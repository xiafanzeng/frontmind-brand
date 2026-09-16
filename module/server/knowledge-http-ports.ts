import type {Request} from "express";
import type {DashboardAgentClient} from "./siteops/provider-ports.js";
export type KnowledgeCredential = Readonly<{id:string;userId:number;version:number;credentialRef:string;fingerprint:string;status:"active"|"retired";verifiedAt:Date|null;agentProfile:"frontmind-base"|"frontmind-pro";provider:"manus"|"zhipu"|"xty_codex";upstreamModel:string;upstreamEffort:string|null}>;
export type KnowledgeAgentClient = DashboardAgentClient;
export type KnowledgeRequest = Request & {frontmindUser?:{id:number};frontmindDeliveryProjectContext?:{projectAssignmentId:string}};
