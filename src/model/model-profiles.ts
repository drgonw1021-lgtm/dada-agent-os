import type { AppConfig } from "../config.js";
import type { ModelRuntimeStatus } from "./model-manager.js";

export interface ModelProfile {
  id: string;
  name: string;
  description: string;
  bestFor: string[];
  env: {
    PLANNER_MODEL: string;
    EXECUTOR_MODEL: string;
    CRITIC_MODEL: string;
  };
  requirements: string[];
  active: boolean;
  ready: boolean;
}

function isActive(config: AppConfig, env: ModelProfile["env"]): boolean {
  return (
    config.plannerModel === env.PLANNER_MODEL &&
    config.executorModel === env.EXECUTOR_MODEL &&
    config.criticModel === env.CRITIC_MODEL
  );
}

export function buildModelProfiles(params: {
  config: AppConfig;
  modelRuntime: ModelRuntimeStatus;
}): ModelProfile[] {
  const localServiceModel = "ollama:qwen2.5:7b";
  const cloudEconomyModel = "cloud:<economy-model-id>";
  const cloudQualityModel = "cloud:<quality-model-id>";
  const hasLocalService = params.modelRuntime.detectedLocalEndpoints.length > 0;

  const profiles: Array<Omit<ModelProfile, "active">> = [
    {
      id: "local-only",
      name: "本地优先",
      description: "Planner / Executor / Critic 全部走内置 GGUF，适合隐私优先和离线场景。",
      bestFor: ["隐私数据", "离线运行", "低云端成本"],
      env: {
        PLANNER_MODEL: "builtin:default",
        EXECUTOR_MODEL: "builtin:default",
        CRITIC_MODEL: "builtin:default"
      },
      requirements: [`${params.modelRuntime.modelsDir} 目录下至少有一个 GGUF 模型`],
      ready: params.modelRuntime.builtinReady
    },
    {
      id: "local-service",
      name: "本地服务模型",
      description: "使用 Ollama / 本地 OpenAI-compatible 服务承载所有角色，部署简单。",
      bestFor: ["已有 Ollama", "局域网模型服务", "快速试用"],
      env: {
        PLANNER_MODEL: localServiceModel,
        EXECUTOR_MODEL: localServiceModel,
        CRITIC_MODEL: localServiceModel
      },
      requirements: hasLocalService
        ? [`已检测到可用本地服务: ${params.modelRuntime.detectedLocalEndpoints.join(", ")}`]
        : ["本地模型服务在线（Ollama / LM Studio / vLLM / llama.cpp）"],
      ready: hasLocalService
    },
    {
      id: "hybrid-economy",
      name: "云端规划 + 本地执行",
      description: "云端模型负责复杂规划和复盘，本地模型负责工具执行与代码生成，平衡质量和成本。",
      bestFor: ["长任务", "代码项目", "成本可控的自治执行"],
      env: {
        PLANNER_MODEL: cloudEconomyModel,
        EXECUTOR_MODEL: "builtin:default",
        CRITIC_MODEL: cloudEconomyModel
      },
      requirements: ["配置 CLOUD_MODEL_ENDPOINT / CLOUD_API_KEY", "本地 GGUF 模型可用"],
      ready: Boolean(params.config.cloudApiKey) && params.modelRuntime.builtinReady
    },
    {
      id: "cloud-quality",
      name: "云端高质量",
      description: "三个角色全部使用云端 OpenAI-compatible 模型，优先保证推理质量和稳定性。",
      bestFor: ["复杂决策", "高价值任务", "需要强推理的项目分析"],
      env: {
        PLANNER_MODEL: cloudQualityModel,
        EXECUTOR_MODEL: cloudQualityModel,
        CRITIC_MODEL: cloudQualityModel
      },
      requirements: ["配置 CLOUD_MODEL_ENDPOINT / CLOUD_API_KEY", "把 <quality-model-id> 替换为实际模型名"],
      ready: Boolean(params.config.cloudApiKey)
    }
  ];

  return profiles.map((profile) => ({
    ...profile,
    active: isActive(params.config, profile.env)
  }));
}
