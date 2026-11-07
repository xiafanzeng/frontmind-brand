import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import {
  loadRagPreviewFixtures,
  peekRagPreviewFixtures,
} from "./rag-preview-fixture-loader";

export type WidgetMessage = {
  id: number;
  from: "visitor" | "assistant";
  text: string;
  sources: string[];
};

export type AssistantExchangeBinding = {
  designEditSequence: number;
  assistantName: string;
  welcome: string;
};

async function resolveAssistantReply(question: string): Promise<{ text: string; sources: string[] }> {
  const fixtures = await loadRagPreviewFixtures();
  const match = fixtures.findSample(question);
  if (match) {
    return {
      text: match.answer,
      sources: match.sources.slice(0, 2).map((source) => source.title),
    };
  }
  return { text: "抱歉，当前本地预览资料中没有支持这个问题的内容。", sources: [] };
}

const unavailableReply = {
  text: "抱歉，本地预览资料暂时无法读取。",
  sources: [] as string[],
};

/**
 * Transitional preview assistant panel. Until the real trial bridge lands, the
 * design-step trial gate still completes through this local illustrative
 * exchange; the real production widget answers only inside a real build.
 */
export function PreviewAssistantWidget({
  assistantName,
  exchangeBinding,
  initiallyOpen,
  interactive = true,
  onExchange,
  showSources,
  trialNote,
  welcome,
}: {
  assistantName: string;
  exchangeBinding?: AssistantExchangeBinding;
  initiallyOpen: boolean;
  /** False in the live real-data draft: local synthetic answers never count
   * as a trial, so the panel only presents the assistant identity there. */
  interactive?: boolean;
  onExchange?: (
    question: string,
    answered: boolean,
    binding: AssistantExchangeBinding,
  ) => void;
  showSources: boolean;
  trialNote?: string;
  welcome: string;
}) {
  const [widgetOpen, setWidgetOpen] = useState(initiallyOpen);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    interactive
      ? (peekRagPreviewFixtures()?.cases.slice(0, 3).map((item) => item.question) ?? [])
      : [],
  );
  const messageIdRef = useRef(1);
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
  }, []);

  useEffect(() => {
    if (!interactive || suggestions.length > 0) return;
    let cancelled = false;
    void loadRagPreviewFixtures()
      .then((fixtures) => {
        if (!cancelled) setSuggestions(fixtures.cases.slice(0, 3).map((item) => item.question));
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => { cancelled = true; };
  }, [interactive, suggestions.length]);

  const ask = (raw: string) => {
    const value = raw.trim();
    if (!value || pending) return;
    const reply = resolveAssistantReply(value).catch(() => unavailableReply);
    const submittedBinding = exchangeBinding ?? null;
    setMessages((current) => [...current, { id: messageIdRef.current++, from: "visitor", text: value, sources: [] }]);
    setQuestion("");
    setWidgetOpen(true);
    setPending(true);
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => { void reply.then((resolved) => {
      pendingTimerRef.current = null;
      setPending(false);
      setMessages((current) => [
        ...current,
        { id: messageIdRef.current++, from: "assistant", text: resolved.text, sources: resolved.sources },
      ]);
      if (submittedBinding) {
        onExchange?.(value, resolved.sources.length > 0, submittedBinding);
      }
    }); }, 500);
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  return (
    <>
      <button
        className="sfp-floating-trigger"
        type="button"
        aria-label={widgetOpen ? "收起 AI 助手" : "打开 AI 助手"}
        aria-expanded={widgetOpen}
        onClick={() => setWidgetOpen((current) => !current)}
      >
        {widgetOpen ? <X size={19} /> : <MessageCircle size={20} />}
      </button>

      {widgetOpen && (
        <section className="sfp-widget" aria-label="网站 AI 助手预览">
          <header>
            <span><Sparkles size={17} /></span>
            <div><strong>{assistantName || "企业助手"}</strong></div>
            <i />
          </header>
          <div className="sfp-widget-body">
            <p className="sfp-widget-bubble">{welcome || "您好，有什么可以帮您？"}</p>
            {messages.map((message) => message.from === "visitor" ? (
              <p key={message.id} className="sfp-widget-bubble sfp-widget-bubble--visitor">{message.text}</p>
            ) : (
              <p key={message.id} className="sfp-widget-bubble">
                {message.text}
                {showSources && message.sources.map((source) => (
                  <button key={source} type="button">来源：{source}</button>
                ))}
              </p>
            ))}
            {pending && <p className="sfp-widget-bubble sfp-widget-typing">正在检索预览知识…</p>}
            {messages.length === 0 && !pending && interactive && (
              <div className="sfp-widget-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => ask(suggestion)}>{suggestion}</button>
                ))}
              </div>
            )}
            {trialNote && <p className="sfp-widget-bubble sfp-widget-note">{trialNote}</p>}
          </div>
          {interactive ? (
            <form onSubmit={submitQuestion}>
              <input
                aria-label="在网站助手中提问"
                placeholder="继续提问…"
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
              />
              <button type="submit" aria-label="发送问题"><Send size={16} /></button>
            </form>
          ) : null}
        </section>
      )}
    </>
  );
}
