import { NextResponse } from "next/server";
import { publicRoute, readJson } from "@/lib/api";
import { registerOfficer, registrationSchema } from "@/lib/officers";

// Creates a waiting account only. It can't log in or see anything until Admin approves it.
export const POST = publicRoute(async (req) => {
  await registerOfficer(registrationSchema.parse(await readJson(req)));
  return NextResponse.json({ ok: true }, { status: 201 });
});
