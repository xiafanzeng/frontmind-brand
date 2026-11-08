import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vitestEntry = require.resolve("vitest/vitest.mjs");
const testFile = "client/dashboard/ai-website-preview/RagChat.test.tsx";
const shards = [
  { name: "starter basics", pattern: "starter basics", expected: 11 },
  { name: "starter toolbar", pattern: "uses the standard answer toolbar", expected: 1 },
  { name: "starter draft confirmation", pattern: "keeps confirmed starters usable", expected: 1 },
  { name: "starter draft cancellation", pattern: "keeps the popover open", expected: 1 },
  { name: "starter draft conflict", pattern: "discards a stale starter edit", expected: 1 },
  { name: "answer identity history", pattern: "answer identity history", expected: 2 },
  { name: "answer interactions", pattern: "answer interactions", expected: 15 },
  { name: "queue reliability", pattern: "queue reliability", expected: 10 },
];

const resultDirectory = mkdtempSync(join(tmpdir(), "frontmind-ragchat-"));
let passed = 0;

try {
  for (const [index, shard] of shards.entries()) {
    const outputFile = join(resultDirectory, `${index}.json`);
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [
      vitestEntry,
      "run",
      "--config",
      "vitest.config.ts",
      testFile,
      `--testNamePattern=${shard.pattern}`,
      "--hideSkippedTests",
      "--reporter=json",
      `--outputFile=${outputFile}`,
    ], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

    if (result.status !== 0) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      throw new Error(`RagChat shard failed: ${shard.name} (exit ${result.status ?? "unknown"})`);
    }

    const report = JSON.parse(readFileSync(outputFile, "utf8"));
    if (report.numFailedTests !== 0 || report.numPassedTests !== shard.expected) {
      throw new Error(`RagChat shard ${shard.name} expected ${shard.expected} passes, got ${report.numPassedTests} passed and ${report.numFailedTests} failed.`);
    }
    passed += report.numPassedTests;
    console.log(`RagChat shard ${shard.name}: ${report.numPassedTests} passed in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  }

  const expectedTotal = shards.reduce((total, shard) => total + shard.expected, 0);
  if (passed !== expectedTotal || expectedTotal !== 42) {
    throw new Error(`RagChat shard coverage mismatch: ${passed}/${expectedTotal}, expected 42 total.`);
  }
  console.log(`RagChat sharded suite: ${passed}/42 passed.`);
} finally {
  rmSync(resultDirectory, { recursive: true, force: true });
}
