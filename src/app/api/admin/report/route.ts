import { adminRoute } from "@/lib/api";
import { getFilterOptions, getRecords, getSummary, PAGE_SIZE, parseFilters } from "@/lib/reports";

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  const filters = parseFilters(params);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [summary, records, options] = await Promise.all([
    getSummary(filters),
    getRecords(filters, page),
    getFilterOptions(),
  ]);
  return { summary, records, options, page, pageSize: PAGE_SIZE };
});
