import type {BrandReportDocument, BrandReportStage} from './brand-report.js';

export const REPORT_STAGES = [
  ['S1','企业与品牌事实'], ['S2','市场与营销图谱'], ['S3','行业趋势'], ['S4','品牌定位'],
  ['S5','品牌诊断'], ['S5.5','语义资产评估'], ['S6','品牌表达'], ['S7','视觉与内容符号'],
  ['S8','问答与内容架构'], ['S9','业务推进方案'], ['S9.8','内容机会与标题'],
] as const;
export const REPORT_PLATFORMS = [{id:'doubao',label:'豆包'},{id:'yuanbao',label:'腾讯元宝'},{id:'qianwen',label:'千问'}] as const;
export type ReportPhase = 'researching'|'awaiting_confirmation'|'monitoring'|'analyzing'|'rendering'|'completed'|'failed';
export type ReportProduct = {id:string;label:string;question:string};
export type ReportRunView = {
  id:string;brandName:string;createdAt:string;updatedAt:string;revision:number;phase:ReportPhase;
  currentStage:string;stages:Array<Pick<BrandReportStage,'id'|'title'|'summary'>>;
  products:ReportProduct[];questions:string[];platforms:string[];sampleCount:number;expectedSamples:number;
  error:{code:string;message:string}|null;canRetry:boolean;
  artifacts:Array<{id:string;label:string;mimeType:string;sizeBytes:number}>;
};
export type ReportWorkspace = {
  company:{name:string;summary:string;ready:boolean};
  knowledge:{available:boolean;documentCount:number};
  runs:ReportRunView[];
};
export type ReportArtifactId = 'panorama.html'|'panorama.pdf'|'briefing.html'|'briefing.pptx'|'reports.zip';
export type ReportDocument = BrandReportDocument;
