import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client';
import {publicEvents} from './events.mjs';
import {reportRuntimePatch} from './runtime-config.mjs';

const root=path.resolve(process.argv[2]),sessionId=process.argv[3];
if(Number(process.versions.node.split('.')[0])<24)throw new Error('REPORT_HARNESS_NODE24_REQUIRED');
if(!process.env.REPORT_DEEPSEEK_API_KEY)throw new Error('REPORT_DEEPSEEK_API_KEY_MISSING');
const emit=value=>process.stdout.write(`${JSON.stringify(value)}\n`);
const stageConfig=path.join(root,'current-stage.json'),patchPath=path.join(root,'runtime.patch.json');
const patch=reportRuntimePatch({root,stageConfig});
await mkdir(root,{recursive:true,mode:0o700});await writeFile(patchPath,JSON.stringify(patch),{mode:0o600});
const environment={};
for(const name of ['PATH','LANG','TMPDIR','TEMP','TMP','SYSTEMROOT','WINDIR'])if(process.env[name])environment[name]=process.env[name];
Object.assign(environment,{HOME:path.join(root,'home'),TMPDIR:path.join(root,'tmp'),TMP:path.join(root,'tmp'),TEMP:path.join(root,'tmp'),REPORT_DEEPSEEK_API_KEY:process.env.REPORT_DEEPSEEK_API_KEY,DSH_TELEMETRY_MODE:'DISABLED',DSH_TELEMETRY_DISABLED:'1'});
await mkdir(environment.HOME,{recursive:true,mode:0o700});
await mkdir(environment.TMPDIR,{recursive:true,mode:0o700});
const harness=new DeepSeekHarness({profile:'sdk-minimal',patches:[patchPath],dshHome:path.join(root,'dsh-home',sessionId),processCwd:root,cwd:root,provider:'frontmind-deepseek',model:'deepseek-flash',maxTokens:16384,env:environment,initializeTimeoutMs:60000,shutdownTimeoutMs:2000,disposeEofGraceMs:6000,disposeGraceMs:3000});
let closing=false,busy=false;
const stop=async()=>{if(closing)return;closing=true;try{await harness.close();}finally{process.exit(0);}};
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
const input=createInterface({input:process.stdin,crlfDelay:Infinity});input.on('close',()=>void stop());
input.on('line',line=>{void (async()=>{
 const command=JSON.parse(line);if(command.type==='close'){await stop();return;}
 if(command.type==='check'){await harness.start();emit({type:'checked',model:'deepseek-flash',sessionId});return;}
 if(command.type!=='run'||busy||closing)throw new Error('REPORT_HARNESS_COMMAND_INVALID');busy=true;
 try{
  await writeFile(stageConfig,JSON.stringify(command.stage),{mode:0o600});
  const result=await harness.run(command.prompt,{sessionId,onNotification:notification=>{for(const event of publicEvents(notification))emit({type:'event',requestId:command.requestId,event});}});
  const ending=result.events.filter(event=>event.type==='turn/end').at(-1);
  if(ending?.data?.reason?.kind!=='completed')throw new Error(`REPORT_HARNESS_TURN_${String(ending?.data?.reason?.kind??'MISSING_END').toUpperCase()}: ${ending?.data?.reason?.error?.message??'阶段未正常完成，保留研究文件供恢复。'}`);
  emit({type:'result',requestId:command.requestId,text:result.finalResponse});
 }catch(error){emit({type:'error',requestId:command.requestId,message:String(error?.message??error).replaceAll(process.env.REPORT_DEEPSEEK_API_KEY,'[REDACTED]').slice(0,5000)});}
 finally{busy=false;}
})().catch(error=>emit({type:'fatal',message:String(error?.message??error).slice(0,3000)}));});
emit({type:'ready',sessionId});
