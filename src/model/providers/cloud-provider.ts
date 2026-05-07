import type { ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk, ToolCall } from "../../core/types.js";
import { joinEndpoint, stripProviderPrefix } from "../provider-utils.js";

export interface CloudProviderOptions {
  endpoint: string;
  apiKey?: string;
}

export class CloudProvider implements ModelProvider {
  readonly kind = "cloud" as const;
  readonly name = "openai-compatible";

  constructor(private readonly options: CloudProviderOptions) {}

  configure(next: Partial<CloudProviderOptions>): void {
    if (typeof next.endpoint === "string" && next.endpoint.trim()) {
      this.options.endpoint = next.endpoint.trim();
    }
    if ("apiKey" in next) {
      this.options.apiKey = next.apiKey?.trim() || undefined;
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.options.apiKey) {
      throw new Error("Cloud provider requires CLOUD_API_KEY");
    }
    const model = stripProviderPrefix(request.model, this.name);
    // R1-family reasoners reject system role, temperature, and tools
    const needsR1Compat = /reasoner|r1/i.test(model) && !/v4/i.test(model);
    // Models with thinking/reasoning capability (R1, V4 series)
    const hasThinking = /reasoner|r1|deepseek.*v4|v4.*(pro|flash)/i.test(model);
    // Only R1 needs system merge; V4 supports system role natively
    const needsSystemMerge = needsR1Compat;

    let messages = request.messages.map((msg: any) => {
      const out: any = { role: msg.role, content: msg.content ?? null };
      if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
      if (msg.toolCallId) out.tool_call_id = out.tool_call_id || msg.toolCallId;
      if (msg.name) out.name = msg.name;
      // DeepSeek thinking mode: must pass reasoning_content back if present
      if (msg.reasoning_content) out.reasoning_content = msg.reasoning_content;
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out.tool_calls = msg.toolCalls.map((tc: ToolCall) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }));
      }
      return out;
    });

    if (needsSystemMerge) {
      const systemContents: string[] = [];
      const nonSystem: typeof messages = [];
      for (const m of messages) {
        if (m.role === "system") {
          systemContents.push(m.content ?? "");
        } else {
          nonSystem.push(m);
        }
      }
      if (systemContents.length > 0 && nonSystem.length > 0) {
        const firstUserIdx = nonSystem.findIndex(m => m.role === "user");
        if (firstUserIdx >= 0) {
          nonSystem[firstUserIdx] = {
            ...nonSystem[firstUserIdx],
            content: systemContents.join("\n\n") + "\n\n---\n\n" + (nonSystem[firstUserIdx].content ?? "")
          };
        }
      }
      messages = nonSystem;
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: false
    };

    // R1 reasoner models don't support temperature; V4 does
    if (!needsR1Compat) {
      body.temperature = request.temperature;
    }

    // R1 reasoner models don't support tools; V4 does
    const nameMap = new Map<string, string>();
    if (request.tools && request.tools.length > 0 && !needsR1Compat) {
      body.tools = request.tools.map((tool) => {
        const sanitized = tool.name.replace(/\./g, "_");
        nameMap.set(sanitized, tool.name);
        return {
          type: "function",
          function: {
            name: sanitized,
            description: tool.description || "",
            parameters: tool.parameters
          }
        };
      });
      body.tool_choice = "auto";
    }

    const toolCount = request.tools?.length ?? 0;
    console.log(`[CloudProvider] POST ${this.options.endpoint}/chat/completions model=${model} tools=${toolCount}`);
    const response = await fetch(joinEndpoint(this.options.endpoint, "/chat/completions"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[CloudProvider] Error ${response.status}: ${errText.slice(0, 500)}`);
      throw new Error(`Cloud provider request failed: ${response.status} ${response.statusText}`);
    }

    console.log(`[CloudProvider] Response ${response.status} received`);

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const message = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc) => {
      const originalName = nameMap.get(tc.function.name) || tc.function.name;
      return {
        id: (tc as any).tool_call_id || tc.id,
        function: { name: originalName, arguments: tc.function.arguments }
      };
    });

    return {
      model,
      content: message?.content ?? "",
      reasoning_content: message?.reasoning_content ?? undefined,
      toolCalls,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens
      },
      metadata: {
        endpoint: this.options.endpoint,
        hasApiKey: true,
        provider: this.name
      }
    };
  }

  async *completeStream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (!this.options.apiKey) {
      yield { content: "", done: true, error: "Cloud provider requires CLOUD_API_KEY" };
      return;
    }
    const model = stripProviderPrefix(request.model, this.name);
    // R1-family reasoners reject system role, temperature, and tools
    const needsR1Compat = /reasoner|r1/i.test(model) && !/v4/i.test(model);
    // Models with thinking/reasoning capability (R1, V4 series)
    const hasThinking = /reasoner|r1|deepseek.*v4|v4.*(pro|flash)/i.test(model);
    // Only R1 needs system merge; V4 supports system role natively
    const needsSystemMerge = needsR1Compat;

    let messages = request.messages.map((msg: any) => {
      const out: any = { role: msg.role, content: msg.content ?? null };
      if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
      if (msg.toolCallId) out.tool_call_id = out.tool_call_id || msg.toolCallId;
      if (msg.name) out.name = msg.name;
      if (msg.reasoning_content) out.reasoning_content = msg.reasoning_content;
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out.tool_calls = msg.toolCalls.map((tc: ToolCall) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }));
      }
      return out;
    });

    if (needsSystemMerge) {
      const systemContents: string[] = [];
      const nonSystem: typeof messages = [];
      for (const m of messages) {
        if (m.role === "system") { systemContents.push(m.content ?? ""); }
        else { nonSystem.push(m); }
      }
      if (systemContents.length > 0 && nonSystem.length > 0) {
        const firstUserIdx = nonSystem.findIndex(m => m.role === "user");
        if (firstUserIdx >= 0) {
          nonSystem[firstUserIdx] = {
            ...nonSystem[firstUserIdx],
            content: systemContents.join("\n\n") + "\n\n---\n\n" + (nonSystem[firstUserIdx].content ?? "")
          };
        }
      }
      messages = nonSystem;
    }

    const nameMap = new Map<string, string>();
    const body: Record<string, unknown> = {
      model, messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
    };
    if (!needsR1Compat && request.temperature != null) body.temperature = request.temperature;

    if (request.tools && request.tools.length > 0 && !needsR1Compat) {
      body.tools = request.tools.map((tool) => {
        const sanitized = tool.name.replace(/\./g, "_");
        nameMap.set(sanitized, tool.name);
        return {
          type: "function",
          function: { name: sanitized, description: tool.description || "", parameters: tool.parameters }
        };
      });
      body.tool_choice = "auto";
    }

    const response = await fetch(joinEndpoint(this.options.endpoint, "/chat/completions"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      yield { content: "", done: true, error: `Cloud provider error ${response.status}: ${errText.slice(0, 300)}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { content: "", done: true, error: "No response body" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const accumulatedToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};
            const chunkContent = delta.content || "";
            if (chunkContent) {
              content += chunkContent;
              yield { content: chunkContent, done: false };
            }

            // Accumulate tool calls from streaming deltas
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!accumulatedToolCalls.has(idx)) {
                  accumulatedToolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", args: "" });
                }
                const entry = accumulatedToolCalls.get(idx)!;
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name = tc.function.name;
                if (tc.function?.arguments) entry.args += tc.function.arguments;
              }
            }

            if (choice.finish_reason) {
              const toolCalls: ToolCall[] = [];
              for (const [, tc] of accumulatedToolCalls) {
                if (tc.name) {
                  const originalName = nameMap.get(tc.name) || tc.name;
                  toolCalls.push({
                    id: tc.id,
                    function: { name: originalName, arguments: tc.args }
                  });
                }
              }
              yield { content: "", toolCalls: toolCalls.length > 0 ? toolCalls : undefined, done: true };
            }
          } catch { /* skip unparseable chunks */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // If we haven't yielded a final done chunk, yield one now
    if (content) {
      const finalToolCalls: ToolCall[] = [];
      for (const [, tc] of accumulatedToolCalls) {
        if (tc.name) {
          finalToolCalls.push({ id: tc.id, function: { name: nameMap.get(tc.name) || tc.name, arguments: tc.args } });
        }
      }
      yield { content: "", toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined, done: true };
    }
  }
}
