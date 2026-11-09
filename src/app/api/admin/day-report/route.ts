import { adminRoute } from "@/lib/api";
import { getDayReport, parseDayReportFilters } from "@/lib/day-report";

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  return getDayReport(parseDayReportFilters(params), Math.max(1, Number(params.get("page")) || 1));
});
