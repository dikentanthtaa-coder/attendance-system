import "server-only";
import ExcelJS from "exceljs";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { writeAudit } from "./attendance";
import { withTransaction } from "./db";
import { normalizeCenter, normalizeMemberId, normalizeMobile, normalizeName, type Gender } from "./shared";

/** Vercel rejects request bodies above 4.5 MB, so check first and give a useful message. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const REQUIRED_COLUMNS = [
  { key: "no", label: "No" },
  { key: "memberid", label: "MemberID" },
  { key: "name", label: "Name" },
  { key: "mono", label: "Mo.no." },
  { key: "gender", label: "Gender" },
  { key: "center", label: "Center" },
] as const;

type ColumnKey = (typeof REQUIRED_COLUMNS)[number]["key"];

export type ImportRowError = {
  row: number;
  memberId: string;
  name: string;
  errors: string[];
};

export type ImportSummary = {
  fileName: string;
  totalRows: number;
  imported: number;
  updated: number;
  errorRows: number;
  errors: ImportRowError[];
};

type ValidRow = {
  row: number;
  id: string | null;
  name: string;
  mobile: string;
  gender: Gender;
  center: string;
};

/** Reads a cell as text, whatever Excel stored it as (number, formula, rich text, hyperlink). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  if ("result" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
  if ("text" in value) return cellText(value.text as ExcelJS.CellValue);
  return "";
}

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ApiError(400, "invalid_file", "This file could not be read. Please upload a valid .xlsx Excel file (older .xls files must be re-saved as .xlsx).");
  }

  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) throw new ApiError(400, "empty_file", "The Excel file is empty.");

  const columns = new Map<ColumnKey, number>();
  const known = new Set<string>(REQUIRED_COLUMNS.map((c) => c.key));
  sheet.getRow(1).eachCell((cell, col) => {
    const key = headerKey(cellText(cell.value));
    if (known.has(key)) columns.set(key as ColumnKey, col);
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !columns.has(c.key)).map((c) => c.label);
  if (missing.length > 0) {
    throw new ApiError(
      400,
      "invalid_columns",
      `Wrong Excel format. Missing column(s): ${missing.join(", ")}. The first row must contain: ${REQUIRED_COLUMNS.map((c) => c.label).join(", ")}.`,
    );
  }

  const read = (row: ExcelJS.Row, key: ColumnKey) => cellText(row.getCell(columns.get(key)!).value);

  const valid: ValidRow[] = [];
  const errors: ImportRowError[] = [];
  let totalRows = 0;
  const seenIds = new Map<string, number>();
  const seenNoId = new Map<string, number>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const rawId = read(row, "memberid");
    const rawName = read(row, "name");
    const rawMobile = read(row, "mono");
    const rawGender = read(row, "gender");
    const rawCenter = read(row, "center");
    if (!rawId && !rawName && !rawMobile && !rawGender && !rawCenter) return; // just a stray "No" or formatting

    totalRows += 1;
    const rowErrors: string[] = [];

    const id = normalizeMemberId(rawId) || null;
    const name = normalizeName(rawName);
    if (!name) rowErrors.push("Name is missing");
    if (name.length > 120) rowErrors.push("Name is too long");
    if (id && id.length > 50) rowErrors.push("MemberID is too long");

    const mobile = normalizeMobile(rawMobile);
    if (!rawMobile) rowErrors.push("Mo.no. is missing");
    else if (!mobile) rowErrors.push(`Mo.no. "${rawMobile}" is not a valid 10-digit number`);

    const genderLower = rawGender.toLowerCase();
    const gender: Gender | null = genderLower === "male" ? "Male" : genderLower === "female" ? "Female" : null;
    if (!gender) rowErrors.push(rawGender ? `Gender "${rawGender}" must be Male or Female` : "Gender is missing");

    const center = normalizeCenter(rawCenter);
    if (!center) rowErrors.push("Center is missing");
    if (center.length > 80) rowErrors.push("Center is too long");

    // A file that lists the same person twice is a mistake the admin should see and fix.
    if (id) {
      const firstRow = seenIds.get(id);
      if (firstRow) rowErrors.push(`MemberID ${id} is repeated (first seen on row ${firstRow})`);
      else if (rowErrors.length === 0) seenIds.set(id, rowNumber);
    } else if (mobile && gender && name) {
      const key = `${name.toLowerCase()}|${mobile}|${gender}`;
      const firstRow = seenNoId.get(key);
      if (firstRow) rowErrors.push(`Same member is repeated (first seen on row ${firstRow})`);
      else if (rowErrors.length === 0) seenNoId.set(key, rowNumber);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, memberId: rawId, name: rawName, errors: rowErrors });
    } else {
      valid.push({ row: rowNumber, id, name, mobile: mobile!, gender: gender!, center });
    }
  });

  if (totalRows === 0) throw new ApiError(400, "empty_file", "The Excel file has no member rows.");
  return { valid, errors, totalRows };
}

export async function importMembers(admin: SessionUser, fileName: string, buffer: ArrayBuffer): Promise<ImportSummary> {
  const { valid, errors, totalRows } = await parseWorkbook(buffer);
  const withId = valid.filter((r) => r.id);
  const withoutId = valid.filter((r) => !r.id);

  const { imported, updated } = await withTransaction(async (tx) => {
    let imported = 0;
    let updated = 0;

    if (withId.length > 0) {
      const rows = tx.json(withId as never);

      // A member first added through Quick Entry without an ID is the same person once
      // the file supplies their ID. Link them, so the upsert below updates them instead
      // of creating a duplicate.
      await tx`
        with t as (
          select * from jsonb_to_recordset(${rows}) as x(id text, name text, mobile text, gender text)
          where not exists (select 1 from members e where e.global_member_id = x.id)
        ),
        pick as (
          select distinct on (t.id) t.id as new_id, m.id as member_id
          from t join members m
            on m.global_member_id is null and m.mobile = t.mobile
           and m.gender = t.gender and lower(m.name) = lower(t.name)
          order by t.id, m.id
        ),
        one_per_member as (
          select distinct on (member_id) new_id, member_id from pick order by member_id, new_id
        )
        update members m set global_member_id = p.new_id
        from one_per_member p where m.id = p.member_id`;

      const result = await tx`
        insert into members (global_member_id, name, mobile, gender, center, created_source, created_by)
        select t.id, t.name, t.mobile, t.gender, t.center, 'excel_import', ${admin.id}
        from jsonb_to_recordset(${rows}) as t(id text, name text, mobile text, gender text, center text)
        on conflict (global_member_id) where global_member_id is not null do update
          set name = excluded.name, mobile = excluded.mobile, gender = excluded.gender,
              center = excluded.center, updated_at = now()
        returning (xmax = 0) as inserted`;
      for (const r of result) {
        if (r.inserted) imported += 1;
        else updated += 1;
      }
    }

    if (withoutId.length > 0) {
      const rows = tx.json(withoutId as never);

      // No MemberID to match on, so re-uploading the same file matches on name + mobile + gender.
      const matched = await tx`
        with t as (
          select * from jsonb_to_recordset(${rows}) as x(name text, mobile text, gender text, center text)
        ),
        pick as (
          select distinct on (t.name, t.mobile, t.gender) m.id, t.center
          from t join members m
            on m.mobile = t.mobile and m.gender = t.gender and lower(m.name) = lower(t.name)
          order by t.name, t.mobile, t.gender, m.id
        )
        update members m set center = p.center, updated_at = now()
        from pick p where m.id = p.id
        returning m.id`;
      updated += matched.count;

      const inserted = await tx`
        insert into members (name, mobile, gender, center, created_source, created_by)
        select t.name, t.mobile, t.gender, t.center, 'excel_import', ${admin.id}
        from jsonb_to_recordset(${rows}) as t(name text, mobile text, gender text, center text)
        where not exists (
          select 1 from members m
          where m.mobile = t.mobile and m.gender = t.gender and lower(m.name) = lower(t.name)
        )
        returning id`;
      imported += inserted.count;
    }

    await writeAudit(tx, admin, "members.excel_upload", null, {
      file_name: fileName,
      total_rows: totalRows,
      imported,
      updated,
      error_rows: errors.length,
    });

    return { imported, updated };
  });

  return { fileName, totalRows, imported, updated, errorRows: errors.length, errors };
}
