import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

/** Hides itself when everything fits on one page. */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3 md:px-5">
      <p className="text-sm text-muted">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" icon={ChevronLeft} disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>
          Next
          <ChevronRight aria-hidden size={16} />
        </Button>
      </div>
    </div>
  );
}
