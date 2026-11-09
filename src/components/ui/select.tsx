"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Check, ChevronDown } from "lucide-react";

const GAP = 6;
const SCREEN_EDGE = 8;
const MAX_HEIGHT = 288;
const TYPE_AHEAD_MS = 600;

/**
 * The floating panel of any dropdown. It is fixed to the screen, so a scrolling pop-up can't clip it,
 * and it opens upwards when there's more room there.
 */
export function ListPopup({
  id,
  anchorRef,
  children,
  ...aria
}: { id: string; anchorRef: RefObject<HTMLElement | null>; children: ReactNode } & Pick<HTMLAttributes<HTMLUListElement>, "aria-label" | "aria-labelledby">) {
  const ref = useRef<HTMLUListElement>(null);

  const place = () => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const popup = ref.current;
    if (!anchor || !popup) return;
    const below = window.innerHeight - anchor.bottom - GAP - SCREEN_EDGE;
    const above = anchor.top - GAP - SCREEN_EDGE;
    const openUp = popup.scrollHeight > below && above > below;
    popup.style.minWidth = `${anchor.width}px`;
    popup.style.maxHeight = `${Math.min(MAX_HEIGHT, openUp ? above : below)}px`;
    popup.style.top = openUp ? "auto" : `${anchor.bottom + GAP}px`;
    popup.style.bottom = openUp ? `${window.innerHeight - anchor.top + GAP}px` : "auto";
    const furthestLeft = window.innerWidth - popup.offsetWidth - SCREEN_EDGE;
    popup.style.left = `${Math.max(SCREEN_EDGE, Math.min(anchor.left, furthestLeft))}px`;
  };

  // No dependency list: a filtered list changes height, so it's placed again after every render.
  useLayoutEffect(place);

  useEffect(() => {
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  });

  return (
    <ul
      {...aria}
      ref={ref}
      id={id}
      role="listbox"
      className="rise-in fixed z-50 w-max max-w-[calc(100vw-1rem)] overflow-y-auto rounded-control border border-line bg-white p-1 text-ink shadow-xl"
    >
      {children}
    </ul>
  );
}

/** One choice in a dropdown. Selecting by mouse must not take focus away from the field. */
export function ListOption({
  id,
  selected,
  highlighted,
  divided,
  onChoose,
  onHover,
  children,
}: {
  id?: string;
  selected: boolean;
  highlighted: boolean;
  divided?: boolean;
  onChoose: () => void;
  onHover: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      onMouseMove={onHover}
      className={`flex min-h-11 items-center justify-between gap-6 rounded-lg px-3 text-sm whitespace-nowrap transition-colors duration-100 md:min-h-10 ${selected ? "font-semibold text-brand-dark" : ""} ${highlighted ? "bg-brand-soft" : ""} ${divided ? "mt-1 border-t border-rule" : ""}`}
    >
      {children}
      <Check aria-hidden size={16} strokeWidth={2.5} className={`shrink-0 text-brand ${selected ? "" : "invisible"}`} />
    </li>
  );
}

export type SelectOption = { value: string; label: string };

/**
 * Use inside a `Field` with the same id, which supplies the label. `active` marks a value that is
 * narrowing something, such as a filter that isn't on "All".
 */
export function Select({
  id,
  value,
  onChange,
  options,
  active,
  placeholder = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  active?: boolean;
  /** Shown when nothing is chosen yet. */
  placeholder?: string;
}) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupId = `${listId}-list`;
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const optionId = (i: number) => `${listId}-${i}`;

  const openAt = (i: number) => {
    setHighlight(i);
    setOpen(true);
  };

  const choose = (i: number) => {
    if (options[i]) onChange(options[i].value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !document.getElementById(popupId)?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [open, popupId]);

  const typeAhead = (key: string) => {
    const now = Date.now();
    const text = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + key.toLowerCase() : key.toLowerCase();
    typed.current = { text, at: now };
    return options.findIndex((o) => o.label.toLowerCase().startsWith(text));
  };

  function onKeyDown(e: KeyboardEvent) {
    const typing = e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (typing) {
      const match = typeAhead(e.key);
      if (match >= 0) openAt(match);
      return;
    }
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openAt(Math.max(selectedIndex, 0));
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === "ArrowDown") setHighlight((h) => Math.min(h + 1, last));
    else if (e.key === "ArrowUp") setHighlight((h) => Math.max(h - 1, 0));
    else if (e.key === "Home") setHighlight(0);
    else if (e.key === "End") setHighlight(last);
    else if (e.key === "Enter" || e.key === " ") choose(highlight);
    else if (e.key === "Escape") {
      // Also stops Escape from closing a pop-up this dropdown sits in.
      e.stopPropagation();
      setOpen(false);
    } else {
      if (e.key === "Tab") setOpen(false);
      return;
    }
    e.preventDefault();
  }

  const look = active ? "border-brand bg-brand-soft font-semibold text-brand-dark" : "border-control bg-white text-ink hover:border-muted";

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popupId}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={open ? optionId(highlight) : undefined}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(selectedIndex, 0)))}
        onKeyDown={onKeyDown}
        // Some browsers click a button when the space bar comes back up, which would close the list again.
        onKeyUp={(e) => {
          if (e.key === " ") e.preventDefault();
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-control border px-3 text-left text-sm shadow-xs transition-colors duration-150 focus:outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20 ${look} ${open ? "border-brand ring-3 ring-brand/20" : ""}`}
      >
        <span className={`min-w-0 truncate ${selectedIndex < 0 ? "text-muted" : ""}`}>{options[selectedIndex]?.label ?? placeholder}</span>
        <ChevronDown aria-hidden size={16} className={`shrink-0 transition-transform duration-150 ${active ? "text-brand" : "text-muted"} ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ListPopup id={popupId} anchorRef={buttonRef} aria-labelledby={`${id}-label`}>
          {options.map((option, i) => (
            <ListOption
              key={option.value}
              id={optionId(i)}
              selected={i === selectedIndex}
              highlighted={i === highlight}
              onChoose={() => choose(i)}
              onHover={() => setHighlight(i)}
            >
              {option.label}
            </ListOption>
          ))}
        </ListPopup>
      )}
    </>
  );
}
