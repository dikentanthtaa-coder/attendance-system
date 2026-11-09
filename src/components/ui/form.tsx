"use client";

import { useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { Eye, EyeOff, Search, X, type LucideIcon } from "lucide-react";

/** 16px while typing, so phones don't zoom the page when the field takes focus. */
const INPUT =
  "w-full min-h-11 rounded-control border border-control bg-white px-3 text-base text-ink shadow-xs transition-colors duration-150 placeholder:text-muted hover:border-muted focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20 disabled:bg-canvas";

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label id={htmlFor && `${htmlFor}-label`} htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
        {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function TextInput({ icon: Icon, className = "", ...props }: ComponentProps<"input"> & { icon?: LucideIcon }) {
  if (!Icon) return <input {...props} className={`${INPUT} ${className}`} />;
  return (
    <div className="relative">
      <Icon aria-hidden size={17} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input {...props} className={`${INPUT} pl-10 ${className}`} />
    </div>
  );
}

export function PasswordInput({ className = "", ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  const Toggle = visible ? EyeOff : Eye;
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${INPUT} pr-12 ${className}`} />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-control text-muted transition-colors duration-150 hover:text-ink"
      >
        <Toggle aria-hidden size={18} />
      </button>
    </div>
  );
}

export function SearchInput({
  value,
  onClear,
  large,
  inputRef,
  className = "",
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "ref"> & { value: string; onClear: () => void; large?: boolean; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div className="relative">
      <Search aria-hidden size={large ? 20 : 17} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input
        {...props}
        ref={inputRef}
        type="search"
        value={value}
        className={`${INPUT} ${large ? "min-h-13 pl-11 text-lg" : "pl-10"} pr-11 ${className}`}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={onClear}
          className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-control text-muted transition-colors duration-150 hover:bg-active hover:text-ink"
        >
          <X aria-hidden size={17} />
        </button>
      )}
    </div>
  );
}
