import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { ModelManager } from "../../model/model-manager.js";

export interface ModelListInput {
  action: "list" | "load" | "unload" | "info" | "download" | "remove";
  modelId?: string;
  url?: string;
}

export interface ModelListOutput {
  success: boolean;
  models?: Array<{
    id: string;
    name: string;
    path: string;
    size: number;
    format: string;
    quantization: string;
  }>;
  currentModel?: string;
  loaded?: boolean;
  runtimeStatus?: ReturnType<ModelManager["getStatus"]>;
  message?: string;
  error?: string;
}

export function createModelTool(modelManager: ModelManager): ToolDefinition<ModelListInput, ModelListOutput> {
  return {
    id: "model",
    description: "Model management: list available models, load/unload models, download new models",
    requiredScopes: [] as PermissionScope[],
    riskLevel: "low",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["list", "load", "unload", "info", "download", "remove"], description: "Model management action" },
        modelId: { type: "string" as const, description: "Model ID or name" },
        url: { type: "string" as const, description: "URL to download model from" }
      },
      required: ["action"]
    },
    async execute(input: ModelListInput, context: ToolContext): Promise<ModelListOutput> {
      const { action, modelId, url } = input;

      try {
        switch (action) {
          case "list": {
            const models = modelManager.listModels();
            const currentModel = modelManager.getCurrentModelId();
            return {
              success: true,
              models: models.map(m => ({
                id: m.id,
                name: m.name,
                path: m.path,
                size: m.size,
                format: m.format,
                quantization: m.quantization
              })),
              currentModel: currentModel || undefined,
              loaded: modelManager.isModelLoaded(),
              runtimeStatus: modelManager.getStatus()
            };
          }

          case "load": {
            if (!modelId) {
              return { success: false, error: "modelId is required for load action" };
            }
            const loaded = await modelManager.loadModel(modelId);
            return {
              success: loaded,
              currentModel: loaded ? modelId : undefined,
              loaded: modelManager.isModelLoaded(),
              runtimeStatus: modelManager.getStatus(),
              message: loaded ? `Model ${modelId} loaded` : "Failed to load model"
            };
          }

          case "unload": {
            modelManager.unloadModel();
            return {
              success: true,
              loaded: false,
              runtimeStatus: modelManager.getStatus(),
              message: "Model unloaded"
            };
          }

          case "info": {
            if (!modelId) {
              return { success: false, error: "modelId is required for info action" };
            }
            const model = modelManager.getModel(modelId);
            if (!model) {
              return { success: false, error: `Model not found: ${modelId}` };
            }
            return {
              success: true,
              models: [{
                id: model.id,
                name: model.name,
                path: model.path,
                size: model.size,
                format: model.format,
                quantization: model.quantization
              }],
              currentModel: modelManager.getCurrentModelId() || undefined,
              loaded: modelManager.isModelLoaded(),
              runtimeStatus: modelManager.getStatus()
            };
          }

          case "download": {
            if (!url) {
              return { success: false, error: "url is required for download action" };
            }
            const filename = await modelManager.addModelFromUrl(url);
            if (filename) {
              return {
                success: true,
                runtimeStatus: modelManager.getStatus(),
                message: `Model downloaded: ${filename}`
              };
            } else {
              return {
                success: false,
                error: "Failed to download model"
              };
            }
          }

          case "remove": {
            if (!modelId) {
              return { success: false, error: "modelId is required for remove action" };
            }
            const removed = await modelManager.removeModel(modelId);
            return {
              success: removed,
              runtimeStatus: modelManager.getStatus(),
              message: removed ? `Model ${modelId} removed` : "Failed to remove model"
            };
          }

          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}
