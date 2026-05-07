import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { listTemplates, searchTemplates, getTemplate, COMFYUI_TEMPLATES } from "../comfyui-templates.js";
import type { ComfyTemplate, TemplateParam } from "../comfyui-templates.js";

export interface ComfyTemplateListInput {
  action: "list" | "search" | "detail" | "build";
  query?: string;
  templateId?: string;
  params?: Record<string, unknown>;
  outputPath?: string;
}

export interface ComfyTemplateListOutput {
  success: boolean;
  action: string;
  templates?: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    requiredModels: string[];
    params: Record<string, TemplateParam>;
  }>;
  template?: {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    requiredModels: string[];
    params: Record<string, TemplateParam>;
  };
  workflow?: Record<string, unknown>;
  total?: number;
  error?: string;
}

export function createComfyTemplateTool(): ToolDefinition<ComfyTemplateListInput, ComfyTemplateListOutput> {
  return {
    id: "comfy.templates",
    description: "List, search, and build ComfyUI workflows from a library of 15 templates (txt2img, txt2img_flux, z_image, poster, icon, img2img, inpainting, upscale, face_restore, controlnet_canny, ip_adapter, animatediff, short_video, voiceover_video, batch_prompt)",
    requiredScopes: ["web.fetch"] as PermissionScope[],
    riskLevel: "low",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["list", "search", "detail", "build"], description: "What to do with the template library" },
        query: { type: "string" as const, description: "Search query for template search" },
        templateId: { type: "string" as const, description: "Template ID (required for detail and build actions)" },
        params: { type: "object" as const, description: "Template parameters for building a workflow", additionalProperties: true },
        outputPath: { type: "string" as const, description: "Output directory for generated media" },
      },
      required: ["action"]
    },
    async execute(input: ComfyTemplateListInput, _context: ToolContext): Promise<ComfyTemplateListOutput> {
      if (input.action === "list") {
        const all = listTemplates();
        return {
          success: true,
          action: "list",
          total: all.length,
          templates: all.map(stripBuild)
        };
      }

      if (input.action === "search") {
        if (!input.query) return { success: false, action: "search", error: "query is required for search action" };
        const results = searchTemplates(input.query);
        return {
          success: true,
          action: "search",
          total: results.length,
          templates: results.map(stripBuild)
        };
      }

      if (input.action === "detail") {
        if (!input.templateId) return { success: false, action: "detail", error: "templateId is required for detail action" };
        const tpl = getTemplate(input.templateId);
        if (!tpl) return { success: false, action: "detail", error: `Template not found: ${input.templateId}. Available: ${Object.keys(COMFYUI_TEMPLATES).join(", ")}` };
        return {
          success: true,
          action: "detail",
          template: {
            id: tpl.id,
            name: tpl.name,
            description: tpl.description,
            category: tpl.category,
            tags: tpl.tags,
            requiredModels: tpl.requiredModels,
            params: tpl.params,
          }
        };
      }

      if (input.action === "build") {
        if (!input.templateId) return { success: false, action: "build", error: "templateId is required for build action" };
        const tpl = getTemplate(input.templateId);
        if (!tpl) return { success: false, action: "build", error: `Template not found: ${input.templateId}` };

        const params = { ...(input.params || {}) };
        // Auto-generate seed if not provided
        if (!params.seed) {
          params.seed = Math.floor(Math.random() * 1_000_000_000_000_000);
        }

        try {
          const workflow = tpl.build(params);
          return {
            success: true,
            action: "build",
            workflow,
            template: stripBuild(tpl),
          };
        } catch (e: any) {
          return { success: false, action: "build", error: `Failed to build workflow: ${e.message}` };
        }
      }

      return { success: false, action: input.action, error: "Unknown action" };
    }
  };
}

type TemplateSummary = { id: string; name: string; description: string; category: string; tags: string[]; requiredModels: string[]; params: Record<string, TemplateParam> };
function stripBuild(tpl: ComfyTemplate): TemplateSummary {
  return {
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    category: tpl.category,
    tags: tpl.tags,
    requiredModels: tpl.requiredModels,
    params: tpl.params,
  };
}
