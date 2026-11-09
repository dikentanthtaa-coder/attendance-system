"use client";

import { useState, type RefObject } from "react";
import { CloudUpload, FileSpreadsheet } from "lucide-react";

/** Drag a file in, or click anywhere to choose one. Holds a real file input, so a form can read it. */
export function FileDrop({
  label,
  accept,
  note,
  fileName,
  inputRef,
  onChange,
}: {
  label: string;
  accept: string;
  note: string;
  fileName: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (fileName: string) => void;
}) {
  const [over, setOver] = useState(false);
  const Icon = fileName ? FileSpreadsheet : CloudUpload;

  const look = over
    ? "border-brand bg-brand-soft"
    : fileName
      ? "border-ok/50 bg-ok-soft"
      : "border-control bg-canvas hover:border-brand hover:bg-brand-soft";

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const input = inputRef.current;
        if (!input || e.dataTransfer.files.length === 0) return;
        input.files = e.dataTransfer.files;
        onChange(e.dataTransfer.files[0].name);
      }}
      className={`flex cursor-pointer flex-col items-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand ${look}`}
    >
      <Icon aria-hidden size={30} className={fileName ? "text-ok" : "text-brand"} />
      <span className="font-semibold break-all">{fileName || "Drag your file here, or click to choose"}</span>
      <span className="text-sm text-muted">{fileName ? "Click to choose a different file" : note}</span>
      <input
        ref={inputRef}
        type="file"
        aria-label={label}
        accept={accept}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")}
      />
    </label>
  );
}
