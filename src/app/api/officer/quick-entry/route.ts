import { anyUserRoute, readJson } from "@/lib/api";
import { quickEntry, quickEntrySchema } from "@/lib/attendance";

export const POST = anyUserRoute(async (user, req) => {
  return quickEntry(user, quickEntrySchema.parse(await readJson(req)));
});
