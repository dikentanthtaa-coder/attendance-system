import { LoaderCircle } from "lucide-react";

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <LoaderCircle aria-hidden size={size} className={`shrink-0 animate-spin ${className}`} />;
}
