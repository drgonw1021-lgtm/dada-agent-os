import type { GenerativeMediaInput } from "./builtin/generative-media-tool.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface ComfyTemplate {
  id: string;
  name: string;
  description: string;
  category: "generation" | "editing" | "enhancement" | "control" | "video" | "utility";
  /** Tags for search/discovery */
  tags: string[];
  /** Required model files (checkpoint, lora, vae, etc.) */
  requiredModels: string[];
  /** Parameter schema for template customization */
  params: Record<string, TemplateParam>;
  /** Generate the ComfyUI workflow JSON from params */
  build: (params: Record<string, unknown>) => Record<string, unknown>;
  /** Generate tool input for gen.media tool */
  toToolInput: (params: Record<string, unknown>, outputPath?: string) => GenerativeMediaInput;
}

export interface TemplateParam {
  type: "string" | "number" | "boolean" | "select" | "image" | "seed";
  default: unknown;
  description: string;
  options?: string[]; // for select type
  min?: number;
  max?: number;
  step?: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────────

function seed(): number {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

// ─── Template Library ─────────────────────────────────────────────────────────────

export const COMFYUI_TEMPLATES: Record<string, ComfyTemplate> = {

  // ═══════════════════════════════════════════════════════════════════════════════════
  // GENERATION
  // ═══════════════════════════════════════════════════════════════════════════════════

  txt2img: {
    id: "txt2img",
    name: "Text to Image",
    description: "Generate an image from a text prompt using SDXL or Flux",
    category: "generation",
    tags: ["txt2img", "generate", "image", "create", "sdxl", "flux"],
    requiredModels: ["checkpoint"],
    params: {
      prompt: { type: "string", default: "", description: "Positive prompt describing the desired image" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality, deformed", description: "Negative prompt" },
      width: { type: "number", default: 1024, description: "Image width", min: 256, max: 2048, step: 64 },
      height: { type: "number", default: 1024, description: "Image height", min: 256, max: 2048, step: 64 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 100 },
      cfg: { type: "number", default: 7.0, description: "CFG scale", min: 1.0, max: 30.0 },
      sampler: { type: "select", default: "euler", description: "Sampler", options: ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "ddim"] },
      scheduler: { type: "select", default: "normal", description: "Scheduler", options: ["normal", "karras", "exponential", "sgm_uniform"] },
      batch_size: { type: "number", default: 1, description: "Number of images", min: 1, max: 8 },
    },
    build(params) {
      const w = (params.width as number) || 1024;
      const h = (params.height as number) || 1024;
      return {
        "1": { inputs: { text: (params.prompt as string) || "", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 20,
            cfg: (params.cfg as number) || 7.0,
            sampler_name: (params.sampler as string) || "euler",
            scheduler: (params.scheduler as string) || "normal",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["5", 0]
          },
          class_type: "KSampler"
        },
        "4": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "5": { inputs: { width: w, height: h, batch_size: (params.batch_size as number) || 1 }, class_type: "EmptyLatentImage" },
        "6": { inputs: { samples: ["3", 0], vae: ["4", 2] }, class_type: "VAEDecode" },
        "7": { inputs: { filename_prefix: "ComfyUI", images: ["6", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  txt2img_flux: {
    id: "txt2img_flux",
    name: "Text to Image (Flux)",
    description: "Generate an image using Flux.1 model with guidance embedding",
    category: "generation",
    tags: ["txt2img", "flux", "generate", "image", "high quality"],
    requiredModels: ["flux_checkpoint", "flux_clip", "flux_vae"],
    params: {
      prompt: { type: "string", default: "", description: "Positive prompt" },
      width: { type: "number", default: 1024, description: "Image width", min: 256, max: 2048, step: 64 },
      height: { type: "number", default: 1024, description: "Image height", min: 256, max: 2048, step: 64 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 50 },
      guidance: { type: "number", default: 3.5, description: "Guidance scale", min: 1.0, max: 10.0 },
    },
    build(params) {
      const w = (params.width as number) || 1024;
      const h = (params.height as number) || 1024;
      const g = (params.guidance as number) || 3.5;
      return {
        "1": { inputs: { text: (params.prompt as string) || "", clip: ["4", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { width: w, height: h, batch_size: 1 }, class_type: "EmptyFluxLatentImage" },
        "3": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 20,
            cfg: 1.0,
            sampler_name: "euler",
            scheduler: "simple",
            denoise: 1.0,
            model: ["5", 0],
            positive: ["1", 0],
            negative: ["7", 0],
            latent_image: ["2", 0],
            guidance: g
          },
          class_type: "KSampler"
        },
        "4": { inputs: { clip_name1: (params.clip_model as string) || "t5xxl_fp16.safetensors", clip_name2: "clip_l.safetensors" }, class_type: "DualCLIPLoader" },
        "5": { inputs: { unet_name: (params.flux_model as string) || "flux1-dev.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
        "6": { inputs: { vae_name: (params.vae_name as string) || "flux_vae.safetensors" }, class_type: "VAELoader" },
        "7": { inputs: { text: "", clip: ["4", 1] }, class_type: "CLIPTextEncode" },
        "8": { inputs: { samples: ["3", 0], vae: ["6", 0] }, class_type: "VAEDecode" },
        "9": { inputs: { filename_prefix: "Flux", images: ["8", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  z_image: {
    id: "z_image",
    name: "Text to Image (Z-Image Turbo)",
    description: "Generate an image using Z-Image Turbo, a DiT-based model from Tongyi-MAI (Alibaba). Fast 4-8 step generation with Chinese+English prompt support. Models download: huggingface.co/Tongyi-MAI/Z-Image-Turbo (z-image-turbo.safetensors, ~6GB). Also needs t5xxl_fp16.safetensors + clip_l.safetensors in ComfyUI/models/clip/ and ae.safetensors in ComfyUI/models/vae/.",
    category: "generation",
    tags: ["txt2img", "z-image", "generate", "image", "turbo", "dit", "chinese", "tongyi"],
    requiredModels: ["zimage_checkpoint", "t5_clip", "clip_l", "vae"],
    params: {
      prompt: { type: "string", default: "", description: "Positive prompt (supports Chinese and English)" },
      negative_prompt: { type: "string", default: "low quality, blurry, distorted, ugly, bad anatomy", description: "Negative prompt" },
      width: { type: "number", default: 1024, description: "Image width", min: 512, max: 2048, step: 64 },
      height: { type: "number", default: 1024, description: "Image height", min: 512, max: 2048, step: 64 },
      steps: { type: "number", default: 6, description: "Sampling steps (4-8 recommended for turbo)", min: 1, max: 30 },
      guidance: { type: "number", default: 1.8, description: "Guidance scale", min: 1.0, max: 5.0, step: 0.1 },
    },
    build(params) {
      const w = (params.width as number) || 1024;
      const h = (params.height as number) || 1024;
      const g = (params.guidance as number) || 1.8;
      const s = (params.steps as number) || 6;
      return {
        "1": { inputs: { text: (params.prompt as string) || "a beautiful landscape", clip: ["4", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { width: w, height: h, batch_size: 1 }, class_type: "EmptyFluxLatentImage" },
        "3": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: s,
            cfg: 1.0,
            sampler_name: "euler",
            scheduler: "simple",
            denoise: 1.0,
            model: ["5", 0],
            positive: ["1", 0],
            negative: ["7", 0],
            latent_image: ["2", 0],
            guidance: g,
          },
          class_type: "KSampler"
        },
        "4": { inputs: { clip_name1: (params.clip_t5 as string) || "t5xxl_fp16.safetensors", clip_name2: (params.clip_l as string) || "clip_l.safetensors" }, class_type: "DualCLIPLoader" },
        "5": { inputs: { unet_name: (params.zimage_model as string) || "z-image-turbo.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
        "6": { inputs: { vae_name: (params.vae_name as string) || "ae.safetensors" }, class_type: "VAELoader" },
        "7": { inputs: { text: (params.negative_prompt as string) || "low quality, blurry, distorted", clip: ["4", 1] }, class_type: "CLIPTextEncode" },
        "8": { inputs: { samples: ["3", 0], vae: ["6", 0] }, class_type: "VAEDecode" },
        "9": { inputs: { filename_prefix: "Z-Image", images: ["8", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // DESIGN
  // ═══════════════════════════════════════════════════════════════════════════════════

  poster: {
    id: "poster",
    name: "Poster / 海报设计",
    description: "Generate a portrait-orientation poster/design from a prompt. Optimized for 2:3 vertical ratio with high detail. Ideal for event posters, product marketing, social media graphics, and creative design compositions.",
    category: "generation",
    tags: ["poster", "海报", "design", "portrait", "vertical", "marketing", "social media"],
    requiredModels: ["checkpoint"],
    params: {
      prompt: { type: "string", default: "", description: "Poster design description — include style, layout, text placement notes, color scheme" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality, distorted text, bad typography, watermark, signature", description: "Negative prompt" },
      width: { type: "number", default: 768, description: "Width (portrait ratio recommended)", min: 512, max: 1536, step: 64 },
      height: { type: "number", default: 1152, description: "Height (2:3 ratio default)", min: 512, max: 2048, step: 64 },
      steps: { type: "number", default: 30, description: "Sampling steps (higher for poster quality)", min: 10, max: 60 },
      cfg: { type: "number", default: 7.5, description: "CFG scale", min: 1.0, max: 20.0 },
      sampler: { type: "select", default: "dpmpp_2m", description: "Sampler (dpmpp_2m recommended for detailed output)", options: ["dpmpp_2m", "dpmpp_sde", "euler_ancestral", "euler", "ddim"] },
      scheduler: { type: "select", default: "karras", description: "Scheduler", options: ["karras", "normal", "exponential", "sgm_uniform"] },
    },
    build(params) {
      const w = (params.width as number) || 768;
      const h = (params.height as number) || 1152;
      return {
        "1": { inputs: { text: (params.prompt as string) || "cinematic poster, professional design", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality, watermark, bad typography", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 30,
            cfg: (params.cfg as number) || 7.5,
            sampler_name: (params.sampler as string) || "dpmpp_2m",
            scheduler: (params.scheduler as string) || "karras",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["5", 0]
          },
          class_type: "KSampler"
        },
        "4": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "5": { inputs: { width: w, height: h, batch_size: 1 }, class_type: "EmptyLatentImage" },
        "6": { inputs: { samples: ["3", 0], vae: ["4", 2] }, class_type: "VAEDecode" },
        "7": { inputs: { filename_prefix: "Poster", images: ["6", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  icon: {
    id: "icon",
    name: "Icon / 图标",
    description: "Generate a square app icon or logo-style image. Optimized for 1:1 format with clean, iconic compositions. Ideal for app icons, favicons, brand marks, and UI assets.",
    category: "generation",
    tags: ["icon", "图标", "logo", "square", "app icon", "brand", "ui"],
    requiredModels: ["checkpoint"],
    params: {
      prompt: { type: "string", default: "", description: "Icon description — be specific about subject, style (flat/minimal/3D), and background" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality, text, letters, watermark, complex background, cluttered", description: "Negative prompt" },
      size: { type: "select", default: "1024", description: "Icon size", options: ["512", "1024", "2048"] },
      steps: { type: "number", default: 25, description: "Sampling steps", min: 10, max: 50 },
      cfg: { type: "number", default: 7.0, description: "CFG scale", min: 1.0, max: 15.0 },
    },
    build(params) {
      const size = parseInt((params.size as string) || "1024");
      return {
        "1": { inputs: { text: (params.prompt as string) || "minimalist app icon, clean design", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, text, watermark, cluttered", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 25,
            cfg: (params.cfg as number) || 7.0,
            sampler_name: "dpmpp_2m",
            scheduler: "karras",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["5", 0]
          },
          class_type: "KSampler"
        },
        "4": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "5": { inputs: { width: size, height: size, batch_size: 1 }, class_type: "EmptyLatentImage" },
        "6": { inputs: { samples: ["3", 0], vae: ["4", 2] }, class_type: "VAEDecode" },
        "7": { inputs: { filename_prefix: "Icon", images: ["6", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // EDITING
  // ═══════════════════════════════════════════════════════════════════════════════════

  img2img: {
    id: "img2img",
    name: "Image to Image",
    description: "Transform an existing image using a prompt, with controllable denoising strength",
    category: "editing",
    tags: ["img2img", "transform", "edit", "variation", "style transfer"],
    requiredModels: ["checkpoint"],
    params: {
      prompt: { type: "string", default: "", description: "Target description" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality", description: "Negative prompt" },
      denoise: { type: "number", default: 0.7, description: "Denoising strength (0=keep original, 1=fully regenerate)", min: 0.05, max: 1.0, step: 0.05 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 100 },
      cfg: { type: "number", default: 7.0, description: "CFG scale", min: 1.0, max: 30.0 },
      width: { type: "number", default: 1024, description: "Target width", min: 256, max: 2048, step: 64 },
      height: { type: "number", default: 1024, description: "Target height", min: 256, max: 2048, step: 64 },
    },
    build(params) {
      const w = (params.width as number) || 1024;
      const h = (params.height as number) || 1024;
      const denoise = (params.denoise as number) ?? 0.7;
      return {
        "1": { inputs: { text: (params.prompt as string) || "", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": { inputs: { image: (params.input_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "4": { inputs: { pixels: ["3", 0], vae: ["7", 2], multiplier: 1.0 }, class_type: "VAEEncode" },
        "5": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 20,
            cfg: (params.cfg as number) || 7.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise,
            model: ["6", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["4", 0]
          },
          class_type: "KSampler"
        },
        "6": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "7": { inputs: { samples: ["5", 0], vae: ["6", 2] }, class_type: "VAEDecode" },
        "8": { inputs: { filename_prefix: "img2img", images: ["7", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  inpainting: {
    id: "inpainting",
    name: "Inpainting",
    description: "Fill or replace a masked region of an image using a prompt",
    category: "editing",
    tags: ["inpainting", "fill", "remove", "replace", "edit", "mask"],
    requiredModels: ["checkpoint"],
    params: {
      prompt: { type: "string", default: "", description: "What to generate in the masked area" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality", description: "Negative prompt" },
      denoise: { type: "number", default: 0.85, description: "Denoising strength", min: 0.1, max: 1.0, step: 0.05 },
      steps: { type: "number", default: 25, description: "Sampling steps", min: 1, max: 100 },
      cfg: { type: "number", default: 7.5, description: "CFG scale", min: 1.0, max: 30.0 },
    },
    build(params) {
      const denoise = (params.denoise as number) ?? 0.85;
      return {
        "1": { inputs: { text: (params.prompt as string) || "", clip: ["3", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["3", 1] }, class_type: "CLIPTextEncode" },
        "3": { inputs: { image: (params.input_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "4": { inputs: { image: (params.mask_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "5": { inputs: { pixels: ["3", 0], vae: ["10", 2], multiplier: 1.0 }, class_type: "VAEEncode" },
        "6": { inputs: { width: ["3", 0], height: ["3", 1], interpolation: "lanczos", crop: "disabled", image: ["4", 0] }, class_type: "ImageResize" },
        "7": { inputs: { mask_channel: "red", mask: ["6", 0], normalize: "true" }, class_type: "MaskToLatent" },
        "8": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 25,
            cfg: (params.cfg as number) || 7.5,
            sampler_name: "euler",
            scheduler: "normal",
            denoise,
            model: ["9", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["5", 0]
          },
          class_type: "KSampler"
        },
        "9": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "10": { inputs: { samples: ["8", 0], vae: ["9", 2] }, class_type: "VAEDecode" },
        "11": { inputs: { filename_prefix: "inpaint", images: ["10", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // ENHANCEMENT
  // ═══════════════════════════════════════════════════════════════════════════════════

  upscale: {
    id: "upscale",
    name: "Upscale Image",
    description: "Upscale an image 2x or 4x using an upscale model",
    category: "enhancement",
    tags: ["upscale", "enhance", "resolution", "4x", "2x"],
    requiredModels: ["upscale_model"],
    params: {
      scale_factor: { type: "select", default: "2", description: "Scale factor", options: ["2", "4"] },
      model_name: { type: "string", default: "4x-UltraSharp.pth", description: "Upscale model filename" },
    },
    build(params) {
      const scale = parseInt((params.scale_factor as string) || "2");
      return {
        "1": { inputs: { image: (params.input_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "2": { inputs: { model_name: (params.model_name as string) || "4x-UltraSharp.pth" }, class_type: "UpscaleModelLoader" },
        "3": { inputs: { upscale_model: ["2", 0], image: ["1", 0] }, class_type: "ImageUpscaleWithModel" },
        "4": { inputs: { filename_prefix: "upscale", images: ["3", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  face_restore: {
    id: "face_restore",
    name: "Face Restore",
    description: "Restore and enhance faces in an image using CodeFormer or GFPGAN",
    category: "enhancement",
    tags: ["face", "restore", "enhance", "codeformer", "gfpgan", "portrait"],
    requiredModels: ["face_restore_model"],
    params: {
      fidelity: { type: "number", default: 0.6, description: "Fidelity (0=more restoration, 1=keep original)", min: 0.0, max: 1.0, step: 0.05 },
      model: { type: "select", default: "codeformer", description: "Face restore model", options: ["codeformer", "gfpgan"] },
    },
    build(params) {
      const fidelity = (params.fidelity as number) ?? 0.6;
      const model = (params.model as string) || "codeformer";
      return {
        "1": { inputs: { image: (params.input_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "2": {
          inputs: {
            detection_score: 0.5,
            image: ["1", 0],
            ...(model === "codeformer"
              ? { model_name: "codeformer-v0.1.0.pth", fidelity }
              : { model_name: "GFPGANv1.4.pth" })
          },
          class_type: model === "codeformer" ? "CodeFormerRestore" : "GFPGANRestore"
        },
        "3": { inputs: { filename_prefix: "face_restore", images: ["2", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CONTROL
  // ═══════════════════════════════════════════════════════════════════════════════════

  controlnet_canny: {
    id: "controlnet_canny",
    name: "ControlNet Canny Edge",
    description: "Use Canny edge detection to control image composition",
    category: "control",
    tags: ["controlnet", "canny", "edge", "pose", "structure", "control"],
    requiredModels: ["checkpoint", "controlnet"],
    params: {
      prompt: { type: "string", default: "", description: "Positive prompt" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality", description: "Negative prompt" },
      low_threshold: { type: "number", default: 100, description: "Canny low threshold", min: 0, max: 255 },
      high_threshold: { type: "number", default: 200, description: "Canny high threshold", min: 0, max: 255 },
      strength: { type: "number", default: 0.8, description: "ControlNet strength", min: 0.0, max: 1.0, step: 0.05 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 100 },
    },
    build(params) {
      return {
        "1": { inputs: { image: (params.input_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "2": {
          inputs: { low_threshold: (params.low_threshold as number) || 100, high_threshold: (params.high_threshold as number) || 200, image: ["1", 0] },
          class_type: "CannyEdgePreprocessor"
        },
        "3": { inputs: { text: (params.prompt as string) || "", clip: ["6", 1] }, class_type: "CLIPTextEncode" },
        "4": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["6", 1] }, class_type: "CLIPTextEncode" },
        "5": { inputs: { width: ["1", 0], height: ["1", 1], batch_size: 1 }, class_type: "EmptyLatentImage" },
        "6": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "7": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 20,
            cfg: 7.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1.0,
            model: ["6", 0],
            positive: ["3", 0],
            negative: ["4", 0],
            latent_image: ["5", 0]
          },
          class_type: "KSampler"
        },
        "8": { inputs: { strength: (params.strength as number) || 0.8, control_net: ["9", 0], image: ["2", 0], model: ["6", 0] }, class_type: "ControlNetApply" },
        "9": { inputs: { control_net_name: (params.controlnet as string) || "control-lora-canny-rank128.safetensors" }, class_type: "ControlNetLoader" },
        "10": { inputs: { samples: ["7", 0], vae: ["6", 2] }, class_type: "VAEDecode" },
        "11": { inputs: { filename_prefix: "controlnet", images: ["10", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  ip_adapter: {
    id: "ip_adapter",
    name: "IP-Adapter Style Transfer",
    description: "Apply the style/aesthetic of a reference image to generation using IP-Adapter",
    category: "control",
    tags: ["ip-adapter", "style", "reference", "aesthetic", "image prompt"],
    requiredModels: ["checkpoint", "ip_adapter_model", "clip_vision"],
    params: {
      prompt: { type: "string", default: "", description: "Positive prompt" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality", description: "Negative prompt" },
      weight: { type: "number", default: 0.8, description: "IP-Adapter influence weight", min: 0.0, max: 1.5, step: 0.05 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 100 },
      width: { type: "number", default: 1024, description: "Image width", min: 256, max: 2048, step: 64 },
      height: { type: "number", default: 1024, description: "Image height", min: 256, max: 2048, step: 64 },
    },
    build(params) {
      const w = (params.width as number) || 1024;
      const h = (params.height as number) || 1024;
      return {
        "1": { inputs: { image: (params.reference_image as string) || "", upload: "image" }, class_type: "LoadImage" },
        "2": { inputs: { clip_name: (params.clip_vision as string) || "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" }, class_type: "CLIPVisionLoader" },
        "3": { inputs: { image: ["1", 0], clip_vision: ["2", 0] }, class_type: "CLIPVisionEncode" },
        "4": { inputs: { text: (params.prompt as string) || "", clip: ["7", 1] }, class_type: "CLIPTextEncode" },
        "5": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["7", 1] }, class_type: "CLIPTextEncode" },
        "6": { inputs: { width: w, height: h, batch_size: 1 }, class_type: "EmptyLatentImage" },
        "7": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "8": {
          inputs: {
            ip_adapter_name: (params.ip_adapter as string) || "ip-adapter-plus_sdxl_vit-h.bin",
            weight: (params.weight as number) || 0.8,
            model: ["7", 0],
            image: ["3", 0],
            clip_vision: ["2", 0]
          },
          class_type: "IPAdapterApply"
        },
        "9": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 20,
            cfg: 7.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1.0,
            model: ["8", 0],
            positive: ["4", 0],
            negative: ["5", 0],
            latent_image: ["6", 0]
          },
          class_type: "KSampler"
        },
        "10": { inputs: { samples: ["9", 0], vae: ["7", 2] }, class_type: "VAEDecode" },
        "11": { inputs: { filename_prefix: "ip_adapter", images: ["10", 0] }, class_type: "SaveImage" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // VIDEO
  // ═══════════════════════════════════════════════════════════════════════════════════

  animatediff: {
    id: "animatediff",
    name: "AnimateDiff",
    description: "Generate a short animated video from a text prompt using AnimateDiff",
    category: "video",
    tags: ["animatediff", "video", "animation", "motion", "gif"],
    requiredModels: ["checkpoint", "motion_module"],
    params: {
      prompt: { type: "string", default: "", description: "Positive prompt describing the animation" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality, jitter", description: "Negative prompt" },
      frames: { type: "number", default: 16, description: "Number of frames", min: 8, max: 48, step: 8 },
      fps: { type: "number", default: 8, description: "Frames per second", min: 4, max: 30 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 50 },
      width: { type: "number", default: 512, description: "Frame width", min: 256, max: 1024, step: 64 },
      height: { type: "number", default: 512, description: "Frame height", min: 256, max: 1024, step: 64 },
    },
    build(params) {
      const w = (params.width as number) || 512;
      const h = (params.height as number) || 512;
      const frames = (params.frames as number) || 16;
      return {
        "1": { inputs: { text: (params.prompt as string) || "", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": { inputs: { width: w, height: h, batch_size: frames }, class_type: "EmptyLatentImage" },
        "4": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "5": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 20,
            cfg: 7.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["3", 0]
          },
          class_type: "KSampler"
        },
        "6": { inputs: { samples: ["5", 0], vae: ["4", 2] }, class_type: "VAEDecode" },
        "7": { inputs: { fps: (params.fps as number) || 8, loop_count: 0, filename_prefix: "AnimateDiff", images: ["6", 0] }, class_type: "SaveAnimatedWEBP" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  short_video: {
    id: "short_video",
    name: "Short Video / 短视频",
    description: "Generate a short video clip (3-5 seconds) optimized for social media. Uses AnimateDiff with higher FPS and more frames for smooth short-form content. Ideal for product teasers, social clips, and quick motion graphics.",
    category: "video",
    tags: ["short_video", "短视频", "video", "social", "animation", "clip", "reels"],
    requiredModels: ["checkpoint", "motion_module"],
    params: {
      prompt: { type: "string", default: "", description: "Video scene description with motion cues (e.g. 'camera pan, gentle movement, flowing')" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality, jitter, flicker, static, frozen", description: "Negative prompt" },
      duration: { type: "select", default: "3", description: "Video duration (seconds)", options: ["3", "4", "5"] },
      fps: { type: "number", default: 12, description: "Frames per second (12 for smooth short-form)", min: 8, max: 24 },
      steps: { type: "number", default: 25, description: "Sampling steps (higher for quality)", min: 10, max: 50 },
      width: { type: "number", default: 576, description: "Frame width (vertical 9:16 default)", min: 256, max: 1024, step: 64 },
      height: { type: "number", default: 1024, description: "Frame height (vertical 9:16 default)", min: 256, max: 1024, step: 64 },
    },
    build(params) {
      const w = (params.width as number) || 576;
      const h = (params.height as number) || 1024;
      const fps = (params.fps as number) || 12;
      const dur = parseInt((params.duration as string) || "3");
      const frames = fps * dur;
      return {
        "1": { inputs: { text: (params.prompt as string) || "cinematic video, gentle motion, flowing animation", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, jitter, flicker, static", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": { inputs: { width: w, height: h, batch_size: frames }, class_type: "EmptyLatentImage" },
        "4": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "5": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 25,
            cfg: 7.5,
            sampler_name: "euler_ancestral",
            scheduler: "normal",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["3", 0]
          },
          class_type: "KSampler"
        },
        "6": { inputs: { samples: ["5", 0], vae: ["4", 2] }, class_type: "VAEDecode" },
        "7": { inputs: { fps, loop_count: 0, filename_prefix: "ShortVideo", format: "video/mp4", images: ["6", 0] }, class_type: "SaveAnimatedWEBP" },
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  voiceover_video: {
    id: "voiceover_video",
    name: "Voiceover Video / 配音视频",
    description: "Generate video frames with audio-sync metadata. The video component is generated in ComfyUI; TTS audio is generated separately via gen.media (speech action) and combined post-render. Use this for narrated product demos, explainer videos, and social content with voiceover. Template generates the visual track optimized for later audio compositing.",
    category: "video",
    tags: ["voiceover", "配音", "video", "audio", "narration", "explainer", "social"],
    requiredModels: ["checkpoint", "motion_module"],
    params: {
      prompt: { type: "string", default: "", description: "Visual scene description — describe what appears on screen during the narration" },
      narration_text: { type: "string", default: "", description: "Narration/voiceover text (will be generated as TTS audio separately)" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality, jitter, flicker", description: "Negative prompt" },
      duration: { type: "select", default: "5", description: "Video duration (seconds, match to voiceover length)", options: ["3", "5", "8", "10", "15"] },
      fps: { type: "number", default: 12, description: "Frames per second", min: 8, max: 24 },
      steps: { type: "number", default: 25, description: "Sampling steps", min: 10, max: 50 },
      width: { type: "number", default: 576, description: "Frame width (9:16 vertical default)", min: 256, max: 1024, step: 64 },
      height: { type: "number", default: 1024, description: "Frame height (9:16 vertical default)", min: 256, max: 1024, step: 64 },
    },
    build(params) {
      const w = (params.width as number) || 576;
      const h = (params.height as number) || 1024;
      const fps = (params.fps as number) || 12;
      const dur = parseInt((params.duration as string) || "5");
      const frames = fps * dur;
      const narration = (params.narration_text as string) || "";
      return {
        "1": { inputs: { text: (params.prompt as string) || "cinematic video scene, professional lighting, smooth motion", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, jitter, flicker", clip: ["2", 1] }, class_type: "CLIPTextEncode" },
        "3": { inputs: { width: w, height: h, batch_size: frames }, class_type: "EmptyLatentImage" },
        "4": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "5": {
          inputs: {
            seed: (params.seed as number) || seed(),
            steps: (params.steps as number) || 25,
            cfg: 7.5,
            sampler_name: "euler_ancestral",
            scheduler: "normal",
            denoise: 1.0,
            model: ["4", 0],
            positive: ["1", 0],
            negative: ["2", 0],
            latent_image: ["3", 0]
          },
          class_type: "KSampler"
        },
        "6": { inputs: { samples: ["5", 0], vae: ["4", 2] }, class_type: "VAEDecode" },
        "7": { inputs: { fps, loop_count: 0, filename_prefix: "VoiceoverVideo", format: "video/mp4", images: ["6", 0] }, class_type: "SaveAnimatedWEBP" },
        // Attach narration metadata for post-processing
        "__narration": narration ? { text: narration, language: params.language || "zh", voice: params.voice || "default" } : undefined,
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════════════

  batch_prompt: {
    id: "batch_prompt",
    name: "Batch Prompt",
    description: "Generate multiple images from a list of prompts in a single workflow",
    category: "utility",
    tags: ["batch", "multiple", "grid", "prompts", "bulk"],
    requiredModels: ["checkpoint"],
    params: {
      prompts: { type: "string", default: "", description: "Prompts separated by newlines (max 20)" },
      negative_prompt: { type: "string", default: "ugly, blurry, low quality", description: "Shared negative prompt" },
      width: { type: "number", default: 1024, description: "Image width", min: 256, max: 2048, step: 64 },
      height: { type: "number", default: 1024, description: "Image height", min: 256, max: 2048, step: 64 },
      steps: { type: "number", default: 20, description: "Sampling steps", min: 1, max: 100 },
    },
    build(params) {
      const prompts = ((params.prompts as string) || "test").split("\n").filter(Boolean).slice(0, 20);
      const w = (params.width as number) || 1024;
      const h = (params.height as number) || 1024;
      return {
        "1": { inputs: { ckpt_name: (params.checkpoint as string) || "sd_xl_base_1.0.safetensors" }, class_type: "CheckpointLoaderSimple" },
        "2": { inputs: { text: (params.negative_prompt as string) || "ugly, blurry, low quality", clip: ["1", 1] }, class_type: "CLIPTextEncode" },
        ...(Object.fromEntries(prompts.map((p, i) => {
          const posId = `${3 + i * 6}`;
          const emptyId = `${4 + i * 6}`;
          const sampId = `${5 + i * 6}`;
          const decId = `${6 + i * 6}`;
          const saveId = `${7 + i * 6}`;
          return [
            [posId, { inputs: { text: p.trim(), clip: ["1", 1] }, class_type: "CLIPTextEncode" }],
            [emptyId, { inputs: { width: w, height: h, batch_size: 1 }, class_type: "EmptyLatentImage" }],
            [sampId, {
              inputs: {
                seed: seed(), steps: (params.steps as number) || 20, cfg: 7.0, sampler_name: "euler",
                scheduler: "normal", denoise: 1.0, model: ["1", 0], positive: [posId, 0],
                negative: ["2", 0], latent_image: [emptyId, 0]
              },
              class_type: "KSampler"
            }],
            [decId, { inputs: { samples: [sampId, 0], vae: ["1", 2] }, class_type: "VAEDecode" }],
            [saveId, { inputs: { filename_prefix: `batch_${i + 1}`, images: [decId, 0] }, class_type: "SaveImage" }],
          ];
        }).flat()) as Record<string, unknown>),
      };
    },
    toToolInput(params, outputPath?) {
      return { action: "comfy_workflow" as const, workflow: this.build(params), wait: true, outputPath };
    },
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────────

export function getTemplate(id: string): ComfyTemplate | undefined {
  return COMFYUI_TEMPLATES[id];
}

export function listTemplates(): ComfyTemplate[] {
  return Object.values(COMFYUI_TEMPLATES);
}

export function searchTemplates(query: string): ComfyTemplate[] {
  const q = query.toLowerCase();
  return Object.values(COMFYUI_TEMPLATES).filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.includes(q)) ||
    t.category.toLowerCase().includes(q)
  );
}

export function getTemplatesByCategory(category: ComfyTemplate["category"]): ComfyTemplate[] {
  return Object.values(COMFYUI_TEMPLATES).filter(t => t.category === category);
}

/** Build a GenerativeMediaInput ready for the gen.media tool */
export function buildWorkflowInput(
  templateId: string,
  params: Record<string, unknown>,
  outputPath?: string
): GenerativeMediaInput | null {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  return tpl.toToolInput(params, outputPath);
}
