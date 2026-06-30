"use strict";

const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { exec } = require("node:child_process");

let mainWindow = null;
let tray = null;
let isQuitting = false;
let serverPort = 9877;

function resolveAppPaths() {
  const devRoot = path.join(__dirname, "..");
  const devServer = path.join(devRoot, "dist", "server.js");

  // In packaged app, import from asar path so ESM resolver finds node_modules/ inside asar.
  // Asar auto-redirects dist/** to the unpacked files.
  const packedAsarRoot = path.join(process.resourcesPath, "app.asar");
  const packedServer = path.join(packedAsarRoot, "dist", "server.js");
  const packedUnpacked = path.join(process.resourcesPath, "app.asar.unpacked");
  try {
    if (fs.existsSync(packedUnpacked)) {
      return { appRoot: packedUnpacked, serverPath: packedServer };
    }
  } catch {}

  return { appRoot: devRoot, serverPath: devServer };
}

function ensureEnv(appRoot) {
  const envPath = path.join(appRoot, ".env");
  const examplePath = path.join(appRoot, ".env.example");
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    try {
      fs.copyFileSync(examplePath, envPath);
      console.log("[electron] Created .env from .env.example");
    } catch (err) {
      console.warn("[electron] Could not create .env:", err.message);
    }
  }
}

/** Clean up stale data from previous versions that could cause issues */
function migrateFromPreviousVersion(appRoot) {
  const versionFile = path.join(appRoot, ".agent", ".version");
  let prevVersion = "0.0.0";
  try {
    if (fs.existsSync(versionFile)) {
      prevVersion = fs.readFileSync(versionFile, "utf8").trim();
    }
  } catch {}

  const currentVersion = "0.6.0";

  // Migration: clean stale checkpoints (caused task recovery loops in v0.5.x)
  if (prevVersion !== currentVersion) {
    console.log(`[electron] Migrating from v${prevVersion} to v${currentVersion}`);
    const checkpointsDir = path.join(appRoot, ".agent", "checkpoints");
    if (fs.existsSync(checkpointsDir)) {
      try {
        fs.rmSync(checkpointsDir, { recursive: true, force: true });
        fs.mkdirSync(checkpointsDir, { recursive: true });
        console.log("[electron] Cleaned stale checkpoints");
      } catch (err) {
        console.warn("[electron] Checkpoint cleanup failed:", err.message);
      }
    }
    // Ensure .agent directory exists
    const agentDir = path.join(appRoot, ".agent");
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }
    // Write version stamp
    try { fs.writeFileSync(versionFile, currentVersion, "utf8"); } catch {}
  }
}

function readEnvPort(appRoot) {
  // Try .env.local first (higher priority), then .env
  for (const name of [".env.local", ".env"]) {
    const p = path.join(appRoot, name);
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8");
        const m = content.match(/^PORT\s*=\s*(\d+)/m);
        if (m) return Number(m[1]);
      }
    } catch {}
  }
  return 9877;
}

async function startServer() {
  const { appRoot, serverPath } = resolveAppPaths();
  const port = readEnvPort(appRoot);

  // Run the server in-process (not a child process)
  process.chdir(appRoot);
  process.env.DADA_EMBEDDED = "1";
  process.env.NO_BROWSER = "1";
  process.env.NODE_ENV = "production";

  const mod = await import(pathToFileURL(serverPath).href);
  // main() starts listening but returns before the callback fires
  await mod.main();

  // Poll until the server responds
  await new Promise((resolve, reject) => {
    const maxWait = 30000;
    const start = Date.now();
    const check = () => {
      http.get(`http://localhost:${port}/api/health`, (res) => {
        resolve();
      }).on("error", () => {
        if (Date.now() - start > maxWait) {
          reject(new Error("Server health check timeout"));
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });

  return port;
}

function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = size / 2, cy = size / 2;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inCircle = dist < 7;
      const inInner = dist < 4;
      const isD = inCircle && x < 11 && x > 4 && y > 3 && y < 12 &&
        !(x > 5 && x < 8 && y > 5 && y < 10);

      if (isD || (inCircle && !inInner && x >= 8)) {
        buf[idx] = 125;
        buf[idx + 1] = 184;
        buf[idx + 2] = 255;
        buf[idx + 3] = 255;
      } else {
        buf[idx + 3] = 0;
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  tray = new Tray(icon);

  // Find NSIS uninstaller next to the app executable (installed version only)
  const uninstallerPath = path.join(path.dirname(process.execPath), "Uninstall DaDa.exe");

  const menuItems = [
    {
      label: "Show DaDa",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    ...(fs.existsSync(uninstallerPath)
      ? [{
          label: "Uninstall DaDa",
          click: () => {
            // Launch uninstaller detached, then quit
            exec(`"${uninstallerPath}"`, { detached: true });
            isQuitting = true;
            app.quit();
          }
        },
        { type: "separator" }]
      : []),
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];

  const contextMenu = Menu.buildFromTemplate(menuItems);

  tray.setToolTip("DaDa AI Agent");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(port) {
  const url = `http://localhost:${port}`;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "DaDa",
    icon: path.join(__dirname, "..", "web", "dada-icon.jpg"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: "#06060e",
    show: false
  });

  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const { appRoot } = resolveAppPaths();
    ensureEnv(appRoot);
    migrateFromPreviousVersion(appRoot);
    console.log("[electron] Starting server in-process...");
    serverPort = await startServer();
    console.log(`[electron] Server healthy on port ${serverPort}, creating window...`);
    createWindow(serverPort);
    createTrayIcon();
  } catch (err) {
    console.error("[electron] Failed to start:", err.message);
    dialog.showErrorBox("Startup Error", `Failed to start DaDa server:\n${err.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(serverPort);
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});
