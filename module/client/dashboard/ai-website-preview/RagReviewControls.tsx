import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import * as Select from "@radix-ui/react-select";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, GripVertical, Search, X } from "lucide-react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReviewEvidenceOption } from "./rag-review-evidence";
import "./rag-review-controls.css";

const EMPTY_SELECTION = "__rag_review_pending__";
const GROUPS = { answer: "回答原文", claim: "陈述", source: "参考资料", existing: "已有定位" };
const GROUP_ORDER = ["answer", "claim", "source", "existing"] as const;
const chipCollision: CollisionDetection = args => {
  const pointerHits = pointerWithin(args);
  return pointerHits.length > 0 ? pointerHits : closestCenter(args);
};

function useReviewOverlay(open: boolean, close: () => void) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [window, setWindow] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLButtonElement | null) => {
    trigger.current = node;
    setWindow(node?.closest<HTMLElement>('[data-answer-panel="review"]') ?? node?.closest<HTMLElement>("aside") ?? null);
  }, []);
  useEffect(() => {
    if (!open || !window) return;
    const observer = new MutationObserver(() => {
      if (window.hidden || window.closest("[hidden],[inert]")) close();
    });
    observer.observe(window, { attributes: true, attributeFilter: ["hidden", "inert"] });
    return () => observer.disconnect();
  }, [open, window, close]);
  return { ref, trigger, window, boundary: window?.querySelector<HTMLElement>(".rag-drawer-body") ?? window };
}

function focusAfterTrigger(trigger: HTMLElement | null, backwards: boolean) {
  if (!trigger) return;
  const scope = trigger.closest('[data-answer-panel="review"]') ?? document.body;
  const elements = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]'))
    .filter(element => !element.closest('[hidden],[inert],[data-rag-review-menu]') && element.getAttribute("aria-hidden") !== "true");
  const index = elements.indexOf(trigger);
  const next = elements[index + (backwards ? -1 : 1)];
  (next ?? trigger).focus();
}

export function RagReviewSelect({ label, fieldLabel, value, options, onValueChange }: {
  label: string; fieldLabel?: string; value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const overlay = useReviewOverlay(open, close);
  const tabbing = useRef(false);
  const labelId = useId();
  const closeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setOpen(false); overlay.trigger.current?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault(); event.stopPropagation(); tabbing.current = true; setOpen(false);
      requestAnimationFrame(() => focusAfterTrigger(overlay.trigger.current, event.shiftKey));
    }
  };
  return <div className="rag-review-control-field">
    <span id={labelId}>{fieldLabel ?? label}</span>
    <Select.Root open={open} onOpenChange={setOpen} value={value === "" ? EMPTY_SELECTION : value} onValueChange={next => onValueChange(next === EMPTY_SELECTION ? "" : next)}>
      <Select.Trigger ref={overlay.ref} aria-label={label} className="rag-review-control rag-review-select">
        <Select.Value /><Select.Icon asChild><ChevronDown size={18} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal container={overlay.window}>
        <Select.Content data-rag-review-menu className="rag-review-menu rag-review-select-menu" position="popper" align="start" sideOffset={8} collisionPadding={8} collisionBoundary={overlay.boundary} onKeyDown={closeKey}
          onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); overlay.trigger.current?.focus(); }}
          onCloseAutoFocus={event => { if (tabbing.current) { event.preventDefault(); tabbing.current = false; } }}>
          <Select.Viewport>{options.map(option => <Select.Item className="rag-review-menu-option" key={option.value} value={option.value === "" ? EMPTY_SELECTION : option.value}>
            <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={16} aria-hidden="true" /></Select.ItemIndicator>
          </Select.Item>)}</Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  </div>;
}

function EvidenceChip({ option, onRemove, onMove }: { option: ReviewEvidenceOption; onRemove: () => void; onMove: (offset: number) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: option.value });
  return <li ref={setNodeRef} className={`rag-review-evidence-chip${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }} data-evidence-value={option.value}>
    <button type="button" className="rag-review-evidence-chip__handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`调整${option.label}顺序`} title="拖动排序；Alt＋方向键调整顺序" onKeyDown={event => {
      if (event.key === "Escape" && isDragging) event.stopPropagation();
      if (event.altKey && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); onMove(["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
      } else listeners?.onKeyDown?.(event);
    }}><GripVertical size={14} aria-hidden="true" /></button>
    <span title={option.description ?? option.value}>{option.label}</span>
    <button type="button" className="rag-review-evidence-chip__remove" aria-label={`移除${option.label}`} onClick={onRemove}><X size={14} aria-hidden="true" /></button>
  </li>;
}

export function RagReviewEvidencePicker({ label, values, options, onValuesChange }: {
  label: string; values: string[]; options: ReviewEvidenceOption[]; onValuesChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const overlay = useReviewOverlay(open, close);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();
  const tabbing = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const uniqueValues = [...new Set(values.filter(value => value.trim()))];
  const knownOptions = new Map(options.map(option => [option.value, option]));
  const allOptions: ReviewEvidenceOption[] = [...options, ...uniqueValues.filter(value => !knownOptions.has(value)).map(value => ({ value, label: value, group: "existing" as const }))];
  const filtered = GROUP_ORDER.flatMap(group => allOptions.filter(option => option.group === group && `${option.label} ${option.description ?? ""} ${option.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const active = filtered[Math.min(activeIndex, Math.max(0, filtered.length - 1))];
  const toggle = (value: string) => onValuesChange(uniqueValues.includes(value) ? uniqueValues.filter(item => item !== value) : [...uniqueValues, value]);
  const move = (value: string, offset: number) => {
    const index = uniqueValues.indexOf(value), destination = index + offset;
    if (index >= 0 && destination >= 0 && destination < uniqueValues.length) onValuesChange(arrayMove(uniqueValues, index, destination));
  };
  const drop = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      const from = uniqueValues.indexOf(String(active.id)), to = uniqueValues.indexOf(String(over.id));
      if (from >= 0 && to >= 0) onValuesChange(arrayMove(uniqueValues, from, to));
    }
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setOpen(false); overlay.trigger.current?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault(); event.stopPropagation(); tabbing.current = true; setOpen(false);
      requestAnimationFrame(() => focusAfterTrigger(overlay.trigger.current, event.shiftKey));
    } else if (!event.nativeEvent.isComposing && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && (event.target === searchRef.current || (event.target as HTMLElement).getAttribute("role") === "option")) {
      event.preventDefault();
      const current = Math.min(activeIndex, filtered.length - 1);
      const next = event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
      setActiveIndex(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && event.target === searchRef.current) {
      event.preventDefault(); if (active) toggle(active.value);
    }
  };
  return <div className="rag-review-control-field rag-review-evidence-picker" role="group" aria-label={label}>
    <span>证据定位</span>
    <Popover.Root modal={false} open={open} onOpenChange={next => { setOpen(next); if (next) { setQuery(""); setActiveIndex(0); } }}>
      <Popover.Trigger ref={overlay.ref} className="rag-review-control rag-review-select" aria-label={label}><span>选择证据{uniqueValues.length > 0 && <span className="rag-review-evidence-count">{uniqueValues.length}</span>}</span><ChevronDown size={18} aria-hidden="true" /></Popover.Trigger>
      <Popover.Portal container={overlay.window}>
        <Popover.Content data-rag-review-menu className="rag-review-menu rag-review-evidence-menu" align="start" sideOffset={8} collisionPadding={8} collisionBoundary={overlay.boundary} onKeyDown={handleKey}
          onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}
          onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); overlay.trigger.current?.focus(); }}
          onCloseAutoFocus={event => { if (tabbing.current) { event.preventDefault(); tabbing.current = false; } }}>
          <div className="rag-review-evidence-search"><Search size={16} aria-hidden="true" /><input ref={searchRef} id={inputId} aria-label={`${label}搜索`} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active ? `${listId}-${filtered.indexOf(active)}` : undefined} placeholder="搜索原文、陈述或资料" value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} /></div>
          <div id={listId} className="rag-review-evidence-options" role="listbox" aria-label={`${label}候选`} aria-multiselectable="true">
            {GROUP_ORDER.map(group => {
              const grouped = filtered.filter(option => option.group === group);
              return grouped.length > 0 && <div key={group} role="group" aria-label={GROUPS[group]}><p className="rag-review-menu-group">{GROUPS[group]}</p>{grouped.map(option => {
                const index = filtered.indexOf(option), selected = uniqueValues.includes(option.value);
                return <button type="button" role="option" key={option.value} id={`${listId}-${index}`} tabIndex={-1} aria-selected={selected} className={`rag-review-menu-option${active === option ? " is-highlighted" : ""}`} onMouseMove={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => { toggle(option.value); searchRef.current?.focus(); }}>
                  <span><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span><Check size={16} aria-hidden="true" className={selected ? "" : "is-unchecked"} />
                </button>;
              })}</div>;
            })}
            {filtered.length === 0 && <p className="rag-review-menu-empty">{query ? "没有匹配的证据" : "暂无可选证据"}</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {uniqueValues.length > 0 && <DndContext sensors={sensors} collisionDetection={chipCollision} onDragEnd={drop} accessibility={{ container: overlay.window ?? undefined, screenReaderInstructions: { draggable: "按空格开始排序，方向键移动，再按空格放下，Escape 取消。也可按 Alt 加方向键调整顺序。" } }}>
      <SortableContext items={uniqueValues} strategy={rectSortingStrategy}><ul className="rag-review-evidence-chips" aria-label={`${label}：已选证据`}>{uniqueValues.map(value => <EvidenceChip key={value} option={knownOptions.get(value) ?? { value, label: value, group: "existing" }} onRemove={() => onValuesChange(uniqueValues.filter(item => item !== value))} onMove={offset => move(value, offset)} />)}</ul></SortableContext>
    </DndContext>}
  </div>;
}
