import { z } from "zod";
import { changePasswordRoute, readJson } from "@/lib/api";
import { homeFor, startSession } from "@/lib/auth";
import { changeOwnPassword } from "@/lib/officers";
import { passwordSchema } from "@/lib/passwords";

const schema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, "New Password and Confirm Password don't match.");

export const POST = changePasswordRoute(async (user, req) => {
  const { password } = schema.parse(await readJson(req));
  const updated = await changeOwnPassword(user, password);
  await startSession(updated);
  return { redirectTo: homeFor(updated) };
});
