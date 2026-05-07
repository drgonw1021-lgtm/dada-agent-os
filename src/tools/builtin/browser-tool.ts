import { spawn, exec } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface BrowserInput {
  action: "open" | "screenshot" | "get_content" | "execute" | "click" | "type" | "scroll" | "wait";
  url?: string;
  selector?: string;
  text?: string;
  code?: string;
  selectorType?: "css" | "xpath" | "text";
  timeout?: number;
}

export interface BrowserOutput {
  success: boolean;
  result?: string;
  data?: string;
  screenshot?: string;
  error?: string;
}

function jsStr(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

async function tryPlaywright(action: BrowserInput): Promise<BrowserOutput> {
  const playwrightScript = `
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    ${getActionCode(action)}

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    await browser.close();
    process.exit(1);
  }
})();
`;

  const scriptPath = join(tmpdir(), `browser_${Date.now()}.js`);
  await writeFile(scriptPath, playwrightScript, "utf-8");

  return new Promise((resolve) => {
    exec(`node "${scriptPath}"`, { timeout: action.timeout || 30000, maxBuffer: 10 * 1024 * 1024 }, async (err, stdout, stderr) => {
      try { await unlink(scriptPath); } catch { /* cleanup */ }

      if (err) {
        resolve({ success: false, error: stderr || err.message });
        return;
      }

      try {
        const output = JSON.parse(stdout);
        resolve(output);
      } catch {
        resolve({ success: false, error: "Failed to parse output" });
      }
    });
  });
}

function getActionCode(action: BrowserInput): string {
  const timeout = action.timeout || 30000;
  switch (action.action) {
    case "open":
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
console.log(JSON.stringify({ success: true, result: 'Opened ' + ${jsStr(action.url)} }));
`;
    case "screenshot":
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
const screenshot = await page.screenshot({ encoding: 'base64' });
console.log(JSON.stringify({ success: true, screenshot }));
`;
    case "get_content":
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.waitForLoadState('networkidle');
const content = await page.content();
console.log(JSON.stringify({ success: true, data: content.substring(0, 50000) }));
`;
    case "execute":
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
const result = await page.evaluate((code) => eval(code), ${jsStr(action.code)});
console.log(JSON.stringify({ success: true, result: String(result) }));
`;
    case "click":
      if (action.selectorType === "text") {
        return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.getByText(${jsStr(action.selector)}).first().click();
console.log(JSON.stringify({ success: true, result: 'Clicked element' }));
`;
      }
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.locator(${jsStr(action.selector)}).first().click();
console.log(JSON.stringify({ success: true, result: 'Clicked element' }));
`;
    case "type":
      if (action.selectorType === "text") {
        return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.getByLabel(${jsStr(action.selector)}).fill(${jsStr(action.text)});
console.log(JSON.stringify({ success: true, result: 'Typed text' }));
`;
      }
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.locator(${jsStr(action.selector)}).fill(${jsStr(action.text)});
console.log(JSON.stringify({ success: true, result: 'Typed text' }));
`;
    case "scroll":
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
console.log(JSON.stringify({ success: true, result: 'Scrolled to bottom' }));
`;
    case "wait":
      return `
await page.goto(${jsStr(action.url)}, { timeout: ${timeout} });
await page.waitForTimeout(${timeout});
console.log(JSON.stringify({ success: true, result: 'Waited' }));
`;
    default:
      return `console.log(JSON.stringify({ success: false, error: 'Unknown action' }));`;
  }
}

export function createBrowserTool(): ToolDefinition<BrowserInput, BrowserOutput> {
  return {
    id: "browser",
    description: "Browser automation: open pages, screenshot, get content, execute JS, click, type",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["open", "screenshot", "get_content", "execute", "click", "type", "scroll", "wait"], description: "Browser action" },
        url: { type: "string", description: "URL to open" },
        selector: { type: "string", description: "CSS/XPath selector" },
        text: { type: "string", description: "Text to type" },
        code: { type: "string", description: "JS code to execute" },
        selectorType: { type: "string", enum: ["css", "xpath", "text"], description: "Selector type" },
        timeout: { type: "number", description: "Timeout in ms" }
      },
      required: ["action"]
    },
    async execute(input: BrowserInput, _context: ToolContext): Promise<BrowserOutput> {
      if (!existsSync(join(process.cwd(), "node_modules", "playwright"))) {
        return basicBrowserAction(input);
      }

      try {
        return await tryPlaywright(input);
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

function basicBrowserAction(input: BrowserInput): Promise<BrowserOutput> {
  if (input.action === "open" && input.url) {
    return new Promise((resolve) => {
      const url = input.url!.replace(/[;&|`$()]/g, "");
      const isWindows = process.platform === "win32";
      const cmd = isWindows ? "start" : "open";
      const args = isWindows ? ["", url] : [url];
      const child = spawn(cmd, args, { shell: true, timeout: 10000 });
      child.on("close", (code) => {
        resolve({
          success: code === 0,
          result: `Opened ${url} in system browser`
        });
      });
      child.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  return Promise.resolve({
    success: false,
    error: "Full browser automation requires Playwright. Install: npm install playwright && npx playwright install chromium"
  });
}

export default createBrowserTool;

export async function checkBrowserCapability(): Promise<{ available: boolean; reason?: string }> {
  try {
    await import("playwright");
    return { available: true };
  } catch {
    return { available: false, reason: "Playwright not installed. Run: npm install playwright && npx playwright install chromium" };
  }
}
