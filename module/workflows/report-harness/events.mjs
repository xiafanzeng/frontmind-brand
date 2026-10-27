const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const visibleText=content=>Array.isArray(content)?content.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join(''):'';
const labels={list_report_files:'查看本阶段资料',read_report_file:'阅读工作流与研究资料',search_public_web:'检索公开资料',fetch_public_page:'核查公开网页',write_research_note:'保存中间分析',save_stage_output:'保存阶段产物'};
/** Only body text and observed action receipts cross the web boundary. Never
 * forward whole SDK notifications, streams, provider metadata or reasoning. */
export function publicEvents(notification){
 const params=object(notification.params);
 if(notification.method==='session.status')return [{kind:'status',message:params.status==='running'?'正在研究与制作':'本阶段执行结束'}];
 if(notification.method!=='session.event')return [];
 const event=object(params.event),data=object(event.data);
 if(event.type==='tool/call')return [{kind:'tool_start',message:labels[data.name]??`调用 ${String(data.name)}`,toolCallId:String(data.callId),detail:typeof data.arguments==='string'?data.arguments.slice(0,16000):JSON.stringify(data.arguments)}];
 if(event.type==='tool/result'){
  const message=object(data.message),text=visibleText(message.content);
  const events=[{kind:'tool_end',message:message.isError?'工具执行失败':'工具执行完成',toolCallId:String(message.toolCallId),detail:text.slice(0,30000)}];
  if(!message.isError){try{const value=JSON.parse(text);if(typeof value.artifact==='string'&&/^work\/[^/]+\.(md|json)$/.test(value.artifact))events.push({kind:'artifact',message:value.revision?'已保存修订，上一版本可在中间文件中查阅':'已保存研究文档',detail:value.revision?JSON.stringify({artifact:value.artifact,revision:value.revision}):value.artifact,toolCallId:String(message.toolCallId)});}catch{}}
  return events;
 }
 if(event.type==='assistant/message'){
  const events=[],text=visibleText(object(data.message).content);if(text)events.push({kind:'text',message:text.slice(0,16000)});
  const usage=object(data.usage);const counts={};for(const key of ['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens'])if(Number.isFinite(usage[key]))counts[key]=usage[key];
  if(Object.keys(counts).length)events.push({kind:'usage',message:'本次模型调用用量',detail:JSON.stringify(counts)});return events;
 }
 return [];
}
