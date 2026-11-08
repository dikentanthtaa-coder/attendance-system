"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "warning" | "error";
type Toast = { id: number; tone: Tone; message: string };

const ToastContext = createContext<(tone: Tone, message: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const TONES: Record<Tone, { className: string; icon: string }> = {
  success: { className: "bg-ok text-white", icon: "✓" },
  warning: { className: "bg-warn text-white", icon: "!" },
  error: { className: "bg-danger text-white", icon: "✕" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((tone: Tone, message: string) => {
    clearTimeout(timer.current);
    nextId.current += 1;
    setToast({ id: nextId.current, tone, message });
    timer.current = setTimeout(() => setToast(null), tone === "success" ? 2500 : 5000);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && (
          <div
            key={toast.id}
            role="status"
            className={`toast-in flex max-w-md items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${TONES[toast.tone].className}`}
          >
            <span aria-hidden className="font-bold">{TONES[toast.tone].icon}</span>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
