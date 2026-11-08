"use client";

import { useId, useState } from "react";
import { CENTERS } from "@/lib/shared";
import { inputClass } from "./ui";

const OTHER = "Other";
const OPTIONS: string[] = [...CENTERS, OTHER];

export type CenterValue = { selected: string; other: string };
export const EMPTY_CENTER: CenterValue = { selected: "", other: "" };

/** The final center name, or "" while the selection is incomplete. */
export const centerName = (v: CenterValue) => (v.selected === OTHER ? v.other.trim() : v.selected);

/** Searchable dropdown of the listed centers, plus "Other" with a free-text field. */
export function CenterSelect({ id, value, onChange }: { id: string; value: CenterValue; onChange: (value: CenterValue) => void }) {
  const listId = useId();
  const [query, setQuery] = useState(value.selected);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Once a center is chosen, the box holds its name, so reopening should list everything.
  const filter = query === value.selected ? "" : query.trim().toLowerCase();
  const matches = OPTIONS.filter((o) => o === OTHER || o.toLowerCase().includes(filter));

  const choose = (option: string) => {
    onChange({ selected: option, other: option === OTHER ? value.other : "" });
    setQuery(option);
    setOpen(false);
  };

  const move = (delta: number) => {
    setOpen(true);
    setHighlight((h) => (h + delta + matches.length) % matches.length);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Type or choose a center"
          className={inputClass}
          value={query}
          onFocus={(e) => {
            e.target.select();
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            // Typed text that isn't an option doesn't count as a selection.
            setQuery(value.selected);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
            if (value.selected) onChange(EMPTY_CENTER);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (matches[highlight]) choose(matches[highlight]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Centers"
            className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg"
          >
            {matches.map((option, i) => (
              <li
                key={option}
                role="option"
                aria-selected={option === value.selected}
                // mousedown fires before the input's blur, which would otherwise close the list first
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex min-h-10 cursor-pointer items-center px-3 text-sm ${i === highlight ? "bg-brand-soft" : ""} ${option === OTHER ? "border-t border-line font-medium" : ""}`}
              >
                {option}
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.selected === OTHER && (
        <input
          aria-label="Center name"
          autoFocus
          maxLength={80}
          placeholder="Type the center name"
          className={inputClass}
          value={value.other}
          onChange={(e) => onChange({ selected: OTHER, other: e.target.value })}
        />
      )}
    </div>
  );
}
