import type { AnyMySqlColumn, AnyMySqlTable } from "drizzle-orm/mysql-core";
/** A Core-owned table projection used inside the same MySQL transaction.
 * The private host supplies its canonical table objects; modules never create
 * a second account/execution schema or open another database connection.
 */
type CoreSqlColumns<Row extends object> = {
  [Key in keyof Row]-?: AnyMySqlColumn<{
    data: Exclude<Row[Key], null>;
    notNull: null extends Row[Key] ? false : true;
  }>;
};
export type CoreSqlTable<Row extends object> = AnyMySqlTable<{
  columns: CoreSqlColumns<Row>;
}> & CoreSqlColumns<Row> & { $inferSelect: Row };
