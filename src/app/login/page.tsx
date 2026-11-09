import { redirect } from "next/navigation";
import { Mark } from "@/components/ui";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Mark />
        <h1 className="mt-4 text-2xl font-semibold">Gyansatr Attendance</h1>
        <p className="mt-1 mb-6 text-muted">Log in with the account given to you.</p>
        <LoginForm />
      </div>
    </main>
  );
}
