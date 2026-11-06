import { useEffect, useRef } from "react";
import { RotateCw, X } from "lucide-react";
import type { ResponseLogicStructuredDraft } from "../../contracts/response-logic.js";
import "./regeneration-review.css";

export function RegenerateButton({onClick, disabled}: {onClick: () => void; disabled?: boolean}) {
  return <button type="button" className="rl-regenerate-button" onClick={onClick} disabled={disabled}>
    <RotateCw size={16} aria-hidden="true" />重新生成应答逻辑
  </button>;
}
export function RegenerationConfirm({onCancel, onConfirm}: {onCancel: () => void; onConfirm: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => {element.close(); previous?.focus();};
  }, []);
  return <dialog ref={dialog} className="rl-regenerate-dialog" aria-labelledby="rl-regenerate-title" aria-describedby="rl-regenerate-description" onCancel={event => {event.preventDefault(); onCancel();}}>
    <header><span className="rl-regenerate-icon"><RotateCw size={20} /></span><button type="button" aria-label="关闭" onClick={onCancel}><X size={18}/></button></header>
    <h3 id="rl-regenerate-title">重新生成应答逻辑？</h3>
    <p id="rl-regenerate-description">基于当前问题、最新企业知识库和已绑定的参考材料，重新生成四段应答逻辑。</p>
    <div className="rl-regenerate-notice"><strong>当前草稿会保留</strong><p>生成后先对照审阅，确认“采用新稿到草稿”后才会替换。放弃新稿不影响当前内容。</p></div>
    <p>采用新稿后需重新评估；正式版本仍以“更新应答逻辑”为准。</p>
    <p className="rl-regenerate-cost">将发起一次新的模型任务，产生相应费用。</p>
    <footer><button ref={cancel} type="button" className="rl-regenerate-button" onClick={onCancel}>取消</button><button type="button" className="rl-primary-button" onClick={onConfirm}>开始重新生成</button></footer>
  </dialog>;
}
const fields = [
  ["concern", "用户真实关心"], ["conclusion", "核心结论与执行口径"],
  ["facts", "企业材料/官方依据"], ["boundaries", "回答边界/禁止表达"],
] as const;
export function RegenerationReview({current, candidate, adopting, error, onAdopt, onKeep}: {
  current: ResponseLogicStructuredDraft; candidate: ResponseLogicStructuredDraft; adopting: boolean;
  error?: string; onAdopt: () => void; onKeep: () => void;
}) {
  return <section className="rl-regeneration-review" aria-label="重新生成的新稿对照">
    <header><div><span className="rl-regenerate-tag">待审阅 · 尚未采用</span><h3>审阅重新生成的应答逻辑</h3><p>当前草稿保持不变。请核对四段内容，再决定是否采用新稿。</p></div></header>
    <div className="rl-regenerate-fields">{fields.map(([key, label], index) => <section key={key} className="rl-regenerate-field">
      <h4><span>{String(index + 1).padStart(2, "0")}</span>{label}</h4>
      <div className="rl-regenerate-compare"><div><h5>当前草稿</h5><p>{current[key] || "尚未填写"}</p></div><div className="rl-regenerate-new"><h5>重新生成的新稿</h5><p>{candidate[key]}</p></div></div>
    </section>)}</div>
    {error && <p role="alert" className="rl-regenerate-error">{error}</p>}
    <footer><p>仅替换四段文字，保留参考材料。采用后需重新评估，正式版本不会自动更新。</p><div><button type="button" className="rl-regenerate-button" disabled={adopting} onClick={onKeep}>保留当前稿</button><button type="button" className="rl-primary-button" disabled={adopting} onClick={onAdopt}>{adopting ? "正在采用…" : "采用新稿到草稿"}</button></div></footer>
  </section>;
}
