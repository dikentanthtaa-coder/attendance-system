"use client";

import type { ComponentProps, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { Field, TextInput } from "@/components/ui";

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "ref" | "id"> & {
  id: string;
  label: string;
  /** How many digits a complete value has: 10 for a mobile number, 6 for a Member ID. */
  digits: number;
  optional?: boolean;
  value: string;
  onValue: (value: string) => void;
  /** Turns whatever was typed or pasted into what the box shows, such as digits only. */
  clean: (raw: string) => string;
  inputRef?: Ref<HTMLInputElement>;
  icon?: LucideIcon;
  /** Set false to hide the "4 of 6 digits" count, such as for an older value nobody has changed. */
  showCount?: boolean;
};

/**
 * A box for a fixed number of digits. Letters and symbols don't appear, and it shows how many digits
 * are still missing. There's no maxLength: it would cut a pasted "+91 98765 43210" short before
 * `clean` could remove the +91.
 */
export function DigitsField({ id, label, digits, optional, value, onValue, clean, inputRef, icon, showCount = true, ...props }: Props) {
  const counting = showCount && value.length > 0 && value.length !== digits;
  return (
    <Field label={label} hint={optional ? `(optional, ${digits} digits)` : `(${digits} digits)`} htmlFor={id}>
      <TextInput
        {...props}
        id={id}
        ref={inputRef}
        icon={icon}
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={counting ? `${id}-count` : undefined}
        value={value}
        onChange={(e) => onValue(clean(e.target.value))}
      />
      {counting && <p id={`${id}-count`} className="text-sm text-muted">{value.length} of {digits} digits</p>}
    </Field>
  );
}
