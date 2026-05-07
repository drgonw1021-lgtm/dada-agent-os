import type { ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk, FunctionDefinition } from "../core/types.js";

export interface RouteRule {
  match: (request: ModelRequest) => boolean;
  providerName: string;
}

export class ModelRouter {
  private readonly providerMap = new Map<string, ModelProvider>();

  constructor(
    providers: ModelProvider[],
    private readonly rules: RouteRule[]
  ) {
    for (const provider of providers) {
      this.providerMap.set(provider.name, provider);
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    console.log('[ModelRouter] Routing request for model:', request.model);
    const rule = this.rules.find((entry) => entry.match(request));
    if (!rule) {
      throw new Error(`No model route matched for model "${request.model}"`);
    }
    console.log('[ModelRouter] Matched rule, provider:', rule.providerName);

    const provider = this.providerMap.get(rule.providerName);
    if (!provider) {
      throw new Error(`Model provider "${rule.providerName}" is not configured`);
    }

    return provider.complete(request);
  }

  async *completeStream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const rule = this.rules.find((entry) => entry.match(request));
    if (!rule) {
      yield { content: "", done: true, error: `No model route matched for "${request.model}"` };
      return;
    }

    const provider = this.providerMap.get(rule.providerName);
    if (!provider) {
      yield { content: "", done: true, error: `Provider "${rule.providerName}" is not configured` };
      return;
    }

    if (provider.completeStream) {
      yield* provider.completeStream(request);
    } else {
      // Fallback: call complete() and yield the full response as a single chunk
      try {
        const result = await provider.complete(request);
        yield { content: result.content, toolCalls: result.toolCalls, done: true };
      } catch (error) {
        yield { content: "", done: true, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
}

export { type FunctionDefinition };
