import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteRevisionFields } from "./WebsiteRevisionFields";

const NativeURL = URL;
let created: ReturnType<typeof vi.fn>;
let revoked: ReturnType<typeof vi.fn>;
beforeEach(() => {
  created = vi.fn((file: File) => `blob:${file.name}`);
  revoked = vi.fn();
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = created;
    static revokeObjectURL = revoked;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function image(name: string, size = 100, type = "image/png") {
  const file = new File(["test"], name, { type, lastModified: 1000 });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function Fields({ disabled = false }: { disabled?: boolean }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  return <WebsiteRevisionFields text={text} files={files} progress={[]} disabled={disabled} onChange={(nextText, nextFiles) => { setText(nextText); setFiles(nextFiles); }} />;
}

describe("website revision fields", () => {
  it("edits text and images through the design's controlled state without submitting", () => {
    const onChange = vi.fn();
    const file = image("参考.png");
    render(<WebsiteRevisionFields text="" files={[]} progress={[]} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "补充修改要求" }), { target: { value: "预约入口移到顶部" } });
    expect(onChange).toHaveBeenLastCalledWith("预约入口移到顶部", []);
    fireEvent.change(screen.getByLabelText("添加修改参考图片"), { target: { files: [file] } });
    expect(onChange).toHaveBeenLastCalledWith("", [file]);
    expect(screen.queryByRole("button", { name: /提交|生成/ })).toBeNull();
  });

  it("accepts paste and drop, deduplicates files and releases removed preview URLs", async () => {
    const first = image("first.png");
    const second = image("second.webp", 100, "image/webp");
    const view = render(<Fields />);
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [first] } });
    expect(screen.getByText("first.png")).toBeTruthy();
    fireEvent.drop(view.container.querySelector(".sfp-revision-drop")!, { dataTransfer: { files: [first, second] } });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "移除参考图片 first.png" }));
    expect(screen.queryByText("first.png")).toBeNull();
    await waitFor(() => expect(revoked).toHaveBeenCalledWith("blob:first.png"));
    view.unmount();
    expect(revoked).toHaveBeenCalledWith("blob:second.webp");
  });

  it("rejects unsupported, empty, oversized and excessive image batches without losing valid files", () => {
    render(<Fields />);
    const input = screen.getByLabelText("添加修改参考图片");
    fireEvent.change(input, { target: { files: [image("keep.png")] } });
    fireEvent.change(input, { target: { files: [image("unsafe.svg", 10, "image/svg+xml")] } });
    expect(screen.getByRole("alert").textContent).toContain("仅支持");
    fireEvent.change(input, { target: { files: [image("empty.png", 0)] } });
    expect(screen.getByRole("alert").textContent).toContain("大于 0");
    fireEvent.change(input, { target: { files: [image("large.png", 8 * 1024 * 1024 + 1)] } });
    expect(screen.getByRole("alert").textContent).toContain("不超过 8 MiB");
    fireEvent.change(input, { target: { files: Array.from({ length: 8 }, (_, index) => image(`extra${index}.png`)) } });
    expect(screen.getByRole("alert").textContent).toContain("最多添加 8");
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("keep.png")).toBeTruthy();
  });

  it("enforces the combined image limit and displays upload progress", () => {
    const onChange = vi.fn();
    const files = Array.from({ length: 4 }, (_, index) => image(`${index}.png`, 8 * 1024 * 1024));
    render(<WebsiteRevisionFields text="" files={files} progress={[42]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("添加修改参考图片"), { target: { files: [image("too-much.png", 1)] } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("32 MiB");
    expect((screen.getByRole("progressbar", { name: "0.png 上传进度" }) as HTMLProgressElement).value).toBe(42);
  });

  it("blocks edits, pasted files and dropped files while submission is pending", () => {
    const onChange = vi.fn();
    const view = render(<WebsiteRevisionFields text="" files={[]} progress={[]} disabled onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "待提交" } });
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [image("paste.png")] } });
    fireEvent.drop(view.container.querySelector(".sfp-revision-drop")!, { dataTransfer: { files: [image("drop.png")] } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
