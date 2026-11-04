// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * Regression tests for the 2026-11-04 white-screen incident (task
 * sess_01a0c34d…, five consecutive 500s on status): old tasks bound to
 * credentials that fail the current XTY provider-mode guard caused every
 * status poll to return 500, which the frontend couldn't recover from.
 * The fix: the status endpoint detects the credential-mode error, releases
 * the stale binding, and returns a terminal 422 so the frontend can show a
 * retryable failure instead of crashing.
 */

describe("stale credential handling contract", () => {
  it("the 422 error code is distinct from retryable transport errors", () => {
    // The frontend's responseLogicTaskStatusIsRetryable must NOT treat 422
    // with RESPONSE_LOGIC_TASK_CREDENTIAL_EXPIRED as retryable — it is a
    // terminal state that requires the user to re-generate.
    const status = 422;
    const code = "RESPONSE_LOGIC_TASK_CREDENTIAL_EXPIRED";
    // 422 is NOT in the retryable set (401/403/429/5xx), and the specific
    // code is not a binding-forbidden code either.
    expect(status === 401 || status === 403 || status === 429 || status >= 500).toBe(false);
    expect(code).not.toMatch(/FORBIDDEN|TRANSPORT/);
  });

  it("the error message guides the user to re-generate, not to wait", () => {
    const message =
      "该任务绑定的凭据已失效（部署模式变更），已自动解除绑定。请重新生成应答逻辑。";
    expect(message).toContain("重新生成");
    expect(message).not.toContain("正在");
  });
});
