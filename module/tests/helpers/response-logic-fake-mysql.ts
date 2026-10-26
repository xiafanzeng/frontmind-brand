import { createHash } from "node:crypto";

/**
 * A mysql2-shaped client double for exercising the REAL drizzle query
 * construction of the response-logic runtime against an in-memory database.
 * drizzle's mysql2 session calls client.query({sql, rowsAsArray?, ...}, params)
 * and — for raw db.execute() — resolves the raw driver tuple [rows, fields]
 * verbatim (drizzle-orm/mysql2 session.js: `!fields && !customResultMapper`
 * branch). This double reproduces both shapes exactly.
 */
export type FakeLedgerRow = {
  ownerUserId: number;
  projectId: string | null;
  payload: unknown;
  revision: number;
};

export type FakeLocalAsset = {
  id: string;
  scope: "managed_user";
  ownerUserId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export function fakeWorkspaceKeyDigest(accountUserId: number, enterpriseProjectId: string | null) {
  return createHash("sha256").update(`${accountUserId}:${enterpriseProjectId ?? "personal"}`, "utf-8").digest("hex");
}

export function createFakeMysqlClient(input: { ledger: FakeLedgerRow[]; localAssets?: FakeLocalAsset[] }) {
  const entries: Array<Record<string, unknown>> = [];
  const localAssets = input.localAssets ?? [];
  const sqlLog: string[] = [];

  const parseColumns = (sql: string, marker: RegExp) => {
    const match = marker.exec(sql);
    if (!match) return [];
    return match[1].split(",").map(part => part.trim().replace(/`/g, ""));
  };

  const client = {
    async query(config: { sql: string; rowsAsArray?: boolean }, params: unknown[] = []) {
      const sql: string = config.sql;
      sqlLog.push(sql);
      if (sql === "begin" || sql === "commit" || sql === "rollback") return [[]];
      // mysql2 returns JSON columns as parsed objects (jsonStrings: false),
      // while drizzle sends JSON params as serialized strings — normalize on
      // the way in so rows come back object-shaped like the real driver.
      const jsonColumns = new Set(["draft", "confirmed", "appliedModelResult", "lastPublicationMutation"]);
      const normalizeJson = (column: string, value: unknown) => {
        if (jsonColumns.has(column) && typeof value === "string") {
          try { return JSON.parse(value); } catch { return value; }
        }
        return value;
      };

      // Raw db.execute() from brand-question-resolver: object rows in the
      // driver tuple. Params: workspaceKey, ownerUserId, projectId.
      if (sql.toLowerCase().includes("brand_intent_workspaces")) {
        const matched = input.ledger.filter(
          row =>
            fakeWorkspaceKeyDigest(row.ownerUserId, row.projectId) === params[0] &&
            row.ownerUserId === params[1],
        );
        return [
          matched.map(row => ({
            payload: typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload),
            revision: row.revision,
          })),
          [{ name: "payload" }, { name: "revision" }],
        ];
      }

      // The Brand question lock deliberately never matches (1 = 0).
      if (sql.includes("`response_logic_entries`") && sql.includes("1 = 0")) {
        return [[], parseColumns(sql, /^select (.+?) from /).map(name => ({ name }))];
      }

      if (sql.startsWith("select") && sql.includes("`response_logic_entries`")) {
        const columns = parseColumns(sql, /^select (.+?) from /);
        const userId = params[0] as number;
        const byQuestion = sql.includes("`questionId` = ?");
        const questionId = byQuestion ? (params[1] as string) : undefined;
        let matched = entries.filter(
          row => row.userId === userId && (questionId === undefined || row.questionId === questionId),
        );
        if (sql.includes("order by")) {
          matched = [...matched].sort(
            (a, b) => String(a.groupId).localeCompare(String(b.groupId)) || String(a.questionId).localeCompare(String(b.questionId)),
          );
        }
        const limit = /limit \?/.test(sql) ? Number(params[params.length - 1]) : undefined;
        if (limit !== undefined) matched = matched.slice(0, limit);
        return [matched.map(row => columns.map(name => row[name])), columns.map(name => ({ name }))];
      }

      if (sql.startsWith("insert into `response_logic_entries`")) {
        const columns = parseColumns(sql, /insert into `response_logic_entries` \((.+?)\) values/);
        // drizzle emits `default` for columns with schema defaults; those
        // positions carry no parameter.
        const placeholders = /values \((.+)\)$/.exec(sql)![1].split(",").map(part => part.trim());
        const row: Record<string, unknown> = {
          skillName: "response-logic-builder",
          skillVersion: "1",
          skillContentHash: null,
        };
        let paramIndex = 0;
        columns.forEach((name, index) => {
          if (placeholders[index] === "default") return;
          row[name] = normalizeJson(name, params[paramIndex]);
          paramIndex += 1;
        });
        entries.push(row);
        return [{ insertId: 1, affectedRows: 1 }, []];
      }

      if (sql.startsWith("update `response_logic_entries`")) {
        const setClause = /^update `response_logic_entries` set (.+?) where /.exec(sql)![1];
        // Each set chunk is "`column` = ?"; take the column name only.
        const setColumns = setClause.split(",").map(chunk => /^`([^`]+)`/.exec(chunk.trim())![1]);
        const id = params[setColumns.length];
        const revision = params[setColumns.length + 1];
        const row = entries.find(item => item.id === id && item.revision === revision);
        if (!row) return [{ affectedRows: 0 }, []];
        setColumns.forEach((name, index) => { row[name] = normalizeJson(name, params[index]); });
        return [{ insertId: 0, affectedRows: 1 }, []];
      }

      // Materials ownership check on local_assets. Params: [...ids, scope?].
      if (sql.includes("from `local_assets`")) {
        const ids = params.filter(value => typeof value === "string") as string[];
        const matched = localAssets.filter(asset => ids.includes(asset.id) && asset.scope === "managed_user");
        const columns = ["id", "scope", "accountUserId", "enterpriseProjectId", "filename", "mimeType", "sizeBytes", "contentSha256", "createdAt", "contentExpiresAt", "contentDeletedAt"];
        return [
          matched.map(asset => columns.map(name => {
            if (name === "contentSha256") return asset.sha256;
            if (name === "createdAt") return new Date();
            if (name === "accountUserId") return String(asset.ownerUserId);
            if (name === "enterpriseProjectId" || name === "contentExpiresAt" || name === "contentDeletedAt") return null;
            return (asset as unknown as Record<string, unknown>)[name] ?? null;
          })),
          columns.map(name => ({ name })),
        ];
      }

      // Evaluation store persistence (response_logic_evaluations) and any
      // other insert: accept and record.
      if (sql.startsWith("insert into")) return [[{ insertId: 1, affectedRows: 1 }], []];
      return [[]];
    },
  };

  return { client, entries, sqlLog, ledgerRows: input.ledger };
}
