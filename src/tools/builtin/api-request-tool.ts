import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface ApiRequestInput {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout?: number;
}

export interface ApiRequestOutput {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}

const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

export function createApiRequestTool(allowlist: string[]): ToolDefinition<ApiRequestInput, ApiRequestOutput> {
  function isAllowed(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      for (const blocked of BLOCKED_HOSTS) {
        if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
          return false;
        }
      }

      if (allowlist.length > 0) {
        return allowlist.some(
          (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  return {
    id: "api.request",
    description: "Make HTTP API requests (GET, POST, PUT, DELETE, PATCH)",
    requiredScopes: ["web.fetch"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Request URL" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], description: "HTTP method (default GET)" },
        headers: { type: "object", additionalProperties: { type: "string" }, description: "Request headers" },
        body: { type: "object", description: "Request body (string or object)" },
        timeout: { type: "number", description: "Timeout in milliseconds (default 30000)" }
      },
      required: ["url"]
    },
    async execute(input: ApiRequestInput, context: ToolContext): Promise<ApiRequestOutput> {
      const { url, method = "GET", headers = {}, body, timeout = 30000 } = input;

      if (!isAllowed(url)) {
        return { success: false, error: `URL not allowed: ${url}` };
      }

      try {
        const response = await fetch(url, {
          method,
          headers: {
            "User-Agent": "dada-agent/1.0",
            ...headers
          },
          body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
          signal: AbortSignal.timeout(timeout)
        });

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        let responseBody: string;
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const json = await response.json();
          responseBody = JSON.stringify(json, null, 2);
        } else {
          responseBody = await response.text();
        }

        return {
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}
