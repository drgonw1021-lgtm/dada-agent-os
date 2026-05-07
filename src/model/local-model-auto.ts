import { LocalProvider } from "./providers/local-provider.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible-provider.js";
import type { ModelProvider } from "../core/types.js";

export type LocalProviderType = "ollama" | "lmstudio" | "vllm" | "llama-cpp";

export interface LocalEndpoint {
  type: LocalProviderType;
  endpoint: string;
  name: string;
}

export const DEFAULT_LOCAL_ENDPOINTS: LocalEndpoint[] = [
  { type: "ollama", endpoint: "http://127.0.0.1:11434", name: "Ollama" },
  { type: "lmstudio", endpoint: "http://127.0.0.1:1234/v1", name: "LM Studio" },
  { type: "vllm", endpoint: "http://127.0.0.1:8000/v1", name: "vLLM" },
  { type: "llama-cpp", endpoint: "http://127.0.0.1:8080/v1", name: "llama.cpp" }
];

export async function detectAvailableProviders(
  endpoints: LocalEndpoint[] = DEFAULT_LOCAL_ENDPOINTS
): Promise<LocalEndpoint[]> {
  const available: LocalEndpoint[] = [];

  for (const ep of endpoints) {
    try {
      const testProvider = createProvider(ep.type, ep.endpoint);
      await testProvider.complete({
        model: "test",
        messages: [{ role: "user", content: "hi" }]
      });
      available.push(ep);
    } catch {
      // Provider not available, skip
    }
  }

  return available;
}

export function createProvider(type: LocalProviderType, endpoint: string): ModelProvider {
  switch (type) {
    case "ollama":
      return new LocalProvider({ endpoint });
    case "lmstudio":
      return new OpenAICompatibleProvider({ providerName: "lmstudio", endpoint });
    case "vllm":
      return new OpenAICompatibleProvider({ providerName: "vllm", endpoint });
    case "llama-cpp":
      return new OpenAICompatibleProvider({ providerName: "llama-cpp", endpoint });
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export function getProviderForModel(model: string): LocalProviderType {
  const prefix = model.split(":")[0]?.toLowerCase();
  switch (prefix) {
    case "ollama":
      return "ollama";
    case "lmstudio":
      return "lmstudio";
    case "vllm":
      return "vllm";
    case "llamacpp":
    case "llama-cpp":
      return "llama-cpp";
    default:
      return "ollama";
  }
}
