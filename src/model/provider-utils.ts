export const PROVIDER_PREFIXES = {
  builtin: ["builtin"],
  "ollama-compatible": ["ollama", "local"],
  lmstudio: ["lmstudio"],
  vllm: ["vllm"],
  "llama-cpp": ["llama-cpp", "llamacpp"],
  "openai-compatible": ["cloud"]
} as const;

export type RegisteredProviderName = keyof typeof PROVIDER_PREFIXES;

export interface ProviderSelectionOptions {
  builtinAvailable?: boolean;
  cloudAvailable?: boolean;
  fallbackProvider?: RegisteredProviderName;
}

export function getModelPrefix(model: string): string | undefined {
  const prefix = model.split(":")[0]?.trim().toLowerCase();
  return prefix || undefined;
}

export function isExplicitModelReference(model: string): boolean {
  return typeof getModelPrefix(model) === "string" && model.includes(":");
}

export function getProviderNameForModel(
  model: string,
  options: ProviderSelectionOptions = {}
): RegisteredProviderName {
  const prefix = getModelPrefix(model);

  if (prefix) {
    for (const [providerName, aliases] of Object.entries(PROVIDER_PREFIXES)) {
      if ((aliases as readonly string[]).includes(prefix)) {
        return providerName as RegisteredProviderName;
      }
    }
  }

  if (options.builtinAvailable) {
    return "builtin";
  }

  if (options.cloudAvailable) {
    return "openai-compatible";
  }

  return options.fallbackProvider ?? "ollama-compatible";
}

export function stripProviderPrefix(
  model: string,
  providerName: RegisteredProviderName
): string {
  const lowered = model.toLowerCase();
  for (const prefix of PROVIDER_PREFIXES[providerName]) {
    const token = `${prefix}:`;
    if (lowered.startsWith(token)) {
      return model.slice(token.length);
    }
  }
  return model;
}

export function getProviderDisplayName(providerName: RegisteredProviderName): string {
  switch (providerName) {
    case "builtin":
      return "Built-in llama.cpp";
    case "ollama-compatible":
      return "Ollama";
    case "lmstudio":
      return "LM Studio";
    case "vllm":
      return "vLLM";
    case "llama-cpp":
      return "llama.cpp server";
    case "openai-compatible":
      return "OpenAI-compatible API";
    default:
      return providerName;
  }
}

export function getProviderMode(
  providerName: RegisteredProviderName
): "builtin" | "local-api" | "cloud-api" {
  if (providerName === "builtin") {
    return "builtin";
  }
  if (providerName === "openai-compatible") {
    return "cloud-api";
  }
  return "local-api";
}

export function joinEndpoint(base: string, path: string): string {
  try {
    const url = new URL(base);
    const baseParts = url.pathname.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);

    while (baseParts.length > 0 && pathParts.length > 0 && baseParts[baseParts.length - 1] === pathParts[0]) {
      pathParts.shift();
    }

    url.pathname = `/${[...baseParts, ...pathParts].join("/")}`;
    return url.toString().replace(/\/$/, "");
  } catch {
    const normalizedBase = base.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}
