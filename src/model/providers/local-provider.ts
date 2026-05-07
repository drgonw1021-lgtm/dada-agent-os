import type { ModelProvider, ModelRequest, ModelResponse } from "../../core/types.js";
import { joinEndpoint, stripProviderPrefix } from "../provider-utils.js";

export interface LocalProviderOptions {
  endpoint: string;
}

export class LocalProvider implements ModelProvider {
  readonly kind = "local" as const;
  readonly name = "ollama-compatible";

  constructor(private readonly options: LocalProviderOptions) {}

  configure(next: Partial<LocalProviderOptions>): void {
    if (typeof next.endpoint === "string" && next.endpoint.trim()) {
      this.options.endpoint = next.endpoint.trim();
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = stripProviderPrefix(request.model, this.name);

    const response = await fetch(joinEndpoint(this.options.endpoint, "/api/chat"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Local provider request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      model?: string;
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      model: data.model ?? model,
      content: data.message?.content ?? "",
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0)
      },
      metadata: {
        endpoint: this.options.endpoint,
        provider: this.name
      }
    };
  }
}
