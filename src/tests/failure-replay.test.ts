import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFailureReplayGoal,
  looksLikeCodeFailure,
  selectFailureReplayCandidates
} from "../tasks/failure-replay.js";
import type { TaskRecord } from "../tasks/task-store.js";

function task(partial: Partial<TaskRecord>): TaskRecord {
  return {
    taskId: partial.taskId ?? "task-1",
    goal: partial.goal ?? "fix tests",
    source: partial.source ?? "manual",
    status: partial.status ?? "failed",
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    completedAt: partial.completedAt,
    retryCount: partial.retryCount ?? 0,
    maxRetries: partial.maxRetries ?? 1,
    error: partial.error,
    replayedByTaskId: partial.replayedByTaskId,
    replayOfTaskId: partial.replayOfTaskId,
    priority: partial.priority ?? 0
  };
}

test("failure replay goal includes original failure context", () => {
  const goal = buildFailureReplayGoal(
    task({
      taskId: "failed-1",
      goal: "make build pass",
      error: "TypeScript error"
    })
  );

  assert.match(goal, /make build pass/);
  assert.match(goal, /TypeScript error/);
  assert.match(goal, /code\.self_improve/);
});

test("failure replay detects code-like failures and prefers self-improve", () => {
  const failedTask = task({
    goal: "fix npm test failure",
    error: "tsc compile error"
  });

  assert.equal(looksLikeCodeFailure(failedTask), true);
  assert.match(buildFailureReplayGoal(failedTask), /prefer calling code\.self_improve/);
});

test("failure replay can force self-improve preference", () => {
  const goal = buildFailureReplayGoal(
    task({
      goal: "summarize docs",
      error: "model unavailable"
    }),
    { preferSelfImprove: true }
  );

  assert.match(goal, /prefer calling code\.self_improve/);
});

test("failure replay candidate selection skips already replayed tasks", () => {
  const candidates = selectFailureReplayCandidates(
    [
      task({ taskId: "failed-1", completedAt: "2026-01-01T00:00:00.000Z" }),
      task({ taskId: "failed-2", replayedByTaskId: "replay-2" }),
      task({ taskId: "done-1", status: "completed" })
    ],
    5
  );

  assert.deepEqual(candidates.map((item) => item.taskId), ["failed-1"]);
});
