import type { ToolDefinition } from "../../core/types.js";

interface EchoInput {
  text: string;
}

interface EchoOutput {
  echoed: string;
  at: string;
}

export const echoTool: ToolDefinition<EchoInput, EchoOutput> = {
  id: "core.echo",
  description: "Echo input text for smoke tests",
  requiredScopes: [],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to echo back" }
    },
    required: ["text"]
  },
  async execute(input, context) {
    return {
      echoed: `[${context.taskId}] ${input.text}`,
      at: context.now.toISOString()
    };
  }
};
