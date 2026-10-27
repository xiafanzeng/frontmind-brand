import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeDocument} from '../workflows/report-harness/safe-files.mjs';
import {assembleStageOutput} from '../workflows/report-harness/output-files.mjs';
const stage={stageId:'S1',operationToken:'report:stage:1',inputHash:'frozen-input'};
const output=()=>({operationToken:stage.operationToken,inputHash:stage.inputHash,stage:{id:'S1',title:'企业事实',summary:'来源核查',sources:[{title:'来源',url:'https://example.org/'}]},products:[]});
test('file-based structured output retains full Markdown, quotes, tables and every character',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'report-output-'));
 try{
  const markdown='# 研究正文\n\n|事实|证据|\n|---|---|\n'+Array.from({length:160},(_,i)=>`|${i} 医学研究“原文”与"引号"|[公开来源](https://example.org/${i})|`).join('\n');
  await writeDocument(root,'work/S1-full.md',markdown);
  const value=await assembleStageOutput(root,stage,{output:output(),markdownPath:'work/S1-full.md'});
  assert.equal(value.stage.markdown,markdown);assert.equal(JSON.parse(JSON.stringify(value)).stage.markdown,markdown);
  await assert.rejects(assembleStageOutput(root,stage,{output:output(),markdownPath:'work/S2-full.md'}),/SCOPE_DENIED/);
  await assert.rejects(assembleStageOutput(root,stage,{output:{...output(),inputHash:'other'},markdownPath:'work/S1-full.md'}),/INPUT_MISMATCH/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('the observed missing root brace gets structural guidance, never content shortening',async()=>{
 const malformed='{"operationToken":"report:stage:1","inputHash":"frozen-input","stage":{"id":"S1","markdown":"完整正文","sources":[],"products":[]}';
 await assert.rejects(assembleStageOutput('/unused',stage,{json:malformed}),error=>/JSON_INVALID/.test(error.message)&&/不要|请勿缩短/.test(error.message)&&/并列字段/.test(error.message));
 const misplaced=output();misplaced.stage.products=[];delete misplaced.products;
 await assert.rejects(assembleStageOutput('/unused',stage,{output:misplaced}),/REPORT_STAGE_SHAPE/);
 await assert.rejects(assembleStageOutput('/unused',stage,{output:output(),json:'{}'}),/ARGUMENTS/);
});
test('legacy output remains compatible and briefing uses its own structured envelope',async()=>{
 const value=output();value.stage.markdown='完整正文';assert.deepEqual(await assembleStageOutput('/unused',stage,{json:JSON.stringify(value)}),value);
 const briefing={...stage,stageId:'briefing'},value2={operationToken:stage.operationToken,inputHash:stage.inputHash,slides:Array.from({length:13},(_,i)=>({title:String(i)}))};
 assert.deepEqual(await assembleStageOutput('/unused',briefing,{output:value2}),value2);
 await assert.rejects(assembleStageOutput('/unused',briefing,{output:value2,markdownPath:'work/S1-full.md'}),/BRIEFING_SHAPE/);
});
