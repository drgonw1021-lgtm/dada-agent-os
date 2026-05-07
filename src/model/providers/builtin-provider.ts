import type { ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk, ToolCall } from "../../core/types.js";
import { ModelManager } from "../model-manager.js";
import { stripProviderPrefix } from "../provider-utils.js";

export interface BuiltInModelOptions {
  modelManager: ModelManager;
}

/**
 * Build a system prompt that includes tool definitions for local GGUF models.
 * Local models don't have native function calling via API — we guide them
 * with prompt formatting and parse structured output.
 */
function buildToolPrompt(tools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>): string {
  if (!tools || tools.length === 0) return "";

  const toolDescs = tools.map((t) => {
    const params = t.parameters as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    let paramDesc = "";
    if (params?.properties) {
      const props = Object.entries(params.properties).map(([key, val]: [string, any]) => {
        const req = params.required?.includes(key) ? " (required)" : "";
        return `    - ${key}: ${val.type || "string"} — ${val.description || ""}${req}`;
      }).join("\n");
      paramDesc = "\n  Parameters:\n" + props;
    }
    return `- ${t.name}: ${t.description}${paramDesc}`;
  }).join("\n\n");

  return [
    "",
    "# Available Tools",
    "You have access to the following tools. To use a tool, respond with a JSON block:",
    "",
    '```json',
    '{"tool_call": {"name": "<tool_name>", "arguments": {<params>}}}',
    '```',
    "",
    "You may call multiple tools in sequence. After each tool call, you will receive the tool result.",
    "When you have completed the task, respond normally without a tool_call JSON block.",
    "",
    toolDescs,
  ].join("\n");
}

/**
 * Parse tool call from model output.
 * Looks for: ```json {"tool_call": ...} ``` or raw {"tool_call": ...}
 */
function parseToolCall(text: string): { name: string; arguments: Record<string, unknown> } | null {
  // Try fenced JSON block first: ```json {"tool_call": {...}} ```
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?"tool_call"[\s\S]*?\})\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (parsed.tool_call) return parsed.tool_call;
    } catch { /* not valid JSON */ }
  }

  // Try {"tool_call": {"name": ..., "arguments": ...}}
  const inline = text.match(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/);
  if (inline) {
    try {
      const parsed = JSON.parse(inline[0]);
      if (parsed.tool_call) return parsed.tool_call;
    } catch { /* not valid */ }
  }

  // Try {"name": "...", "arguments": {...}} — simpler format some models prefer
  const simple = text.match(/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/);
  if (simple) {
    try {
      return { name: simple[1], arguments: JSON.parse(simple[2]) };
    } catch { /* not valid */ }
  }

  // Try fenced simple format: ```json {"name": "...", "arguments": {...}} ```
  const fencedSimple = text.match(/```(?:json)?\s*(\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\})\s*```/i);
  if (fencedSimple) {
    try {
      const parsed = JSON.parse(fencedSimple[1]);
      if (parsed.name && parsed.arguments) return { name: parsed.name, arguments: parsed.arguments };
    } catch { /* not valid */ }
  }

  // Try XML-style: <tool_call>name(args)</tool_call>
  const xml = text.match(/<tool_call>\s*(\w+)\s*\(([\s\S]*?)\)\s*<\/tool_call>/i);
  if (xml) {
    const name = xml[1];
    const argsStr = xml[2].trim();
    if (argsStr.startsWith("{")) {
      try {
        return { name, arguments: JSON.parse(argsStr) };
      } catch { /* not JSON */ }
    }
    const args: Record<string, string> = {};
    for (const pair of argsStr.split(",")) {
      const [k, v] = pair.split("=").map(s => s.trim().replace(/^["']|["']$/g, ""));
      if (k) args[k] = v || "";
    }
    return { name, arguments: args };
  }

  return null;
}

function stripToolBlocks(text: string): string {
  return text.replace(/```(?:json)?\s*\{[\s\S]*?"name"[\s\S]*?"arguments"[\s\S]*?\}\s*```/gi, "")
    .replace(/```(?:json)?\s*\{[\s\S]*?"tool_call"[\s\S]*?\}\s*```/gi, "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/g, "")
    .replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .trim();
}

export class BuiltInModelProvider implements ModelProvider {
  readonly kind = "local" as const;
  readonly name = "builtin";

  constructor(private readonly options: BuiltInModelOptions) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const requestedModelId = stripProviderPrefix(request.model, this.name);
    const modelId = this.options.modelManager.resolveModelId(requestedModelId);

    if (!this.options.modelManager.isLlamaCppAvailable()) {
      throw new Error(
        "Built-in model runtime is unavailable. Install node-llama-cpp and ensure native bindings can load."
      );
    }

    if (!modelId) {
      throw new Error("No built-in model is available. Please add a GGUF model to the models/ directory.");
    }

    if (
      !this.options.modelManager.isModelLoaded() ||
      this.options.modelManager.getCurrentModelId() !== modelId
    ) {
      const loaded = await this.options.modelManager.loadModel(modelId);
      if (!loaded) {
        throw new Error(`Failed to load built-in model "${modelId}".`);
      }
    }

    const systemMessage = request.messages.find(m => m.role === "system")?.content;
    const userMessages = request.messages.filter(m => m.role !== "system");
    const tools = request.tools || [];

    // Build the tool prompt if tools are available
    const toolPrompt = tools.length > 0
      ? buildToolPrompt(tools.map(t => ({
        name: t.name,
        description: t.description || "",
        parameters: t.parameters as unknown as Record<string, unknown> | undefined,
      })))
      : "";

    // Build message history string
    const historyStr = userMessages.map(m =>
      `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
    ).join("\n\n");

    const fullPrompt = [
      systemMessage ? `System: ${systemMessage}` : "",
      toolPrompt,
      "",
      historyStr,
      "Assistant:",
    ].filter(Boolean).join("\n");

    try {
      const rawResponse = await this.options.modelManager.complete(fullPrompt, {
        temperature: request.temperature,
        maxTokens: request.maxTokens || 1024,
      });

      // Check for prompt-based tool calls in the text
      const toolCall = parseToolCall(rawResponse);
      if (toolCall) {
        const cleanContent = stripToolBlocks(rawResponse);
        return {
          model: modelId,
          content: cleanContent,
          toolCalls: [{
            id: `call_${Date.now()}`,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          }],
          metadata: { provider: this.name, modelLoaded: true, currentModelId: modelId },
        };
      }

      // Plain text response
      const content = typeof rawResponse === "string" ? rawResponse : String(rawResponse);

      return {
        model: modelId,
        content,
        usage: {
          promptTokens: Math.floor(fullPrompt.length / 4),
          completionTokens: Math.floor(content.length / 4),
          totalTokens: Math.floor((fullPrompt.length + content.length) / 4),
        },
        metadata: {
          provider: this.name,
          modelLoaded: true,
          currentModelId: modelId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BuiltinProvider] Completion error: ${message}`);
      throw new Error(`Built-in model error: ${message}`);
    }
  }

  async *completeStream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const requestedModelId = stripProviderPrefix(request.model, this.name);
    const modelId = this.options.modelManager.resolveModelId(requestedModelId);

    if (!this.options.modelManager.isLlamaCppAvailable()) {
      yield { content: "", done: true, error: "Built-in model runtime is unavailable. Install node-llama-cpp." };
      return;
    }
    if (!modelId) {
      yield { content: "", done: true, error: "No built-in model available. Add a GGUF model to models/." };
      return;
    }

    if (!this.options.modelManager.isModelLoaded() ||
        this.options.modelManager.getCurrentModelId() !== modelId) {
      const loaded = await this.options.modelManager.loadModel(modelId);
      if (!loaded) {
        yield { content: "", done: true, error: `Failed to load model "${modelId}".` };
        return;
      }
    }

    const systemMessage = request.messages.find(m => m.role === "system")?.content;
    const userMessages = request.messages.filter(m => m.role !== "system");
    const tools = request.tools || [];

    const toolPrompt = tools.length > 0
      ? buildToolPrompt(tools.map(t => ({
        name: t.name,
        description: t.description || "",
        parameters: t.parameters as unknown as Record<string, unknown> | undefined,
      })))
      : "";

    const historyStr = userMessages.map(m =>
      `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
    ).join("\n\n");

    const fullPrompt = [
      systemMessage ? `System: ${systemMessage}` : "",
      toolPrompt,
      "",
      historyStr,
      "Assistant:",
    ].filter(Boolean).join("\n");

    try {
      const rawResponse = await this.options.modelManager.complete(fullPrompt, {
        temperature: request.temperature,
        maxTokens: request.maxTokens || 1024,
        onToken: tools.length === 0 ? undefined : undefined, // skip onToken when using tools (need full response to parse)
      });

      // For tool-calling: parse tool calls from full response
      const toolCall = tools.length > 0 ? parseToolCall(rawResponse) : null;
      if (toolCall) {
        yield {
          content: stripToolBlocks(rawResponse),
          toolCalls: [{
            id: `call_${Date.now()}`,
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
          }],
          done: true,
        };
      } else {
        yield { content: rawResponse, done: true };
      }
    } catch (error) {
      yield { content: "", done: true, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
