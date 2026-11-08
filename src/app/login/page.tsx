import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-brand">Gyansatr Attendance</h1>
        <p className="mt-1 mb-5 text-sm text-muted">Log in with the account given to you.</p>
        <LoginForm />
      </div>
    </main>
  );
}
