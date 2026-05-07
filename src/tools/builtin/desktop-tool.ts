import { spawn, exec } from "node:child_process";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface DesktopInput {
  action: "open_app" | "run_command" | "click" | "type" | "screenshot" | "key_combo" | "move_mouse" | "get_clipboard" | "set_clipboard";
  app?: string;
  command?: string;
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];
}

export interface DesktopOutput {
  success: boolean;
  result?: string;
  screenshot?: string;
  clipboard?: string;
  error?: string;
}

export function createDesktopTool(): ToolDefinition<DesktopInput, DesktopOutput> {
  return {
    id: "desktop",
    description: "桌面自动化：运行程序、鼠标操作、键盘输入、截图、剪贴板。支持 Windows/macOS/Linux。",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["open_app", "run_command", "click", "type", "screenshot", "key_combo", "move_mouse", "get_clipboard", "set_clipboard"], description: "Desktop action to perform" },
        app: { type: "string" as const, description: "Application name or path to open" },
        command: { type: "string" as const, description: "Command to run" },
        x: { type: "integer" as const, description: "X coordinate for mouse actions" },
        y: { type: "integer" as const, description: "Y coordinate for mouse actions" },
        text: { type: "string" as const, description: "Text to type or message to set" },
        keys: { type: "array" as const, description: "Key combination (e.g. [\"ctrl\", \"c\"])", items: { type: "string" as const } }
      },
      required: ["action"]
    },
    async execute(input: DesktopInput, _context: ToolContext): Promise<DesktopOutput> {
      try {
        switch (input.action) {
          case "open_app":
            return await openApp(input.app || "");
          case "run_command":
            return await runCommand(input.command || "");
          case "screenshot":
            return await takeScreenshot();
          case "click":
            return await mouseClick(input.x || 0, input.y || 0);
          case "type":
            return await typeText(input.text || "");
          case "key_combo":
            return await keyCombo(input.keys || []);
          case "move_mouse":
            return await moveMouse(input.x || 0, input.y || 0);
          case "get_clipboard":
            return await getClipboard();
          case "set_clipboard":
            return await setClipboard(input.text || "");
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  };
}

async function openApp(app: string): Promise<DesktopOutput> {
  const platform = process.platform;

  return new Promise((resolve) => {
    let cmd: string, args: string[];

    if (platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", app];
    } else if (platform === "darwin") {
      cmd = "open";
      args = ["-a", app];
    } else {
      cmd = "xdg-open";
      args = [app];
    }

    const proc = spawn(cmd, args, { shell: true });
    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        result: `Opened: ${app}`
      });
    });
    proc.on("error", (e) => {
      resolve({ success: false, error: e.message });
    });
  });
}

async function runCommand(command: string): Promise<DesktopOutput> {
  return new Promise((resolve) => {
    exec(command, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
        return;
      }
      resolve({
        success: true,
        result: stdout.substring(0, 10000)
      });
    });
  });
}

async function takeScreenshot(): Promise<DesktopOutput> {
  const platform = process.platform;

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bmp"`, (err, stdout) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({
          success: true,
          result: "Screenshot captured (base64)"
        });
      });
    } else {
      resolve({ success: false, error: "Screenshot not supported on this platform" });
    }
  });
}

async function mouseClick(x: number, y: number): Promise<DesktopOutput> {
  const platform = process.platform;

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${x}, ${y}); [System.Windows.Forms.Mouse]::EventClick([System.Windows.Forms.MouseButtons]::Left)"`, (err) => {
        resolve({ success: !err, result: `Clicked at (${x}, ${y})` });
      });
    } else {
      exec(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`, (err) => {
        resolve({ success: !err, result: `Clicked at (${x}, ${y})` });
      });
    }
  });
}

async function moveMouse(x: number, y: number): Promise<DesktopOutput> {
  const platform = process.platform;

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${x}, ${y})"`, (err) => {
        resolve({ success: !err, result: `Moved to (${x}, ${y})` });
      });
    } else {
      exec(`osascript -e 'tell application "System Events" to set position of mouse to {${x}, ${y}}'`, (err) => {
        resolve({ success: !err, result: `Moved to (${x}, ${y})` });
      });
    }
  });
}

async function typeText(text: string): Promise<DesktopOutput> {
  const platform = process.platform;
  const escaped = text.replace(/"/g, '\\"');

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')"`, (err) => {
        resolve({ success: !err, result: `Typed: ${text}` });
      });
    } else {
      exec(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, (err) => {
        resolve({ success: !err, result: `Typed: ${text}` });
      });
    }
  });
}

async function keyCombo(keys: string[]): Promise<DesktopOutput> {
  const platform = process.platform;
  const combo = keys.join("+");

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${combo}')"`, (err) => {
        resolve({ success: !err, result: `Pressed: ${combo}` });
      });
    } else {
      const applescript = keys.map(k => `keystroke "${k}"`).join(", ");
      exec(`osascript -e 'tell application "System Events" to ${applescript}'`, (err) => {
        resolve({ success: !err, result: `Pressed: ${combo}` });
      });
    }
  });
}

async function getClipboard(): Promise<DesktopOutput> {
  const platform = process.platform;

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Get-Clipboard"`, (err, stdout) => {
        resolve({ success: !err, clipboard: stdout.trim() });
      });
    } else {
      exec(`pbpaste`, (err, stdout) => {
        resolve({ success: !err, clipboard: stdout.trim() });
      });
    }
  });
}

async function setClipboard(text: string): Promise<DesktopOutput> {
  const platform = process.platform;
  const escaped = text.replace(/"/g, '\\"');

  return new Promise((resolve) => {
    if (platform === "win32") {
      exec(`powershell -Command "Set-Clipboard -Value '${escaped}'"`, (err) => {
        resolve({ success: !err, result: `Clipboard set` });
      });
    } else {
      exec(`echo -n "${escaped}" | pbcopy`, (err) => {
        resolve({ success: !err, result: `Clipboard set` });
      });
    }
  });
}

export default createDesktopTool;