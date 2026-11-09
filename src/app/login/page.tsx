import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  return (
    <AuthFrame>
      <h2 className="text-xl font-bold">Log in</h2>
      <p className="mt-0.5 mb-5 text-muted">Welcome back. Enter your details to continue.</p>
      <LoginForm />
      <p className="mt-3 text-center text-sm text-muted">
        New Attendance Officer?{" "}
        <Link href="/register" className="inline-flex min-h-11 items-center font-semibold text-brand underline">Register here</Link>
      </p>
    </AuthFrame>
  );
}
