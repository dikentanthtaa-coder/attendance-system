"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { Button } from "./button";
import { InstallButton } from "./pwa";

/** The app's mark: three strokes for the three days. */
export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="8" fill="#fff" />
      <path d="M9 10v12M23 10v12" stroke="var(--color-brand)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M16 10v12" stroke="var(--color-accent)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function useLogOut() {
  const router = useRouter();
  return async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };
}

/** `short` is kept for callers; the drawer has room for every full label. */
export type NavLink = { href: string; label: string; short?: string; icon: LucideIcon };

const WIDTH = "max-w-[1600px]";

function Brand({ subtitle, subtitleMore, page }: { subtitle: string; subtitleMore?: string; page?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Logo />
      <div className="min-w-0">
        <p className="truncate text-base leading-tight font-bold">Gyansatr Attendance</p>
        <p className="truncate text-xs text-white/85">
          {subtitle}
          {subtitleMore && <span className="max-sm:hidden"> · {subtitleMore}</span>}
          {/* Where you are, below 1024px, where the page links are in the drawer instead of the header. */}
          {page && <span className="font-semibold text-white lg:hidden"> · {page}</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * The frame every signed-in screen sits in, so all roles share one header and one page width.
 * Large screens show the menu in the header. Phones and tablets keep the header to one short row,
 * with every page, Install app and Log out in a drawer behind the menu button.
 */
export function AppShell({
  subtitle,
  subtitleMore,
  links,
  children,
}: {
  subtitle: string;
  /** Left out of the header on phones, where it would be cut off. The drawer shows it in full. */
  subtitleMore?: string;
  links?: NavLink[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const logOut = useLogOut();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = links?.find((l) => l.href === pathname);

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 bg-brand-deep pt-[env(safe-area-inset-top)] text-white shadow-md">
        <div className={`mx-auto flex min-h-14 w-full items-center gap-3 px-3 py-1.5 md:px-6 lg:min-h-16 lg:gap-6 lg:py-2 ${WIDTH}`}>
          <button
            type="button"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-150 hover:bg-white/15 active:bg-white/25 lg:hidden"
          >
            <Menu aria-hidden size={24} />
          </button>
          <div className="min-w-0 flex-1 lg:flex-none">
            <Brand subtitle={subtitle} subtitleMore={subtitleMore} page={current?.label} />
          </div>

          {links && (
            <nav aria-label="Admin" className="hidden flex-1 gap-1 lg:flex">
              {links.map(({ href, label, icon: Icon }) => {
                const here = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={here ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-2 rounded-control px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ${here ? "bg-white text-brand-dark" : "text-white hover:bg-white/15"}`}
                  >
                    <Icon aria-hidden size={16} className="shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          )}
          <div className={`hidden items-center gap-1 lg:flex ${links ? "" : "ml-auto"}`}>
            <InstallButton variant="on-dark" className="px-3" />
            <Button variant="on-dark" icon={LogOut} className="px-3" onClick={logOut}>Log out</Button>
          </div>
        </div>
      </header>

      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        subtitle={subtitle}
        subtitleMore={subtitleMore}
        links={links}
        pathname={pathname}
        onLogOut={logOut}
      />

      <main className={`mx-auto flex w-full flex-1 flex-col gap-5 px-4 pt-5 pb-10 md:px-6 ${WIDTH}`}>{children}</main>
    </div>
  );
}

function MenuDrawer({
  open,
  onClose,
  subtitle,
  subtitleMore,
  links,
  pathname,
  onLogOut,
}: {
  open: boolean;
  onClose: () => void;
  subtitle: string;
  subtitleMore?: string;
  links?: NavLink[];
  pathname: string;
  onLogOut: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // A native modal dialog keeps focus inside, closes on Escape and hides the page from screen readers.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Grown past the drawer's breakpoint, such as a tablet turned sideways: the header has the menu now.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = () => wide.matches && onClose();
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      aria-label="Menu"
      onClose={onClose}
      // A tap on the dimmed page beside the drawer closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="drawer-in fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,86vw)] max-w-none bg-white p-0 text-ink shadow-xl"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 bg-brand-deep px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-4 text-white">
            <div className="min-w-0 flex-1 pl-1">
              <div className="flex items-center gap-3">
                <Logo />
                <p className="text-base leading-tight font-bold">Gyansatr Attendance</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close menu"
              onClick={onClose}
              className="flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-150 hover:bg-white/15"
            >
              <X aria-hidden size={22} />
            </button>
          </div>

          <div className="border-b border-rule bg-brand-deep px-4 pb-4 text-white">
            <p className="text-xs tracking-wide text-white/70 uppercase">Logged in as</p>
            <p className="text-base font-semibold">{subtitle}</p>
            {subtitleMore && <p className="text-sm text-white/85">{subtitleMore}</p>}
          </div>

          {links && (
            <nav aria-label="Pages" className="flex flex-col gap-1 overflow-y-auto p-3">
              {links.map(({ href, label, icon: Icon }) => {
                const here = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={here ? "page" : undefined}
                    onClick={onClose}
                    className={`flex min-h-12 items-center gap-3 rounded-control px-3 text-base font-semibold transition-colors duration-150 ${here ? "bg-brand-soft text-brand-dark" : "text-ink hover:bg-canvas"}`}
                  >
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-control ${here ? "bg-brand text-white" : "bg-canvas text-brand"}`}>
                      <Icon aria-hidden size={18} />
                    </span>
                    {label}
                  </Link>
                );
              })}
            </nav>
          )}

          <div className="mt-auto flex flex-col gap-2 border-t border-rule p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <InstallButton variant="secondary" className="w-full" />
            <Button variant="danger-outline" icon={LogOut} className="w-full" onClick={onLogOut}>Log out</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
