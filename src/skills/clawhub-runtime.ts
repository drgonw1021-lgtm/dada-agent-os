import { readFile, readdir, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../core/types.js";
import type { ToolContext } from "../core/types.js";
import type { ToolParam } from "../core/types.js";

const execAsync = promisify(exec);

const SAFE_SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]*(\/[a-zA-Z0-9_.\-]+)?$/;

function assertSafeName(name: string): void {
  if (!SAFE_SKILL_NAME.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Only alphanumeric, hyphens, underscores, dots, and optional org/name format allowed.`);
  }
}

// ─── Manifest Types ───────────────────────────────────────────────────────────

export interface ClawhubSkillManifest {
  name: string;
  description: string;
  version?: string;
  triggers?: string[];
  requires?: {
    env?: string[];
    tools?: string[];
    scripts?: string[];
  };
  assets?: string[];
}

export interface ClawhubScriptTool {
  skillName: string;
  scriptName: string;
  description: string;
  command: string;
  args?: string[];
  inputSchema: ToolParam;
  cwd?: string;
  timeout?: number;
}

export interface ClawhubSkill {
  manifest: ClawhubSkillManifest;
  rootDir: string;
  scripts: ClawhubScriptTool[];
}

// ─── Index Store ─────────────────────────────────────────────────────────────

interface SkillIndex {
  version: number;
  skills: Array<{
    name: string;
    manifest: ClawhubSkillManifest;
    rootDir: string;
    installedAt: string;
  }>;
}

async function readIndex(dir: string): Promise<SkillIndex> {
  try {
    const raw = await readFile(join(dir, "index.json"), "utf8");
    return JSON.parse(raw) as SkillIndex;
  } catch {
    return { version: 1, skills: [] };
  }
}

async function writeIndex(dir: string, index: SkillIndex): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.json"), JSON.stringify(index, null, 2), "utf8");
}

// ─── Manifest Parsing ────────────────────────────────────────────────────────

function parseFrontmatter(content: string): { metadata: Partial<ClawhubSkillManifest>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const meta: Partial<ClawhubSkillManifest> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "name") meta.name = value;
    else if (key === "description") meta.description = value;
    else if (key === "version") meta.version = value;
    else if (key === "triggers") meta.triggers = value.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return { metadata: meta, body: match[2] };
}

function extractInputSchema(body: string, scriptName: string): ToolParam {
  const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`###\\s+${escaped}[\\s\\S]*?\x60{3,}[\\s\\S]*?\x60{3,}`, "i");
  const match = body.match(pattern);
  if (match) {
    const jsonMatch = match[0].match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]) as ToolParam; } catch { /* fall through */ }
    }
  }
  return { type: "object", properties: {}, required: [] };
}

async function spawnAsync(command: string, args: string[], opts: { cwd: string; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, timeout: opts.timeout, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Process exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
    });
    child.on("error", reject);
  });
}

// ─── ClawhubRuntime ──────────────────────────────────────────────────────────

export class ClawhubRuntime {
  private skills = new Map<string, ClawhubSkill>();
  private cliPath: string;
  private skillhubDir: string;

  constructor(skillhubDir: string, cliPath = "npx") {
    this.skillhubDir = resolve(skillhubDir);
    this.cliPath = cliPath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.skillhubDir, { recursive: true });
    await this.scanDirectory();
    console.log(`[ClawhubRuntime] Initialized: ${this.skills.size} skills loaded`);
  }

  private async scanDirectory(): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.skillhubDir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await this.loadSkill(entry.name);
      if (skill) this.skills.set(skill.manifest.name || entry.name, skill);
    }
  }

  async loadSkill(name: string): Promise<ClawhubSkill | null> {
    const rootDir = join(this.skillhubDir, name);
    try { await stat(join(rootDir, "SKILL.md")); } catch { return null; }

    const content = await readFile(join(rootDir, "SKILL.md"), "utf8");
    const { metadata, body } = parseFrontmatter(content);
    if (!metadata.name) metadata.name = name;

    const scripts: ClawhubScriptTool[] = [];
    try {
      const scriptFiles = await readdir(join(rootDir, "scripts"), { withFileTypes: true });
      for (const sf of scriptFiles) {
        if (!sf.isFile()) continue;
        const ext = sf.name.split(".").pop()?.toLowerCase();
        if (!["py", "js", "ts", "sh", "bat", "ps1"].includes(ext ?? "")) continue;
        const scriptName = sf.name.replace(/\.[^.]+$/, "");
        const command = ext === "py" ? "python" : ext === "ts" ? "npx ts-node" : sf.name;
        scripts.push({
          skillName: name,
          scriptName,
          description: `Run ${sf.name} from skill "${name}"`,
          command,
          args: [`./scripts/${sf.name}`],
          inputSchema: extractInputSchema(body, scriptName),
          cwd: rootDir,
          timeout: 60000
        });
      }
    } catch { /* no scripts dir */ }

    return { manifest: metadata as ClawhubSkillManifest, rootDir, scripts };
  }

  async installSkill(name: string): Promise<{ success: boolean; path?: string; error?: string }> {
    assertSafeName(name);
    try {
      await execAsync(`${this.cliPath} clawhub install ${name}`, { cwd: this.skillhubDir, timeout: 120_000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("command not found")) {
        try {
          await spawnAsync("git", ["clone", `https://github.com/clawhub/${name}.git`, name], { cwd: this.skillhubDir, timeout: 60_000 });
        } catch {
          return { success: false, error: `Install failed: ${msg}` };
        }
      } else {
        return { success: false, error: `Install failed: ${msg}` };
      }
    }

    const skill = await this.loadSkill(name);
    if (!skill) return { success: false, error: "Installed but failed to load" };
    this.skills.set(name, skill);
    await this.saveToIndex(skill);
    return { success: true, path: skill.rootDir };
  }

  async uninstallSkill(name: string): Promise<{ success: boolean; error?: string }> {
    const skill = this.skills.get(name);
    if (!skill) return { success: false, error: `Skill "${name}" not found` };
    try { await rm(skill.rootDir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.skills.delete(name);
    await this.removeFromIndex(name);
    return { success: true };
  }

  async searchSkills(query: string): Promise<Array<{ name: string; description: string; author?: string }>> {
    const sanitized = query.replace(/[^a-zA-Z0-9\s_.\-@/]/g, "").trim();
    if (!sanitized) return [];
    try {
      const { stdout } = await execAsync(`${this.cliPath} clawhub search ${sanitized}`, { timeout: 30_000 });
      try {
        return JSON.parse(stdout);
      } catch {
        return stdout.split("\n").filter((l) => l.includes("-")).map((l) => {
          const [name, ...descParts] = l.split("-");
          return { name: name.trim(), description: descParts.join("-").trim() };
        });
      }
    } catch { return []; }
  }

  getToolDefinitions(): ToolDefinition<Record<string, unknown>, unknown>[] {
    const tools: ToolDefinition<Record<string, unknown>, unknown>[] = [];
    for (const skill of this.skills.values()) {
      for (const script of skill.scripts) {
        const scriptRef = script;
        tools.push({
          id: `clawhub:${skill.manifest.name}.${scriptRef.scriptName}`,
          description: scriptRef.description,
          requiredScopes: [],
          riskLevel: "high",
          inputSchema: scriptRef.inputSchema,
          execute: async (input: Record<string, unknown>): Promise<unknown> => {
            const args = scriptRef.args ?? [];
            const cmd = `${scriptRef.command} ${args.join(" ")}`;
            try {
              const { stdout, stderr } = await execAsync(cmd, {
                cwd: scriptRef.cwd ?? this.skillhubDir,
                timeout: scriptRef.timeout ?? 60_000
              });
              return { success: true, stdout, stderr, input };
            } catch (err: unknown) {
              const e = err as { message?: string; stdout?: string; stderr?: string };
              return { success: false, error: e.message ?? "Script execution failed", stdout: e.stdout ?? "", stderr: e.stderr ?? "", input };
            }
          }
        });
      }
    }
    return tools;
  }

  listSkills(): ClawhubSkill[] { return Array.from(this.skills.values()); }
  getSkill(name: string): ClawhubSkill | undefined { return this.skills.get(name); }

  private async saveToIndex(skill: ClawhubSkill): Promise<void> {
    const index = await readIndex(this.skillhubDir);
    const existing = index.skills.findIndex((s) => s.manifest.name === skill.manifest.name);
    const entry = { name: skill.manifest.name!, manifest: skill.manifest, rootDir: skill.rootDir, installedAt: new Date().toISOString() };
    if (existing >= 0) index.skills[existing] = entry; else index.skills.push(entry);
    await writeIndex(this.skillhubDir, index);
  }

  private async removeFromIndex(name: string): Promise<void> {
    const index = await readIndex(this.skillhubDir);
    index.skills = index.skills.filter((s) => s.manifest.name !== name);
    await writeIndex(this.skillhubDir, index);
  }
}

export function createClawhubRuntime(skillhubDir: string, cliPath?: string): ClawhubRuntime {
  return new ClawhubRuntime(skillhubDir, cliPath);
}
