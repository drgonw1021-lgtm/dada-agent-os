import { resolve, relative } from "node:path";

export interface SandboxPolicyOptions {
  readRoots: string[];
  writeRoots: string[];
  shellAllowlist: string[];
  webAllowlist: string[];
}

function isInsideRoots(targetPath: string, roots: string[]): boolean {
  const resolvedTarget = resolve(targetPath);
  return roots.some((root) => {
    const resolvedRoot = resolve(root);
    const rel = relative(resolvedRoot, resolvedTarget);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
  });
}

export class SandboxPolicy {
  constructor(private readonly options: SandboxPolicyOptions) {}

  assertReadPath(path: string): void {
    if (!isInsideRoots(path, this.options.readRoots)) {
      throw new Error(`Path "${path}" is outside sandbox read roots`);
    }
  }

  assertWritePath(path: string): void {
    if (!isInsideRoots(path, this.options.writeRoots)) {
      throw new Error(`Path "${path}" is outside sandbox write roots`);
    }
  }

  assertShellCommand(command: string): void {
    const firstToken = command.trim().split(/\s+/)[0] ?? "";
    if (!firstToken || !this.options.shellAllowlist.includes(firstToken)) {
      throw new Error(`Command "${firstToken}" is not allowed by shell allowlist`);
    }
  }

  assertWebUrl(url: string): void {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw new Error(`Invalid URL "${url}"`);
    }
    // Wildcard allows all domains
    if (this.options.webAllowlist.includes("*")) return;
    const allowed = this.options.webAllowlist.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
    if (!allowed) {
      throw new Error(`Domain "${host}" is not allowed by web allowlist`);
    }
  }
}
