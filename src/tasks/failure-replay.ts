import type { TaskRecord } from "./task-store.js";

export interface FailureReplayPlan {
  sourceTaskId: string;
  goal: string;
}

export interface FailureReplayOptions {
  preferSelfImprove?: boolean;
}

export function looksLikeCodeFailure(task: TaskRecord): boolean {
  const text = `${task.goal}\n${task.error ?? ""}\n${task.summary ?? ""}`.toLowerCase();
  return [
    "test",
    "build",
    "typescript",
    "javascript",
    "python",
    "code",
    "compile",
    "lint",
    "npm",
    "pytest",
    "tsc",
    "bug",
    "fix"
  ].some((token) => text.includes(token));
}

export function buildFailureReplayGoal(
  task: TaskRecord,
  options: FailureReplayOptions = {}
): string {
  const preferSelfImprove = options.preferSelfImprove || looksLikeCodeFailure(task);

  return [
    "Replay a previously failed autonomous agent task.",
    "",
    "## Original goal",
    task.goal,
    "",
    "## Failure context",
    `Task ID: ${task.taskId}`,
    `Status: ${task.status}`,
    `Error: ${task.error || "unknown"}`,
    task.summary ? `Summary: ${task.summary}` : "",
    "",
    "## Replay instructions",
    "- First analyze why the prior attempt failed.",
    "- Avoid repeating the same failing action blindly.",
    "- Prefer safe read/check/build commands before write or shell operations.",
    preferSelfImprove
      ? "- This looks like a code/build/test failure: prefer calling code.self_improve after reading the relevant files and test output."
      : "- If this is a code-generation or test-fix task, consider using code.self_improve.",
    "- If a high-risk operation is needed, request approval through the normal tool flow.",
    "- Finish with a concise DONE summary when the replay succeeds."
  ]
    .filter(Boolean)
    .join("\n");
}

export function selectFailureReplayCandidates(
  tasks: TaskRecord[],
  limit: number
): TaskRecord[] {
  return tasks
    .filter(
      (task) =>
        task.status === "failed" &&
        !task.replayedByTaskId &&
        !task.replayOfTaskId &&
        !task.cancelRequested
    )
    .sort((a, b) => (b.completedAt ?? b.updatedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.updatedAt ?? a.createdAt))
    .slice(0, Math.max(0, limit));
}
