import { ProgressManager, ProgressEvent } from "../progress-manager.js";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  execute: (context: WorkflowContext) => Promise<StepResult>;
}

export interface StepResult {
  success: boolean;
  output?: any;
  error?: string;
}

export interface SearchResult {
  title: string;
  url?: string;
  content: string;
  snippet?: string;
  relevance?: number;
}

export interface WorkflowContext {
  goal: string;
  domain: string;
  data: Map<string, any>;
  progress: ProgressManager;
  taskId: string;
  complete: (prompt: string) => Promise<string>;
  search?: (query: string, maxResults?: number) => Promise<SearchResult[]>;
}

export abstract class DomainWorkflow {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly steps: WorkflowStep[];

  async execute(context: WorkflowContext): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of this.steps) {
      context.progress.emit(context.taskId, {
        type: "step_start",
        payload: { stepId: step.id, stepName: step.name },
        at: new Date().toISOString()
      });

      try {
        const result = await step.execute(context);
        results.push(result);

        context.progress.emit(context.taskId, {
          type: result.success ? "step_complete" : "step_failed",
          payload: { stepId: step.id, stepName: step.name, result },
          at: new Date().toISOString()
        });

        if (!result.success) {
          context.progress.emit(context.taskId, {
            type: "workflow_failed",
            payload: { stepId: step.id, error: result.error },
            at: new Date().toISOString()
          });
          break;
        }
      } catch (err: any) {
        const errorResult: StepResult = { success: false, error: err.message };
        results.push(errorResult);
        context.progress.emit(context.taskId, {
          type: "step_failed",
          payload: { stepId: step.id, stepName: step.name, error: err.message },
          at: new Date().toISOString()
        });
        break;
      }
    }

    context.progress.emit(context.taskId, {
      type: "workflow_complete",
      payload: { totalSteps: results.length, successful: results.filter(r => r.success).length },
      at: new Date().toISOString()
    });

    return results;
  }
}
