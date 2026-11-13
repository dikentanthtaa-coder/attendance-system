// Types and pure helpers used on both the server and the client.

export type Gender = "Male" | "Female";
export type EventStatus = "not_started" | "active" | "ended";
export type MemberSource = "excel_import" | "quick_entry";

export const MIN_PASSWORD_LENGTH = 8;

export const CENTERS = [
  "Varachha",
  "Pasodara",
  "Dabholi",
  "Ankleshwar",
  "Bharuch",
  "Navsari",
  "Vapi",
  "Valsad",
  "Kandivali",
  "Navi Mumbai",
  "Pune",
  "Vadodara",
] as const;

/** One day for one person in the report. Absent only exists once the day is over. */
export type DayCell = "P" | "A" | "-";

export function dayCell(status: EventStatus, present: boolean): DayCell {
  if (present) return "P";
  return status === "ended" ? "A" : "-";
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  not_started: "Not Started",
  active: "Active",
  ended: "Ended",
};

/**
 * Where a member came from. Register is the registration list: the Excel upload, or Admin adding
 * someone by hand. Quick Member is someone an officer added at the door with Quick Entry.
 */
export const SOURCE_LABEL: Record<MemberSource, string> = {
  excel_import: "Register",
  quick_entry: "Quick Member",
};

export type EventSession = {
  /** The session's own number: its attendance points to this. */
  event_day: number;
  /** Which day it belongs to. A day can have several sessions, such as Morning and Evening. */
  day_no: number;
  name: string;
  status: EventStatus;
  started_at: string | null;
  ended_at: string | null;
};

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

/** Returns a 10-digit mobile number, accepting +91 / 0 prefixes, or null if invalid. */
export function normalizeMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}

/** What a mobile box shows after typing or pasting: digits only, at most 10, without a +91 or leading 0. */
export function mobileInputValue(raw: string): string {
  return normalizeMobile(raw) ?? raw.replace(/\D/g, "").slice(0, 10);
}

/** New Member IDs are exactly this many digits, like the ones in the registration list. */
export const MEMBER_ID_DIGITS = 6;

export function isMemberIdValid(id: string): boolean {
  return new RegExp(`^\\d{${MEMBER_ID_DIGITS}}$`).test(id);
}

/** What a Member ID box shows after typing or pasting: digits only, at most 6. Leading zeros stay. */
export function memberIdInputValue(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, MEMBER_ID_DIGITS);
}

/** MemberIDs are compared case-insensitively, so they are stored in upper case. */
export function normalizeMemberId(raw: string): string {
  return collapse(raw).toUpperCase();
}

export function normalizeName(raw: string): string {
  return collapse(raw);
}

/** Folds "varachha " onto the listed "Varachha"; other center names are kept as typed. */
export function normalizeCenter(raw: string): string {
  const value = collapse(raw);
  return CENTERS.find((c) => c.toLowerCase() === value.toLowerCase()) ?? value;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC", // the input is already a calendar date
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** All times are shown in IST regardless of the device's or server's timezone. */
export function formatDateTime(value: string | Date | null): string {
  return value ? dateTimeFormat.format(new Date(value)) : "—";
}

export function formatTime(value: string | Date | null): string {
  return value ? timeFormat.format(new Date(value)) : "—";
}

/** Formats a YYYY-MM-DD calendar date. */
export function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`));
}
