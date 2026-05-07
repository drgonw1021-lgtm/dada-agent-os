import type { ToolDefinition } from "../../core/types.js";
import type { KnowledgeBase } from "../../knowledge/knowledge-base.js";

interface KnowledgeSearchInput {
  query: string;
  topK?: number;
}

interface KnowledgeSearchOutput {
  results: Array<{
    content: string;
    filePath: string;
    score: number;
  }>;
  contextString: string;
}

export function createKnowledgeSearchTool(kb: KnowledgeBase): ToolDefinition<KnowledgeSearchInput, KnowledgeSearchOutput> {
  return {
    id: "knowledge.search",
    description: "Search the workspace knowledge base for relevant files and code related to your task",
    requiredScopes: ["filesystem.read"],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — what information you need from the workspace" },
        topK: { type: "number", description: "Number of results to return (default 5, max 10)" }
      },
      required: ["query"]
    },
    async execute(input) {
      const topK = Math.min(input.topK ?? 5, 10);
      const results = await kb.query(input.query, topK);
      const contextString = await kb.getContextString(input.query, topK, 3000);
      return { results, contextString };
    }
  };
}
