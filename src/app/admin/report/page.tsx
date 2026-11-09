import { requirePageRole } from "@/lib/auth";
import { getDayReport, parseDayReportFilters } from "@/lib/day-report";
import { DayReport } from "./day-report";

export default async function ReportPage() {
  await requirePageRole("admin");
  const report = await getDayReport(parseDayReportFilters(new URLSearchParams()), 1);
  return <DayReport initial={JSON.parse(JSON.stringify(report))} />;
}
