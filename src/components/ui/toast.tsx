"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";

type Tone = "success" | "warning" | "error";
type Toast = { id: number; tone: Tone; message: string };

const ToastContext = createContext<(tone: Tone, message: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const ICONS = {
  success: <CircleCheck aria-hidden size={18} className="shrink-0 text-[#7fd6a5]" />,
  warning: <TriangleAlert aria-hidden size={18} className="shrink-0 text-[#f5c15c]" />,
  error: <CircleAlert aria-hidden size={18} className="shrink-0 text-[#ff9a90]" />,
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

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* At the top, because a phone's keyboard can cover the bottom of the screen. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
        {toast && (
          <div key={toast.id} role="status" className="rise-in flex max-w-md items-center gap-2 rounded-card bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">
            {ICONS[toast.tone]}
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
