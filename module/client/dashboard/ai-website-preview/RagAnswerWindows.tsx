import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Columns3, Maximize2, Minimize2, X } from "lucide-react";
import { RagEntranceReadyContext } from "./RagEntranceContext";
import "./rag-answer-windows.css";

export type AnswerPanel = "evidence" | "improve" | "review" | "answer";
export type AnswerWindowRect = { x: number; y: number; width: number; height: number };
type Viewport = { width: number; height: number; offsetTop?: number };
type WindowState = { rect: AnswerWindowRect; maximized: boolean; restore?: AnswerWindowRect };
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type WindowGesture = { panel: AnswerPanel; pointerId: number; x: number; y: number; origin: AnswerWindowRect; edge?: ResizeEdge };
type SheetGesture = { panel: AnswerPanel; pointerId: number; y: number; moved: number };

export type RagAnswerWindowsProps = {
  panels: AnswerPanel[];
  activePanel: AnswerPanel | null;
  onActivate: (panel: AnswerPanel) => void;
  onClose: (panel: AnswerPanel) => void;
  titles: Record<AnswerPanel, string>;
  renderBody: (panel: AnswerPanel) => ReactNode;
  renderFooter: (panel: AnswerPanel) => ReactNode;
  availability: Record<AnswerPanel, boolean>;
  modalBlocked?: boolean;
  onModalChange?: (open: boolean) => void;
};

const DETAIL_PANEL_TYPES: AnswerPanel[] = ["evidence", "improve", "review"];
const PANEL_TYPES: AnswerPanel[] = [...DETAIL_PANEL_TYPES, "answer"];
const PANEL_LABELS: Record<AnswerPanel, string> = { evidence: "回答依据", improve: "优化方案", review: "人工评审", answer: "回答编辑" };
const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const FOCUSABLE = "button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";
const MARGIN = 16;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);
const sameRect = (a: AnswerWindowRect, b: AnswerWindowRect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const readViewport = (): Viewport => typeof window === "undefined" ? { width: 1440, height: 900 } : {
  width: window.innerWidth,
  height: Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight),
  offsetTop: window.visualViewport?.offsetTop ?? 0,
};

export function constrainAnswerWindow(rect: AnswerWindowRect, viewport: Viewport): AnswerWindowRect {
  const availableWidth = Math.max(1, viewport.width - MARGIN * 2);
  const availableHeight = Math.max(1, viewport.height - MARGIN * 2);
  const width = clamp(rect.width, Math.min(360, availableWidth), availableWidth);
  const height = clamp(rect.height, Math.min(320, availableHeight), availableHeight);
  return { width, height, x: clamp(rect.x, MARGIN, viewport.width - MARGIN - width), y: clamp(rect.y, MARGIN, viewport.height - MARGIN - height) };
}

export function resizeAnswerWindow(rect: AnswerWindowRect, edge: ResizeEdge, dx: number, dy: number, viewport: Viewport): AnswerWindowRect {
  const next = { ...rect };
  if (edge.includes("e")) next.width = clamp(rect.width + dx, Math.min(360, viewport.width - 32), viewport.width - MARGIN - rect.x);
  if (edge.includes("s")) next.height = clamp(rect.height + dy, Math.min(320, viewport.height - 32), viewport.height - MARGIN - rect.y);
  if (edge.includes("w")) {
    next.width = clamp(rect.width - dx, Math.min(360, viewport.width - 32), rect.x + rect.width - MARGIN);
    next.x = rect.x + rect.width - next.width;
  }
  if (edge.includes("n")) {
    next.height = clamp(rect.height - dy, Math.min(320, viewport.height - 32), rect.y + rect.height - MARGIN);
    next.y = rect.y + rect.height - next.height;
  }
  return constrainAnswerWindow(next, viewport);
}

function maximumRect(viewport: Viewport): AnswerWindowRect {
  return { x: MARGIN, y: MARGIN, width: Math.max(1, viewport.width - MARGIN * 2), height: Math.max(1, viewport.height - MARGIN * 2) };
}

function initialRect(panel: AnswerPanel, offset: number, viewport: Viewport): AnswerWindowRect {
  const width = Math.min(panel === "evidence" ? 880 : 640, viewport.width - 48);
  const height = Math.min(720, viewport.height - 48);
  return constrainAnswerWindow({ width, height, x: (viewport.width - width) / 2 + offset * 24, y: (viewport.height - height) / 2 + offset * 24 }, viewport);
}

function capturePointer(element: HTMLElement, pointerId: number) {
  try { element.setPointerCapture?.(pointerId); } catch { /* The pointer may already have ended. */ }
}

function focusableElements(element: HTMLElement | null): HTMLElement[] {
  return Array.from(element?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(item => !item.closest("[hidden],[inert],details:not([open]) > :not(summary)") && item.getAttribute("aria-hidden") !== "true");
}

function restoreFocusUnlessInterrupted(restore: () => void) {
  let interrupted = false;
  const mark = () => { interrupted = true; };
  document.addEventListener("pointerdown", mark, true);
  document.addEventListener("keydown", mark, true);
  requestAnimationFrame(() => {
    document.removeEventListener("pointerdown", mark, true);
    document.removeEventListener("keydown", mark, true);
    if (!interrupted) restore();
  });
}

// Geometry updates should only move the frame, preserving its reading and form tree.
const AnswerWindowContent = memo(function AnswerWindowContent({ panel, ready, renderBody, renderFooter }: {
  panel: AnswerPanel;
  ready: boolean;
  renderBody: RagAnswerWindowsProps["renderBody"];
  renderFooter: RagAnswerWindowsProps["renderFooter"];
}) {
  const footer = renderFooter(panel);
  return <>
    <div className="rag-drawer-body"><RagEntranceReadyContext value={ready}>{renderBody(panel)}</RagEntranceReadyContext></div>
    {footer && <footer>{footer}</footer>}
  </>;
});

export function RagAnswerWindows({ panels, activePanel, onActivate, onClose, titles, renderBody, renderFooter, availability, modalBlocked = false, onModalChange }: RagAnswerWindowsProps) {
  const instanceId = useId().replace(/:/g, "");
  const [viewport, setViewport] = useState(readViewport);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [windows, setWindows] = useState<Partial<Record<AnswerPanel, WindowState>>>({});
  const [order, setOrder] = useState<AnswerPanel[]>([]);
  const [sheetExpanded, setSheetExpanded] = useState<Partial<Record<AnswerPanel, boolean>>>({});
  const [dragging, setDragging] = useState<AnswerPanel | null>(null);
  const [enteredPanels, setEnteredPanels] = useState<AnswerPanel[]>([]);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const entryTimers = useRef(new Map<AnswerPanel, number>());
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{ panel: AnswerPanel; rect: AnswerWindowRect } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const windowRefs = useRef<Partial<Record<AnswerPanel, HTMLElement | null>>>({});
  const windowGesture = useRef<WindowGesture | null>(null);
  const sheetGesture = useRef<SheetGesture | null>(null);
  const focusedPanel = useRef<AnswerPanel | null>(null);
  const previousPanels = useRef<AnswerPanel[]>([]);
  const mobile = viewport.width < 768;
  const visiblePanel = activePanel && panels.includes(activePanel) ? activePanel : panels.at(-1) ?? null;
  const modalOpen = mobile && panels.length > 0 && !modalBlocked;
  const canTile = panels.length > 1 && (viewport.width - 32 - (panels.length - 1) * 16) / panels.length >= 360 && viewport.height - 32 >= 320;
  const panelKey = panels.join("|");
  const finishEntry = (panel: AnswerPanel) => {
    window.clearTimeout(entryTimers.current.get(panel));
    entryTimers.current.delete(panel);
    setEnteredPanels(old => old.includes(panel) ? old : [...old, panel]);
  };

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    setEnteredPanels(old => old.every(panel => panels.includes(panel)) ? old : old.filter(panel => panels.includes(panel)));
    for (const [panel, timer] of entryTimers.current) {
      if (!panels.includes(panel)) { window.clearTimeout(timer); entryTimers.current.delete(panel); }
    }
    for (const panel of panels) {
      if (reducedMotion) finishEntry(panel);
      else if (!enteredPanels.includes(panel) && !entryTimers.current.has(panel)) {
        // animationend can be absent when an element is hidden or animations are cancelled.
        entryTimers.current.set(panel, window.setTimeout(() => finishEntry(panel), 220));
      }
    }
  }, [panelKey, reducedMotion]);

  useEffect(() => () => {
    entryTimers.current.forEach(timer => window.clearTimeout(timer));
    entryTimers.current.clear();
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = null;
    pendingMove.current = null;
  }, []);

  // Header height can change with title wrapping, zoom, window resize and mobile tabs.
  // Keep the scrollable content's inset in sync without moving the header controls.
  useLayoutEffect(() => {
    const headers = PANEL_TYPES.map(panel => windowRefs.current[panel]?.querySelector<HTMLElement>(".rag-answer-window__header")).filter((header): header is HTMLElement => Boolean(header));
    const measure = (header: HTMLElement, measuredHeight?: number) => {
      const height = measuredHeight ?? header.getBoundingClientRect().height;
      const parent = header.parentElement;
      const value = `${height}px`;
      if (height > 0 && parent?.style.getPropertyValue("--rag-window-header-height") !== value) parent?.style.setProperty("--rag-window-header-height", value);
    };
    const measureAll = () => {
      const heights = headers.map(header => header.getBoundingClientRect().height);
      headers.forEach((header, index) => measure(header, heights[index]));
    };
    measureAll();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => entries.forEach(entry => measure(entry.target as HTMLElement, entry.borderBoxSize?.[0]?.blockSize)));
    headers.forEach(header => observer?.observe(header));
    window.addEventListener("resize", measureAll);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measureAll); };
  }, [panelKey, mobile, visiblePanel]);

  useEffect(() => {
    const resize = () => setViewport(readViewport());
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize); };
  }, []);

  useEffect(() => {
    if (mobile) return;
    setWindows(old => {
      const next = { ...old };
      let changed = false;
      for (const panel of PANEL_TYPES) {
        const saved = old[panel];
        if (saved) {
          const rect = saved.maximized ? maximumRect(viewport) : constrainAnswerWindow(saved.rect, viewport);
          if (!sameRect(saved.rect, rect)) { next[panel] = { ...saved, rect }; changed = true; }
        }
      }
      for (const [index, panel] of panels.entries()) {
        if (!next[panel]) { next[panel] = { rect: initialRect(panel, index, viewport), maximized: false }; changed = true; }
      }
      return changed ? next : old;
    });
  }, [mobile, panels, viewport]);

  useEffect(() => {
    if (!visiblePanel) return;
    setOrder(old => old.at(-1) === visiblePanel ? old : [...old.filter(panel => panel !== visiblePanel), visiblePanel]);
  }, [visiblePanel]);

  useEffect(() => {
    if (windowGesture.current && (!panels.includes(windowGesture.current.panel) || mobile || modalBlocked)) {
      windowGesture.current = null;
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
      pendingMove.current = null;
      setDragging(null);
    }
    if (sheetGesture.current && (!panels.includes(sheetGesture.current.panel) || !mobile || modalBlocked)) sheetGesture.current = null;
  }, [panels, mobile, modalBlocked]);

  useLayoutEffect(() => {
    if (layerRef.current) layerRef.current.inert = modalBlocked;
  }, [modalBlocked]);

  useEffect(() => {
    onModalChange?.(modalOpen);
    return () => onModalChange?.(false);
  }, [modalOpen, onModalChange]);

  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      focusedPanel.current = target?.closest<HTMLElement>("[data-answer-panel]")?.dataset.answerPanel as AnswerPanel | undefined ?? null;
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, []);

  const returnFocus = (closed: AnswerPanel) => {
    const remaining = order.filter(panel => panel !== closed && panels.includes(panel)).reverse();
    const next = remaining[0] ?? panels.find(panel => panel !== closed);
    restoreFocusUnlessInterrupted(() => {
      if (next) windowRefs.current[next]?.focus();
      else document.querySelector<HTMLElement>(`[data-answer-panel-trigger="${closed}"]`)?.focus();
    });
  };

  useLayoutEffect(() => {
    const removed = previousPanels.current.filter(panel => !panels.includes(panel));
    if (focusedPanel.current && removed.includes(focusedPanel.current) && !modalBlocked) returnFocus(focusedPanel.current);
    previousPanels.current = [...panels];
  }, [panels, modalBlocked]);

  useLayoutEffect(() => {
    if (!visiblePanel || modalBlocked) return;
    const element = windowRefs.current[visiblePanel];
    if (!element || element.contains(document.activeElement)) return;
    // Leave an actual pointer target in the window focused; only entry activation moves focus here.
    element.querySelector<HTMLButtonElement>("[data-answer-window-close]")?.focus();
  }, [visiblePanel, mobile, modalBlocked]);

  const closePanel = (panel: AnswerPanel) => {
    if (modalBlocked) return;
    if (mobile) {
      focusedPanel.current = null;
      panels.forEach(onClose);
      restoreFocusUnlessInterrupted(() => {
        document.querySelector<HTMLElement>(`[data-answer-panel-trigger="${panel}"]`)?.focus();
      });
      return;
    }
    onClose(panel);
    returnFocus(panel);
  };

  const activate = (panel: AnswerPanel) => {
    if (!modalBlocked) onActivate(panel);
  };

  const updateRect = (panel: AnswerPanel, rect: AnswerWindowRect) => setWindows(old => ({ ...old, [panel]: { rect: constrainAnswerWindow(rect, viewportRef.current), maximized: false } }));
  const flushMove = () => {
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = null;
    const pending = pendingMove.current;
    pendingMove.current = null;
    if (pending) updateRect(pending.panel, pending.rect);
  };

  const beginWindowGesture = (event: PointerEvent<HTMLElement>, panel: AnswerPanel, edge?: ResizeEdge) => {
    if (mobile || modalBlocked || event.button !== 0 || windows[panel]?.maximized) return;
    if (!edge && (event.target as HTMLElement).closest("button,a,input,textarea,select,nav")) return;
    activate(panel);
    event.preventDefault();
    const rect = windows[panel]?.rect ?? initialRect(panel, panels.indexOf(panel), viewport);
    windowGesture.current = { panel, pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: rect, edge };
    setDragging(panel);
    capturePointer(event.currentTarget, event.pointerId);
  };

  const moveWindowGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = windowGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    pendingMove.current = { panel: gesture.panel, rect: gesture.edge ? resizeAnswerWindow(gesture.origin, gesture.edge, dx, dy, viewport) : { ...gesture.origin, x: gesture.origin.x + dx, y: gesture.origin.y + dy } };
    if (moveFrame.current === null) moveFrame.current = requestAnimationFrame(flushMove);
  };

  const endWindowGesture = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    if (windowGesture.current?.pointerId !== event.pointerId) return;
    if (cancelled) {
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
      pendingMove.current = null;
    } else flushMove();
    windowGesture.current = null;
    setDragging(null);
  };

  const toggleMaximum = (panel: AnswerPanel) => {
    if (mobile) { setSheetExpanded(old => ({ ...old, [panel]: !old[panel] })); return; }
    setWindows(old => {
      const saved = old[panel] ?? { rect: initialRect(panel, panels.indexOf(panel), viewport), maximized: false };
      return { ...old, [panel]: saved.maximized ? { rect: constrainAnswerWindow(saved.restore ?? saved.rect, viewport), maximized: false } : { rect: maximumRect(viewport), restore: saved.rect, maximized: true } };
    });
  };

  const tileWindows = () => {
    if (!canTile) return;
    const width = (viewport.width - 32 - (panels.length - 1) * 16) / panels.length;
    const height = Math.min(720, viewport.height - 32);
    setWindows(old => {
      const next = { ...old };
      panels.forEach((panel, index) => { next[panel] = { rect: { x: 16 + index * (width + 16), y: (viewport.height - height) / 2, width, height }, maximized: false }; });
      return next;
    });
  };

  const headerKeyDown = (event: KeyboardEvent<HTMLElement>, panel: AnswerPanel) => {
    if (mobile || windows[panel]?.maximized || event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0;
    const dy = event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : 0;
    const rect = windows[panel]?.rect ?? initialRect(panel, panels.indexOf(panel), viewport);
    updateRect(panel, event.shiftKey ? { ...rect, width: rect.width + dx, height: rect.height + dy } : { ...rect, x: rect.x + dx, y: rect.y + dy });
  };

  const panelKeyDown = (event: KeyboardEvent<HTMLElement>, panel: AnswerPanel) => {
    if (event.defaultPrevented || modalBlocked) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); closePanel(panel); return;
    }
    if (!mobile || event.key !== "Tab") return;
    const element = windowRefs.current[panel] ?? null;
    const targets = focusableElements(element);
    const first = targets[0], last = targets.at(-1);
    if (!first || !last) { event.preventDefault(); element?.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const beginSheetGesture = (event: PointerEvent<HTMLElement>, panel: AnswerPanel) => {
    if (!mobile || modalBlocked || event.button !== 0) return;
    event.preventDefault();
    sheetGesture.current = { panel, pointerId: event.pointerId, y: event.clientY, moved: 0 };
    capturePointer(event.currentTarget, event.pointerId);
  };
  const moveSheetGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = sheetGesture.current;
    if (gesture?.pointerId === event.pointerId) gesture.moved = event.clientY - gesture.y;
  };
  const endSheetGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = sheetGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    sheetGesture.current = null;
    if (gesture.moved < -32) setSheetExpanded(old => ({ ...old, [gesture.panel]: true }));
    else if (gesture.moved > 64) closePanel(gesture.panel);
  };

  return <div ref={layerRef} className={`rag-answer-windows${mobile ? " is-sheet" : ""}`} aria-hidden={modalBlocked || undefined} data-testid="rag-answer-windows">
    {modalOpen && <div className="rag-answer-windows__backdrop" onMouseDown={event => { if (event.target === event.currentTarget && visiblePanel) closePanel(visiblePanel); }} />}
    {!mobile && panels.length > 0 && !modalBlocked && <div className="rag-answer-windows__desktop-dim" aria-hidden="true" />}
    <p id={`${instanceId}-window-help`} className="rag-reveal-screen-reader-text">可拖动标题栏移动窗口，拖动边缘调整大小。聚焦标题栏后，方向键移动，Shift 加方向键调整大小。</p>
    {PANEL_TYPES.filter(panel => panels.includes(panel)).map(panel => {
      const saved = windows[panel] ?? { rect: initialRect(panel, panels.indexOf(panel), viewport), maximized: false };
      const isVisible = !mobile || panel === visiblePanel;
      const expanded = mobile ? Boolean(sheetExpanded[panel]) : saved.maximized;
      const ready = reducedMotion || enteredPanels.includes(panel);
      const sheetHeight = expanded ? Math.max(1, viewport.height - 16) : Math.max(1, Math.min(viewport.height * .9, viewport.height - 16));
      const style: CSSProperties = mobile ? { left: 8, top: (viewport.offsetTop ?? 0) + viewport.height - 8 - sheetHeight, width: Math.max(1, viewport.width - 16), height: sheetHeight, zIndex: 2 } : { left: saved.rect.x, top: saved.rect.y, width: saved.rect.width, height: saved.rect.height, zIndex: 2 + Math.max(0, order.indexOf(panel)) };
      return <aside key={panel} ref={element => { windowRefs.current[panel] = element; }} className={`rag-drawer rag-drawer--${panel} rag-answer-window${panel === visiblePanel ? " is-active" : ""}${dragging === panel ? " is-dragging" : ""}${expanded ? " is-expanded" : ""}`} style={style} hidden={!isVisible} role="dialog" aria-modal={mobile && isVisible ? true : undefined} aria-labelledby={`${instanceId}-${panel}-title`} data-answer-panel={panel} data-entering={!ready || undefined} data-testid={`rag-answer-window-${panel}`} tabIndex={-1} onAnimationEnd={event => { if (event.target === event.currentTarget && ["rag-answer-window-enter", "rag-answer-sheet-enter"].includes(event.animationName)) finishEntry(panel); }} onPointerDownCapture={() => activate(panel)} onFocusCapture={() => activate(panel)} onKeyDown={event => panelKeyDown(event, panel)}>
        <header className="rag-answer-window__header" role={mobile ? undefined : "group"} tabIndex={mobile ? undefined : 0} aria-label={mobile ? undefined : `移动${PANEL_LABELS[panel]}窗口`} aria-describedby={mobile ? undefined : `${instanceId}-window-help`} onKeyDown={event => headerKeyDown(event, panel)} onPointerDown={event => beginWindowGesture(event, panel)} onPointerMove={moveWindowGesture} onPointerUp={event => endWindowGesture(event)} onPointerCancel={event => endWindowGesture(event, true)}>
          {mobile && <div className="rag-answer-window__sheet-handle" aria-hidden="true" onPointerDown={event => beginSheetGesture(event, panel)} onPointerMove={moveSheetGesture} onPointerUp={endSheetGesture} onPointerCancel={() => { sheetGesture.current = null; }}><span /></div>}
          <div className="rag-answer-window__heading"><div><h2 id={`${instanceId}-${panel}-title`}>{titles[panel]}</h2></div>
            <div className="rag-answer-window__controls">
              {!mobile && <span title={canTile ? "并排窗口" : panels.length < 2 ? "打开两个以上窗口后可并排" : "当前空间不足以并排窗口"}><button type="button" aria-label="并排窗口" disabled={!canTile} onClick={tileWindows}><Columns3 size={16} aria-hidden="true" /></button></span>}
              <button type="button" aria-label={expanded ? "还原窗口" : "放大窗口"} title={expanded ? "还原窗口" : "放大窗口"} onClick={() => toggleMaximum(panel)}>{expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button>
              <button type="button" data-answer-window-close aria-label={panel === "answer" ? "关闭回答编辑" : "关闭评估面板"} title="关闭" onClick={() => closePanel(panel)}><X size={18} aria-hidden="true" /></button>
            </div>
          </div>
          {mobile && panel !== "answer" && <nav className="rag-answer-window__tabs" aria-label="回答评估详情切换">{DETAIL_PANEL_TYPES.map(type => <button type="button" key={type} aria-current={type === panel ? "page" : undefined} disabled={!availability[type]} onClick={() => activate(type)}>{PANEL_LABELS[type]}</button>)}</nav>}
        </header>
        <AnswerWindowContent panel={panel} ready={ready} renderBody={renderBody} renderFooter={renderFooter} />
        {!mobile && !saved.maximized && EDGES.map(edge => <div key={edge} className={`rag-answer-window__resize is-${edge}`} data-resize-edge={edge} aria-hidden="true" onPointerDown={event => beginWindowGesture(event, panel, edge)} onPointerMove={moveWindowGesture} onPointerUp={event => endWindowGesture(event)} onPointerCancel={event => endWindowGesture(event, true)} />)}
      </aside>;
    })}
  </div>;
}
