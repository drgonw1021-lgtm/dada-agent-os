import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ClawhubSkill } from "./clawhub-runtime.js";

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  triggers?: string[];
  requires?: { env?: string[]; tools?: string[] };
}

export interface Skill {
  metadata: SkillMetadata;
  instructions: string;
  tools?: Record<string, unknown>;
}

export interface LoadedSkill {
  metadata: SkillMetadata;
  instructions: string;
  toolDefinitions?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

const SKILL_FILE = "SKILL.md";

function parseFrontmatter(content: string): { metadata: SkillMetadata; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: { name: "unknown", description: "" }, body: content };
  const meta: SkillMetadata = { name: "", description: "" };
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":"); if (idx === -1) continue;
    const key = line.slice(0, idx).trim(); const val = line.slice(idx + 1).trim();
    if (key === "name") meta.name = val;
    else if (key === "description") meta.description = val;
    else if (key === "version") meta.version = val;
    else if (key === "triggers") meta.triggers = val.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return { metadata: meta, body: match[2] };
}

export class SkillLoader {
  private skills = new Map<string, LoadedSkill>();

  async loadFromDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const content = await readFile(join(dirPath, entry.name, SKILL_FILE), "utf8");
          const { metadata, body } = parseFrontmatter(content);
          if (!metadata.name) metadata.name = entry.name;
          this.skills.set(metadata.name, { metadata, instructions: body.trim(), toolDefinitions: this.extractToolDefinitions(body) });
          console.log("[Skills] Loaded: " + metadata.name);
        } catch { /* skip */ }
      }
    } catch { console.log("[Skills] No skills directory at " + dirPath); }
  }

  private extractToolDefinitions(content: string): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> | undefined {
    const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
    const pat = /### (\w+)\s*\n([\s\S]*?)(?=\n### |\n## |\n#|$)/g; let m;
    while ((m = pat.exec(content)) !== null) {
      const name = m[1].trim(); const firstLine = m[2].trim().split("\n")[0];
      tools.push({ name, description: firstLine, inputSchema: { type: "object", properties: {} } });
    }
    return tools.length > 0 ? tools : undefined;
  }

  get(name: string): LoadedSkill | undefined { return this.skills.get(name); }
  list(): LoadedSkill[] { return Array.from(this.skills.values()); }

  getInstructionsForTask(task: string): string {
    const matching: string[] = [];
    for (const skill of this.skills.values()) {
      const triggers = skill.metadata.triggers || [];
      if (triggers.some((t) => task.toLowerCase().includes(t.toLowerCase()))) { matching.push(skill.instructions); continue; }
      if (skill.metadata.description && task.toLowerCase().includes(skill.metadata.name.replace(/_/g, " "))) matching.push(skill.instructions);
    }
    return matching.length > 0 ? "\n## Relevant Skills\n\n" + matching.join("\n\n---\n\n") : "";
  }

  /** Merge skills from a ClaWHub runtime so capability router also sees ClaWHub-installed skills. */
  async loadFromClawhub(clawhubSkills: ClawhubSkill[]): Promise<void> {
    for (const skill of clawhubSkills) {
      const name = skill.manifest.name ?? "unknown";
      if (this.skills.has(name)) continue;
      this.skills.set(name, {
        metadata: { name, description: skill.manifest.description ?? "", version: skill.manifest.version, triggers: skill.manifest.triggers },
        instructions: skill.scripts.map((s) => "### clawhub:" + name + "." + s.scriptName + "\n" + s.description).join("\n\n"),
        toolDefinitions: skill.scripts.map((s) => ({ name: s.scriptName, description: s.description, inputSchema: s.inputSchema as unknown as Record<string, unknown> }))
      });
      console.log("[SkillLoader] Merged from ClaWHub: " + name + " (" + skill.scripts.length + " scripts)");
    }
  }
}

export function createSkillLoader(): SkillLoader { return new SkillLoader(); }
