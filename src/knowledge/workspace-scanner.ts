/**
 * Recursive workspace file scanner with configurable include/exclude patterns.
 */

import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname, relative } from "node:path";

export interface ScanOptions {
  /** Directories to scan (relative to workspace root) */
  includeDirs?: string[];
  /** Directories to skip */
  excludeDirs?: string[];
  /** File extensions to include (e.g. [".ts", ".md", ".json"]) */
  includeExtensions?: string[];
  /** Glob-like patterns to exclude */
  excludePatterns?: string[];
  /** Max file size in bytes (default 512KB) */
  maxFileSize?: number;
  /** Max total files to scan (default 1000) */
  maxFiles?: number;
}

export interface ScannedFile {
  absPath: string;
  relPath: string;
  ext: string;
  size: number;
  lastModified: number;
}

const DEFAULT_EXCLUDE_DIRS = [
  "node_modules", ".git", "dist", ".claude", ".agent",
  "__pycache__", ".venv", "venv", ".next", ".nuxt",
  "coverage", ".nyc_output", "tmp", ".cache"
];

const DEFAULT_EXCLUDE_PATTERNS = [
  "*.map", "*.d.ts", "*.min.js", "*.bundle.js",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "*.lock", "*.log", "*.bin"
];

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".md", ".mdx", ".txt", ".rst",
  ".json", ".jsonc", ".json5", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env",
  ".html", ".htm", ".css", ".scss", ".less",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".fs",
  ".sh", ".bash", ".zsh", ".fish", ".ps1",
  ".xml", ".svg", ".csv", ".tsv",
  ".sql", ".graphql", ".proto",
  ".vue", ".svelte", ".astro",
  ".dockerfile", ".makefile", ".gitignore", ".editorconfig"
]);

export function isTextFile(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase());
}

const MAX_FILE_SIZE = 512 * 1024;
const MAX_FILES = 1000;

export async function scanWorkspace(
  rootDir: string,
  options: ScanOptions = {}
): Promise<ScannedFile[]> {
  const {
    includeDirs,
    excludeDirs = DEFAULT_EXCLUDE_DIRS,
    includeExtensions,
    excludePatterns = DEFAULT_EXCLUDE_PATTERNS,
    maxFileSize = MAX_FILE_SIZE,
    maxFiles = MAX_FILES
  } = options;

  const results: ScannedFile[] = [];
  const excludeDirSet = new Set(excludeDirs.map(d => d.toLowerCase()));

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxFiles) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;

      const absPath = join(dir, entry.name);
      const relPath = relative(rootDir, absPath);

      if (entry.isDirectory()) {
        if (excludeDirSet.has(entry.name.toLowerCase())) continue;
        if (entry.name.startsWith(".") && !includeDirs?.includes(entry.name)) continue;
        await walk(absPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (includeExtensions && !includeExtensions.includes(ext)) continue;
        if (!includeExtensions && !TEXT_EXTENSIONS.has(ext)) continue;

        if (matchesPattern(entry.name, excludePatterns)) continue;

        let fileStat;
        try {
          fileStat = await stat(absPath);
        } catch {
          continue;
        }

        if (fileStat.size > maxFileSize) continue;
        if (fileStat.size === 0) continue;

        results.push({
          absPath,
          relPath: relPath.replace(/\\/g, "/"),
          ext: ext || ".txt",
          size: fileStat.size,
          lastModified: fileStat.mtimeMs
        });
      }
    }
  }

  await walk(rootDir);
  return results;
}

function matchesPattern(filename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      if (filename.endsWith(pattern.slice(1))) return true;
    } else if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
        "i"
      );
      if (regex.test(filename)) return true;
    } else if (filename === pattern) {
      return true;
    }
  }
  return false;
}
