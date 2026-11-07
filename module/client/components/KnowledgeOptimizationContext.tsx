import {createContext} from "react";
import type {IntentReceipt} from "../../contracts/intent-workbench";
/** The latest execution is scoped by ModuleWorkspace; the node reader stays authoritative. */
export const KnowledgeOptimizationContext=createContext<IntentReceipt|undefined>(undefined);
