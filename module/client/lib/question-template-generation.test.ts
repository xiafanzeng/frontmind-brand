import {afterEach,expect,it,vi} from "vitest";
const scope=vi.hoisted(()=>({fetch:vi.fn(),assertActive:vi.fn(),headers:(value?:unknown)=>value}));
vi.mock("./workspace-rest-scope",()=>({captureWorkspaceRestOperation:()=>scope}));
import {generateQuestionTemplate} from "./question-template-generation";
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});

it("POST响应Load failed后按同一标识读取，读取断线自动恢复，不重复生成",async()=>{
 vi.useFakeTimers();
 scope.fetch.mockRejectedValueOnce(new TypeError("Load failed"))
  .mockResolvedValueOnce(response({generation:{status:"running"}},202))
  .mockRejectedValueOnce(new TypeError("Load failed"))
  .mockResolvedValueOnce(response({data:[{question:"医院如何选择？"}]}));
 const pending=generateQuestionTemplate("recommend-questions",{brand:"台心医院",coreWords:["台资综合医院"]});
 await vi.advanceTimersByTimeAsync(4500);
 expect(await pending).toEqual({data:[{question:"医院如何选择？"}]});
 const [postUrl,post]=scope.fetch.mock.calls[0];
 expect(postUrl).toContain("recommend-questions");
 expect(post.headers.Prefer).toBe("respond-async");
 const requestId=post.headers["X-FrontMind-Request-Id"];
 for(const [url,init] of scope.fetch.mock.calls.slice(1)){
  expect(url).toContain(`/generations/${requestId}`);expect(init.method).toBe("GET");
 }
 expect(scope.fetch.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
});

it("明确的业务错误不自动重试，任务失效不重复POST",async()=>{
 scope.fetch.mockResolvedValueOnce(response({error:{message:"没有生成权限"}},403));
 await expect(generateQuestionTemplate("recommend-questions",{})).rejects.toThrow("没有生成权限");
 expect(scope.fetch).toHaveBeenCalledTimes(1);
 scope.fetch.mockReset();vi.useFakeTimers();
 scope.fetch.mockRejectedValueOnce(new TypeError("Load failed"))
  .mockResolvedValueOnce(response({error:{message:"生成任务已失效"}},404));
 const pending=generateQuestionTemplate("recommend-questions",{});
 const failed=expect(pending).rejects.toThrow("生成任务已失效");
 await vi.advanceTimersByTimeAsync(1500);await failed;
 expect(scope.fetch).toHaveBeenCalledTimes(2);
});

it("切换工作区后停止读取，不在新工作区提交旧公司的内容",async()=>{
 scope.fetch.mockRejectedValueOnce(new TypeError("Load failed"));
 scope.assertActive.mockImplementationOnce(()=>{}).mockImplementation(()=>{throw new Error("workspace changed");});
 await expect(generateQuestionTemplate("recommend-questions",{})).rejects.toThrow("workspace changed");
 expect(scope.fetch).toHaveBeenCalledTimes(1);
 scope.assertActive.mockReset();
});
