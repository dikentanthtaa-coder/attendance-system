import { adminRoute } from "@/lib/api";
import { buildDayReportExport, parseDayReportFilters } from "@/lib/day-report";

export const GET = adminRoute(async (_admin, req) => {
  const { buffer, fileName } = await buildDayReportExport(parseDayReportFilters(new URL(req.url).searchParams));
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
