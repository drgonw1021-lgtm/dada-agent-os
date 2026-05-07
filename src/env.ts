import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE_ORDER = [".env", ".env.local"] as const;

function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    // Strip matching surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

export function loadEnvironmentFiles(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string[] {
  const loadedFiles: string[] = [];
  const originalKeys = new Set(
    Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
  );

  for (const relativePath of ENV_FILE_ORDER) {
    const absolutePath = resolve(cwd, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const parsed = parseEnvFile(readFileSync(absolutePath, "utf8"));
    const shouldOverrideEarlierFiles = relativePath === ".env.local";

    for (const [key, value] of Object.entries(parsed)) {
      if (originalKeys.has(key)) {
        continue;
      }

      if (!shouldOverrideEarlierFiles && env[key] !== undefined) {
        continue;
      }

      env[key] = value;
    }

    loadedFiles.push(absolutePath);
  }

  return loadedFiles;
}
