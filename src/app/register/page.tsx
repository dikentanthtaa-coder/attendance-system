import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  return (
    <AuthFrame>
      <RegisterForm />
    </AuthFrame>
  );
}
