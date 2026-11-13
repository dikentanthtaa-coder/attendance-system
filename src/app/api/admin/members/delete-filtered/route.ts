import { z } from "zod";
import { adminRoute, readJson } from "@/lib/api";
import { confirmOwnPassword } from "@/lib/confirm-password";
import { deleteFilteredMembers, memberFiltersSchema } from "@/lib/members";

const schema = z.object({
  password: z.string(),
  filters: memberFiltersSchema,
  // How many members Admin saw matching, and agreed to delete.
  expected: z.number().int().nonnegative(),
});

/** Admin deletes every member the current search and filters match, after typing their own password again. */
export const POST = adminRoute(async (admin, req) => {
  const { password, filters, expected } = schema.parse(await readJson(req));
  await confirmOwnPassword(admin.id, password);
  return deleteFilteredMembers(admin, filters, expected);
});
