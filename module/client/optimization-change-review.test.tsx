import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {OptimizationChangeReview} from "./response-logic/optimization-change-review";
import type {OptimizationOutput} from "../contracts/response-logic-optimization";
import {buildOptimizationReview} from "../contracts/response-logic-change-review";
import {configureIntentWorkspaceHost} from "./response-logic-runtime-host";
import {useOptimizationGeneration} from "./use-optimization-generation";
import {fingerprintLogic} from "../contracts/response-logic-evaluation";
import {ResponseLogicOptimizationWorkflow} from "./response-logic/optimization-workflow";

const logic={concern:"保留。原句。",conclusion:"结论。",facts:"来源。",boundaries:"边界。"};
const output:OptimizationOutput={kind:"judge-optimization",summary:"不展示的摘要",optimizedDraft:{...logic,concern:"保留。新句。"},changes:[{field:"concern",summary:"接口返回的原始理由",evidence:[{source:"draft",excerpt:"原句。",supports:"接口返回的修改依据"}]}]};
afterEach(cleanup);
describe("real data change review",()=>{
 it("includes punctuation, supports keyboard/tap, and keeps full explanations beneath the pair",()=>{
  render(<OptimizationChangeReview field="concern" logic={logic} result={output} candidate={output.optimizedDraft.concern}/>);
  const mark=screen.getByRole("button",{name:"调整表达：新句。，查看修改原因"});
  expect(mark.textContent).toBe("新句。");
  fireEvent.focus(mark);expect(within(screen.getByRole("tooltip")).getByText("接口返回的原始理由")).toBeTruthy();
  fireEvent.keyDown(mark,{key:"Escape"});expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.keyDown(mark,{key:"Enter"});expect(screen.getByText("关联草稿证据的修改意见")).toBeTruthy();
  expect(screen.getByText("接口返回的原始理由").closest(".rl-change-explanation")).toBeTruthy();
 });
 it("does not attach original model reasons to a manually edited candidate",()=>{
  render(<OptimizationChangeReview field="concern" logic={logic} result={output} candidate="人工改写。"/>);
  fireEvent.click(screen.getByRole("button",{name:"调整表达：人工改写。，查看修改原因"}));
  expect(screen.queryByText("接口返回的原始理由")).toBeNull();
  expect(screen.getByText("人工编辑后的差异")).toBeTruthy();
 });
 it("recovers through real HTTP client → lifecycle → workflow with server projection and no writes",async()=>{
  const calls:string[]=[];
  const fingerprint=fingerprintLogic(logic);
  const review=buildOptimizationReview(logic,output);
  configureIntentWorkspaceHost({captureRestOperation:(signal?:AbortSignal)=>({signal:signal??new AbortController().signal,assertActive(){},fetch:async(url:string,init?:RequestInit)=>{
   calls.push(`${init?.method??"GET"} ${url}`);
   const body=url.includes("/recovery?")?{status:"found",taskId:"candidate-http",attempt:0,recordRevision:5,sourceFingerprint:fingerprint}:{status:"completed",optimizerVersion:"1",recordRevision:5,sourceFingerprint:fingerprint,judgeTaskId:"judge-http",knowledgeFingerprint:"none",evaluatedAt:new Date().toISOString(),optimization:output,review};
   return new Response(JSON.stringify(body),{status:200});
  }})} as never);
  function Harness(){const optimization=useOptimizationGeneration({questionId:"q-http",recordRevision:5,sourceFingerprint:fingerprint,judgeTaskId:"judge-http"});return <ResponseLogicOptimizationWorkflow question="真实入口问题" intent="" logic={logic} judgeTaskId="judge-http" optimization={optimization} onAdopt={vi.fn()} onBack={vi.fn()}/>;}
  render(<Harness/>);
  fireEvent.click(await screen.findByRole("button",{name:"查看修改意见"}));
  fireEvent.click(screen.getByRole("button",{name:"调整表达：新句。，查看修改原因"}));
  expect(screen.getAllByText("接口返回的原始理由").length).toBeGreaterThan(0);
  expect(screen.getByText("接口返回的修改依据",{exact:false})).toBeTruthy();
  expect(calls.some(call=>call.includes("review=1"))).toBe(true);
  expect(calls.every(call=>call.startsWith("GET "))).toBe(true);
 });
});
