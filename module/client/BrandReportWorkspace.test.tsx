import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import BrandReportWorkspace from './BrandReportWorkspace';
const mock=vi.hoisted(()=>({fetch:vi.fn(),workspace:null as any,process:null as any}));
vi.mock('./host',()=>({captureWorkspaceRestOperation:()=>({assertActive:()=>{},fetch:mock.fetch,headers:(value:unknown)=>value??{}}),projectResourceUrl:(url:string)=>url}));
const run={id:'run-1',brandName:'测试企业',createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',revision:5,phase:'awaiting_confirmation',currentStage:'S4',stages:[],products:[{id:'service',label:'核心服务',question:'核心服务有哪些推荐品牌？'}],questions:[],platforms:[],sampleCount:0,expectedSamples:0,error:null,canRetry:false,canStop:true,engine:'deepseek-harness-v1',model:'deepseek-flash',artifacts:[]};
beforeEach(()=>{mock.workspace={company:{name:'测试企业',summary:'真实企业资料',ready:true},knowledge:{available:true,documentCount:8},profileHash:'f'.repeat(64),runs:[]};mock.process={events:[],nextCursor:0,hasMore:false,documents:[],intermediate:[]};mock.fetch.mockReset();mock.fetch.mockImplementation(async(url,options)=>({ok:true,json:async()=>options?.method==='POST'?run:String(url).includes('/process?')?mock.process:mock.workspace}));});
afterEach(cleanup);
describe('brand report visible workflow',()=>{
 it('selects materials without a free text composer and starts a frozen input',async()=>{
  render(<BrandReportWorkspace projectId="project-a"/>);
  await screen.findByRole('button',{name:/测试企业/});expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:/已有品牌知识库/}));
  fireEvent.click(screen.getByRole('button',{name:'开始品牌研究'}));
  await waitFor(()=>expect(mock.fetch).toHaveBeenCalledWith('/api/modules/brand/reports',expect.objectContaining({method:'POST',body:expect.stringContaining('"includeKnowledge":true')})));
 });
 it('puts both questions and platform cards into one confirmation',async()=>{
  mock.workspace.runs=[run];render(<BrandReportWorkspace projectId="project-a"/>);
  const confirmation=await screen.findByRole('region',{name:'确认诊断范围'});
  expect(within(confirmation).getByText('测试企业有什么缺点和问题？')).toBeTruthy();
  expect(within(confirmation).getAllByRole('button',{name:'确认并继续'})).toHaveLength(1);
  await waitFor(()=>expect((within(confirmation).getByRole('button',{name:'确认并继续'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(confirmation).getByRole('button',{name:'确认并继续'}));
  await waitFor(()=>expect(mock.fetch).toHaveBeenCalledWith('/api/modules/brand/reports/run-1/confirm',expect.objectContaining({body:JSON.stringify({expectedRevision:5,productId:'service',platforms:['doubao','yuanbao','qianwen']})})));
 });
 it('delivers exactly two report cards with the paired HTML and file formats',async()=>{
  mock.workspace.runs=[{...run,phase:'completed',canStop:false}];render(<BrandReportWorkspace projectId="project-a"/>);
  const results=await screen.findByRole('region',{name:'报告成果'});
  expect(within(results).getByRole('link',{name:/打开全景报告/}).getAttribute('href')).toContain('/panorama.html');
  expect(within(results).getByRole('link',{name:/下载 PDF/}).getAttribute('href')).toContain('/panorama.pdf');
  expect(within(results).getByRole('link',{name:/打开汇报报告/}).getAttribute('href')).toContain('/briefing.html');
  expect(within(results).getByRole('link',{name:/下载 PPTX/}).getAttribute('href')).toContain('/briefing.pptx');
 });
 it('renders live public output, tool receipts and intermediate documents, and can stop while running',async()=>{
  mock.workspace.runs=[{...run,phase:'researching',currentStage:'S1'}];
  mock.process={events:[{seq:1,at:run.createdAt,stageId:'S1',kind:'text',message:'正在核实公开企业资料。'},{seq:2,at:run.createdAt,stageId:'S1',kind:'tool_end',message:'来源页面读取完成',detail:'返回公开资料正文'}],nextCursor:2,hasMore:false,documents:[{id:'S1',title:'企业事实',summary:'已核实',markdown:'完整企业研究正文',sources:[]}],intermediate:[{id:'work/notes.md',title:'研究笔记',text:'已保存的初步证据',updatedAt:run.createdAt}]};
  render(<BrandReportWorkspace projectId="project-a"/>);
  await screen.findByText('正在核实公开企业资料。');expect(screen.getByText('来源页面读取完成')).toBeTruthy();expect(screen.getByText('研究笔记')).toBeTruthy();expect(screen.getByText('完整企业研究正文')).toBeTruthy();
  const stop=screen.getByRole('button',{name:'停止本轮'}) as HTMLButtonElement;expect(stop.disabled).toBe(false);fireEvent.click(stop);
  await waitFor(()=>expect(mock.fetch).toHaveBeenCalledWith('/api/modules/brand/reports/run-1/stop',expect.objectContaining({method:'POST'})));
 });
 it('keeps stopped legacy history readable without a resume button',async()=>{
  mock.workspace.runs=[{...run,phase:'cancelled',engine:'legacy',canStop:false,error:{code:'REPORT_STOPPED_BY_USER',message:'已按要求停止'}}];render(<BrandReportWorkspace projectId="project-a"/>);
  await screen.findByText('本轮已停止');expect(screen.queryByRole('button',{name:'恢复本轮任务'})).toBeNull();expect(screen.queryByRole('button',{name:'停止本轮'})).toBeNull();
 });

});
