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
const s2Input={...input,stageId:'S2',operationToken:'brand-report:test:S2:1'};
const repeatedReason='真实资质、适配场景、流程与支付边界';
const specificReasons=[
 '团检组织者需核对员工人数与分批预约容量',
 '康复患者需核对疾病阶段与治疗团队适配情况',
 '跨区域患者需核对远程会诊材料与支付流程',
 '慢病患者需核对复诊排班与处方续配条件',
 '患者家属需核对急症分流与就诊科室路径',
 '企业采购者需核对报告交付时效与隐私授权',
 '转诊医生需核对接诊边界与检查资料交接',
 '晚间就诊者需核对门诊时段与预约截止时间',
 ];
function table(heading:string,values:string[]){return `|编号|意图类别|用户角色|${heading}|\n|---|---|---|---|\n${values.map((value,index)=>`|T${index+1}|信息搜索|患者或共同决策者|${value}|`).join('\n')}`;}
function s2Output(markdown:string){const result=output();return {...result,operationToken:s2Input.operationToken,stage:{...result.stage,id:'S2',markdown:result.stage.markdown+'\n\n'+markdown}};}

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

describe('S2 table reasoning quality',()=>{
 it('rejects the observed mechanical triplet pattern with an actionable same-session repair reason',()=>{
  const observed=`|编号|用户角色|场景|意图|心智阶段|查询模式|决策因素|
|---|---|---|---|---|---|---|
|T003|患者或共同决策者|企业年度健康管理|informational|品类拦截|胸痛或心衰患者在东莞应该如何就医|真实资质、适配场景、流程与支付边界|
|T011|发起者、评估者、付款者|晚间康复与工作冲突|comparative|品类拦截|东莞胸痛中心/心衰中心如何核验|真实资质、适配场景、流程与支付边界|
|T019|患者本人或家属|企业年度健康管理|transactional|品类拦截|慢病患者如何安排复诊、检查和线上服务|真实资质、适配场景、流程与支付边界|
|T023|发起者、评估者、付款者|体检/团检方案评估|transactional|品类拦截|台湾患者到东莞就医的流程和材料|真实资质、适配场景、流程与支付边界|
|T029|发起者、评估者、付款者|医保/商保/健保核验|navigational|品牌验证|台心医院康复医学中心、转诊和复诊入口|真实资质、适配场景、流程与支付边界|
|T030|评估者、转诊发起者|远程会诊与第二意见|navigational|品牌验证|台心医院科室导航、医生和医技预约入口|真实资质、适配场景、流程与支付边界|`;
  expect(()=>validateReportModelOutput(s2Output(observed),s2Input)).toThrow(/决策因素.*6\/6.*逐行核对用户角色.*保留已核查事实、来源/);
 });
 it.each(['决策因素','主要任务重叠','判断','内容触点'])('checks repeated substantive descriptions in %s',heading=>{
  const payload=s2Output(table(heading,[...Array(5).fill(repeatedReason),specificReasons[0]!]));
  expect(()=>validateReportModelOutput(payload,s2Input)).toThrow(`“${heading}”列有5/6行`);
 });
 it('recognizes the same rationale despite Markdown and whitespace presentation changes',()=>{
  const values=[repeatedReason,`**${repeatedReason}**`,`\`${repeatedReason}\``,`[${repeatedReason}](https://example.org/evidence)`, '真实资质，适配场景，流程与支付边界','真实资质、 适配场景、流程与支付边界'];
  expect(()=>validateReportModelOutput(s2Output(table('**决策因素**',values)),s2Input)).toThrow('6/6');
 });
 it('accepts repeated categories and roles when each substantive rationale is specific',()=>{
  const good=s2Output(table('决策因素',specificReasons));
  expect(validateReportModelOutput(good,s2Input)).toEqual(good);
  const classifications=s2Output(table('意图分类',Array(8).fill('信息搜索与比较评估的分类标签')));
  expect(validateReportModelOutput(classifications,s2Input)).toEqual(classifications);
 });
 it('requires six rows and strictly more than 75 percent, ignoring short labels and fenced examples',()=>{
  for(const markdown of [table('判断',Array(5).fill(repeatedReason)),table('判断',[...Array(6).fill(repeatedReason),...specificReasons.slice(0,2)]),table('判断',Array(8).fill('待核实')),`\`\`\`markdown\n${table('判断',Array(8).fill(repeatedReason))}\n\`\`\``]){
   expect(()=>validateReportModelOutput(s2Output(markdown),s2Input)).not.toThrow();
  }
  const otherStage=output();otherStage.stage.markdown+='\n\n'+table('判断',Array(8).fill(repeatedReason));
  expect(()=>validateReportModelOutput(otherStage,input)).not.toThrow();
 });
 it('includes explicit semantic pairing and evidence-preservation instructions in the S2 archive',async()=>{
  const archive=await JSZip.loadAsync(await reportModelArchive(s2Input));
  const instructions=await archive.file('SKILL.md')!.async('string');
  expect(instructions).toContain('禁止将画像、场景、触发条件、问题按数组索引轮转');
  expect(instructions).toContain('保留已核查事实与来源');
  expect(instructions).toContain('分类名称、意图类别可以合理重复');
 });
});
