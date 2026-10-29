/** Offline fixed judgments only. No provider, network, real customer data or
 * human-review claim. Run after building module/dist. */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRagChecklist } from "../dist/contracts/enterprise-rag-checklist.js";
import { ENTERPRISE_RAG_GATE_IDS, validateEnterpriseRagJudgeOutput } from "../dist/contracts/enterprise-rag-evaluation-run.js";
import { checklistEnterpriseRagEvaluationSkill } from "../dist/client/dashboard/ai-website-preview/enterprise-rag-checklist-skill.js";
import { runEvaluationSkill } from "../dist/client/dashboard/ai-website-preview/evaluation-skill-contract.js";
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const tasks = JSON.parse(await readFile(new URL("../fixtures/rag-eval-1.4/tasks.json", import.meta.url), "utf8"));

export function calibrationCase(task = tasks[0], quality = "complete") {
  const answer = quality === "critical" ? task.wrongFact
    : quality === "minor" ? `${task.fact}${task.fact}`
    : quality === "noticeable" ? `星舟让每一天更美好，欢迎关注更多与本次问题无关的品牌故事。${task.fact}${task.fact}${task.fact}` : task.fact;
  const input = {
    schemaVersion: 3, taskScope: "single_turn", checklist: createRagChecklist(task.question, task.taskKind),
    operationToken: `synthetic:${task.taskKind}:${quality}`, sourceQaTaskId: "synthetic-qa", sourceTurnId: `synthetic-${quality}`,
    conversationId: "synthetic-conversation", questionMessageId: "q", answerMessageId: "a", question: task.question, answer,
    sources: [{ id: "synthetic-source", title: "合成星舟知识（非真实企业）", kind: "published_knowledge", citedByAnswer: true, content: task.fact }],
    allowedEvidenceIds: ["question:q", "answer:a", "synthetic-source"],
    knowledgeBase: { snapshotId: "synthetic-kb", version: 1, sourceFileName: "tasks.json", documentCount: 1, contentHash: hash(task.fact) },
    evaluator: { skillId: "enterprise-rag-evaluation", skillVersion: "3.0.0", judgeVersion: "3.0.0", ruleVersion: "rag-eval-1.4" },
  };
  input.inputHash = hash(input);
  const output = {
    schemaVersion: 3, operationToken: input.operationToken, inputHash: input.inputHash,
    checks: input.checklist.checks.map(c => ({ id: c.id, status: "met", rationale: "固定合成标注：本项适用要求均满足，不额外要求无关信息。", evidenceIds: ["answer:a", "synthetic-source"] })),
    gates: ENTERPRISE_RAG_GATE_IDS.map(id => ({ id, status: "passed", reason: "固定合成标注，未发现此类重大风险。", evidenceIds: ["answer:a", "synthetic-source"] })),
    claims: [{ id: "claim-1", statement: quality === "critical" ? task.wrongFact : task.fact, kind: "fact", relevance: "core", status: quality === "critical" ? "contradicted" : "supported", sourceIds: ["synthetic-source"], rationale: quality === "critical" ? "合成原文直接反驳核心事实。" : "合成原文支持此陈述。" }],
    task: { status: "completed", rationale: "固定合成标签，单次核心任务已回应；质量风险另行判断。", evidenceIds: ["question:q", "answer:a"] },
    findings: [], optionalSuggestions: [], summary: "合成固定判断，非模型运行、非真实人工验收。",
  };
  const defect = (checkId, status, severity, kind, summary, impact) => {
    const check = output.checks.find(c => c.id === checkId); check.status = status; check.rationale = impact;
    const coordinate = output.findings.length + 1;
    output.findings.push({ id: `finding-${coordinate}`, rootCauseId: `root-cause-${coordinate}`, checkId, kind, severity, summary, impact,
      dimensionIds: [input.checklist.checks.find(c => c.id === checkId).dimensionId], claimIds: kind === "fact" ? ["claim-1"] : [], evidenceIds: ["answer:a", "synthetic-source"] });
  };
  if (quality === "minor") defect("clarity_concise", "partial", "improvement", "expression", "同一句说明重复一次", "原句重复一次，但用户仍能完成当前任务。");
  if (quality === "noticeable") {
    defect("clarity_concise", "unmet", "improvement", "expression", "同一句说明重复多次", "重复说明多次，增加阅读负担。");
    defect("clarity_direct", "partial", "improvement", "expression", "无关宣传先于核心答案", "独立的无关开场使用户需要查找答案，但信息仍可找到。");
  }
  if (quality === "critical") {
    defect("facts_core", "unmet", "critical", "fact", "核心事实与正式依据矛盾", "错误渠道、条件或能力会改变用户决策或行动。");
    output.gates.find(g => g.id === "facts").status = "failed";
  }
  return { provenance: "synthetic_fixed_judgment", input, output,
    expectedScore: { complete: 100, minor: 98.5, noticeable: 94.5, critical: 83 }[quality],
    expectedVerdict: quality === "critical" ? "unusable" : quality === "complete" ? "usable" : "usable_with_improvements" };
}

export async function runCalibration(outputDirectory) {
  const rows = [];
  // An existing directory is never reused: prior evidence remains intact.
  await mkdir(outputDirectory);
  const manifest = [];
  for (const task of tasks) for (const quality of ["complete", "minor", "noticeable", "critical"]) {
    const sample = calibrationCase(task, quality);
    const judgments = validateEnterpriseRagJudgeOutput(sample.output, sample.input);
    const result = await runEvaluationSkill(checklistEnterpriseRagEvaluationSkill, judgments);
    if (result.score !== sample.expectedScore || result.answerVerdict !== sample.expectedVerdict) throw new Error(`Calibration mismatch: ${task.taskKind}/${quality}`);
    const file = `${task.taskKind}-${quality}.json`, content = JSON.stringify({ ...sample, result }, null, 2) + "\n";
    await writeFile(path.join(outputDirectory, file), content, { flag: "wx" });
    manifest.push({ file, sha256: hash(content) });
    rows.push(`|${task.taskKind}|${quality}|${result.score}|${result.answerVerdict}|`);
  }
  const report = `# rag-eval-1.4 合成校准回放\n\n全部为合成资料与固定标注；没有模型调用，没有真实客户数据，不代表人工或业务验收。分数差异来自指定缺陷，不是目标分布。\n\n|任务|样例|分数|结论|\n|---|---|---|---|\n${rows.join("\n")}\n\n规则变化：相较 rag-eval-1.3，改用检查项汇总；不得据此宣称 RAG 能力改善。\n`;
  await writeFile(path.join(outputDirectory, "REPORT.md"), report, { flag: "wx" });
  manifest.push({ file: "REPORT.md", sha256: hash(report) });
  await writeFile(path.join(outputDirectory, "manifest.json"), JSON.stringify({ provenance: "synthetic_fixed_judgment", ruleVersion: "rag-eval-1.4", files: manifest }, null, 2) + "\n", { flag: "wx" });
  return { cases: rows.length, outputDirectory };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Provide a new output directory.");
  console.log(JSON.stringify(await runCalibration(path.resolve(process.argv[2]))));
}
