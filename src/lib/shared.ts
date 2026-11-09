// Types and pure helpers used on both the server and the client.

export type Gender = "Male" | "Female";
export type EventStatus = "not_started" | "active" | "ended";
export type MemberSource = "excel_import" | "quick_entry";
export type AttendanceStatus = "present" | "absent";
export type OfficerStatus = "pending" | "approved" | "rejected";

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

export const STATUS_LABEL: Record<EventStatus, string> = {
  not_started: "Not Started",
  active: "Active",
  ended: "Ended",
};

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
};

export const OFFICER_STATUS_LABEL: Record<OfficerStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "No access",
};

export const SOURCE_LABEL: Record<MemberSource, string> = {
  excel_import: "Excel Import",
  quick_entry: "Quick Entry",
};

export type EventSession = {
  event_day: number;
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
