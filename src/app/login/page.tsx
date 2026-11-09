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
      <p className="mt-0.5 mb-5 text-muted">Use the account given to you.</p>
      <LoginForm />
    </AuthFrame>
  );
}
