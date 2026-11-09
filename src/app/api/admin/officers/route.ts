import { adminRoute } from "@/lib/api";
import { listOfficers } from "@/lib/officers";

export const GET = adminRoute(async () => listOfficers());
