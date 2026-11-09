import { redirect } from "next/navigation";
import { CalendarDays, CircleCheck, Search, type LucideIcon } from "lucide-react";
import { Card, Logo } from "@/components/ui";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

const FEATURES: { icon: LucideIcon; text: string }[] = [
  { icon: Search, text: "Find a member by ID, name or mobile" },
  { icon: CircleCheck, text: "Mark them present in one tap" },
  { icon: CalendarDays, text: "Live counts across all three days" },
];

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  return (
    <main className="flex flex-1 flex-col lg:flex-row">
      <div className="bg-brand-deep px-6 pt-10 pb-20 text-white lg:flex lg:w-1/2 lg:items-center lg:justify-center lg:p-16">
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <Logo className="size-12" />
          <h1 className="mt-4 text-3xl font-bold tracking-tight lg:text-4xl">Gyansatr Attendance</h1>
          <p className="mt-1 text-white/85 lg:text-lg">Attendance for the three-day Gyansatr event.</p>
          <ul className="mt-8 hidden flex-col gap-4 lg:flex">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon aria-hidden size={20} className="shrink-0 text-accent" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-10 lg:items-center lg:p-10">
        <Card className="-mt-12 w-full max-w-md p-6 lg:mt-0">
          <h2 className="text-xl font-bold">Log in</h2>
          <p className="mt-0.5 mb-5 text-muted">Use the account given to you.</p>
          <LoginForm />
        </Card>
      </div>
    </main>
  );
}
