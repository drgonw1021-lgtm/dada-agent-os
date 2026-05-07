import type { ModelProvider, ModelRequest, ModelResponse, ToolCall } from "../../core/types.js";
import { joinEndpoint, stripProviderPrefix } from "../provider-utils.js";
import type { RegisteredProviderName } from "../provider-utils.js";

export interface OpenAICompatibleOptions {
  endpoint: string;
  providerName: RegisteredProviderName;
  includeTools?: boolean;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly kind = "local" as const;
  readonly name: RegisteredProviderName;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.name = options.providerName;
  }

  configure(next: { endpoint?: string }): void {
    if (typeof next.endpoint === "string" && next.endpoint.trim()) {
      this.options.endpoint = next.endpoint.trim();
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = stripProviderPrefix(request.model, this.name);

    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map((msg: any) => {
        const out: any = { role: msg.role, content: msg.content ?? null };
        if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
        if (msg.toolCallId) out.tool_call_id = out.tool_call_id || msg.toolCallId;
        if (msg.name) out.name = msg.name;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          out.tool_calls = msg.toolCalls.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }));
        }
        return out;
      }),
      temperature: request.temperature,
      max_tokens: request.maxTokens ?? (request.tools && request.tools.length > 0 ? 8192 : 2048),
      stream: false
    };

    const nameMap = new Map<string, string>();
    if (this.options.includeTools && request.tools?.length) {
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
    console.log(`[${this.name}] POST ${this.options.endpoint}/v1/chat/completions model=${model} tools=${toolCount}`);

    const response = await fetch(joinEndpoint(this.options.endpoint, "/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[${this.name}] Error ${response.status}: ${errText.slice(0, 500)}`);
      throw new Error(`${this.name} request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      model?: string;
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; tool_call_id?: string; function: { name: string; arguments: string } }>
        }
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const message = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc) => {
      const originalName = nameMap.get(tc.function.name) || tc.function.name;
      return {
        id: (tc as any).tool_call_id || tc.id || "",
        function: { name: originalName, arguments: tc.function.arguments }
      };
    });

    if (toolCalls.length > 0) {
      console.log(`[${this.name}] Received ${toolCalls.length} tool call(s): ${toolCalls.map((tc) => tc.function.name).join(", ")}`);
    }

    return {
      model: data.model ?? model,
      content: message?.content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens
      },
      metadata: { endpoint: this.options.endpoint, provider: this.name }
    };
  }
}
