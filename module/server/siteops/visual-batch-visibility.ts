import type {BrandSchema} from '../../schema/index.js';
import type {MySql2Database} from 'drizzle-orm/mysql2';
import type {SQL} from 'drizzle-orm';
type Port=(...args:any[])=>any;
export interface VisualBatchVisibilityCore {
 tables:BrandSchema;
}
let websiteStyleSampleBatches:BrandSchema['websiteStyleSampleBatches'];
export function configureVisualBatchVisibilityCore(core:VisualBatchVisibilityCore){
 ({websiteStyleSampleBatches}=core.tables);
 ({}=core);
}
import { inArray } from "drizzle-orm";



/**
 * A visual board remains customer-visible after the customer locks it. Keep
 * every reader of customer-owned preview bytes on this single predicate so a
 * lifecycle transition cannot leave observation URLs pointing at 404s.
 */
export const CUSTOMER_VISIBLE_STYLE_BATCH_STATUSES = [
  "published",
  "selected",
] as const;

export function customerVisibleStyleBatchStatusCondition() {
  return inArray(
    websiteStyleSampleBatches.status,
    CUSTOMER_VISIBLE_STYLE_BATCH_STATUSES,
  );
}
