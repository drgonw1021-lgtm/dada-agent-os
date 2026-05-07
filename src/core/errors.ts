export class PermissionDeniedError extends Error {
  constructor(scope: string, toolId: string) {
    super(`Permission denied for scope "${scope}" while calling tool "${toolId}"`);
    this.name = "PermissionDeniedError";
  }
}

export class ToolNotFoundError extends Error {
  constructor(toolId: string) {
    super(`Tool "${toolId}" is not registered`);
    this.name = "ToolNotFoundError";
  }
}

export class ApprovalRequiredError extends Error {
  constructor(
    public readonly toolId: string,
    public readonly approvalId: string
  ) {
    super(`Tool "${toolId}" requires approval (${approvalId})`);
    this.name = "ApprovalRequiredError";
  }
}

export class TaskPausedForApprovalError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly toolId: string,
    message = `Task paused for approval on tool "${toolId}"`
  ) {
    super(message);
    this.name = "TaskPausedForApprovalError";
  }
}
