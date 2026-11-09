import { adminRoute } from "@/lib/api";
import { getReport, parseFilters } from "@/lib/reports";

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  return getReport(parseFilters(params));
});
