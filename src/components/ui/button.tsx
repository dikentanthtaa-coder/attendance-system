import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Spinner } from "./spinner";

const VARIANTS = {
  primary: "bg-brand text-white shadow-xs hover:bg-brand-dark active:bg-brand-deep disabled:bg-active disabled:text-muted disabled:shadow-none",
  success: "bg-ok text-white shadow-xs hover:bg-ok-dark active:bg-ok-dark disabled:bg-active disabled:text-muted disabled:shadow-none",
  secondary: "border border-control bg-white text-ink shadow-xs hover:border-muted hover:bg-canvas active:bg-active disabled:bg-canvas disabled:text-muted disabled:shadow-none",
  danger: "bg-danger text-white shadow-xs hover:bg-danger-dark active:bg-danger-dark disabled:bg-active disabled:text-muted disabled:shadow-none",
  "danger-outline": "border border-danger/50 bg-white text-danger hover:border-danger hover:bg-danger-soft active:bg-danger-soft",
  ghost: "text-brand hover:bg-brand-soft active:bg-active",
  "ghost-danger": "text-muted hover:bg-danger-soft hover:text-danger active:bg-danger-soft",
  "on-dark": "text-white hover:bg-white/15 active:bg-white/25",
} as const;

const SIZES = {
  // Rows are dense on a desktop table, but a phone still needs a 44px target.
  sm: "min-h-11 gap-1.5 px-2.5 text-sm whitespace-nowrap lg:min-h-9",
  md: "min-h-11 gap-2 px-4 text-sm whitespace-nowrap",
  // Large buttons hold full sentences, which may wrap on the narrowest phones.
  lg: "min-h-13 gap-2 px-4 py-2 text-center text-base sm:px-6",
} as const;

const ICON_SIZE = { sm: 15, md: 16, lg: 20 } as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

type Look = { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon };

const look = (variant: ButtonVariant, size: ButtonSize, className: string) =>
  `inline-flex items-center justify-center rounded-control font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`;

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  loading,
  disabled,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & Look & { loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={disabled || loading} className={look(variant, size, className)}>
      {loading ? <Spinner size={ICON_SIZE[size]} /> : Icon && <Icon aria-hidden size={ICON_SIZE[size]} className="shrink-0" />}
      {children}
    </button>
  );
}

/**
 * A link that looks like a button. `native` skips client-side routing, which a file download needs.
 */
export function LinkButton({
  variant = "secondary",
  size = "md",
  icon: Icon,
  native,
  href,
  className = "",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & Look & { href: string; native?: boolean }) {
  const content = (
    <>
      {Icon && <Icon aria-hidden size={ICON_SIZE[size]} className="shrink-0" />}
      {children}
    </>
  );
  const classes = look(variant, size, className);
  if (native) {
    return <a {...props} href={href} className={classes}>{content}</a>;
  }
  return <Link {...props} href={href} className={classes}>{content}</Link>;
}
