// @vitest-environment node
import {describe,expect,it} from 'vitest';
import Ajv from 'ajv';
import JSZip from 'jszip';
import {BRAND_REPORT_STAGES} from '../contracts/brand-report.js';
import {reportModelArchive,reportModelWireSchema,validateReportModelOutput,type ReportModelInput} from '../server/report-model.js';

const input:ReportModelInput={operationToken:'brand-report:test:S1:1',inputHash:'a'.repeat(64),stageId:'S1',brandName:'测试企业',context:{profile:{}},previousStages:[],monitoring:null};
function output(url='https://example.org/source'){
 return {operationToken:input.operationToken,inputHash:input.inputHash,stage:{id:'S1',title:'品牌事实',summary:'经过核对的品牌事实与企业资料构成本轮研究的真实依据。',markdown:'经过核对的完整研究事实与来源。'.repeat(50),sources:[{title:'公开来源',url}]},products:[]};
}

describe('brand report model transport contract',()=>{
 it('compiles every stage using the actual strict AJV configuration without format plugins',()=>{
  for(const stage of [...BRAND_REPORT_STAGES.map(item=>item.id),'briefing']){
   const schema=reportModelWireSchema(stage);
   expect(()=>new Ajv({strict:true,allErrors:false}).compile(schema)).not.toThrow();
   expect(JSON.stringify(schema)).not.toContain('"format":"uri"');
  }
  expect(new Ajv({strict:true}).compile(reportModelWireSchema('S1'))(output())).toBe(true);
 });
 it('retains safe public URL and full local validation after transport adaptation',()=>{
  const validate=new Ajv({strict:true}).compile(reportModelWireSchema('S1'));
  for(const url of ['javascript:alert(1)','file:///etc/passwd','https://user:password@example.org/']){
   expect(validate(output(url))).toBe(false);expect(()=>validateReportModelOutput(output(url),input)).toThrow();
  }
  expect(validate(output('https://example.org/a b'))).toBe(false);
  // The transport pattern is deliberately simple. URL parsing remains the
  // authority for edge cases such as malformed ports and hosts.
  expect(()=>validateReportModelOutput(output('https://example.org:invalid/'),input)).toThrow();
  expect(validateReportModelOutput(output(),input)).toEqual(output());
 });
 it('ships the same compatible schema with the original operation and input identity',async()=>{
  const archive=await JSZip.loadAsync(await reportModelArchive(input));
  expect(JSON.parse(await archive.file('OUTPUT_SCHEMA.json')!.async('string'))).toEqual(reportModelWireSchema('S1'));
  expect(JSON.parse(await archive.file('input.json')!.async('string'))).toEqual(input);
 });
});
