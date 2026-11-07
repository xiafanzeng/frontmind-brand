import { describe, expect, it } from "vitest";
import { getTableConfig, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { createBrandSchema } from "../schema/index.js";

const integerTable = (name: string) => mysqlTable(name, { id: int("id").primaryKey() });
const stringTable = (name: string) => mysqlTable(name, { id: varchar("id", { length: 36 }).primaryKey() });

function schema() {
  return createBrandSchema({
    users: integerTable("schema_test_users"),
    apiCredentials: integerTable("schema_test_api_credentials"),
    presalesApiCredentials: integerTable("schema_test_presales_credentials"),
    localAssets: stringTable("schema_test_local_assets"),
    serviceQuotaPeriods: stringTable("schema_test_quota_periods"),
    deliveryTickets: stringTable("schema_test_delivery_tickets"),
    deliveryTicketAttachments: stringTable("schema_test_ticket_attachments"),
    deliveryProjectAssignments: stringTable("schema_test_project_assignments"),
    conversations: stringTable("schema_test_conversations"),
    conversationTurns: stringTable("schema_test_conversation_turns"),
    currentEnterpriseProjectId: () => null,
  });
}

describe("RAG starter-question schema", () => {
  it("uses MySQL-safe explicit identifiers and keeps snapshot deletion cascading", () => {
    const config = getTableConfig(schema().ragStarterQuestionSets);
    const snapshotForeignKey = config.foreignKeys.find(
      (foreignKey) => foreignKey.getName() === "rag_starter_question_sets_snapshot_fk",
    );

    expect(snapshotForeignKey).toBeTruthy();
    expect(snapshotForeignKey!.onDelete).toBe("cascade");
    expect([
      ...config.foreignKeys.map((foreignKey) => foreignKey.getName()),
      ...config.indexes.map((index) => index.config.name),
      ...config.uniqueConstraints.map((constraint) => constraint.name),
    ].every((name) => name.length <= 64)).toBe(true);
  });
});
