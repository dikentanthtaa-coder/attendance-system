import { officerRoute, readJson } from "@/lib/api";
import { quickEntry, quickEntrySchema } from "@/lib/attendance";

export const POST = officerRoute(async (officer, req) => {
  return quickEntry(officer, quickEntrySchema.parse(await readJson(req)));
});
