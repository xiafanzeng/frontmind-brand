import { describe, expect, it } from "vitest";
import type { DiagnosticRun, DiagnosticJob } from "../contracts/diagnostics.js";
import { diagnosticOperationStatus, terminalDiagnosticJobOperationStatus } from "../server/diagnostic-operation-status.js";
const run = (extra: Partial<DiagnosticRun> = {}) => ({ phase: "draft", jobs: [], attempts: [], results: {}, ...extra }) as DiagnosticRun;
const job = (status: DiagnosticJob["status"]) => ({ id: "job", kind: "recommend", status }) as DiagnosticJob;
describe("diagnostic operation ledger", () => {
  it("does not schedule an idle draft as a running agent", () => {
    expect(diagnosticOperationStatus(run())).toBe("succeeded");
    expect(diagnosticOperationStatus(run({ jobs: [job("failed")] }))).toBe("failed");
  });
  it("keeps active jobs and accepted samples running until their outcome is known", () => {
    expect(diagnosticOperationStatus(run({ jobs: [job("submitting")] }))).toBe("running");
    expect(diagnosticOperationStatus(run({ phase: "collecting", attempts: [{ status: "submitted" } as any] }))).toBe("running");
    expect(diagnosticOperationStatus(run({ phase: "stopped", jobs: [job("running")] }))).toBe("cancelled");
  });
  it("repairs only definite terminal child facts", () => {
    expect(terminalDiagnosticJobOperationStatus(job("failed"))).toBe("failed");
    expect(terminalDiagnosticJobOperationStatus(job("cancelled"))).toBe("cancelled");
    expect(terminalDiagnosticJobOperationStatus(job("completed"))).toBe("succeeded");
    expect(terminalDiagnosticJobOperationStatus(job("submitting"))).toBeNull();
  });
});
