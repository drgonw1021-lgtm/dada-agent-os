import { exec } from "node:child_process";
import { cpus, totalmem, freemem, hostname, platform, release, arch, uptime } from "node:os";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface SystemInput {
  action: "info" | "cpu" | "memory" | "processes" | "disk";
}

export interface SystemOutput {
  success: boolean;
  data?: any;
  error?: string;
}

export function createSystemTool(): ToolDefinition<SystemInput, SystemOutput> {
  return {
    id: "system",
    description: "系统信息：获取 CPU、内存、进程、磁盘信息",
    requiredScopes: [] as PermissionScope[],
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["info", "cpu", "memory", "processes", "disk"], description: "System info action" }
      },
      required: ["action"]
    },
    async execute(input: SystemInput, _context: ToolContext): Promise<SystemOutput> {
      try {
        switch (input.action) {
          case "info":
            return {
              success: true,
              data: {
                hostname: hostname(),
                platform: platform(),
                release: release(),
                arch: arch(),
                uptime: uptime(),
                cpus: cpus().length,
                totalMemory: totalmem(),
                freeMemory: freemem()
              }
            };
          case "cpu":
            return {
              success: true,
              data: {
                count: cpus().length,
                models: [...new Set(cpus().map(c => c.model))]
              }
            };
          case "memory":
            const total = totalmem();
            const free = freemem();
            return {
              success: true,
              data: {
                total: total,
                free: free,
                used: total - free,
                usagePercent: ((total - free) / total * 100).toFixed(2)
              }
            };
          case "processes":
            return await listProcesses();
          case "disk":
            return await getDiskInfo();
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  };
}

async function listProcesses(): Promise<SystemOutput> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32"
      ? "tasklist /FO CSV /NH"
      : "ps aux";

    exec(cmd, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ success: false, error: err.message });
        return;
      }

      if (process.platform === "win32") {
        const processes = stdout.split("\n")
          .filter(line => line.trim())
          .slice(0, 20)
          .map(line => {
            const parts = line.split(",");
            return { name: parts[0]?.replace(/"/g, ""), pid: parts[1]?.replace(/"/g, "") };
          });
        resolve({ success: true, data: processes });
      } else {
        const processes = stdout.split("\n")
          .filter(line => line.trim())
          .slice(0, 20)
          .map(line => {
            const parts = line.split(/\s+/);
            return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(" ") };
          });
        resolve({ success: true, data: processes });
      }
    });
  });
}

async function getDiskInfo(): Promise<SystemOutput> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32"
      ? "wmic logicaldisk get size,freespace,caption"
      : "df -h";

    exec(cmd, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ success: false, error: err.message });
        return;
      }
      resolve({ success: true, data: stdout });
    });
  });
}

export default createSystemTool;