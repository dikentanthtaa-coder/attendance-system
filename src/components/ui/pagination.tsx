import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

/** 1 … 4 5 6 … 110: always the first and last page, and the pages either side of this one. */
function pageItems(page: number, last: number): (number | "gap")[] {
  const wanted = [...new Set([1, page - 1, page, page + 1, last])].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  wanted.forEach((p, i) => {
    if (i > 0) {
      const gap = p - wanted[i - 1];
      if (gap === 2) items.push(p - 1); // a gap of one page is shorter as the number itself
      else if (gap > 2) items.push("gap");
    }
    items.push(p);
  });
  return items;
}

/** Hides itself when everything fits on one page. */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total <= pageSize) return null;
  const last = Math.ceil(total / pageSize);
  const box = "flex min-h-11 min-w-11 items-center justify-center rounded-control text-sm font-semibold transition-colors duration-150 lg:min-h-9 lg:min-w-9";
  return (
    <div className="flex flex-col items-center gap-3 border-t border-rule px-4 py-3 sm:flex-row sm:justify-between md:px-5">
      <p className="text-sm text-muted">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </p>
      <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-1">
        <Button variant="ghost" size="sm" aria-label="Previous" disabled={page === 1} onClick={() => onPage(page - 1)} className="disabled:text-muted">
          <ChevronLeft aria-hidden size={16} />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        {pageItems(page, last).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} aria-hidden className="flex min-w-6 justify-center text-muted">…</span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPage(item)}
              className={`${box} ${item === page ? "bg-brand text-white" : "text-ink hover:bg-brand-soft"}`}
            >
              {item}
            </button>
          ),
        )}
        <Button variant="ghost" size="sm" aria-label="Next" disabled={page >= last} onClick={() => onPage(page + 1)} className="disabled:text-muted">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight aria-hidden size={16} />
        </Button>
      </nav>
    </div>
  );
}
