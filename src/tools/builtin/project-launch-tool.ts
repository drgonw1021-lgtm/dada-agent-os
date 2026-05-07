import type { ToolDefinition, ToolContext } from "../../core/types.js";
import type { TaskChainManager, ProjectChainDef, TaskTemplate } from "../../tasks/task-chain-manager.js";

export interface ProjectLaunchInput {
  /** Project name for tracking */
  name: string;
  /** High-level project goal */
  goal: string;
  /** Ordered task chain. Tasks execute sequentially by default; use dependsOn for DAG structure. */
  tasks: Array<{
    goal: string;
    taskType?: string;
    assignedRole?: string;
    /** Zero-based index of task this depends on. Omit for entry-point tasks. */
    dependsOn?: number;
  }>;
}

export interface ProjectLaunchOutput {
  success: boolean;
  projectId?: string;
  enqueuedTaskIds?: string[];
  taskCount?: number;
  error?: string;
}

export function createProjectLaunchTool(
  chainManager: TaskChainManager
): ToolDefinition<ProjectLaunchInput, ProjectLaunchOutput> {
  return {
    id: "project.launch",
    description:
      "Launch a multi-task project chain. Define a sequence of tasks with dependencies — " +
      "when a parent task completes, dependent child tasks automatically receive its output and execute. " +
      "Use this for complex multi-step projects that span research → engineering → verification workflows.",
    requiredScopes: [],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short project name (e.g., 'market-research-q2')" },
        goal: { type: "string", description: "Overall project goal" },
        tasks: {
          type: "array",
          description: "Ordered task chain. First task(s) without dependsOn are entry points.",
          items: {
            type: "object",
            properties: {
              goal: { type: "string", description: "Task goal. Use {{parentSummary}} to include previous task output." },
              taskType: { type: "string", description: "Task type hint: research, code, image_generation, general" },
              assignedRole: { type: "string", description: "Agent role: researcher, engineer, media, reviewer" },
              dependsOn: { type: "number", description: "Zero-based index of task this depends on. Omit for first tasks." },
            },
            required: ["goal"],
          },
        },
      },
      required: ["name", "goal", "tasks"],
    },
    async execute(input: ProjectLaunchInput, _context: ToolContext): Promise<ProjectLaunchOutput> {
      try {
        const templates: TaskTemplate[] = input.tasks.map((t) => ({
          goal: t.goal,
          taskType: t.taskType as any,
          assignedRole: t.assignedRole as any,
          dependsOn: t.dependsOn,
        }));

        const chain: ProjectChainDef = {
          projectId: "",
          name: input.name,
          goal: input.goal,
          tasks: templates,
        };

        const enqueuedIds = await chainManager.launch(chain);
        const projectId = enqueuedIds[0] || "";

        return {
          success: true,
          projectId,
          enqueuedTaskIds: enqueuedIds,
          taskCount: input.tasks.length,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  };
}
