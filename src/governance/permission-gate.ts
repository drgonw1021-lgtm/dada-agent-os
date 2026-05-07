import { PermissionDeniedError } from "../core/errors.js";
import type { PermissionScope } from "../core/types.js";

export class PermissionGate {
  constructor(private readonly grantedScopes: Set<PermissionScope>) {}

  assert(toolId: string, requiredScopes: PermissionScope[]): void {
    for (const scope of requiredScopes) {
      if (!this.grantedScopes.has(scope)) {
        throw new PermissionDeniedError(scope, toolId);
      }
    }
  }
}
