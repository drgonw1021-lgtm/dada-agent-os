"use strict";

const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require("electron");
const { fork } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

const PORT = Number(process.env.PORT || "9877");
const URL = `http://localhost:${PORT}`;
const isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev");

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, "..", "dist", "server.js");

    serverProcess = fork(serverPath, [], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });

    let started = false;

    serverProcess.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write("[server] " + text);
      if (!started && text.includes("DaDa UI running at")) {
        started = true;
        resolve();
      }
    });

    serverProcess.stderr?.on("data", (chunk) => {
      process.stderr.write("[server:err] " + chunk.toString());
    });

    serverProcess.on("error", (err) => {
      if (!started) reject(err);
    });

    serverProcess.on("exit", (code) => {
      if (!started) {
        reject(new Error(`Server exited with code ${code} before starting`));
      }
    });

    // Timeout after 30s
    setTimeout(() => {
      if (!started) reject(new Error("Server start timeout"));
    }, 30000);
  });
}

function waitForServer() {
  return new Promise((resolve) => {
    const check = () => {
      http.get(`${URL}/api/health`, (res) => {
        resolve();
      }).on("error", () => {
        setTimeout(check, 500);
      });
    };
    check();
  });
}

function createTrayIcon() {
  // Create a 16x16 tray icon from raw pixel data (DaDa "D" monogram)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Draw a simple rounded square with "D"
      const cx = size / 2, cy = size / 2;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inCircle = dist < 7;
      const inInner = dist < 4;
      // Left half of D character
      const isD = inCircle && x < 11 && x > 4 && y > 3 && y < 12 &&
        !(x > 5 && x < 8 && y > 5 && y < 10);

      if (isD || (inCircle && !inInner && x >= 8)) {
        buf[idx] = 125;     // R
        buf[idx + 1] = 184; // G
        buf[idx + 2] = 255; // B
        buf[idx + 3] = 255; // A
      } else {
        buf[idx + 3] = 0;   // transparent
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
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
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip("DaDa AI Agent");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
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

  mainWindow.loadURL(URL);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // Minimize to tray instead of closing
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
    await startServer();
    console.log("[electron] Server started, waiting for health check...");
    await waitForServer();
    console.log("[electron] Server healthy, creating window...");
    createWindow();
    createTrayIcon();
  } catch (err) {
    console.error("[electron] Failed to start:", err.message);
    dialog.showErrorBox("Startup Error", `Failed to start DaDa server:\n${err.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // Don't quit on macOS unless explicitly quitting
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
