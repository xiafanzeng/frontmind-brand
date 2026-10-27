import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
const scope = vi.hoisted(() => ({fetch: vi.fn(), assertActive: vi.fn(), headers: (value: unknown) => value}));
vi.mock("../lib/workspace-rest-scope", () => ({captureWorkspaceRestOperation: () => scope}));
import QuestionTemplateApiFlow from "./QuestionTemplateApiFlow";

afterEach(() => {cleanup(); vi.useRealTimers(); vi.clearAllMocks();});

it("超过30秒仍显示等待时间并禁止重复提交，成功后显示真实核心词", async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  scope.fetch.mockImplementation(() => new Promise<Response>(done => {resolve = done;}));
  render(<QuestionTemplateApiFlow/>);
  const input = screen.getByLabelText("企业名称") as HTMLInputElement;
  const submit = screen.getByRole("button", {name: "推荐核心词"}) as HTMLButtonElement;
  fireEvent.change(input, {target: {value: "东莞台心医院"}});
  fireEvent.click(submit);
  await act(async () => {await vi.advanceTimersByTimeAsync(31_000);});
  expect(screen.getByRole("status").textContent).toContain("已等待 31 秒");
  expect(input.disabled).toBe(true);
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(scope.fetch).toHaveBeenCalledTimes(1);
  await act(async () => {resolve(new Response(JSON.stringify({success: true, data: [{word: "综合医院", category: "category"}]})));});
  expect(screen.getByText("综合医院")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(input.disabled).toBe(false);
});

it("推荐问题请求仍在核心词页时显示正确的等待阶段", async () => {
  scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify({success: true, data: [{word: "综合医院", category: "category"}]})))
    .mockReturnValueOnce(new Promise(() => {}));
  render(<QuestionTemplateApiFlow/>);
  fireEvent.change(screen.getByLabelText("企业名称"), {target: {value: "东莞台心医院"}});
  await act(async () => {fireEvent.click(screen.getByRole("button", {name: "推荐核心词"}));});
  fireEvent.click(screen.getByRole("button", {name: "选择词条"}));
  fireEvent.click(screen.getByRole("button", {name: /生成推荐问题/}));
  expect(screen.getByRole("status").textContent).toContain("正在生成推荐问题");
  expect(scope.fetch).toHaveBeenCalledTimes(2);
});

it("只保存所选问题，保留分类，失败可重试并刷新正式词库",async()=>{
 const onSaved=vi.fn().mockResolvedValue(undefined);
 scope.fetch.mockResolvedValueOnce(new Response(JSON.stringify({data:[{word:"综合医院",category:"category"}]})))
  .mockResolvedValueOnce(new Response(JSON.stringify({data:[{question:"如何选择综合医院？"},{question:"医院有急诊吗？"}]})))
  .mockResolvedValueOnce(new Response(JSON.stringify({error:{message:"保存失败"}}),{status:503}))
  .mockResolvedValueOnce(new Response(JSON.stringify({success:true,added:1,duplicates:0})));
 render(<QuestionTemplateApiFlow onSaved={onSaved}/>);
 fireEvent.change(screen.getByLabelText("企业名称"),{target:{value:"东莞台心医院"}});
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"推荐核心词"}));});
 fireEvent.click(screen.getByRole("button",{name:"选择词条"}));
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:/生成推荐问题/}));});
 fireEvent.click(screen.getAllByRole("button",{name:"选择词条"})[0]);
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:/保存到全域词库/}));});
 expect(screen.getByRole("alert").textContent).toBe("保存失败");
 expect(screen.getByRole("button",{name:"已选择 ✓"})).toBeTruthy();
 expect(onSaved).not.toHaveBeenCalled();
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:/保存到全域词库/}));});
 expect(onSaved).toHaveBeenCalledTimes(1);
 expect(screen.getByRole("status").textContent).toContain("新增 1 条");
 expect(JSON.parse(scope.fetch.mock.calls[3][1].body)).toEqual({brand:"东莞台心医院",questions:[{question:"如何选择综合医院？",coreWord:"综合医院",category:"category",mainCategory:"industry",heat:null}]});
 fireEvent.change(screen.getByLabelText("企业名称"),{target:{value:"其他医院"}});
 expect(screen.queryByRole("button",{name:/保存到全域词库/})).toBeNull();
});
