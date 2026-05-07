declare module "node-llama-cpp" {
  export function getLlama(options?: {
    gpu?: false | "auto" | "metal" | "cuda" | "vulkan";
    progressLogs?: boolean;
  }): Promise<unknown>;
  export interface Llama {
    loadModel(options: { modelPath: string }): Promise<unknown>;
  }
}
