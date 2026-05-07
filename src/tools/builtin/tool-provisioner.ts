import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import type { ToolDefinition } from "../../core/types.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface InstallRecipe {
  tool: string;
  method: "pip" | "pipx" | "npm" | "npx" | "apt" | "brew" | "choco" | "winget" | "curl" | "git" | "builtin";
  command: string;
  check: string;
  note?: string;
}

interface ScanResult {
  available: string[];
  missing: string[];
  recipes: InstallRecipe[];
  scannedAt: string;
}

// ── Known tools database ───────────────────────────────────────────────────

const KNOWN_TOOLS: Record<string, InstallRecipe> = {
  // Python ecosystem
  "python":     { tool: "python", method: "builtin", command: "", check: "python --version || python3 --version", note: "Requires Python installed from python.org or system package manager" },
  "python3":    { tool: "python3", method: "builtin", command: "", check: "python3 --version" },
  "pip":        { tool: "pip", method: "builtin", command: "python -m ensurepip", check: "pip --version || python -m pip --version" },
  "pytest":     { tool: "pytest", method: "pip", command: "pip install pytest", check: "pytest --version || python -m pytest --version" },
  "jupyter":    { tool: "jupyter", method: "pip", command: "pip install jupyter", check: "jupyter --version" },
  "pandas":     { tool: "pandas", method: "pip", command: "pip install pandas", check: "python -c \"import pandas\"" },
  "numpy":      { tool: "numpy", method: "pip", command: "pip install numpy", check: "python -c \"import numpy\"" },
  "matplotlib": { tool: "matplotlib", method: "pip", command: "pip install matplotlib", check: "python -c \"import matplotlib\"" },
  "scipy":      { tool: "scipy", method: "pip", command: "pip install scipy", check: "python -c \"import scipy\"" },
  "flask":      { tool: "flask", method: "pip", command: "pip install flask", check: "python -c \"import flask\"" },
  "fastapi":    { tool: "fastapi", method: "pip", command: "pip install fastapi uvicorn", check: "python -c \"import fastapi\"" },
  "django":     { tool: "django", method: "pip", command: "pip install django", check: "python -c \"import django\"" },
  "requests":   { tool: "requests", method: "pip", command: "pip install requests", check: "python -c \"import requests\"" },
  "pillow":     { tool: "pillow", method: "pip", command: "pip install Pillow", check: "python -c \"from PIL import Image\"" },
  "openpyxl":   { tool: "openpyxl", method: "pip", command: "pip install openpyxl", check: "python -c \"import openpyxl\"" },
  "pdfkit":     { tool: "pdfkit", method: "pip", command: "pip install pdfkit", check: "python -c \"import pdfkit\"", note: "Also requires wkhtmltopdf system package" },
  "reportlab":  { tool: "reportlab", method: "pip", command: "pip install reportlab", check: "python -c \"import reportlab\"" },

  // Node.js ecosystem
  "node":       { tool: "node", method: "builtin", command: "", check: "node --version", note: "Install from https://nodejs.org" },
  "npm":        { tool: "npm", method: "builtin", command: "", check: "npm --version" },
  "npx":        { tool: "npx", method: "builtin", command: "", check: "npx --version" },
  "yarn":       { tool: "yarn", method: "npm", command: "npm install -g yarn", check: "yarn --version" },
  "pnpm":       { tool: "pnpm", method: "npm", command: "npm install -g pnpm", check: "pnpm --version" },
  "typescript": { tool: "typescript", method: "npm", command: "npm install -g typescript", check: "tsc --version" },
  "tsx":        { tool: "tsx", method: "npm", command: "npm install -g tsx", check: "tsx --version" },

  // System tools
  "git":        { tool: "git", method: "builtin", command: "", check: "git --version", note: "Install from https://git-scm.com" },
  "curl":       { tool: "curl", method: "builtin", command: "", check: "curl --version" },
  "wget":       { tool: "wget", method: "choco", command: "choco install wget", check: "wget --version" },
  "tar":        { tool: "tar", method: "builtin", command: "", check: "tar --version" },
  "ffmpeg":     { tool: "ffmpeg", method: "choco", command: "choco install ffmpeg", check: "ffmpeg -version", note: "Or: winget install ffmpeg" },
  "tesseract":  { tool: "tesseract", method: "choco", command: "choco install tesseract", check: "tesseract --version", note: "OCR engine. Or: winget install UB-Mannheim.Tesseract" },
  "imagemagick":{ tool: "imagemagick", method: "choco", command: "choco install imagemagick", check: "magick --version" },
  "wkhtmltopdf":{ tool: "wkhtmltopdf", method: "choco", command: "choco install wkhtmltopdf", check: "wkhtmltopdf --version", note: "Or: winget install wkhtmltopdf" },
  "pandoc":     { tool: "pandoc", method: "choco", command: "choco install pandoc", check: "pandoc --version", note: "Or: winget install pandoc" },

  // System utils (Windows)
  "choco":      { tool: "choco", method: "builtin", command: "", check: "choco --version", note: "Windows package manager. Install: https://chocolatey.org/install" },
  "winget":     { tool: "winget", method: "builtin", command: "", check: "winget --version", note: "Built-in Windows package manager (Win10+)" },
  "docker":     { tool: "docker", method: "builtin", command: "", check: "docker --version", note: "Install Docker Desktop from https://docker.com" },
};

// ── PATH scanning ──────────────────────────────────────────────────────────

const CACHE_DIR = join(process.cwd(), ".agent", "cache");
const SCAN_CACHE_FILE = join(CACHE_DIR, "tool-scan.json");
const SCAN_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function which(command: string): string | null {
  try {
    const isWin = platform() === "win32";
    const check = isWin ? `where "${command}" 2>nul` : `which "${command}" 2>/dev/null`;
    const result = execSync(check, { timeout: 5000, stdio: "pipe", shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash" });
    return result.toString().trim() || null;
  } catch {
    return null;
  }
}

function scanAvailableTools(): { available: string[]; missing: string[] } {
  const available: string[] = [];
  const missing: string[] = [];

  for (const [name, recipe] of Object.entries(KNOWN_TOOLS)) {
    // For "builtin" tools, we still try which to see if they're in PATH
    if (which(name)) {
      available.push(name);
    } else {
      missing.push(name);
    }
  }

  return { available, missing };
}

function findRecipesForTask(goal: string): InstallRecipe[] {
  const lower = goal.toLowerCase();
  const keywords: Record<string, string[]> = {
    "pdf": ["pdfkit", "reportlab", "wkhtmltopdf", "pandoc"],
    "excel": ["openpyxl", "pandas"],
    "image": ["pillow", "imagemagick", "ffmpeg"],
    "video": ["ffmpeg"],
    "ocr": ["tesseract", "pillow"],
    "web": ["flask", "fastapi", "django", "requests"],
    "data": ["pandas", "numpy", "matplotlib"],
    "chart": ["matplotlib"],
    "doc": ["pandoc", "pdfkit"],
    "code": ["typescript", "tsx", "node", "git"],
  };

  const matchedTools = new Set<string>();
  for (const [keyword, tools] of Object.entries(keywords)) {
    if (lower.includes(keyword)) {
      for (const t of tools) matchedTools.add(t);
    }
  }

  return [...matchedTools].map(t => KNOWN_TOOLS[t]).filter(Boolean);
}

// ── Cache management ───────────────────────────────────────────────────────

function loadScanCache(): ScanResult | null {
  try {
    if (!existsSync(SCAN_CACHE_FILE)) return null;
    const raw = readFileSync(SCAN_CACHE_FILE, "utf-8");
    const cached = JSON.parse(raw) as ScanResult;
    const age = Date.now() - new Date(cached.scannedAt).getTime();
    if (age > SCAN_CACHE_TTL) return null;
    return cached;
  } catch {
    return null;
  }
}

function saveScanCache(result: ScanResult): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(SCAN_CACHE_FILE, JSON.stringify(result, null, 2), "utf-8");
  } catch { /* non-critical */ }
}

// ── Tool definition ────────────────────────────────────────────────────────

interface ProvisionerInput {
  action: "scan" | "ensure" | "suggest" | "install";
  tool?: string;
  goal?: string;
}

interface ProvisionerOutput {
  action: string;
  available?: string[];
  missing?: string[];
  recipe?: InstallRecipe;
  suggestions?: InstallRecipe[];
  message: string;
}

export function createToolProvisioner(): ToolDefinition<ProvisionerInput, ProvisionerOutput> {
  return {
    id: "tool.provision",
    description: "Scan available system tools, get install recipes for missing tools, or suggest tools for a task. Use when a command is 'not found' or you need a tool you don't have.",
    riskLevel: "medium",
    requiredScopes: ["shell.exec"],
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "scan: list all available/missing tools. ensure: check a specific tool and get install recipe if missing. suggest: find tools relevant to a task goal. install: get one-line install command for a tool.",
          enum: ["scan", "ensure", "suggest", "install"]
        },
        tool: { type: "string", description: "Tool name for ensure/install actions (e.g. 'pandas', 'ffmpeg', 'tesseract')" },
        goal: { type: "string", description: "Task description for suggest action" }
      },
      required: ["action"]
    },

    async execute(input) {
      // Try cache first
      let cached = loadScanCache();
      if (!cached) {
        const { available, missing } = scanAvailableTools();
        cached = {
          available,
          missing,
          recipes: [],
          scannedAt: new Date().toISOString()
        };
        saveScanCache(cached);
      }

      switch (input.action) {
        case "scan": {
          // Re-scan if cache is stale
          const { available, missing } = scanAvailableTools();
          const result: ScanResult = { available, missing, recipes: [], scannedAt: new Date().toISOString() };
          saveScanCache(result);
          return {
            action: "scan",
            available,
            missing,
            message: `Found ${available.length} tools available, ${missing.length} missing. Use "ensure" action to get install recipes for missing tools.`
          };
        }

        case "ensure": {
          if (!input.tool) {
            return { action: "ensure", message: "Please specify a tool name to check." };
          }
          const toolName = input.tool.toLowerCase();
          const isAvailable = which(toolName) !== null;
          const recipe = KNOWN_TOOLS[toolName];

          if (isAvailable) {
            return { action: "ensure", available: [toolName], message: `Tool "${toolName}" is available in PATH.` };
          }

          if (recipe && recipe.method !== "builtin") {
            return {
              action: "ensure",
              missing: [toolName],
              recipe,
              message: `Tool "${toolName}" is NOT available. Install: ${recipe.command}${recipe.note ? ` (Note: ${recipe.note})` : ""}`
            };
          }

          if (recipe && recipe.method === "builtin") {
            return {
              action: "ensure",
              missing: [toolName],
              message: `Tool "${toolName}" is NOT available. ${recipe.note || "This tool must be installed manually."}`
            };
          }

          return {
            action: "ensure",
            missing: [toolName],
            message: `Tool "${toolName}" is not in the known tools database and is not available in PATH. Try "suggest" to find related tools.`
          };
        }

        case "suggest": {
          if (!input.goal) {
            return { action: "suggest", message: "Please provide a task goal to get tool suggestions." };
          }
          const suggestions = findRecipesForTask(input.goal);
          const suggestWithStatus = suggestions.map(s => ({
            ...s,
            available: which(s.tool) !== null
          }));
          return {
            action: "suggest",
            suggestions: suggestWithStatus,
            message: suggestions.length > 0
              ? `Found ${suggestions.length} relevant tools. ${suggestWithStatus.filter(s => !s.available).length} need installation.`
              : "No specific tool suggestions found for this task. Try 'scan' to see all known tools."
          };
        }

        case "install": {
          if (!input.tool) {
            return { action: "install", message: "Please specify a tool name to get install instructions." };
          }
          const recipe = KNOWN_TOOLS[input.tool.toLowerCase()];
          if (!recipe) {
            return { action: "install", message: `Tool "${input.tool}" is not in the known tools database. Try "suggest" to find related tools.` };
          }
          if (recipe.method === "builtin") {
            return {
              action: "install",
              recipe,
              message: `${recipe.tool} requires manual installation. ${recipe.note || ""} Use shell.exec to run the check command to verify: ${recipe.check}`
            };
          }
          return {
            action: "install",
            recipe,
            message: `To install ${recipe.tool}, run via shell.exec: ${recipe.command}. Then verify with: ${recipe.check}`
          };
        }

        default:
          return { action: input.action, message: `Unknown action: ${input.action}. Use scan, ensure, suggest, or install.` };
      }
    }
  };
}
