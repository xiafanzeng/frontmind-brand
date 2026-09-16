#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";


const args = process.argv.slice(2);
if (args.length < 2) {
  throw new Error(
    "Usage: build_workbook.mjs <final.json> <output.xlsx> [--preview <preview.png>]",
  );
}

const inputPath = path.resolve(args[0]);
const outputPath = path.resolve(args[1]);
let previewPath = null;
for (let index = 2; index < args.length; index += 1) {
  if (args[index] === "--preview") {
    if (!args[index + 1]) throw new Error("--preview requires a path");
    previewPath = path.resolve(args[index + 1]);
    index += 1;
  } else {
    throw new Error(`Unknown argument: ${args[index]}`);
  }
}

const headers = ["序号", "问题", "核心词", "核心词分类", "问题细分"];
const headerSet = new Set(headers);
const categoryOrder = ["行业排名词", "竞品对比词", "美誉舆情词", "产品场景词"];
const targets = {
  行业排名词: 20,
  竞品对比词: 20,
  美誉舆情词: 20,
  产品场景词: 100,
};

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = Array.isArray(payload)
  ? payload
  : Array.isArray(payload?.rows)
    ? payload.rows
    : payload?.questions;

if (!Array.isArray(rows)) {
  throw new Error("Input JSON must be an array or contain a rows/questions array");
}
if (rows.length !== 160) {
  throw new Error(`Expected 160 rows, received ${rows.length}`);
}

const expectedCategories = categoryOrder.flatMap((category) =>
  Array(targets[category]).fill(category),
);
const categoryCounts = Object.fromEntries(categoryOrder.map((category) => [category, 0]));

const outputRows = rows.map((row, index) => {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`Row ${index + 1} is not an object`);
  }
  const keys = Object.keys(row);
  if (keys.length !== headers.length || keys.some((key) => !headerSet.has(key))) {
    throw new Error(`Row ${index + 1} must contain exactly: ${headers.join(" / ")}`);
  }
  if (row["序号"] !== index + 1) {
    throw new Error(`Row ${index + 1} has invalid 序号 ${row["序号"]}`);
  }
  if (row["核心词分类"] !== expectedCategories[index]) {
    throw new Error(
      `Row ${index + 1} expected ${expectedCategories[index]}, received ${row["核心词分类"]}`,
    );
  }
  for (const header of headers.slice(1)) {
    if (typeof row[header] !== "string" || row[header].trim() === "") {
      throw new Error(`Row ${index + 1} has an empty ${header}`);
    }
  }
  categoryCounts[row["核心词分类"]] += 1;
  return headers.map((header) => row[header]);
});

for (const category of categoryOrder) {
  if (categoryCounts[category] !== targets[category]) {
    throw new Error(
      `${category} expected ${targets[category]}, received ${categoryCounts[category]}`,
    );
  }
}

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("问题列表");
sheet.showGridLines = true;
sheet.freezePanes.unfreeze();

sheet.getRange("A1:E161").values = [headers, ...outputRows];

const headerRange = sheet.getRange("A1:E1");
headerRange.format = {
  fill: "#C0C0C0",
  font: { bold: true, name: "宋体", size: 14 },
  borders: { preset: "all", style: "thin", color: "#000000" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
headerRange.format.rowHeight = 25;

const bodyRange = sheet.getRange("A2:E161");
bodyRange.format = {
  font: { name: "Calibri", size: 11 },
  wrapText: false,
};
bodyRange.format.rowHeight = 18;

const widths = { A: 8, B: 50, C: 34, D: 15, E: 15 };
for (const [column, width] of Object.entries(widths)) {
  sheet.getRange(`${column}1:${column}161`).format.columnWidth = width;
}

const usedRange = sheet.getUsedRange();
if (usedRange.address !== "A1:E161") {
  throw new Error(`Unexpected used range before export: ${usedRange.address}`);
}
const usedValues = usedRange.values;
if (usedValues.length !== 161 || usedValues[0]?.length !== 5) {
  throw new Error("Unexpected workbook shape before export");
}
if (JSON.stringify(usedValues[0]) !== JSON.stringify(headers)) {
  throw new Error("Visible headers do not match the required schema");
}

const headInspection = await workbook.inspect({
  kind: "table",
  sheetId: "问题列表",
  range: "A1:E8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 5,
  maxChars: 8000,
});
const tailInspection = await workbook.inspect({
  kind: "table",
  sheetId: "问题列表",
  range: "A154:E161",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 5,
  maxChars: 8000,
});
const styleInspection = await workbook.inspect({
  kind: "computedStyle",
  sheetId: "问题列表",
  range: "A1:E3",
  maxChars: 10000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "question universe formula error scan",
});
const formulaScanRecords = formulaErrors.ndjson
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const formulaScanIsClean = formulaScanRecords.length > 0
  && formulaScanRecords.every(
    (record) => record.kind === "notice" && /matched 0 entries/i.test(record.message ?? ""),
  );
if (!formulaScanIsClean) {
  throw new Error(`Formula error scan returned matches: ${formulaErrors.ndjson}`);
}

const preview = await workbook.render({
  sheetName: "问题列表",
  range: "A1:E161",
  scale: 1,
  format: "png",
});
if (previewPath) {
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

const roundTrip = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const sheetNames = roundTrip.worksheets.items.map((item) => item.name);
if (sheetNames.length !== 1 || sheetNames[0] !== "问题列表") {
  throw new Error(`Unexpected worksheets after export: ${sheetNames.join(", ")}`);
}
const roundTripSheet = roundTrip.worksheets.getItem("问题列表");
const roundTripRange = roundTripSheet.getUsedRange();
if (roundTripRange.address !== "A1:E161") {
  throw new Error(`Round-trip used range mismatch: ${roundTripRange.address}`);
}
const roundTripValues = roundTripRange.values;
const expectedValues = [headers, ...outputRows];
if (
  roundTripValues.length !== 161
  || roundTripValues[0]?.length !== 5
  || JSON.stringify(roundTripValues[0]) !== JSON.stringify(headers)
) {
  throw new Error("Round-trip workbook structure mismatch");
}
if (JSON.stringify(roundTripValues) !== JSON.stringify(expectedValues)) {
  throw new Error("Round-trip workbook values do not match the input matrix");
}

const inspectSidecarPath = `${outputPath}.inspect.ndjson`;
try {
  await fs.unlink(inspectSidecarPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(JSON.stringify({
  status: "ok",
  outputPath,
  previewPath,
  sheet: "问题列表",
  usedRange: roundTripRange.address,
  rows: rows.length,
  categories: categoryCounts,
  inspections: {
    headChars: headInspection.ndjson.length,
    tailChars: tailInspection.ndjson.length,
    styleChars: styleInspection.ndjson.length,
    formulaErrorScanChars: formulaErrors.ndjson.length,
    formulaErrors: 0,
  },
}, null, 2));
