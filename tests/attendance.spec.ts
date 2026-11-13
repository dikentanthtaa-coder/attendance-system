import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { SignJWT } from "jose";
import postgres from "postgres";
import { TEST_DB } from "../playwright.config";
import { api, ClientApiError } from "../src/lib/client-api";
import { TEST_PASSWORD } from "./global-setup";

const HEADER = ["No", "MemberID", "Name", "Mo.no.", "Gender", "Center"];
const db = postgres(TEST_DB, { max: 2 });

test.describe.configure({ mode: "serial" });
test.afterAll(() => db.end());

async function xlsx(rows: unknown[][], header = HEADER) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Members");
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const LOGIN_LABEL = "Username";
const OFFICER_NAME = "Male Officer";

// A screen can crash while everything else about it still looks fine, so every test run watches for this.
const pageErrors: string[] = [];

async function loginPage(browser: Browser, username: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ viewport: viewport ?? { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (err) => {
    pageErrors.push(`${username}: ${err.message}`);
    console.log(`PAGE ERROR (${username} at ${page.url()}): ${err.stack ?? err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`CONSOLE ERROR (${username} at ${page.url()}): ${msg.text()}`);
  });
  await page.goto("/login");
  await page.getByLabel(LOGIN_LABEL).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(username === "admin" ? "**/admin" : "**/officer");
  return page;
}

const apiOf = (page: Page) => page.context().request;
/** Log out is in the header on large screens, and in the menu drawer below 1024px. */
const logOutOf = async (page: Page) => {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Log out" }).filter({ visible: true }).click();
};
/** Phones show marking and history one at a time. Large screens show both, with no bar to tap. */
const showView = async (page: Page, name: "Mark" | "History") => {
  const bar = page.getByRole("navigation", { name: "Marking view" });
  if (await bar.isVisible()) await bar.getByRole("button", { name, exact: true }).click();
};
/** Visible boxes you type into that show no placeholder. Dropdowns always show a value instead. */
const missingPlaceholders = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea")]
      .filter((el) => el.offsetParent !== null && !el.closest("[role=combobox], [aria-haspopup]") && el.getAttribute("role") !== "combobox" && !el.placeholder?.trim())
      .map((el) => el.id || el.name || el.outerHTML.slice(0, 60)),
  );
/** `within` can be a dialog, when the page behind it has a field with the same label. */
const pick = async (within: Page | Locator, label: string, option: string) => {
  await within.getByLabel(label, { exact: true }).click();
  await within.getByRole("option", { name: option, exact: true }).click();
};
const upload = (api: APIRequestContext, buffer: Buffer, name = "members.xlsx", password = TEST_PASSWORD) =>
  api.post("/api/admin/members/import", {
    multipart: { file: { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer }, password },
  });
/**
 * An upload replaces the list uploaded before it, so a later file in these tests also lists everyone
 * already uploaded, as Admin's full list would. People `rows` already lists are left out.
 */
const alsoUploaded = async (rows: unknown[][] = []) => {
  const ids = new Set(rows.map((r) => String(r[1])).filter(Boolean));
  const names = new Set(rows.map((r) => String(r[2]).toLowerCase()));
  const members = await db`
    select global_member_id, name, mobile, gender, center from members
    where created_source = 'excel_import' and not added_by_hand order by id`;
  return members
    .filter((m) => !(m.global_member_id && ids.has(m.global_member_id)) && !names.has(m.name.toLowerCase()))
    .map((m) => [0, m.global_member_id ?? "", m.name, m.mobile ?? "", m.gender, m.center]);
};
const setEvent = (api: APIRequestContext, day: number, action: string) =>
  api.post(`/api/admin/events/${day}`, { data: { action } });
const mark = (api: APIRequestContext, memberId: number, eventDay: number, extra: object = {}) =>
  api.post("/api/officer/attendance", { data: { memberId, eventDay, ...extra } });
const logIn = (api: APIRequestContext, username: string, password = TEST_PASSWORD) =>
  api.post("/api/auth/login", { data: { username, password } });
const search = async (api: APIRequestContext, q: string, day = 1) => {
  const res = await api.get(`/api/officer/search?day=${day}&q=${encodeURIComponent(q)}`);
  expect(res.status()).toBe(200);
  return (await res.json()).results as { id: number; name: string; global_member_id: string; mobile: string; gender: string; center: string; present_at: string | null }[];
};
const memberId = async (globalId: string) => (await db`select id from members where global_member_id = ${globalId}`)[0].id as number;
const quick = (api: APIRequestContext, data: object) =>
  api.post("/api/officer/quick-entry", { data: { eventDay: 1, center: "Vapi", ...data } });

let admin: Page, officer: Page, officer2: Page;
let adminApi: APIRequestContext, officerApi: APIRequestContext, officer2Api: APIRequestContext;

test("login: three accounts only, no signup, wrong password refused", async ({ browser, page, request }) => {
  await page.goto("/");
  await page.waitForURL("**/login");
  expect(await missingPlaceholders(page)).toEqual([]);
  await expect(page.getByText(/sign ?up|register/i)).toHaveCount(0);
  expect((await page.goto("/register"))?.status()).toBe(404);
  expect((await request.post("/api/auth/register", { data: { email: "x@y.z", password: "long-enough-1" } })).status()).toBe(404);
  await page.goto("/login");

  // Everything else here would still pass on an unstyled page, so check the styles really load.
  await expect(page.getByRole("button", { name: "Log in" })).toHaveCSS("background-color", "rgb(28, 90, 150)");
  await expect(page.getByLabel(LOGIN_LABEL)).toHaveCSS("min-height", "44px");

  await page.getByLabel(LOGIN_LABEL).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Wrong username or password.")).toBeVisible();

  for (const route of ["/admin", "/officer", "/admin/members", "/admin/officers"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
  }

  admin = await loginPage(browser, "admin");
  officer = await loginPage(browser, "male.officer", { width: 390, height: 844 });
  officer2 = await loginPage(browser, "female.officer");
  [adminApi, officerApi, officer2Api] = [apiOf(admin), apiOf(officer), apiOf(officer2)];
  const accounts = await db`select username, role, gender_scope from app_users where is_active order by username`;
  expect(accounts.map((a) => [a.username, a.role, a.gender_scope])).toEqual([
    ["admin", "admin", null], ["female.officer", "officer", "Female"], ["male.officer", "officer", "Male"],
  ]);
  // The database itself refuses a second active officer for the same gender.
  await expect(db`insert into app_users (username, display_name, password_hash, role, gender_scope, approval_status) values ('extra', 'Extra', 'x', 'officer', 'Male', 'approved')`).rejects.toThrow();

  // First run: the dashboard says what to do first.
  await expect(admin.getByText("No members yet.")).toBeVisible();

  const hash = (await db`select password_hash from app_users where username = 'admin'`)[0].password_hash as string;
  expect(hash).toMatch(/^\$2[aby]\$12\$/);
});

test("reset password: temporary password shown once, every device logged out, and a new password must be chosen", async ({ browser, request }) => {
  const username = "female.officer";
  const [{ id, password_hash: originalHash }] = await db`select id, password_hash from app_users where username = ${username}`;
  const device = await loginPage(browser, username);

  expect((await request.post(`/api/admin/officers/${id}/reset-password`, { data: {} })).status()).toBe(401);
  expect((await officerApi.post(`/api/admin/officers/${id}/reset-password`, { data: {} })).status()).toBe(403);
  const [adminRow] = await db`select id, password_hash from app_users where username = 'admin'`;
  expect((await adminApi.post(`/api/admin/officers/${adminRow.id}/reset-password`, { data: {} })).status()).toBe(404);
  expect((await db`select password_hash from app_users where username = 'admin'`)[0].password_hash).toBe(adminRow.password_hash);

  for (let i = 0; i < 5; i++) await logIn(request, username, "wrong-guess");
  expect((await logIn(request, username)).status()).toBe(429);

  await admin.goto("/admin/officers");
  await admin.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const row = admin.getByRole("region", { name: "Officer list" }).getByRole("listitem").filter({ hasText: "Female Officer" });
  await expect(row).toContainText(username);
  await row.getByRole("button", { name: "Reset password" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Reset Password" }).click();
  const shown = admin.getByTestId("temporary-password");
  await expect(shown).toBeVisible();
  const temporary = (await shown.textContent())!.trim();
  expect(temporary).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/);
  await admin.getByRole("dialog").getByRole("button", { name: "Copy" }).click();
  await expect(admin.getByRole("dialog").getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(temporary);
  await admin.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(shown).toHaveCount(0);

  // The old password and every device stop working at once, and the lockout is cleared.
  expect((await apiOf(device).get("/api/events")).status()).toBe(401);
  await device.waitForURL("**/login", { timeout: 8000 });
  expect((await logIn(request, username)).status()).toBe(401);

  const [stored] = await db`select password_hash, must_change_password from app_users where id = ${id}`;
  expect(stored.password_hash).toMatch(/^\$2[aby]\$12\$/);
  expect(stored.must_change_password).toBe(true);
  expect((await db`select count(*)::int as n from audit_log where details::text like ${`%${temporary}%`}`)[0].n).toBe(0);

  // With the temporary password, the only thing they can do is choose a new one.
  await device.getByLabel(LOGIN_LABEL).fill(username);
  await device.getByLabel("Password", { exact: true }).fill(temporary);
  await device.getByRole("button", { name: "Log in" }).click();
  await device.waitForURL("**/change-password");
  const api = apiOf(device);
  const blocked = await api.get("/api/events");
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe("password_change_required");
  await device.goto("/officer");
  await expect(device).toHaveURL(/\/change-password$/);

  const change = (password: string, confirmPassword = password) => api.post("/api/auth/change-password", { data: { password, confirmPassword } });
  expect((await change("short")).status()).toBe(400);
  expect((await change("long-enough-1", "long-enough-2")).status()).toBe(400);
  expect((await (await change(temporary)).json()).code).toBe("same_password");

  const fresh = "my-own-password-9";
  expect(await missingPlaceholders(device)).toEqual([]);
  await device.getByLabel("New Password").fill(fresh);
  await device.getByLabel("Confirm Password").fill(fresh);
  await device.getByRole("button", { name: "Save New Password" }).click();
  await device.waitForURL("**/officer");
  expect((await apiOf(device).get("/api/events")).status()).toBe(200);
  expect((await logIn(request, username, temporary)).status()).toBe(401);
  expect((await logIn(request, username, fresh)).status()).toBe(200);
  await device.context().close();

  // Put things back for the tests that follow. The earlier session is logged out by this reset.
  await db`update app_users set password_hash = ${originalHash} where id = ${id}`;
  officer2 = await loginPage(browser, username);
  officer2Api = apiOf(officer2);

  // A session issued before this feature existed, with no version in it, still works.
  const old = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(adminRow.id).setIssuedAt().setExpirationTime("1d")
    .sign(new TextEncoder().encode("test-only-secret-test-only-secret-test-only"));
  expect((await request.get("/api/events", { headers: { Cookie: `att_session=${old}` } })).status()).toBe(200);
});

test("permissions are enforced on the server for every role", async ({ request }) => {
  // Anonymous
  expect((await request.get("/api/admin/report")).status()).toBe(401);
  expect((await request.get("/api/officer/search?day=1&q=a")).status()).toBe(401);
  expect((await request.post("/api/officer/attendance", { data: { memberId: 1, eventDay: 1 } })).status()).toBe(401);
  // Officer on admin endpoints
  expect((await officerApi.get("/api/admin/report")).status()).toBe(403);
  expect((await setEvent(officerApi, 1, "start")).status()).toBe(403);
  expect((await upload(officerApi, await xlsx([]))).status()).toBe(403);
  expect((await officerApi.delete("/api/admin/members/1")).status()).toBe(403);
  expect((await officerApi.post("/api/admin/attendance/1/cancel", { data: { reason: "x" } })).status()).toBe(403);
  // Admin can use the marking screen too, so these are open to Admin.
  expect((await adminApi.get("/api/officer/search?day=1&q=a")).status()).toBe(200);
  // Officer pages redirect away from admin
  await officer.goto("/admin");
  await expect(officer).toHaveURL(/\/officer$/);
  // A forged cookie gets nowhere
  const forged = await request.get("/api/admin/report", {
    headers: { Cookie: "att_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0." },
  });
  expect(forged.status()).toBe(401);
});

test("Excel upload: wrong format gets a clear error", async () => {
  const res = await upload(adminApi, await xlsx([[1, "1", "A", "9000000000", "Male", "Vapi"]], ["No", "MemberID", "Name", "Phone", "Gender"]));
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.message).toContain("Mo.no.");
  expect(body.message).toContain("Center");

  expect((await upload(adminApi, Buffer.from("not an excel file"))).status()).toBe(400);
  expect((await upload(adminApi, await xlsx([]), "members.xls")).status()).toBe(400);
  expect((await upload(adminApi, await xlsx([]))).status()).toBe(400);
});

test("Excel upload in the UI: summary, invalid row details, and no duplicates on re-upload", async () => {
  const rows = [
    [1, 2051, "Ramesh Patel", 9876500001, "Male", "Varachha"],
    [2, 2052, "Raju Pandya", "98765 00002", "male", "varachha "],
    [3, 2053, "Radha Patel", "+91 98765 00003", "Female", "Pune"],
    [4, 3001, "Suresh Shah", "09876500004", "Male", "Bharuch"],
    [5, "", "No Id Man", "9876500005", "Male", "Vapi"],
    [6, 3002, "Bad Gender", "9876500006", "X", "Vapi"],
    [7, 3003, "Bad Mobile", "12345", "Male", "Vapi"],
    [8, 3004, "", "9876500008", "Female", "Vapi"],
    [9, 2051, "Repeat Row", "9876500009", "Male", "Vapi"],
  ];
  await admin.goto("/admin/members");
  await admin.getByLabel("Excel file").setInputFiles({
    name: "members.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await xlsx(rows),
  });
  // With no members yet, the upload box is already open.
  await expect(admin.getByRole("button", { name: "Upload file" })).toBeVisible();
  await admin.getByRole("button", { name: "Upload file" }).click();
  const summary = admin.getByTestId("import-summary");
  await expect(summary).toBeVisible();
  await expect(summary.locator("dd")).toHaveText(["9", "5", "0", "0", "4"]);
  // Once the list is in, the upload form goes and Add Member takes its place. The result stays to read.
  await expect(admin.getByRole("button", { name: "Upload file" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Add Member" })).toBeVisible();
  await expect(summary).toContainText('Gender "X" must be M, F, Male or Female');
  await expect(summary).toContainText("not a valid 10-digit number");
  await expect(summary).toContainText("Name is missing");
  await expect(summary).toContainText("repeated (first seen on row 2)");

  // Numbers typed differently all normalize; a listed center's casing is folded.
  const [raju] = await db`select mobile, center, gender from members where global_member_id = '2052'`;
  expect(raju).toMatchObject({ mobile: "9876500002", center: "Varachha", gender: "Male" });

  const before = (await db`select count(*)::int as n from members`)[0].n;
  const changed = [
    [1, 2051, "Ramesh K Patel", 9876500001, "Male", "Varachha"],
    [2, "", "No Id Man", "9876500005", "Male", "Navsari"],
  ];
  const again = await (await upload(adminApi, await xlsx([...changed, ...(await alsoUploaded(changed))]))).json();
  expect(again).toMatchObject({ totalRows: 5, imported: 0, updated: 5, removed: 0, errorRows: 0 });
  expect((await db`select count(*)::int as n from members`)[0].n).toBe(before);
  expect((await db`select name from members where global_member_id = '2051'`)[0].name).toBe("Ramesh K Patel");
  expect((await db`select center from members where name = 'No Id Man'`)[0].center).toBe("Navsari");
});

test("Excel upload: real-world files with M and F, and people with no mobile number", async () => {
  const rows = [
    [1, 6001, "Mita Letter", 9876560001, "F", "Vapi"],
    [2, 6002, "Mohan Letter", 9876560002, "M", "Vapi"],
    [3, 6003, "Lower Case", 9876560003, "f", "Vapi"],
    [4, 6004, "No Mobile Id", "", "M", "Vapi"],
    [5, "", "No Mobile Noid", "", "F", "Vapi"],
    [6, "", "No Mobile Noid", "", "F", "Vapi"], // listed twice, so it's a mistake to show
    [7, 6007, "Wrong Number", "12345", "M", "Vapi"], // a wrong number is still an error
  ];
  const earlier = await alsoUploaded(rows);
  const first = await (await upload(adminApi, await xlsx([...rows, ...earlier], ["No", "MemberID", "Name", "Mo.no", "Gender", "Center"]))).json();
  expect(first).toMatchObject({ totalRows: 7 + earlier.length, imported: 5, updated: earlier.length, removed: 0, errorRows: 2 });
  expect(first.errors.map((e: { row: number }) => e.row)).toEqual([7, 8]);
  expect(first.errors[0].errors[0]).toContain("repeated");
  expect(first.errors[1].errors[0]).toContain("not a valid 10-digit number");

  const saved = await db`select name, gender, mobile from members where name in ('Mita Letter', 'Mohan Letter', 'Lower Case', 'No Mobile Id', 'No Mobile Noid') order by name`;
  expect(saved.map((m) => [m.name, m.gender, m.mobile])).toEqual([
    ["Lower Case", "Female", "9876560003"],
    ["Mita Letter", "Female", "9876560001"],
    ["Mohan Letter", "Male", "9876560002"],
    ["No Mobile Id", "Male", null],
    ["No Mobile Noid", "Female", null],
  ]);

  // Uploading the same file again adds nobody, even those with neither an ID nor a number.
  const count = async () => (await db`select count(*)::int as n from members`)[0].n;
  const before = await count();
  const again = await (await upload(adminApi, await xlsx([...rows, ...earlier]))).json();
  expect(again).toMatchObject({ imported: 0, updated: 5 + earlier.length, removed: 0, errorRows: 2 });
  expect(await count()).toBe(before);

  // A blank in a later file doesn't erase a number already on record.
  const blank = [[1, 6001, "Mita Letter", "", "F", "Vapi"]];
  await upload(adminApi, await xlsx([...blank, ...(await alsoUploaded(blank))]));
  expect((await db`select mobile from members where global_member_id = '6001'`)[0].mobile).toBe("9876560001");

  // Someone with no number can still be found, edited and shown on every screen.
  const none = await memberId("6004");
  await admin.goto("/admin/members");
  await admin.getByLabel("Search members").fill("No Mobile Id");
  const row = admin.getByRole("row").filter({ hasText: "No Mobile Id" });
  await expect(row).toContainText("—");
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog.getByLabel("Mobile Number")).toHaveValue("");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByRole("status")).toContainText("Member updated");
  expect((await db`select mobile from members where id = ${none}`)[0].mobile).toBeNull();
  const badEdit = await adminApi.patch(`/api/admin/members/${none}`, { data: { globalMemberId: "600400", name: "No Mobile Id", mobile: "123", gender: "Male", center: "Vapi" } });
  expect(badEdit.status()).toBe(400);
});

test("attendance is refused before the event starts, and officers see all three days", async () => {
  const id = await memberId("2051");
  const res = await mark(officerApi, id, 1);
  expect(res.status()).toBe(409);
  expect((await res.json()).code).toBe("event_not_active");
  expect((await quick(officerApi, { name: "Too Early", mobile: "9000000001" })).status()).toBe(409);
  expect((await db`select count(*)::int as n from members where name = 'Too Early'`)[0].n).toBe(0);

  await officer.goto("/officer");
  const days = officer.getByRole("navigation", { name: "Event days" }).getByRole("button");
  await expect(days).toHaveCount(3);
  await expect(days.nth(0)).toContainText("Not Started");
  await expect(officer.getByLabel(/Search by Member ID/)).toHaveCount(0);
});

test("only one event can be active, including when two starts race", async () => {
  const results = await Promise.all([setEvent(adminApi, 1, "start"), setEvent(adminApi, 2, "start"), setEvent(adminApi, 3, "start")]);
  const statuses = results.map((r) => r.status()).sort();
  expect(statuses).toEqual([200, 409, 409]);
  const active = await db`select event_day from event_sessions where status = 'active'`;
  expect(active.length).toBe(1);
  // Normalize to Day 1 for the remaining tests.
  if (active[0].event_day !== 1) {
    await setEvent(adminApi, active[0].event_day, "end");
    await db`update event_sessions set status = 'not_started', started_at = null, ended_at = null, started_by = null, ended_by = null where event_day <> 1`;
    expect((await setEvent(adminApi, 1, "start")).status()).toBe(200);
  }
  const blocked = await setEvent(adminApi, 2, "start");
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).code).toBe("another_event_active");
});

test("search: partial ID and mobile, and names by the start of each name in order, within the officer's gender", async () => {
  const ids = (await search(officerApi, "205")).map((r) => r.global_member_id);
  expect(ids).toEqual(["2051", "2052"]); // 2053 is Female
  expect((await search(officer2Api, "205")).map((r) => r.global_member_id)).toEqual(["2053"]);

  expect((await search(officerApi, "ra pa")).map((r) => r.global_member_id)).toEqual(expect.arrayContaining(["2051", "2052"]));
  expect((await search(officerApi, "ram pat")).map((r) => r.name)).toEqual(["Ramesh K Patel"]);
  expect((await search(officerApi, "RAM PAT")).length).toBe(1);
  expect(await search(officerApi, "radha")).toEqual([]);

  // The example from real use: "jay kan" must not find Jay... or Kan... in the wrong place.
  const add = async (id: string, name: string, mobile: string) => {
    await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values (${id}, ${name}, ${mobile}, 'Male', 'Vapi', 'excel_import')`;
  };
  await add("7101", "Jayantibhai Popatbhai Kanani", "9876571001");
  await add("7102", "Monal Jaytibhai Kanani", "9876571002");
  await add("7103", "Vijaybhai Gangjibhai Kanjariya", "9876571003");
  await add("7104", "Jay Kanani", "9876571004");
  await add("7105", "Jayesh Patel", "9876571005");
  const names = async (q: string) => (await search(officerApi, q)).map((r) => r.name).sort();
  expect(await names("jay kan")).toEqual(["Jay Kanani", "Jayantibhai Popatbhai Kanani"]); // first and last
  expect(await names("JAY  KAN")).toEqual(["Jay Kanani", "Jayantibhai Popatbhai Kanani"]);
  expect(await names("jay pop kan")).toEqual(["Jayantibhai Popatbhai Kanani"]); // first, middle and last
  expect(await names("jay kan pop")).toEqual([]); // out of order
  expect(await names("kan jay")).toEqual([]);
  expect(await names("mon jay kan")).toEqual(["Monal Jaytibhai Kanani"]);
  expect(await names("vij kan")).toEqual(["Vijaybhai Gangjibhai Kanjariya"]);
  // One piece alone starts any word, with first names listed first, but never matches mid-word.
  const single = (await search(officerApi, "jay")).map((r) => r.name);
  expect(single.slice(0, 3).sort()).toEqual(["Jay Kanani", "Jayantibhai Popatbhai Kanani", "Jayesh Patel"]);
  expect(single).toContain("Monal Jaytibhai Kanani");
  expect(single).not.toContain("Vijaybhai Gangjibhai Kanjariya");
  // Admin's member list follows the same rule.
  const listed = await (await adminApi.get("/api/admin/members?q=jay%20kan")).json();
  expect(listed.members.map((m: { name: string }) => m.name).sort()).toEqual(["Jay Kanani", "Jayantibhai Popatbhai Kanani"]);

  const byMobile = await search(officerApi, "500004");
  expect(byMobile.map((r) => r.name)).toEqual(["Suresh Shah"]);
  expect(await search(officerApi, "500003")).toEqual([]); // Radha's number, wrong officer

  const [row] = await search(officerApi, "3001");
  expect(row).toMatchObject({ global_member_id: "3001", name: "Suresh Shah", mobile: "9876500004", center: "Bharuch" });

  // Punctuation and SQL are treated as plain text.
  for (const q of ["%", "_", "' or 1=1 --", ".*", "(", "[a", "\\"]) expect(await search(officerApi, q)).toEqual([]);
});

test("mark attendance through the UI on a phone, then Already Present", async () => {
  await officer.goto("/officer");
  const box = officer.getByLabel(/Search by Member ID/);
  await box.fill("300");
  const row = officer.getByRole("region", { name: "Search results" }).getByRole("listitem").filter({ hasText: "Suresh Shah" });
  await expect(row).toContainText("9876500004");
  await expect(row).toContainText("Bharuch");
  await row.getByRole("button", { name: "Mark Present" }).click();
  const confirmation = officer.getByRole("status");
  await expect(confirmation).toContainText("Present: Suresh Shah");
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  // The keyboard stays open for the next person, so the confirmation has to sit above where it opens.
  const box2 = (await confirmation.boundingBox())!;
  expect(box2.y + box2.height).toBeLessThan(844 * 0.5);

  await box.fill("3001");
  await expect(officer.getByRole("region", { name: "Search results" }).getByRole("listitem").filter({ hasText: "Suresh Shah" })).toContainText("Already Present");

  const [record] = await db`
    select a.event_day, a.marked_at, u.username, a.status from attendance a
    join app_users u on u.id = a.marked_by join members m on m.id = a.member_id
    where m.global_member_id = '3001'`;
  expect(record).toMatchObject({ event_day: 1, username: "male.officer", status: "present" });
  expect(record.marked_at).toBeInstanceOf(Date);
});

test("Enter marks only when there is exactly one match", async () => {
  await officer.goto("/officer");
  const box = officer.getByLabel(/Search by Member ID/);
  await box.fill("205");
  await expect(officer.getByRole("button", { name: "Mark Present" })).toHaveCount(2);
  await box.press("Enter");
  await expect(officer.getByRole("status")).toHaveCount(0);
  expect((await db`select count(*)::int as n from attendance a join members m on m.id=a.member_id where m.global_member_id in ('2051','2052')`)[0].n).toBe(0);

  await box.fill("2051");
  await expect(officer.getByRole("button", { name: "Mark Present" })).toHaveCount(1);
  await box.press("Enter");
  await expect(officer.getByRole("status")).toContainText("Present: Ramesh K Patel");
});

test("an officer cannot mark a member of the other gender, even with a forged request", async () => {
  const radha = await memberId("2053");
  const res = await mark(officerApi, radha, 1);
  expect(res.status()).toBe(404);
  expect((await db`select count(*)::int as n from attendance where member_id = ${radha}`)[0].n).toBe(0);
  expect((await mark(officer2Api, radha, 1)).status()).toBe(200);
  expect((await mark(officer2Api, await memberId("2052"), 1)).status()).toBe(404);
});

test("Present only: no Absent option anywhere, and an officer can never undo Present", async () => {
  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values ('4001', 'Late Lalit', '9876540001', 'Male', 'Vapi', 'excel_import')`;
  const late = await memberId("4001");
  await officer.goto("/officer");
  await expect(officer.getByRole("button", { name: /Absent/ })).toHaveCount(0);
  await expect(officer.getByText(/absent/i)).toHaveCount(0);
  await officer.getByLabel(/Search by Member ID/).fill("4001");
  const row = officer.getByRole("region", { name: "Search results" }).getByRole("listitem").filter({ hasText: "Late Lalit" });
  await expect(row.getByRole("button")).toHaveCount(1);
  const markButton = row.getByRole("button", { name: "Mark Present" });
  await expect(markButton).toHaveText("Mark");
  const size = (await markButton.boundingBox())!;
  expect(size.width).toBeLessThan(100); // small enough to leave the name its room, on every screen
  expect(size.height).toBeGreaterThanOrEqual(36); // and still easy to tap
  expect(size.height).toBeLessThanOrEqual(40);
  expect(Number.parseFloat(await markButton.evaluate((e) => getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThanOrEqual(size.height / 2); // fully round
  await officer.screenshot({ path: "test-results/screens/officer-mark-phone.png" });

  // A forged "absent" is ignored: the request can only ever record Present.
  expect((await (await mark(officerApi, late, 1, { status: "absent" })).json()).status).toBe("marked");
  expect((await db`select status from attendance where member_id = ${late} and event_day = 1`)[0].status).toBe("present");
  expect((await (await mark(officerApi, late, 1, { status: "absent" })).json()).status).toBe("already_present");
  expect((await db`select status from attendance where member_id = ${late} and event_day = 1`)[0].status).toBe("present");

  await officer.getByLabel(/Search by Member ID/).fill("");
  await officer.getByLabel(/Search by Member ID/).fill("4001");
  await expect(row).toContainText("Already Present");
  await expect(row.getByRole("button")).toHaveCount(0);

  // Officers have no way to remove attendance at all.
  const [record] = await db`select id from attendance where member_id = ${late} and event_day = 1`;
  expect((await officerApi.post(`/api/admin/attendance/${record.id}/cancel`, { data: { reason: "x" } })).status()).toBe(403);
  expect((await officerApi.delete(`/api/admin/members/${late}`)).status()).toBe(403);
});

test("the Area dropdown narrows the search, and keeps within the officer's gender", async () => {
  const add = async (id: string, name: string, mobile: string, center: string, gender = "Male") => {
    await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values (${id}, ${name}, ${mobile}, ${gender}, ${center}, 'excel_import')`;
  };
  await add("8201", "Area Puneman", "9876582001", "Pune");
  await add("8202", "Area Vapiman", "9876582002", "Vapi");
  await add("8203", "Area Surat", "9876582003", "Surat");
  await add("8204", "Area Herself", "9876582004", "Nashik", "Female");

  await officer.goto("/officer");
  const area = officer.getByRole("combobox", { name: "Area", exact: true });
  await expect(area).toHaveText("All Areas");
  await area.click();
  const options = await officer.getByRole("option").allTextContents();
  expect(options[0]).toBe("All Areas");
  expect(options).toEqual(expect.arrayContaining(["Pune", "Vapi", "Surat"]));
  expect(options).not.toContain("Nashik"); // only the other gender is there
  await officer.getByRole("option", { name: "Pune", exact: true }).click();
  await officer.screenshot({ path: "test-results/screens/officer-area.png" });

  // Search stays inside the chosen area, and changing the area updates results already showing.
  const box = officer.getByLabel(/Search by Member ID/);
  await box.fill("Area P");
  await expect(officer.getByRole("region", { name: "Search results" })).toContainText("Area Puneman");
  await box.fill("Area V");
  await expect(officer.getByText("No member matches “Area V” in Pune")).toBeVisible();
  await area.click();
  await officer.getByRole("option", { name: "Vapi", exact: true }).click();
  const results = officer.getByRole("region", { name: "Search results" });
  await expect(results).toContainText("Area Vapiman");

  // Marking keeps the area for the next person, and Quick Entry starts with it filled in.
  await results.getByRole("button", { name: "Mark Present" }).click();
  await expect(officer.getByRole("status")).toContainText("Present: Area Vapiman");
  await expect(area).toHaveText("Vapi");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  await expect(officer.getByRole("region", { name: "Quick Entry" }).getByLabel("Center", { exact: true })).toHaveValue("Vapi");
  await officer.getByRole("button", { name: "Back to search" }).click();
  await expect(area).toHaveText("Vapi");

  await area.click();
  await officer.getByRole("option", { name: "All Areas" }).click();
  await expect(area).toHaveText("All Areas");

  // On the server: the area can't get around the gender limit, and odd values are harmless.
  const get = async (path: string) => (await officerApi.get(path)).json();
  expect((await get("/api/officer/unmarked?day=1&center=Nashik")).total).toBe(0);
  expect((await get("/api/officer/search?day=1&q=Area&center=Nashik")).results).toEqual([]);
  expect((await get(`/api/officer/unmarked?day=1&center=${encodeURIComponent("' or 1=1 --")}`)).total).toBe(0);
  expect((await officerApi.get("/api/officer/unmarked?day=1")).status()).toBe(200);

  // Admin covers every area.
  await admin.goto("/admin/mark");
  await admin.getByRole("combobox", { name: "Area", exact: true }).click();
  await expect(admin.getByRole("option", { name: "Nashik", exact: true })).toBeVisible();
  await admin.keyboard.press("Escape");
});

test("one login works on five devices at once, with no errors, and they all stay in step", async ({ browser }) => {
  const add = async (id: string, name: string, mobile: string) => {
    await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values (${id}, ${name}, ${mobile}, 'Male', 'Vapi', 'excel_import')`;
    return memberId(id);
  };
  const viewports = [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 412, height: 915 }];
  const devices = await Promise.all(viewports.map((v) => loginPage(browser, "male.officer", v)));

  // Every device is logged in and working at the same time.
  for (const d of devices) {
    await expect(d.getByRole("banner")).toContainText("Male Officer");
    expect((await apiOf(d).get("/api/events")).status()).toBe(200);
  }

  // Each device marks a different person, at the same moment.
  const ids = await Promise.all([0, 1, 2, 3, 4].map((i) => add(`810${i}`, `Device Person${i}`, `987658100${i}`)));
  const results = await Promise.all(devices.map((d, i) => mark(apiOf(d), ids[i], 1)));
  expect(results.map((r) => r.status())).toEqual([200, 200, 200, 200, 200]);
  expect((await db`select count(*)::int as n from attendance where member_id = any(${ids})`)[0].n).toBe(5);

  // All five tap the same person: it's saved once, and nobody gets an error.
  const shared = await add("8110", "Device Shared", "9876581100");
  const taps = await Promise.all(devices.map((d) => mark(apiOf(d), shared, 1)));
  expect(taps.map((r) => r.status())).toEqual([200, 200, 200, 200, 200]);
  const bodies = await Promise.all(taps.map((r) => r.json()));
  expect(bodies.filter((b) => b.status === "marked").length).toBe(1);
  expect(bodies.filter((b) => b.status === "already_present").length).toBe(4);

  // On the screen, a device that's behind sees "Already Present", not an error.
  const [a, b] = devices;
  await a.getByLabel(/Search by Member ID/).fill("8120");
  await add("8120", "Device Both", "9876581200");
  await a.getByLabel(/Search by Member ID/).fill("Device Both");
  const button = a.getByRole("region", { name: "Search results" }).getByRole("button", { name: "Mark Present" });
  await expect(button).toBeVisible();
  await mark(apiOf(b), await memberId("8120"), 1);
  await button.click();
  await expect(a.getByRole("status")).toContainText("Already Present");

  // Totals reach every device by themselves, within one refresh.
  const total = (await db`select count(*)::int as n from attendance a join app_users u on u.id = a.marked_by where a.event_day = 1 and a.status = 'present' and u.username = 'male.officer'`)[0].n;
  for (const d of devices) await expect(d.getByTestId("stat-my-present")).toHaveText(String(total), { timeout: 8000 });

  // Logging out on one device leaves the others logged in.
  await logOutOf(devices[4]);
  await devices[4].waitForURL("**/login");
  for (const d of devices.slice(0, 4)) expect((await apiOf(d).get("/api/events")).status()).toBe(200);

  // A sixth device can still log in with everything else running.
  const sixth = await loginPage(browser, "male.officer");
  expect((await apiOf(sixth).get("/api/events")).status()).toBe(200);
  for (const d of [...devices, sixth]) await d.context().close();
});

test("duplicate attendance is impossible, including simultaneous taps", async () => {
  const id = await memberId("2052");
  const results = await Promise.all(Array.from({ length: 8 }, () => mark(officerApi, id, 1)));
  const bodies = await Promise.all(results.map((r) => r.json()));
  expect(results.every((r) => r.status() === 200)).toBe(true);
  expect(bodies.filter((b) => b.status === "marked").length).toBe(1);
  expect(bodies.filter((b) => b.status === "already_present").length).toBe(7);
  expect((await db`select count(*)::int as n from attendance where member_id = ${id}`)[0].n).toBe(1);
});

test("Quick Entry through the UI: gender automatic, attendance automatic, duplicate-mobile warning", async () => {
  await officer.goto("/officer");
  await officer.getByLabel(/Search by Member ID/).fill("Kiran Desai");
  await expect(officer.getByText("No member matches")).toBeVisible();
  await officer.getByRole("button", { name: /Quick Entry/ }).click();

  const dialog = officer.getByRole("region", { name: "Quick Entry" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Kiran Desai");
  await expect(dialog).toContainText("saved as Male");
  await expect(dialog.getByLabel(/gender/i)).toHaveCount(0);

  // Searchable dropdown
  const center = dialog.getByLabel("Center", { exact: true });
  await center.click();
  await expect(dialog.getByRole("option")).toHaveCount(13);
  await center.fill("nav");
  await expect(dialog.getByRole("option")).toHaveText(["Navsari", "Navi Mumbai", "Other"]);
  await dialog.getByRole("option", { name: "Navsari" }).click();
  await expect(center).toHaveValue("Navsari");

  // 9876500003 belongs to Radha. The warning names her and blocks saving until answered.
  await dialog.getByLabel("Mobile Number").fill("9876500003");
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Aa mobile number aa member sathe already registered chhe.");
  await expect(alert).toContainText("Radha Patel");
  await expect(dialog.getByRole("button", { name: "Save & Mark Present" })).toBeDisabled();

  await alert.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByLabel("Mobile Number")).toHaveValue("");

  await dialog.getByLabel("Mobile Number").fill("9876500003");
  await dialog.getByRole("alert").getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Save & Mark Present" }).click();
  await expect(officer.getByRole("status")).toContainText("Added and marked present: Kiran Desai");

  const [kiran] = await db`
    select m.gender, m.created_source, m.center, m.mobile, a.event_day, a.status
    from members m join attendance a on a.member_id = m.id where m.name = 'Kiran Desai'`;
  expect(kiran).toMatchObject({ gender: "Male", created_source: "quick_entry", center: "Navsari", event_day: 1, status: "present" });
  // Existing member untouched
  const [radha] = await db`select name, gender, center from members where global_member_id = '2053'`;
  expect(radha).toMatchObject({ name: "Radha Patel", gender: "Female", center: "Pune" });
  expect((await db`select count(*)::int as n from members where mobile = '9876500003'`)[0].n).toBe(2);
});

test("Quick Entry mobile number: digits only and exactly 10", async () => {
  await officer.goto("/officer");
  const search = officer.getByLabel(/Search by Member ID/);
  await search.fill("Nisha Joshi");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  const panel = officer.getByRole("region", { name: "Quick Entry" });
  const box = panel.getByLabel("Mobile Number");
  expect(await missingPlaceholders(officer)).toEqual([]);

  // Letters and symbols don't appear, and typing stops at 10 digits.
  await box.pressSequentially("98a76-5 43210 99");
  await expect(box).toHaveValue("9876543210");

  // A pasted number loses its country code or leading 0, instead of being cut off wrongly.
  await box.fill("+91 98765 43211");
  await expect(box).toHaveValue("9876543211");
  await box.fill("098765 43212");
  await expect(box).toHaveValue("9876543212");

  // Too short: says how many were entered, goes back to the box, and saves nothing.
  await box.fill("98765");
  await expect(panel).toContainText("5 of 10 digits");
  await panel.getByRole("button", { name: "Save & Mark Present" }).click();
  await expect(panel.getByRole("alert")).toContainText("Mobile number must be 10 digits. You entered 5.");
  await expect(box).toBeFocused();
  expect((await db`select count(*)::int as n from members where name = 'Nisha Joshi'`)[0].n).toBe(0);

  // The message and the count go away once the number is complete.
  await box.fill("9876543213");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel).not.toContainText("of 10 digits");

  // Global Member ID: optional, but when filled in, exactly 6 digits.
  const idBox = panel.getByLabel("Global Member ID");
  await idBox.pressSequentially("20a6-3 83 99");
  await expect(idBox).toHaveValue("206383");
  await idBox.fill("2063");
  await expect(panel).toContainText("4 of 6 digits");
  await panel.getByLabel("Center", { exact: true }).click();
  await panel.getByRole("option", { name: "Vapi" }).click();
  await panel.getByRole("button", { name: "Save & Mark Present" }).click();
  await expect(panel.getByRole("alert")).toContainText("Member ID must be 6 digits. You entered 4.");
  await expect(idBox).toBeFocused();
  expect((await db`select count(*)::int as n from members where name = 'Nisha Joshi'`)[0].n).toBe(0);
  await idBox.fill("098765");
  await expect(panel).not.toContainText("of 6 digits");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to search" }).click();

  // A short ID searched for arrives in the box, with the count showing.
  await search.fill("2063");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  await expect(idBox).toHaveValue("2063");
  await expect(panel).toContainText("4 of 6 digits");
  await panel.getByRole("button", { name: "Back to search" }).click();

  // A long number searched for arrives in the box as its 10 digits.
  await search.fill("919876543214");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  await expect(box).toHaveValue("9876543214");

  // The server refuses a wrong length even if the screen is bypassed, and never stores a prefix.
  for (const mobile of ["987654321", "98765432101", "abcdefghij"]) {
    const refused = await quick(officer2Api, { name: "Wrong Length", mobile });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toContain("10-digit");
  }
  expect((await db`select count(*)::int as n from members where name = 'Wrong Length'`)[0].n).toBe(0);
  for (const globalMemberId of ["2063", "2063831", "20638A", "20 6383"]) {
    const refused = await quick(officer2Api, { name: "Wrong Id", mobile: "9876543216", globalMemberId });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toContain("6 digits");
  }
  expect((await db`select count(*)::int as n from members where name = 'Wrong Id'`)[0].n).toBe(0);
  const leadingZero = await quick(officer2Api, { name: "Leading Zero", mobile: "9876543217", globalMemberId: "098766" });
  expect(leadingZero.status()).toBe(200);
  expect((await db`select global_member_id from members where name = 'Leading Zero'`)[0].global_member_id).toBe("098766");
  const prefixed = await quick(officer2Api, { name: "Prefixed Number", mobile: "+91 98765 43215" });
  expect(prefixed.status()).toBe(200);
  expect((await db`select mobile from members where name = 'Prefixed Number'`)[0].mobile).toBe("9876543215");
});

test("Quick Entry checks the Member ID while typing, like the mobile number, for every role", async () => {
  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values
    ('700001', 'Idowner Male', '9876547001', 'Male', 'Surat', 'excel_import'),
    ('700002', 'Idowner Female', '9876547002', 'Female', 'Surat', 'excel_import')`;
  await officer.goto("/officer");
  await officer.getByLabel(/Search by Member ID/).fill("Nobody Newname");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  const panel = officer.getByRole("region", { name: "Quick Entry" });
  const idBox = panel.getByLabel(/Global Member ID/);
  const save = panel.getByRole("button", { name: "Save & Mark Present" });

  // Nothing is said until all 6 digits are in.
  await idBox.fill("70000");
  await expect(panel).toContainText("5 of 6 digits");
  await expect(panel.getByRole("alert")).toHaveCount(0);

  // Taken by someone this officer can see: named, with a way to find them, and saving is blocked.
  await idBox.fill("700001");
  const alert = panel.getByRole("alert");
  await expect(alert).toContainText("Member ID 700001 already belongs to Idowner Male.");
  await expect(save).toBeDisabled();
  await officer.screenshot({ path: "test-results/screens/quick-entry-id-taken.png", fullPage: true });

  // Taken by someone of the other gender: not named.
  await idBox.fill("700002");
  await expect(alert).toContainText("Member ID 700002 is already in use.");
  await expect(alert).not.toContainText("Idowner Female");
  await expect(alert.getByRole("button", { name: "Find this member" })).toHaveCount(0);

  // A free ID clears it.
  await idBox.fill("700003");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(save).toBeEnabled();

  // Find this member goes back to the search with the ID typed in.
  await idBox.fill("700001");
  await panel.getByRole("alert").getByRole("button", { name: "Find this member" }).click();
  await expect(officer.getByLabel(/Search by Member ID/)).toHaveValue("700001");
  await expect(officer.getByRole("region", { name: "Search results" })).toContainText("Idowner Male");

  // Every role gets the check. Admin, who covers everyone, sees the owner's name whatever their gender.
  const check = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/officer/check-duplicate?memberId=${id}`)).json()).memberIdTaken;
  expect(await check(adminApi, "700002")).toEqual({ name: "Idowner Female" });
  expect(await check(officer2Api, "700002")).toEqual({ name: "Idowner Female" });
  expect(await check(officerApi, "700002")).toEqual({ name: null });
  expect(await check(officerApi, "700009")).toBeNull();
  expect(await check(officerApi, "7000")).toBeNull(); // only a complete ID is checked
});

test("Admin adds a member by hand: checked like Quick Entry, saved as Register, not marked present", async () => {
  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values ('400100', 'Family Head', '9876540001', 'Female', 'Surat', 'excel_import')`;
  await admin.goto("/admin/members");
  await admin.getByRole("button", { name: "Add Member" }).click();
  const dialog = admin.getByRole("dialog", { name: "Add member" });
  await expect(dialog.getByLabel("Name")).toBeVisible();
  expect(await missingPlaceholders(admin)).toEqual([]);

  await dialog.getByLabel("Name").fill("Hand Added");
  const mobile = dialog.getByLabel("Mobile Number");
  await mobile.pressSequentially("98a76-54 00 02 9");
  await expect(mobile).toHaveValue("9876540002");
  await pick(dialog, "Gender", "Female");
  await dialog.getByLabel("Center", { exact: true }).click();
  await dialog.getByRole("option", { name: "Vapi" }).click();
  const id = dialog.getByLabel("Global Member ID");
  await id.fill("40020");
  await expect(dialog).toContainText("5 of 6 digits");
  await dialog.getByRole("button", { name: "Add Member" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Member ID must be 6 digits. You entered 5.");
  await id.fill("400200");
  await dialog.getByRole("button", { name: "Add Member" }).click();
  await expect(admin.getByRole("status")).toContainText("Added: Hand Added");
  await expect(dialog).toBeHidden();
  const [added] = await db`select id, global_member_id, mobile, gender, center, created_source from members where name = 'Hand Added'`;
  expect(added).toMatchObject({ global_member_id: "400200", mobile: "9876540002", gender: "Female", center: "Vapi", created_source: "excel_import" });
  expect((await db`select count(*)::int as n from attendance where member_id = ${added.id}`)[0].n).toBe(0);
  await admin.getByLabel("Search members").fill("Hand Added");
  await expect(admin.getByRole("row").filter({ hasText: "Hand Added" })).toContainText("Register");

  // A shared mobile asks first, and Add anyway adds them.
  await admin.getByRole("button", { name: "Add Member" }).click();
  await dialog.getByLabel("Name").fill("Family Child");
  await dialog.getByLabel("Mobile Number").fill("9876540001");
  await pick(dialog, "Gender", "Male");
  await dialog.getByLabel("Center", { exact: true }).click();
  await dialog.getByRole("option", { name: "Vapi" }).click();
  await dialog.getByRole("button", { name: "Add Member" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Family Head");
  await dialog.getByRole("button", { name: "Add anyway" }).click();
  await expect(admin.getByRole("status")).toContainText("Added: Family Child");

  // The server: the same person twice, a taken ID, and no gender are refused. Officers can't add.
  const post = (data: object) => adminApi.post("/api/admin/members", { data: { center: "Vapi", gender: "Male", ...data } });
  const twice = await post({ name: "hand added", mobile: "9876540002", gender: "Female", confirmDuplicate: true });
  expect(twice.status()).toBe(409);
  expect((await twice.json()).code).toBe("member_exists");
  const taken = await post({ name: "Other Person", mobile: "9876540003", globalMemberId: "400100" });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).message).toContain("Family Head");
  expect((await post({ name: "No Gender", mobile: "9876540004", gender: undefined })).status()).toBe(400);
  expect((await post({ name: "Short Id", globalMemberId: "4001" })).status()).toBe(400);
  const noMobile = await post({ name: "Nobody Mobile" });
  expect(noMobile.status()).toBe(200);
  expect((await officerApi.post("/api/admin/members", { data: { name: "X", gender: "Male", center: "Vapi" } })).status()).toBe(403);
  await db`delete from members where name in ('Hand Added', 'Family Child', 'Family Head', 'Nobody Mobile')`;
});

test("Quick Entry on the server: forged gender ignored, confirmation required, Other center, ID collisions", async () => {
  const noConfirm = await quick(officer2Api, { name: "Family Member", mobile: "9876500004" });
  expect(noConfirm.status()).toBe(409);
  const body = await noConfirm.json();
  expect(body.code).toBe("duplicate_mobile");
  expect(body.matches).toEqual(["Suresh Shah"]);
  expect((await db`select count(*)::int as n from members where name = 'Family Member'`)[0].n).toBe(0);

  const forged = await quick(officer2Api, { name: "Family Member", mobile: "9876500004", confirmDuplicateMobile: true, gender: "Male", center: "Surat" });
  expect(forged.status()).toBe(200);
  expect((await db`select gender, center from members where name = 'Family Member'`)[0]).toMatchObject({ gender: "Female", center: "Surat" });

  // Member ID already taken by the other gender: refused without naming them.
  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values ('300100', 'Id Owner', '9876530010', 'Male', 'Vapi', 'excel_import')`;
  const taken = await quick(officer2Api, { name: "X", mobile: "9000000002", globalMemberId: "300100" });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).message).not.toContain("Id Owner");
  // Taken within the same gender: names them so the officer can search instead.
  const taken2 = await quick(officerApi, { name: "X", mobile: "9000000002", globalMemberId: "300100" });
  expect((await taken2.json()).message).toContain("Id Owner");

  for (const bad of [{ name: "", mobile: "9000000003" }, { name: "Y", mobile: "123" }, { name: "Y", mobile: "9000000003", center: "" }]) {
    expect((await quick(officerApi, bad)).status()).toBe(400);
  }
  // Admin covers everyone, so Admin has to choose a gender.
  expect((await quick(adminApi, { name: "Y", mobile: "9000000003" })).status()).toBe(400);

  // A later Excel file supplying an ID links to the Quick Entry member instead of duplicating.
  const ok = await quick(officerApi, { name: "Later Linked", mobile: "9000000004" });
  expect(ok.status()).toBe(200);
  const linkRow = [[1, "7001", "later linked", "9000000004", "Male", "Vapi"]];
  const others = await alsoUploaded(linkRow);
  const res = await (await upload(adminApi, await xlsx([...linkRow, ...others]))).json();
  expect(res).toMatchObject({ imported: 0, updated: 1 + others.length, removed: 0 });
  const linked = await db`select global_member_id, created_source from members where mobile = '9000000004'`;
  expect(linked.length).toBe(1);
  expect(linked[0]).toMatchObject({ global_member_id: "7001", created_source: "quick_entry" });
});

test("totals and history: each officer sees their own and the whole, and a new mark appears by itself", async () => {
  const dbCount = async (username?: string) => (await db`
    select count(*)::int as n from attendance a join app_users u on u.id = a.marked_by
    where a.event_day = 1 and a.status = 'present' ${username ? db`and u.username = ${username}` : db``}`)[0].n as number;
  const add = async (id: string, name: string, mobile: string, gender: string) => {
    const [{ id: memberRow }] = await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values (${id}, ${name}, ${mobile}, ${gender}, 'Pune', 'excel_import') returning id`;
    return memberRow as number;
  };

  const counts = async (api: APIRequestContext) => (await (await api.get("/api/events")).json()).counts["1"];
  const mine = await counts(officerApi);
  expect(mine).toEqual({ present: await dbCount(), myPresent: await dbCount("male.officer") });
  const other = await counts(officer2Api);
  expect(other).toEqual({ present: await dbCount(), myPresent: await dbCount("female.officer") });

  await add("4004", "History Hari", "9876540004", "Male");
  await mark(officer2Api, await add("4005", "Others Olga", "9876540005", "Female"), 1);

  await officer.goto("/officer");
  await expect(officer.getByTestId("stat-my-present")).toHaveText(String(mine.myPresent));
  await expect(officer.getByTestId("stat-all-present")).toHaveText(String(mine.present + 1));

  // An officer's history shows their own gender only, with no choice to see more.
  await showView(officer, "History");
  const history = officer.getByRole("region", { name: "Attendance history" });
  await expect(history).toContainText("Suresh Shah");
  await expect(history).not.toContainText("Others Olga");
  await expect(history).not.toContainText("Radha");
  await expect(officer.getByRole("combobox", { name: "Marked by" })).toHaveCount(0);
  await expect(history.getByRole("button", { name: /^Remove/ })).toHaveCount(0); // only Admin can remove a mark
  const allParam = await (await officerApi.get("/api/officer/history?day=1&scope=all")).json();
  expect(allParam.records.every((r: { gender: string }) => r.gender === "Male")).toBe(true);

  // Marking someone puts them in the table below, and updates the figures, without a reload.
  await showView(officer, "Mark");
  await officer.getByLabel(/Search by Member ID/).fill("4004");
  await officer.getByRole("region", { name: "Search results" }).getByRole("button", { name: "Mark Present" }).click();
  await expect(officer.getByRole("status")).toContainText("Present: History Hari");
  await expect(officer.getByTestId("stat-my-present")).toHaveText(String(mine.myPresent + 1));
  await showView(officer, "History");
  const newest = history.getByRole("listitem").first();
  await expect(newest).toContainText("History Hari");
  await expect(newest).toContainText("You");
  await officer.screenshot({ path: "test-results/screens/officer-history-phone.png", fullPage: true });

  // Removed by Admin: gone from the history, with the totals following.
  const [record] = await db`select a.id from attendance a join members m on m.id = a.member_id where m.name = 'History Hari'`;
  expect((await adminApi.post(`/api/admin/attendance/${record.id}/cancel`, { data: { reason: "test" } })).status()).toBe(200);
  await expect(history).not.toContainText("History Hari", { timeout: 8000 });
  await showView(officer, "Mark");
  expect((await mark(officerApi, await memberId("4004"), 1)).status()).toBe(200);
  expect((await officerApi.get("/api/officer/history?day=0")).status()).toBe(400);

  // Admin: every officer's own total, the entire total, and one click to their history.
  await admin.goto("/admin");
  const table = admin.getByRole("region", { name: "Attendance by officer" });
  await expect(table.getByRole("row").filter({ hasText: "Male Officer" }).first().getByRole("cell").nth(1)).toHaveText(String(await dbTotal("male.officer")));
  await expect(admin.getByTestId("officer-totals")).toContainText(String(await dbTotal()));
  await admin.screenshot({ path: "test-results/screens/admin-by-officer.png", fullPage: true });

  // The list of every mark is gone from the Dashboard. Choosing an officer narrows the numbers and the export.
  await expect(admin.getByRole("region", { name: "Attendance records" })).toHaveCount(0);
  await expect(table.getByRole("button", { name: /View history/ })).toHaveCount(0);
  await pick(admin, "Marked by", "Female Officer");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await dbTotal("female.officer")));

  await admin.getByRole("button", { name: "Clear filters" }).click();
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await dbTotal()));

  async function dbTotal(username?: string) {
    return (await db`
      select count(*)::int as n from attendance a join app_users u on u.id = a.marked_by
      where a.status = 'present' ${username ? db`and u.username = ${username}` : db``}`)[0].n as number;
  }
});

test("Mark Present is offered without searching, with page numbers, for Admin only", async () => {
  const add = async (id: string, name: string, mobile: string, gender = "Male") => {
    await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values (${id}, ${name}, ${mobile}, ${gender}, 'Vapi', 'excel_import')`;
    return memberId(id);
  };
  await add("5001", "Aaru First", "9876550001");
  const second = await add("5002", "Aaditi Second", "9876550002", "Female");
  await add("5003", "Aarohi Third", "9876550003", "Female");
  const statusOf = async (id: number) => (await db`select status from attendance where member_id = ${id} and event_day = 1`)[0]?.status;

  // Officers find people by search only: no list, and Quick Entry is full width and filled.
  await officer.goto("/officer");
  await expect(officer.getByLabel(/Search by Member ID/)).toBeVisible();
  await expect(officer.getByRole("region", { name: "Not marked yet" })).toHaveCount(0);
  const quick = officer.getByRole("button", { name: /Quick Entry/ });
  await expect(quick).toHaveText("Quick Entry: add new member");
  await expect(quick).toHaveCSS("background-color", "rgb(28, 90, 150)");
  const searchCard = (await officer.getByRole("region", { name: /^Mark attendance for/ }).boundingBox())!;
  expect(Math.abs((await quick.boundingBox())!.width - searchCard.width)).toBeLessThan(2);
  await officer.getByLabel(/Search by Member ID/).fill("5001");
  await expect(officer.getByRole("region", { name: "Search results" })).toContainText("Aaru First");
  await officer.screenshot({ path: "test-results/screens/officer-no-list.png", fullPage: true });

  // Admin: a tab and a shortcut to the same screen. Like officers, Admin finds people by search, with no list.
  await admin.goto("/admin");
  await admin.getByRole("main").getByRole("link", { name: "Mark Attendance" }).click();
  await admin.waitForURL("**/admin/mark");
  await expect(admin.getByRole("heading", { name: /^Marking Gyansatra Day/ })).toHaveCount(1);
  await expect(admin.getByRole("button", { name: /Absent/ })).toHaveCount(0);
  await expect(admin.getByRole("region", { name: "Not marked yet" })).toHaveCount(0);
  // The area names still arrive, for narrowing a search.
  await pick(admin, "Area", "Varachha");
  await pick(admin, "Area", "All Areas");
  await admin.getByLabel(/Search by Member ID/).fill("5002");
  const row = admin.getByRole("region", { name: "Search results" }).getByRole("listitem").filter({ hasText: "Aaditi Second" });
  await row.getByRole("button", { name: "Mark Present" }).click();
  await expect(admin.getByRole("status")).toContainText("Present: Aaditi Second");
  await admin.screenshot({ path: "test-results/screens/admin-mark.png", fullPage: true });
  expect(await statusOf(second)).toBe("present");
  const adminHistory = admin.getByRole("region", { name: "Attendance history" });
  await expect(adminHistory.getByRole("listitem").filter({ hasText: "Aaditi Second" })).toContainText("You");

  // It counts for Admin in the reports, so the officers' totals still add up to the whole.
  await admin.goto("/admin");
  const table = admin.getByRole("region", { name: "Attendance by officer" });
  await expect(table.getByRole("row").filter({ hasText: /^Admin/ }).getByRole("cell").nth(1)).toHaveText("1");

  expect((await officer.goto("/admin/mark"))?.url()).toMatch(/\/officer$/);
});

test("pages arrive with their numbers already in them, not placeholders to fill in", async () => {
  // Read the page as first sent by the server, before any of its scripts have run.
  const html = async (api: APIRequestContext, path: string) => {
    const res = await api.get(path);
    expect(res.status()).toBe(200);
    return res.text();
  };
  const dashboard = await html(adminApi, "/admin");
  expect(dashboard).not.toContain("animate-pulse");
  expect(dashboard).toContain('data-testid="stat-total"');
  const total = (await db`select count(*)::int as n from attendance where status = 'present'`)[0].n;
  expect(dashboard).toMatch(new RegExp(`data-testid="stat-total"[^>]*>${total}<`));
  expect(dashboard).toContain("Total Users");
  expect(dashboard).not.toContain("Attendance report");

  const members = await html(adminApi, "/admin/members");
  expect(members).not.toContain("animate-pulse");
  expect(members).toContain("Suresh Shah");

  const officers = await html(adminApi, "/admin/officers");
  expect(officers).not.toContain("animate-pulse");
  expect(officers).toContain(OFFICER_NAME);
  expect(officers).toContain("female.officer");

  for (const [api, path] of [[officerApi, "/officer"], [adminApi, "/admin/mark"]] as const) {
    const desk = await html(api, path);
    expect(desk).not.toContain("animate-pulse");
    expect(desk).not.toContain("Not marked yet");
    expect(desk).toContain('data-testid="stat-my-present"');
  }
});

test("Quick Entry won't add someone who already exists, checked by name and mobile", async () => {
  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values ('8401', 'Twin Name', '9876584001', 'Male', 'Vapi', 'excel_import')`;
  const count = async () => (await db`select count(*)::int as n from members`)[0].n as number;
  const before = await count();

  // On the server: the same name and mobile is refused, however it's typed, even when "confirmed".
  for (const data of [{ name: "Twin Name", mobile: "9876584001" }, { name: " twin  NAME ", mobile: "+91 98765 84001", confirmDuplicateMobile: true }]) {
    const res = await quick(officerApi, data);
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("member_exists");
  }
  // Across genders it's refused too, without naming someone this officer can't see.
  const other = await quick(officer2Api, { name: "Twin Name", mobile: "9876584001", confirmDuplicateMobile: true });
  expect(other.status()).toBe(409);
  expect((await other.json()).message).not.toContain("Twin");

  // Only the name matching asks first.
  const nameOnly = await quick(officerApi, { name: "Twin Name", mobile: "9876584002" });
  expect(nameOnly.status()).toBe(409);
  const nameBody = await nameOnly.json();
  expect(nameBody.code).toBe("duplicate_name");
  expect(nameBody.nameMatches[0]).toMatchObject({ name: "Twin Name", memberId: "8401", center: "Vapi" });
  expect(await count()).toBe(before);

  // On the screen, while typing.
  await officer.goto("/officer");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  const panel = officer.getByRole("region", { name: "Quick Entry" });
  const save = panel.getByRole("button", { name: "Save & Mark Present" });
  await panel.getByLabel("Name").fill("twin name");
  await expect(panel.getByRole("alert")).toContainText("Aa naam no member already registered chhe.");
  await expect(panel.getByRole("alert")).toContainText("8401");
  await expect(save).toBeDisabled();
  await panel.getByLabel("Mobile Number").fill("9876584001");
  const exact = panel.getByRole("alert");
  await expect(exact).toContainText("already exists");
  await expect(exact.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(save).toBeDisabled();
  await officer.screenshot({ path: "test-results/screens/quick-entry-exists-phone.png" });

  // One tap goes to the person who's already there, ready to mark.
  await exact.getByRole("button", { name: "Find this member" }).click();
  await expect(officer.getByLabel(/Search by Member ID/)).toHaveValue("Twin Name");
  await expect(officer.getByRole("region", { name: "Search results" })).toContainText("8401");

  // A different person who shares a name can still be added, once the officer has confirmed.
  await officer.getByLabel(/Search by Member ID/).fill("");
  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  await panel.getByLabel("Name").fill("Twin Name");
  await panel.getByLabel("Mobile Number").fill("9876584009");
  await panel.getByRole("alert").getByRole("button", { name: "Continue" }).click();
  await panel.getByLabel("Center", { exact: true }).click();
  await panel.getByRole("option", { name: "Vapi" }).click();
  await save.click();
  await expect(officer.getByRole("status")).toContainText("Added and marked present: Twin Name");
  expect(await count()).toBe(before + 1);
  await db`delete from attendance where member_id in (select id from members where name = 'Twin Name')`;
  await db`delete from members where name = 'Twin Name'`;
});

test("each officer only ever sees their own gender's names, on every list", async () => {
  const names = async (api: APIRequestContext, path: string) => (await (await api.get(path)).json());
  for (const [api, gender] of [[officerApi, "Male"], [officer2Api, "Female"]] as const) {
    const list = await names(api, "/api/officer/unmarked?day=1");
    expect(list.members.length).toBeGreaterThan(0);
    expect(list.members.every((m: { gender: string }) => m.gender === gender)).toBe(true);
    const found = await names(api, "/api/officer/search?day=1&q=a");
    expect(found.results.every((m: { gender: string }) => m.gender === gender)).toBe(true);
    const history = await names(api, "/api/officer/history?day=1&scope=all");
    expect(history.records.every((m: { gender: string }) => m.gender === gender)).toBe(true);
    const totalOfGender = (await db`
      select count(*)::int as n from members m where m.gender = ${gender} and not exists (
        select 1 from attendance a where a.member_id = m.id and a.event_day = 1 and a.status = 'present')`)[0].n;
    expect(list.total).toBe(totalOfGender);
  }
});

test("ending the event stops marking at once, and the officer's screen locks by itself", async () => {
  await officer.goto("/officer");
  await expect(officer.getByLabel(/Search by Member ID/)).toBeVisible();

  await admin.goto("/admin");
  const card = admin.getByRole("article").filter({ hasText: "Gyansatra Day 1" });
  await card.getByRole("button", { name: "End Event" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "End Event" }).click();
  await expect(card).toContainText("Ended");

  // The server refuses straight away, before any screen has refreshed.
  const res = await mark(officerApi, await memberId("2051"), 1);
  expect(res.status()).toBe(409);
  expect((await quick(officerApi, { name: "Too Late", mobile: "9000000009" })).status()).toBe(409);

  await expect(officer.getByLabel(/Search by Member ID/)).toHaveCount(0, { timeout: 8000 });
  await expect(officer.getByText("This event has ended")).toBeVisible();
  // The day's totals and history stay readable after it ends.
  await showView(officer, "History");
  await expect(officer.getByRole("region", { name: "Attendance history" })).toContainText("Suresh Shah");
  await showView(officer, "Mark");
});

test("each day's attendance is separate, and the officer follows the newly active day", async () => {
  expect((await setEvent(adminApi, 2, "start")).status()).toBe(200);
  await expect(officer.getByLabel(/Search by Member ID/)).toBeVisible({ timeout: 8000 });
  await expect(officer.getByRole("heading", { name: "Marking Gyansatra Day 2" })).toBeVisible();

  const id = await memberId("3001");
  expect((await (await mark(officerApi, id, 2)).json()).status).toBe("marked");
  // A stale screen still pointed at Day 1 can't write to it.
  expect((await mark(officerApi, id, 1)).status()).toBe(409);
  const days = await db`select event_day from attendance where member_id = ${id} order by 1`;
  expect(days.map((d) => d.event_day)).toEqual([1, 2]);

  // A Quick Entry member from Day 1 can be found on Day 2.
  expect((await search(officerApi, "kiran", 2)).length).toBe(1);
});

test("dashboard: totals respond to filters and match the database", async () => {
  await admin.goto("/admin");
  const count = async (where: string) => (await db.unsafe(`
    select count(*)::int as n from attendance a join members m on m.id = a.member_id
    where a.status = 'present' ${where}`))[0].n as number;

  await expect(admin.getByTestId("stat-male")).toHaveText(String(await count("and m.gender='Male'")));
  await expect(admin.getByTestId("stat-female")).toHaveText(String(await count("and m.gender='Female'")));
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("")));

  await pick(admin, "Event", "Gyansatra Day 2");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and a.event_day=2")));
  await pick(admin, "Event", "All Days");

  await pick(admin, "Gender", "Female");
  await expect(admin.getByTestId("stat-male")).toHaveText("0");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.gender='Female'")));
  await pick(admin, "Gender", "All");

  await pick(admin, "Center", "Bharuch");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.center='Bharuch'")));
  await pick(admin, "Center", "All Centers");

  await pick(admin, "Member source", "Quick Member");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.created_source='quick_entry'")));
  await expect(admin.getByTestId("stat-quick")).toHaveText(String(await count("and m.created_source='quick_entry'")));
  await pick(admin, "Member source", "All");

  await expect(admin.getByText(/absent/i)).toHaveCount(0);

  // Each card: the total first, and how many of them are present below it.
  const [m] = await db`
    select count(*)::int as total, count(*) filter (where gender = 'Male')::int as male,
           count(*) filter (where gender = 'Female')::int as female,
           count(*) filter (where created_source = 'quick_entry')::int as quick
    from members`;
  await expect(admin.getByTestId("stat-members")).toHaveText(String(m.total));
  await expect(admin.getByTestId("stat-members-male")).toHaveText(String(m.male));
  await expect(admin.getByTestId("stat-members-female")).toHaveText(String(m.female));
  await expect(admin.getByTestId("stat-members-quick")).toHaveText(String(m.quick));
  await expect(admin.getByTestId("stat-quick")).toHaveText(String(await count("and m.created_source='quick_entry'")));
  const cards = (await admin.getByRole("region", { name: "Summary" }).innerText()).replace(/\s+/g, " ");
  expect(cards).toMatch(/Total Users \d+ \d+ Combined attendees/);
  expect(cards).toMatch(/Total Male \d+ \d+ Present Male/);
  expect(cards).toMatch(/Total Female \d+ \d+ Present Female/);
  expect(cards).toMatch(/Total Quick Members \d+ \d+ Present Quick Members/);
  // By event day: a column chart whose numbers match the database, with the exact figure on hover,
  // a table for plain numbers, and no Excel export on the Dashboard any more.
  await expect(admin.getByRole("link", { name: "Export to Excel" })).toHaveCount(0);
  const chart = admin.getByRole("region", { name: "Event day-wise attendance" });
  const day1 = await db`
    select count(*) filter (where m.gender = 'Male')::int as male, count(*) filter (where m.gender = 'Female')::int as female
    from attendance a join members m on m.id = a.member_id where a.status = 'present' and a.event_day = 1`;
  const maleCol = chart.getByRole("button", { name: new RegExp(`^Day 1, .*: ${day1[0].male} male$`) });
  await expect(maleCol).toHaveCount(1);
  await expect(chart.getByRole("button", { name: new RegExp(`^Day 1, .*: ${day1[0].female} female$`) })).toHaveCount(1);
  await maleCol.hover();
  await expect(chart.getByRole("tooltip")).toContainText(String(day1[0].male));
  await expect(chart.getByRole("tooltip")).toContainText("Male · Day 1");
  await expect(chart.getByRole("img", { name: /% male \(\d+\), \d+% female/ })).toBeVisible();
  await chart.getByRole("button", { name: "Show table" }).click();
  await expect(chart.getByRole("row").filter({ hasText: "Gyansatra Day 1" })).toContainText(String(day1[0].male + day1[0].female));
  await chart.getByRole("button", { name: "Show chart" }).click();
  await pick(admin, "Gender", "Male");
  await expect(chart.getByRole("button", { name: / female$/ })).toHaveCount(0);
  await expect(chart.getByRole("list", { name: "Legend" })).toHaveCount(0);
  await pick(admin, "Gender", "All");
  for (const width of [320, 768]) {
    await admin.setViewportSize({ width, height: 900 });
    await expect(chart.getByRole("button", { name: / male$/ }).first()).toBeVisible();
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await admin.setViewportSize({ width: 1280, height: 900 });

  // The totals follow the member filters too.
  await pick(admin, "Gender", "Female");
  await expect(admin.getByTestId("stat-members-male")).toHaveText("0");
  await expect(admin.getByTestId("stat-members")).toHaveText(String(m.female));
  await pick(admin, "Gender", "All");
});

test("dropdowns: not the browser's own, and work by mouse and keyboard", async () => {
  await admin.goto("/admin");
  const scope = admin.getByRole("region", { name: "Filters" });
  await expect(scope.locator("select")).toHaveCount(0);
  const gender = admin.getByRole("combobox", { name: "Gender", exact: true });
  const list = admin.getByRole("listbox");
  const selected = list.getByRole("option", { selected: true });

  // Mouse: opens, marks the current choice, and a click elsewhere closes it unchanged.
  await gender.click();
  await expect(gender).toHaveAttribute("aria-expanded", "true");
  await expect(selected).toHaveText("All");
  await admin.getByRole("heading", { name: "Dashboard" }).click();
  await expect(list).toHaveCount(0);
  await expect(gender).toHaveText("All");

  // Clicking the label opens it, as with a normal field.
  await scope.getByText("Gender", { exact: true }).click();
  await expect(list).toBeVisible();
  await admin.keyboard.press("Escape");
  await expect(list).toHaveCount(0);

  // Keyboard: arrows and Enter choose; Escape leaves the value alone; letters jump to a match.
  await gender.focus();
  await admin.keyboard.press("ArrowDown");
  await admin.keyboard.press("ArrowDown");
  await admin.keyboard.press("Enter");
  await expect(gender).toHaveText("Male");
  await expect(gender).toBeFocused();
  await expect(admin.getByTestId("stat-female")).toHaveText("0");
  await admin.keyboard.press("Enter");
  await expect(selected).toHaveText("Male");
  await admin.keyboard.press("ArrowDown");
  await admin.keyboard.press("Escape");
  await expect(gender).toHaveText("Male");
  await admin.keyboard.press("f");
  await admin.keyboard.press("Enter");
  await expect(gender).toHaveText("Female");
  await admin.getByRole("button", { name: "Clear filters" }).click();
  await expect(gender).toHaveText("All");

  // Open dropdowns stay on screen, with nothing covering them.
  await gender.click();
  await expect(list).toHaveCSS("opacity", "1");
  await admin.screenshot({ path: "test-results/screens/dropdown-desktop.png" });
  const box = (await list.boundingBox())!;
  const viewport = admin.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await admin.keyboard.press("Escape");

  // Inside a pop-up: a scrolling dialog must not clip it, and Escape closes only the list.
  await admin.goto("/admin/members");
  await admin.getByRole("row").filter({ hasText: "Ramesh K Patel" }).getByRole("button", { name: "Edit" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Gender", { exact: true }).click();
  await expect(dialog.getByRole("option", { name: "Female" })).toBeVisible();
  const hit = await dialog.getByRole("option", { name: "Female" }).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
  });
  expect(hit).toBe(true);
  await expect(dialog.getByRole("listbox")).toHaveCSS("opacity", "1");
  await admin.screenshot({ path: "test-results/screens/dropdown-dialog.png" });
  await admin.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // A saved center that isn't on the list opens as Other, with its name kept.
  await db`update members set center = 'Rajkot' where global_member_id = '2051'`;
  await admin.reload();
  await admin.getByRole("row").filter({ hasText: "Ramesh K Patel" }).getByRole("button", { name: "Edit" }).click();
  await expect(dialog.getByLabel("Center", { exact: true })).toHaveValue("Other");
  await expect(dialog.getByLabel("Center name")).toHaveValue("Rajkot");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByRole("status")).toContainText("Member updated");
  expect((await db`select center from members where global_member_id = '2051'`)[0].center).toBe("Rajkot");
  await db`update members set center = 'Varachha' where global_member_id = '2051'`;
});

test("the P/A report: one column per day, A filled in when a day ends, and all three merged at the end", async () => {
  // At this point Day 1 has ended and Day 2 is running. Suresh was marked on both days.
  const events = await db`select event_day, status from event_sessions order by 1`;
  expect(events.map((e) => e.status)).toEqual(["ended", "active", "not_started"]);
  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values ('8301', 'Report Nobody', '9876583001', 'Male', 'Pune', 'excel_import')`;
  const nobody = "Report Nobody";

  await admin.goto("/admin/report");
  const table = admin.getByRole("region", { name: "Report", exact: true });
  await expect(table.getByRole("columnheader", { name: "Gyansatra Day 1" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Gyansatra Day 2" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Gyansatra Day 3" })).toHaveCount(0); // hasn't started

  const search = admin.getByLabel("Search", { exact: true });
  const cells = async (name: string, count: number) => {
    await search.fill(name);
    const row = table.getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    const texts = await row.getByRole("cell").allTextContents();
    return texts.slice(-count);
  };
  expect(await cells("Suresh Shah", 2)).toEqual(["P", "P"]);
  expect(await cells(nobody, 2)).toEqual(["A", "-"]); // ended without a mark is A; running is only "not yet"

  // Status says where each person came from: Quick Entry or the Excel list.
  await expect(table.getByRole("columnheader", { name: "Status" })).toBeVisible();
  expect((await cells("Kiran Desai", 3))[0]).toBe("Quick Member");
  expect((await cells("Suresh Shah", 3))[0]).toBe("Register");
  await admin.screenshot({ path: "test-results/screens/report-desktop.png" });
  await search.fill("");

  // The day totals match the database, and A is everyone who wasn't marked.
  const members = (await db`select count(*)::int as n from members`)[0].n as number;
  const presentOn = async (day: number) => (await db`select count(*)::int as n from attendance where event_day = ${day} and status = 'present'`)[0].n as number;
  const quickOn = async (day: number) => (await db`select count(*)::int as n from attendance a join members m on m.id = a.member_id where a.event_day = ${day} and a.status = 'present' and m.created_source = 'quick_entry'`)[0].n as number;
  // Present + Quick Member = Total Present, and Total Present + Absent = everyone.
  expect(await quickOn(1)).toBeGreaterThan(0);
  expect(await presentOn(1)).toBeGreaterThan(await quickOn(1));
  await expect(admin.getByTestId("day-1-present")).toHaveText(String((await presentOn(1)) - (await quickOn(1))));
  await expect(admin.getByTestId("day-1-quick")).toHaveText(String(await quickOn(1)));
  await expect(admin.getByTestId("day-1-total")).toHaveText(String(await presentOn(1)));
  await expect(admin.getByTestId("day-1-absent")).toHaveText(String(members - (await presentOn(1))));
  // The card reads as a sum, in this order, with Absent after it.
  const day1Card = (await admin.getByLabel("Gyansatra Day 1 totals").innerText()).replace(/\s+/g, " ");
  expect(day1Card).toMatch(/\d+ Present \+ \d+ Quick Member = \d+ Total Present \d+ Absent/);
  expect((await admin.getByLabel("Gyansatra Day 2 totals").innerText()).replace(/\s+/g, " ")).toMatch(/Total Present \d+ Not marked yet/);
  await expect(admin.getByTestId("day-2-total")).toHaveText(String(await presentOn(2)));
  await expect(admin.getByTestId("day-2-not-marked")).toHaveText(String(members - (await presentOn(2))));
  await expect(admin.getByTestId("day-2-absent")).toHaveCount(0);

  // Filters: who was absent on Day 1.
  await pick(admin, "Show", "Absent on Gyansatra Day 1");
  await expect(table).toContainText(nobody);
  await expect(table).not.toContainText("Suresh Shah");
  await expect(table.getByRole("heading")).toContainText(`(${members - (await presentOn(1))})`);
  await pick(admin, "Show", "Everyone");

  const read = async (buffer: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const sheet = wb.getWorksheet("P-A Report")!;
    const header = (sheet.getRow(1).values as string[]).slice(1);
    const rows = new Map<string, Record<string, unknown>>();
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const values = (row.values as unknown[]).slice(1);
      rows.set(String(values[2]), Object.fromEntries(header.map((h, i) => [h, values[i]])));
    });
    return { header, rows, wb };
  };

  // Day 2 running: the download has Days 1 and 2.
  const [download] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Download Excel" }).click()]);
  expect(download.suggestedFilename()).toBe("attendance_report_day-1-2.xlsx");
  const running = await read(readFileSync(await download.path()));
  expect(running.header).toEqual(["Sr", "Member ID", "Name", "Mobile", "Gender", "Center", "Status", "Gyansatra Day 1", "Gyansatra Day 2", "Days Present"]);
  expect(running.rows.get("Kiran Desai")!.Status).toBe("Quick Member");
  expect(running.rows.get("Suresh Shah")!.Status).toBe("Register");
  // The Totals sheet adds up the same way as the page.
  const totalsRow = (running.wb.getWorksheet("Totals")!.getRow(2).values as unknown[]).slice(1);
  expect((running.wb.getWorksheet("Totals")!.getRow(1).values as unknown[]).slice(1)).toEqual(["Day", "Status", "Present", "Quick Member", "Total Present", "Absent"]);
  expect(totalsRow).toEqual(["Gyansatra Day 1", "Ended", (await presentOn(1)) - (await quickOn(1)), await quickOn(1), await presentOn(1), members - (await presentOn(1))]);
  expect(running.rows.size).toBe(members);
  expect(running.rows.get(nobody)).toMatchObject({ "Gyansatra Day 1": "A", "Gyansatra Day 2": "-", "Days Present": 0 });
  expect(running.rows.get("Suresh Shah")).toMatchObject({ "Gyansatra Day 1": "P", "Gyansatra Day 2": "P", "Days Present": 2 });

  // Ending Day 2 turns its blanks into A, and the toast points to the report.
  await admin.goto("/admin");
  const day2 = admin.getByRole("article").filter({ hasText: "Gyansatra Day 2" });
  await day2.getByRole("button", { name: "End Event" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "End Event" }).click();
  await expect(admin.getByRole("status")).toContainText("ready in Report");
  await admin.goto("/admin/report");
  expect(await cells(nobody, 2)).toEqual(["A", "A"]);
  await search.fill("");

  // All three days finished: the same report is the merged one.
  expect((await setEvent(adminApi, 3, "start")).status()).toBe(200);
  expect((await mark(officerApi, await memberId("8301"), 3)).status()).toBe(200);
  expect((await setEvent(adminApi, 3, "end")).status()).toBe(200);
  const merged = await adminApi.get("/api/admin/day-report/export");
  expect(merged.headers()["content-disposition"]).toContain("attendance_report_all-days.xlsx");
  const all = await read(await merged.body());
  expect(all.header).toEqual(["Sr", "Member ID", "Name", "Mobile", "Gender", "Center", "Status", "Gyansatra Day 1", "Gyansatra Day 2", "Gyansatra Day 3", "Days Present"]);
  expect(all.rows.get(nobody)).toMatchObject({ "Gyansatra Day 1": "A", "Gyansatra Day 2": "A", "Gyansatra Day 3": "P", "Days Present": 1 });
  expect(all.rows.get("Suresh Shah")).toMatchObject({ "Gyansatra Day 1": "P", "Gyansatra Day 2": "P", "Gyansatra Day 3": "A", "Days Present": 2 });
  const totals = JSON.stringify(all.wb.getWorksheet("Totals")!.getSheetValues());
  expect(totals).toContain("Gyansatra Day 3");

  // It follows the filters, and is Admin's only.
  const males = await read(await (await adminApi.get("/api/admin/day-report/export?gender=Male")).body());
  expect([...males.rows.values()].every((r) => r.Gender === "Male")).toBe(true);
  expect((await officerApi.get("/api/admin/day-report")).status()).toBe(403);
  expect((await officerApi.get("/api/admin/day-report/export")).status()).toBe(403);
  expect((await officer.goto("/admin/report"))?.url()).toMatch(/\/officer$/);

  // Put the days back for the tests that follow, and tidy the extra marks.
  await db`delete from attendance where event_day = 3`;
  await db`update event_sessions set status = 'not_started', started_at = null, ended_at = null, started_by = null, ended_by = null where event_day = 3`;
  expect((await setEvent(adminApi, 2, "restart")).status()).toBe(200);
});

test("Admin corrections: remove attendance with a reason, logged, and re-markable", async () => {
  // Removing a mark is on Admin's History, on the Mark Attendance page.
  await admin.goto("/admin/mark");
  await admin.getByRole("navigation", { name: "Event days" }).getByRole("button", { name: /^Gyansatra Day 1/ }).click();
  const history = admin.getByRole("region", { name: "Attendance history" });
  await expect(admin.getByLabel("Marked by", { exact: true })).toContainText("Everyone"); // officers' marks first, as they're what Admin corrects

  // Found by search rather than by paging, and narrowed by gender.
  await pick(admin, "Marked by", "Me");
  await history.getByLabel(/^Search/).fill("raju pan");
  await expect(history).toContainText("Nobody here matches “raju pan”");
  await history.getByRole("button", { name: "Show Everyone" }).click();
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history.getByRole("listitem")).toContainText("Raju Pandya");
  await pick(admin, "Gender", "Female");
  await expect(history.getByRole("listitem")).toHaveCount(0);
  await pick(admin, "Gender", "Male");
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await history.getByLabel(/^Search/).fill("2052");
  await expect(history.getByRole("listitem")).toContainText("Raju Pandya");
  await admin.screenshot({ path: "test-results/screens/admin-history-search.png", fullPage: true });
  // On the smallest phone, both dropdowns sit side by side with their words whole.
  await admin.setViewportSize({ width: 320, height: 800 });
  await showView(admin, "History");
  await pick(admin, "Marked by", "Me");
  await expect(history).toContainText("Nobody here matches “2052”");
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const label of ["Marked by", "Gender"]) {
    const shown = admin.getByLabel(label, { exact: true }).locator("span").first();
    expect(await shown.evaluate((e) => e.scrollWidth <= e.clientWidth), `${label} is cut off`).toBe(true);
  }
  await admin.screenshot({ path: "test-results/screens/admin-history-320.png", fullPage: true });
  await pick(admin, "Marked by", "Everyone");
  await admin.setViewportSize({ width: 1280, height: 900 });

  const total = async (api: APIRequestContext, extra = "") => (await (await api.get(`/api/officer/history?day=1&scope=all${extra}`)).json()).total as number;
  expect((await total(adminApi, "&gender=Male")) + (await total(adminApi, "&gender=Female"))).toBe(await total(adminApi));
  expect(await total(officerApi, "&gender=Female")).toBe(await total(officerApi)); // an officer stays within their own gender
  expect(await total(adminApi, `&q=${encodeURIComponent("%_\\(")}`)).toBe(0);

  await history.getByRole("listitem").filter({ hasText: "Raju Pandya" }).getByRole("button", { name: "Remove Raju Pandya" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Remove Attendance" })).toBeDisabled();
  expect(await missingPlaceholders(admin)).toEqual([]);
  await dialog.getByLabel("Reason").fill("Marked by mistake");
  await dialog.getByRole("button", { name: "Remove Attendance" }).click();
  await expect(admin.getByRole("status")).toContainText("Attendance removed");
  await expect(history.getByRole("listitem").filter({ hasText: "Raju Pandya" })).toHaveCount(0);

  const id = await memberId("2052");
  const [a] = await db`select status, cancel_reason from attendance where member_id = ${id} and event_day = 1`;
  expect(a).toMatchObject({ status: "cancelled", cancel_reason: "Marked by mistake" });

  // Officer can't cancel
  expect((await officerApi.post("/api/admin/attendance/1/cancel", { data: { reason: "x" } })).status()).toBe(403);

  // A cancelled day can be marked again when that day is active.
  await setEvent(adminApi, 2, "end");
  await setEvent(adminApi, 1, "restart");
  expect((await (await mark(officerApi, id, 1)).json()).status).toBe("marked");
  await setEvent(adminApi, 1, "end");
  await setEvent(adminApi, 2, "restart");
});

test("Admin can edit and delete members; history stays in the log", async () => {
  const id = await memberId("3001");
  expect((await officerApi.patch(`/api/admin/members/${id}`, { data: {} })).status()).toBe(403);

  await admin.goto("/admin/members");
  await admin.getByLabel("Search members").fill("Suresh");
  const row = admin.getByRole("row").filter({ hasText: "Suresh Shah" });
  await row.getByRole("button", { name: "Edit" }).click();
  const editDialog = admin.getByRole("dialog");
  await expect(editDialog.getByLabel("Center", { exact: true })).toHaveValue("Bharuch");
  await editDialog.getByLabel("Center", { exact: true }).click();
  await editDialog.getByLabel("Center", { exact: true }).fill("vap");
  await editDialog.getByRole("option", { name: "Vapi" }).click();
  await editDialog.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByRole("status")).toContainText("Member updated");
  expect((await db`select center from members where id = ${id}`)[0].center).toBe("Vapi");

  await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values ('205100', 'Id Holder', '9876530011', 'Male', 'Vapi', 'excel_import')`;
  const clash = await adminApi.patch(`/api/admin/members/${id}`, {
    data: { globalMemberId: "205100", name: "Suresh Shah", mobile: "9876500004", gender: "Male", center: "Vapi" },
  });
  expect(clash.status()).toBe(409);
  // A new or changed ID must be 6 digits. Suresh's older 4-digit ID can stay as it is.
  for (const globalMemberId of ["2051", "2051000", "20510A"]) {
    const wrong = await adminApi.patch(`/api/admin/members/${id}`, { data: { globalMemberId, name: "Suresh Shah", mobile: "9876500004", gender: "Male", center: "Vapi" } });
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).message).toContain("6 digits");
  }
  expect((await db`select global_member_id from members where id = ${id}`)[0].global_member_id).toBe("3001");

  // The edit form: digits only, stops at 6, and says how many are missing.
  await admin.getByRole("row").filter({ hasText: "Suresh Shah" }).getByRole("button", { name: "Edit" }).click();
  await expect(admin.getByRole("dialog").getByLabel("Name")).toBeVisible();
  expect(await missingPlaceholders(admin)).toEqual([]);
  const idBox = admin.getByRole("dialog").getByLabel("Global Member ID");
  await idBox.fill("");
  await idBox.pressSequentially("30a1-0 0 99");
  await expect(idBox).toHaveValue("301009");
  await idBox.fill("3010");
  await expect(admin.getByRole("dialog")).toContainText("4 of 6 digits");
  await admin.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(admin.getByRole("dialog").getByRole("alert")).toContainText("Member ID must be 6 digits. You entered 4.");
  await expect(idBox).toBeFocused();
  await admin.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  expect((await db`select global_member_id from members where id = ${id}`)[0].global_member_id).toBe("3001");

  await admin.getByRole("row").filter({ hasText: "Suresh Shah" }).getByRole("button", { name: "Delete" }).click();
  await expect(admin.getByRole("dialog")).toContainText("2 day(s)");
  await admin.getByRole("dialog").getByRole("button", { name: "Delete Member" }).click();
  await expect(admin.getByRole("status")).toContainText("Deleted: Suresh Shah");
  expect((await db`select count(*)::int as n from members where id = ${id}`)[0].n).toBe(0);

  const [log] = await db`select details from audit_log where action = 'member.delete' and entity_id = ${String(id)}`;
  expect(log.details.member.name).toBe("Suresh Shah");
  expect(log.details.attendance.length).toBe(2);
});

test("every important activity is in the audit log with user and time", async () => {
  const actions = (await db`select distinct action from audit_log`).map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining([
    "auth.login", "members.excel_upload", "event.start", "event.end", "event.restart",
    "attendance.mark", "attendance.cancel", "member.quick_entry", "member.edit", "member.delete",
    "officer.password_reset", "auth.password_change",
  ]));
  expect((await db`select count(*)::int as n from audit_log where username = '' or at is null`)[0].n).toBe(0);

  // Recorded for the database only: there is no screen or API that shows it.
  await admin.goto("/admin");
  await expect(admin.getByRole("navigation", { name: "Admin" }).getByRole("link")).toHaveText(["Dashboard", "Mark Attendance", "Report", "Members", "Officers"], { useInnerText: true });
  expect((await admin.goto("/admin/activity"))?.status()).toBe(404);
  expect((await officerApi.get("/api/admin/audit")).status()).toBe(404);
});

test("performance: 20,000 members upload and search quickly", async () => {
  const rows = Array.from({ length: 20000 }, (_, i) => [
    i + 1,
    100000 + i,
    `Person${i} Surname${i % 500}`,
    String(7000000000 + i),
    i % 2 ? "Male" : "Female",
    ["Varachha", "Vapi", "Pune"][i % 3],
  ]);
  const buffer = await xlsx([...rows, ...(await alsoUploaded())]);
  const started = Date.now();
  const res = await upload(adminApi, buffer, "big.xlsx");
  const uploadMs = Date.now() - started;
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ imported: 20000, removed: 0, errorRows: 0 });

  const timings: Record<string, number> = {};
  for (const q of ["1001", "per sur", "700000", "person19999", "su", "a"]) {
    const t = Date.now();
    const results = await search(officerApi, q, 2);
    timings[q] = Date.now() - t;
    expect(results.length).toBeLessThanOrEqual(30);
  }
  console.log(`upload ${(buffer.length / 1024).toFixed(0)} KB in ${uploadMs} ms; search ms:`, timings);
  expect(Math.max(...Object.values(timings))).toBeLessThan(300);
});

test("screens fit a phone with no sideways scroll; screenshots for review", async ({ browser }) => {
  const dir = "test-results/screens";
  await officer.setViewportSize({ width: 390, height: 844 });
  await officer.goto("/officer");
  await officer.getByLabel(/Search by Member ID/).fill("person19");
  await expect(officer.getByRole("button", { name: "Mark Present" }).first()).toBeVisible();
  await officer.screenshot({ path: `${dir}/officer-phone.png` });
  expect(await officer.locator("h1").count()).toBe(1);
  // Numbers line up only if the font really has tabular figures.
  const digitWidths = await officer.evaluate(() => {
    const measure = (text: string) => {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.cssText = "position:absolute;visibility:hidden;font-size:40px";
      document.body.append(span);
      const width = span.getBoundingClientRect().width;
      span.remove();
      return width;
    };
    return [measure("1111111111"), measure("0000000000"), getComputedStyle(document.body).fontFamily];
  });
  expect(digitWidths[0]).toBe(digitWidths[1]);
  expect(String(digitWidths[2])).toMatch(/mukta/i);

  const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(officer)).toBeLessThanOrEqual(0);

  await officer.getByRole("button", { name: /Quick Entry/ }).click();
  const panel = officer.getByRole("region", { name: "Quick Entry" });
  await panel.getByLabel("Mobile Number").fill("9876500003");
  await expect(panel.getByRole("alert")).toBeVisible();
  await officer.screenshot({ path: `${dir}/quick-entry-phone.png` });

  await admin.goto("/admin");
  await expect(admin.getByTestId("stat-total")).not.toHaveText("");
  await admin.screenshot({ path: `${dir}/admin-desktop.png`, fullPage: true });
  await admin.goto("/admin/members");
  await expect(admin.getByRole("region", { name: "Member list" }).getByRole("row").nth(1)).toBeVisible();
  // With members in place, the upload form is closed until Upload Excel opens it, next to Add Member.
  await expect(admin.getByRole("button", { name: /^Upload/ }).filter({ hasNotText: "Upload Excel" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Upload Excel" })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Add Member" })).toBeVisible();
  await admin.screenshot({ path: `${dir}/members-desktop.png` });

  const adminPhone = await loginPage(browser, "admin", { width: 390, height: 844 });
  await expect(adminPhone.getByTestId("stat-total")).toBeVisible();
  expect(await overflow(adminPhone)).toBeLessThanOrEqual(0);
  await adminPhone.screenshot({ path: `${dir}/admin-phone.png`, fullPage: true });
  await adminPhone.getByRole("button", { name: "Filters" }).click();
  await expect(adminPhone.getByLabel("Member source")).toBeVisible();
  await adminPhone.getByLabel("Center", { exact: true }).click();
  await expect(adminPhone.getByRole("listbox")).toHaveCSS("opacity", "1");
  const phoneList = (await adminPhone.getByRole("listbox").boundingBox())!;
  expect(phoneList.x).toBeGreaterThanOrEqual(0);
  expect(phoneList.x + phoneList.width).toBeLessThanOrEqual(390);
  await adminPhone.screenshot({ path: `${dir}/dropdown-phone.png` });
  await adminPhone.keyboard.press("Escape");
  await adminPhone.getByRole("button", { name: "Filters" }).click();
  await adminPhone.goto("/admin/members");
  await expect(adminPhone.getByRole("region", { name: "Member list" }).getByRole("listitem").first()).toBeVisible();
  expect(await overflow(adminPhone)).toBeLessThanOrEqual(0);
  await adminPhone.screenshot({ path: `${dir}/members-phone.png` });
  // On a phone the Members filters open in a pop-up. Choices apply at once, and its button shows the count.
  await adminPhone.getByRole("button", { name: "Filters", exact: true }).click();
  const filterPopup = adminPhone.getByRole("dialog", { name: "Filters" });
  await expect(filterPopup.getByRole("button", { name: "Clear filters" })).toBeDisabled();
  await pick(filterPopup, "Gender", "Female");
  const memberList = adminPhone.getByRole("region", { name: "Member list" });
  const matching = (await db`select count(*)::int as n from members where gender = 'Female'`)[0].n as number;
  await expect(filterPopup.getByRole("button", { name: `Show ${matching} members` })).toBeVisible();
  await expect(memberList.getByRole("heading", { name: `Matching members (${matching})` })).toBeVisible();
  await expect(memberList.getByRole("listitem").filter({ hasText: "Male" }).filter({ hasNotText: "Female" })).toHaveCount(0);
  const popupBox = (await filterPopup.boundingBox())!;
  expect(popupBox.x).toBeGreaterThanOrEqual(0);
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(390);
  await adminPhone.screenshot({ path: `${dir}/members-filters-phone.png` });
  await filterPopup.getByRole("button", { name: `Show ${matching} members` }).click();
  await expect(filterPopup).toBeHidden();
  await expect(adminPhone.getByRole("button", { name: "Filters (1)", exact: true })).toBeVisible();
  expect(await overflow(adminPhone)).toBeLessThanOrEqual(0);
  await adminPhone.screenshot({ path: `${dir}/members-filtered-phone.png` });
  // On the narrowest phone, every button in these dialogs stays whole and inside the dialog.
  await adminPhone.setViewportSize({ width: 320, height: 791 });
  const buttonsFit = async (dialog: Locator) => {
    const box = (await dialog.boundingBox())!;
    for (const button of await dialog.getByRole("button").all()) {
      const b = (await button.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
  };
  await adminPhone.getByRole("button", { name: "Filters (1)", exact: true }).click();
  await expect(filterPopup.getByRole("button", { name: `Show ${matching} members` })).toBeVisible();
  await buttonsFit(filterPopup);
  await adminPhone.screenshot({ path: `${dir}/members-filters-320.png` });
  await filterPopup.getByRole("button", { name: `Show ${matching} members` }).click();
  await memberList.getByRole("button", { name: `Delete Filtered (${matching})` }).click();
  const deletePopup = adminPhone.getByRole("dialog", { name: "Delete filtered members" });
  await expect(deletePopup.getByLabel("Admin password")).toBeVisible();
  await buttonsFit(deletePopup);
  await adminPhone.screenshot({ path: `${dir}/members-delete-320.png` });
  await deletePopup.getByRole("button", { name: "Cancel" }).click();
  expect(await overflow(adminPhone)).toBeLessThanOrEqual(0);

  // The upload card at 320px: Cancel and Upload each take a full-width line, and the prompt breaks between words.
  await adminPhone.getByRole("button", { name: "Upload Excel" }).click();
  const uploadCard = adminPhone.getByRole("region", { name: "Excel upload" });
  const cardBox = (await uploadCard.boundingBox())!;
  const cancelBox = (await uploadCard.getByRole("button", { name: "Cancel" }).boundingBox())!;
  const uploadBox = (await uploadCard.getByRole("button", { name: "Upload and replace list" }).boundingBox())!;
  expect(Math.abs(cancelBox.width - uploadBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(cancelBox.x - uploadBox.x)).toBeLessThanOrEqual(1);
  expect(uploadBox.y).toBeGreaterThan(cancelBox.y);
  expect(uploadBox.x + uploadBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  const prompt = uploadCard.getByText("Drag your file here, or click to choose");
  expect(await prompt.evaluate((el) => getComputedStyle(el).wordBreak)).not.toBe("break-all");
  await adminPhone.screenshot({ path: `${dir}/members-upload-320.png`, fullPage: true });
  await uploadCard.getByRole("button", { name: "Cancel" }).click();
  await adminPhone.context().close();

  // An officer's menu holds Install app and Log out.
  await officer.getByRole("button", { name: "Open menu" }).click();
  const officerMenu = officer.getByRole("dialog", { name: "Menu" });
  await expect(officerMenu.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(officerMenu).toContainText("Male members only");
  await officer.screenshot({ path: `${dir}/officer-drawer.png`, animations: "disabled" });
  await officer.keyboard.press("Escape");
  await expect(officerMenu).toBeHidden();

  // The narrowest phone: the header is one short row, and every page is in the drawer behind the menu button.
  const tiny = await loginPage(browser, "admin", { width: 320, height: 720 });
  await expect(tiny.getByRole("navigation", { name: "Admin" })).toBeHidden();
  await expect(tiny.getByRole("button", { name: "Log out" })).toBeHidden();
  expect((await tiny.locator("header").boundingBox())!.height).toBeLessThan(80);
  const pages = [["Report", "/admin/report"], ["Members", "/admin/members"], ["Officers", "/admin/officers"], ["Mark Attendance", "/admin/mark"], ["Dashboard", "/admin"]];
  for (const [label, path] of pages) {
    await tiny.getByRole("button", { name: "Open menu" }).click();
    const drawer = tiny.getByRole("dialog", { name: "Menu" });
    await expect(drawer.getByRole("link", { name: label })).toBeVisible();
    if (label === "Report") await tiny.screenshot({ path: `${dir}/drawer-320.png`, animations: "disabled" });
    await drawer.getByRole("link", { name: label }).click();
    await tiny.waitForURL((url) => url.pathname === path);
    await expect(drawer).toBeHidden();
    await expect(tiny.locator("h1").first()).toBeVisible();
    expect(await overflow(tiny)).toBeLessThanOrEqual(0);
    await tiny.screenshot({ path: `${dir}/${label.toLowerCase().replace(" ", "-")}-320.png`, fullPage: true });
  }
  // A tap beside the drawer closes it.
  await tiny.getByRole("button", { name: "Open menu" }).click();
  await tiny.mouse.click(310, 400);
  await expect(tiny.getByRole("dialog", { name: "Menu" })).toBeHidden();
  await tiny.context().close();
});

test("idle officer screen and login, for review", async ({ browser }) => {
  const dir = "test-results/screens";
  await officer.goto("/officer");
  const box = officer.getByLabel(/Search by Member ID/);
  for (const q of ["100001", "100003"]) {
    await box.fill(q);
    await officer.getByRole("button", { name: "Mark Present" }).click();
    await expect(box).toHaveValue("");
  }
  await expect(officer.getByRole("status")).toHaveCSS("opacity", "1");
  await officer.screenshot({ path: `${dir}/officer-idle-phone.png` });
  const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await fresh.goto("/login");
  await fresh.screenshot({ path: `${dir}/login-phone.png` });
  await fresh.setViewportSize({ width: 1280, height: 800 });
  await fresh.setViewportSize({ width: 1280, height: 800 });
  await fresh.screenshot({ path: `${dir}/login-desktop.png` });
  await fresh.close();
});

test("everything clickable shows a pointer, and disabled buttons show they're blocked", async ({ browser }) => {
  const wrongCursors = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, a[href], [role=option], label:has(input[type=file])")]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => getComputedStyle(el).cursor !== ((el as HTMLButtonElement).disabled ? "not-allowed" : "pointer"))
        .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30)),
    );

  await admin.goto("/admin");
  await expect(admin.getByTestId("stat-total")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Start Event" }).first()).toBeDisabled();
  await admin.getByRole("combobox", { name: "Event", exact: true }).click();
  expect(await wrongCursors(admin)).toEqual([]);
  await admin.keyboard.press("Escape");

  await admin.goto("/admin/members");
  await admin.getByRole("button", { name: "Add Member" }).click();
  expect(await wrongCursors(admin)).toEqual([]);
  await admin.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await admin.getByLabel("Search members").fill("Ramesh");
  await admin.getByRole("row").filter({ hasText: "Ramesh K Patel" }).getByRole("button", { name: "Edit" }).click();
  expect(await wrongCursors(admin)).toEqual([]);
  await admin.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await officer.goto("/officer");
  await officer.getByLabel(/Search by Member ID/).fill("person19");
  await expect(officer.getByRole("button", { name: "Mark Present" }).first()).toBeVisible();
  expect(await wrongCursors(officer)).toEqual([]);

  const fresh = await browser.newPage();
  await fresh.goto("/login");
  expect(await wrongCursors(fresh)).toEqual([]);
  await fresh.close();
});

test("a request cancelled while its reply is arriving is reported as cancelled, not as an empty success", async () => {
  // Filters and search cancel the previous request. Treated as a success, this crashed the screen.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"records":[');
    // The rest of the reply never comes, so the request is stuck part-way through its body.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  const controller = new AbortController();
  const pending = api(url, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  server.closeAllConnections();
  server.close();

  // A reply that isn't JSON, such as a proxy's error page sent as 200, is an error too.
  const html = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Bad gateway</h1>");
  });
  await new Promise<void>((resolve) => html.listen(0, "127.0.0.1", resolve));
  await expect(api(`http://127.0.0.1:${(html.address() as AddressInfo).port}/`)).rejects.toBeInstanceOf(ClientApiError);
  html.close();

  // On the real screens: a bad reply shows the error with Retry, and the page survives.
  await admin.goto("/admin");
  await expect(admin.getByTestId("stat-total")).toBeVisible();
  await admin.route("**/api/admin/report?**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Bad gateway</h1>" }));
  await pick(admin, "Gender", "Male");
  await expect(admin.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await admin.unroute("**/api/admin/report?**");
  await admin.getByRole("button", { name: "Retry" }).click();
  await expect(admin.getByRole("button", { name: "Retry" })).toHaveCount(0);

  await admin.goto("/admin/mark");
  await admin.route("**/api/officer/history?**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Bad gateway</h1>" }));
  await admin.getByRole("combobox", { name: "Marked by" }).click();
  await admin.getByRole("option", { name: "Me", exact: true }).click();
  await expect(admin.getByRole("region", { name: "Attendance history" }).getByRole("button", { name: "Retry" })).toBeVisible();
  await admin.unroute("**/api/officer/history?**");
});

test("cancelling slow requests, by changing filters or leaving the page, causes no errors", async () => {
  // Reports run several at once, so these are cancelled in flight whenever the filters change.
  await admin.goto("/admin");
  await expect(admin.getByTestId("stat-total")).toBeVisible();
  await admin.route("**/api/admin/report?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue().catch(() => {});
  });
  for (const option of ["Male", "Female", "All", "Male"]) {
    await pick(admin, "Gender", option);
    await admin.waitForTimeout(150);
  }
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Members" }).click();
  await admin.waitForURL("**/admin/members");
  await admin.unroute("**/api/admin/report?**");
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Dashboard" }).click();
  await admin.waitForURL("**/admin");
  await expect(admin.getByTestId("stat-total")).toBeVisible();
  await expect(admin.getByText("This page couldn’t load")).toHaveCount(0);
});

test("the database connection keeps the setting that stops Supabase's pooler stalling", () => {
  // Tests run against a local database with no pooler, so they can't catch this if it's removed.
  const source = readFileSync("src/lib/db.ts", "utf8");
  expect(source).toMatch(/max_pipeline: 1\b/);
  expect(source).toMatch(/query_timeout: \d+/);
});

test("the marking screen: side by side on large screens, one at a time with a bottom bar on small ones", async ({ browser }) => {
  const large = await loginPage(browser, "male.officer", { width: 1440, height: 900 });
  const left = large.getByLabel(/Search by Member ID/);
  const right = large.getByRole("region", { name: "Attendance history" });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const [l, r] = [(await left.boundingBox())!, (await right.boundingBox())!];
  expect(r.x).toBeGreaterThanOrEqual(l.x + l.width);
  await expect(large.getByRole("navigation", { name: "Marking view" })).toBeHidden();
  await large.screenshot({ path: "test-results/screens/officer-desktop.png" });

  await large.context().close();

  // The header is one row at every width: Log out (or, below 1024px, the menu button) level with the title.
  for (const width of [390, 640, 820, 1024, 1280, 1920]) {
    const page = await loginPage(browser, "admin", { width, height: 900 });
    const title = (await page.getByText("Gyansatra Attendance", { exact: true }).first().boundingBox())!;
    const control = page.getByRole("button", { name: width < 1024 ? "Open menu" : "Log out" });
    const box = (await control.boundingBox())!;
    expect(Math.abs(title.y + title.height / 2 - (box.y + box.height / 2))).toBeLessThan(24);
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible({ visible: width >= 1024 });
    if (width === 820) await page.screenshot({ path: "test-results/screens/admin-tablet.png" });
    await page.context().close();
  }

  // The narrowest phone: every Day tab one line and one height, and the heading one line.
  const small = await loginPage(browser, "male.officer", { width: 320, height: 700 });
  // The hint in the search box is small, and shows in full.
  const hint = await small.getByLabel(/Search by Member ID/).evaluate((input: HTMLInputElement) => {
    const style = getComputedStyle(input, "::placeholder");
    const box = getComputedStyle(input);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${style.fontWeight} ${style.fontSize} ${box.fontFamily}`;
    // The outer width, because Chrome's clientWidth on an input already leaves out the padding.
    const edges = ["borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight"] as const;
    const room = input.getBoundingClientRect().width - edges.reduce((sum, k) => sum + parseFloat(box[k]), 0);
    return { size: parseFloat(style.fontSize), width: context.measureText(input.placeholder).width, room };
  });
  expect(hint.size).toBeLessThanOrEqual(14);
  expect(hint.size).toBeGreaterThanOrEqual(12);
  expect(hint.width).toBeLessThanOrEqual(hint.room);
  expect(await small.getByLabel(/Search by Member ID/).getAttribute("placeholder")).toBe("206383, Ghanshyam Pande, 9876543210");
  const dayTabs = small.getByRole("navigation", { name: "Event days" }).getByRole("button");
  const heights = await dayTabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
  const heading = small.getByRole("heading", { name: /^Marking Gyansatra Day/ });
  expect((await heading.boundingBox())!.height).toBeLessThan(36);
  expect((await small.getByText("Gyansatra Attendance").first().evaluate((e) => e.scrollWidth <= e.clientWidth))).toBe(true);
  await small.screenshot({ path: "test-results/screens/officer-320.png" });

  // Long names stay compact: at most two lines, with the details on one, and the button on the same row.
  await small.getByLabel(/Search by Member ID/).fill("jayantibhai");
  const longRow = small.getByRole("region", { name: "Search results" }).getByRole("listitem").filter({ hasText: "Jayantibhai Popatbhai Kanani" });
  await expect(longRow).toBeVisible();
  expect((await longRow.boundingBox())!.height).toBeLessThanOrEqual(84);
  // The Mark button has real space inside it, so the word and tick don't touch the edges.
  const padded = longRow.getByRole("button", { name: "Mark Present" });
  expect(Number.parseFloat(await padded.evaluate((e) => getComputedStyle(e).paddingLeft))).toBeGreaterThanOrEqual(14);
  await small.getByLabel(/Search by Member ID/).fill("");
  // Quick Entry is full width, below Area, and in view without scrolling.
  const areaBox = (await small.getByRole("combobox", { name: "Area", exact: true }).boundingBox())!;
  const quickBox = (await small.getByRole("button", { name: /Quick Entry/ }).boundingBox())!;
  expect(quickBox.y).toBeGreaterThan(areaBox.y + areaBox.height - 1);
  expect(Math.abs(quickBox.width - areaBox.width)).toBeLessThan(2);
  await expect(small.getByRole("button", { name: /Quick Entry/ })).toBeInViewport();
  await small.screenshot({ path: "test-results/screens/officer-320-quick-entry.png", fullPage: false });
  await small.context().close();

  // Admin gets the same layout on the same screen.
  const adminLarge = await loginPage(browser, "admin", { width: 1280, height: 800 });
  await adminLarge.goto("/admin/mark");
  await expect(adminLarge.getByRole("region", { name: "Attendance history" })).toBeInViewport();
  await adminLarge.screenshot({ path: "test-results/screens/admin-mark-desktop.png" });
  await adminLarge.context().close();

  const phone = await loginPage(browser, "male.officer", { width: 390, height: 844 });
  const bar = phone.getByRole("navigation", { name: "Marking view" });
  await expect(bar).toBeInViewport();
  await expect(phone.getByLabel(/Search by Member ID/)).toBeVisible();
  await expect(phone.getByRole("region", { name: "Attendance history" })).toHaveCount(0);
  await bar.getByRole("button", { name: "History" }).click();
  await expect(phone.getByRole("region", { name: "Attendance history" })).toBeVisible();
  await expect(phone.getByTestId("stat-my-present")).toBeVisible();
  await expect(phone.getByLabel(/Search by Member ID/)).toBeHidden();
  // The bar shows which side is open, in words and colour.
  await expect(bar.getByRole("button", { name: "History" })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("button", { name: "Mark" })).not.toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("button", { name: "History" })).toHaveCSS("color", "rgb(28, 90, 150)");
  await phone.screenshot({ path: "test-results/screens/officer-history-tab-phone.png" });
  await bar.getByRole("button", { name: "Mark" }).click();
  await expect(phone.getByLabel(/Search by Member ID/)).toBeVisible();

  // The bar never covers the last thing on the page.
  await phone.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const barBox = (await bar.boundingBox())!;
  const lastButton = (await phone.getByRole("button", { name: /Quick Entry/ }).boundingBox())!;
  expect(lastButton.y + lastButton.height).toBeLessThanOrEqual(barBox.y + 1);
  await phone.context().close();
});

test("the Install app button catches an early offer, prompts once, and explains when Chrome refuses", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // A stand-in for Chrome's install offer, sent as soon as the page's HTML is read, before the app's code runs.
  await context.addInitScript(() => {
    const w = window as unknown as { prompts: number; refuse: boolean };
    w.prompts = 0;
    w.refuse = location.search.includes("refuse");
    document.addEventListener("DOMContentLoaded", () => {
      const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          w.prompts += 1;
          if (w.refuse) throw new DOMException("refused", "NotAllowedError");
          await new Promise((done) => setTimeout(done, 300));
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(offer);
    });
  });
  const page = await context.newPage();
  await page.goto("/login");
  const button = page.getByRole("button", { name: "Install app" });
  await expect(button).toBeVisible();
  // It says what it does on the narrowest phone too, not just a download arrow, and fits the screen.
  await page.setViewportSize({ width: 320, height: 791 });
  await expect(button).toHaveText("Install app");
  const installBox = (await button.boundingBox())!;
  expect(installBox.x).toBeGreaterThanOrEqual(0);
  expect(installBox.x + installBox.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "test-results/screens/login-install-320.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Two quick taps open one prompt, and the spent offer isn't kept.
  await button.dblclick();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompts: number }).prompts)).toBe(1);
  await expect(button).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // When Chrome refuses the prompt, the browser's own way to install is explained instead of nothing happening.
  await page.goto("/login?refuse");
  await page.getByRole("button", { name: "Install app" }).click();
  const help = page.getByRole("dialog", { name: "Install from the browser menu" });
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Done" }).click();
  await expect(help).toHaveCount(0);
  await context.close();
});

test("it installs as an app, and stores nothing personal on the device", async ({ browser, request }) => {
  // The manifest and icons a phone needs in order to offer installing.
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Gyansatra Attendance", short_name: "Gyansatra", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("image/png");
    expect((await file.body()).length).toBeGreaterThan(500);
  }
  expect((await request.get("/apple-icon.png")).status()).toBe(200);
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toContain("no-cache");

  // Chrome's own check of whether this can be installed.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(LOGIN_LABEL).fill("male.officer");
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/officer");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await context.newCDPSession(page);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  // Test browsers run in Incognito, where Chrome never installs anything. Anything else is a real problem.
  expect(installability.installabilityErrors.map((e) => e.errorId).filter((id) => id !== "in-incognito")).toEqual([]);
  const appManifest = await cdp.send("Page.getAppManifest");
  expect(appManifest.errors).toEqual([]);

  // A reload puts the page under the worker's control. Use the app, then look at what was stored.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByLabel(/Search by Member ID/).fill("205").catch(() => {});
  await page.waitForTimeout(800);
  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);
    return urls;
  });
  expect(stored).toContain("/offline.html");
  expect(stored.some((u) => u.startsWith("/_next/static/"))).toBe(true);
  expect(stored.filter((u) => !u.startsWith("/_next/static/") && !u.startsWith("/icons/") && u !== "/offline.html")).toEqual([]);

  // Losing the internet says so on the open page, and a reload gets a proper screen.
  await context.setOffline(true);
  await expect(page.getByRole("alert").filter({ hasText: "No internet" })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/offline-banner-phone.png" });
  await page.reload().catch(() => {});
  await expect(page.getByRole("heading", { name: "No internet connection" })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/offline-page-phone.png" });

  // Coming back returns to the app by itself, still logged in.
  await context.setOffline(false);
  await expect(page.getByLabel(/Search by Member ID/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("alert").filter({ hasText: "No internet" })).toHaveCount(0);
  await context.close();
});

test("Admin adds, renames and removes sessions beyond the first three", async () => {
  await admin.goto("/admin");
  await admin.getByRole("button", { name: "New Session" }).click();
  await admin.getByLabel("Session name").fill("  Youth   Shibir ");
  await admin.getByRole("dialog").getByRole("button", { name: "Add Session" }).click();
  await expect(admin.getByRole("status")).toContainText("Added: Youth Shibir");
  const card = admin.getByRole("article").filter({ hasText: "Youth Shibir" });
  await expect(card).toContainText("Not Started");
  const [created] = await db`select event_day, status from event_sessions where name = 'Youth Shibir'`;
  expect(created).toMatchObject({ event_day: 4, status: "not_started" });

  // Names are unique, ignoring case, and can't be blank.
  expect((await adminApi.post("/api/admin/events", { data: { name: "youth shibir" } })).status()).toBe(409);
  expect((await adminApi.post("/api/admin/events", { data: { name: "   " } })).status()).toBe(400);
  expect((await officerApi.post("/api/admin/events", { data: { name: "Not allowed" } })).status()).toBe(403);

  await card.getByRole("button", { name: "Rename Youth Shibir" }).click();
  await admin.getByLabel("Session name").fill("Youth Shibir Evening");
  await admin.getByRole("dialog").getByRole("button", { name: "Rename Session" }).click();
  await expect(admin.getByRole("article").filter({ hasText: "Youth Shibir Evening" })).toBeVisible();

  // It runs like any other day: start, mark, report, end.
  const wasActive = (await db`select event_day from event_sessions where status = 'active'`)[0]?.event_day as number | undefined;
  if (wasActive) expect((await setEvent(adminApi, wasActive, "end")).status()).toBe(200);
  expect((await setEvent(adminApi, 4, "start")).status()).toBe(200);
  expect((await mark(officerApi, await memberId("100001"), 4)).status()).toBe(200);
  const present = await (await adminApi.get("/api/admin/day-report?show=P:4")).json();
  expect(present.rows.map((r: { name: string }) => r.name)).toEqual(["Person1 Surname1"]);
  expect(present.days.map((d: { name: string }) => d.name)).toContain("Youth Shibir Evening");
  const dash = await (await adminApi.get("/api/admin/report?event=4")).json();
  expect(dash.summary.total).toBe(1);
  expect(dash.options.events).toContainEqual({ day: 4, name: "Youth Shibir Evening" });
  expect((await adminApi.delete("/api/admin/events/4")).status()).toBe(409); // started, so it stays
  expect((await setEvent(adminApi, 4, "end")).status()).toBe(200);
  if (wasActive) expect((await setEvent(adminApi, wasActive, "restart")).status()).toBe(200);

  // A session added by mistake can be removed before it starts.
  expect((await adminApi.post("/api/admin/events", { data: { name: "Added by mistake" } })).status()).toBe(200);
  await admin.reload();
  await admin.getByRole("button", { name: "Remove Added by mistake" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Remove Session" }).click();
  await expect(admin.getByRole("status")).toContainText("Removed: Added by mistake");
  expect((await db`select count(*)::int as n from event_sessions where name = 'Added by mistake'`)[0].n).toBe(0);
});

test("a new upload replaces the earlier list, and Admin can clear attendance, both behind the Admin password", async () => {
  // Someone from the current list, someone about to be left out, one added by hand, one from Quick Entry.
  const extra = [[1, 9101, "Keep Me", "9000009101", "Male", "Vapi"], [2, 9102, "Drop Me", "9000009102", "Male", "Vapi"]];
  expect((await upload(adminApi, await xlsx([...extra, ...(await alsoUploaded(extra))]))).status()).toBe(200);
  const byHand = await adminApi.post("/api/admin/members", { data: { globalMemberId: "", name: "By Hand", mobile: "9000009103", gender: "Male", center: "Vapi" } });
  expect(byHand.status()).toBe(200);
  const quickCount = (await db`select count(*)::int as n from members where created_source = 'quick_entry'`)[0].n as number;
  expect(quickCount).toBeGreaterThan(0);

  if (!(await db`select 1 from event_sessions where status = 'active'`).length) expect((await setEvent(adminApi, 4, "restart")).status()).toBe(200);
  const day = (await db`select event_day from event_sessions where status = 'active'`)[0].event_day as number;
  for (const id of ["9101", "9102"]) expect((await mark(officerApi, await memberId(id), day)).status()).toBe(200);

  // Without the password, or with a wrong one, nothing changes.
  const file = await xlsx([[1, 9101, "Keep Me", "9000009101", "Male", "Vapi"], [2, 6002, "Mohan Letter", "9876560002", "X", "Vapi"]]);
  expect((await (await upload(adminApi, file, "new.xlsx", "")).json()).code).toBe("password_required");
  expect((await upload(adminApi, file, "new.xlsx", "wrong-password")).status()).toBe(403);
  expect((await upload(officerApi, file)).status()).toBe(403);
  expect(await memberId("9102")).toBeTruthy();

  await admin.goto("/admin/members");
  await admin.getByRole("button", { name: "Upload Excel" }).click();
  await expect(admin.getByText("This file replaces the member list you uploaded before.")).toBeVisible();
  await admin.getByLabel("Excel file").setInputFiles({ name: "new.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await admin.getByRole("button", { name: "Upload and replace list" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Admin password").fill("wrong-password");
  await dialog.getByRole("button", { name: "Replace List" }).click();
  await expect(dialog).toContainText("That password isn't right");
  await dialog.getByLabel("Admin password").fill(TEST_PASSWORD);
  await dialog.getByRole("button", { name: "Replace List" }).click();
  const summary = admin.getByTestId("import-summary");
  await expect(summary).toContainText("weren't in this file and were removed");

  const left = await db`select name, created_source, added_by_hand from members`;
  const names = left.map((m) => m.name);
  expect(names).toContain("Keep Me");
  expect(names).not.toContain("Drop Me");
  expect(names).toContain("Mohan Letter"); // on a row with a mistake, so still on the list
  expect(names).toContain("By Hand");
  expect(left.filter((m) => m.created_source === "quick_entry").length).toBe(quickCount);
  // Someone still on the list keeps their attendance.
  expect((await db`select count(*)::int as n from attendance where member_id = ${await memberId("9101")}`)[0].n).toBe(1);
  const [log] = await db`select details from audit_log where action = 'members.excel_upload' order by id desc limit 1`;
  expect(log.details.removed).toBeGreaterThan(0);

  // Clearing one session's attendance leaves the others.
  const otherDays = async () => (await db`select count(*)::int as n from attendance where event_day <> ${day}`)[0].n as number;
  const before = await otherDays();
  expect(before).toBeGreaterThan(0);
  const dayName = (await db`select name from event_sessions where event_day = ${day}`)[0].name as string;
  await admin.goto("/admin");
  await admin.getByRole("button", { name: "Clear Attendance" }).click();
  await pick(admin, "Clear attendance from", dayName);
  await dialog.getByLabel("Admin password").fill("wrong-password");
  await dialog.getByRole("button", { name: "Clear Attendance" }).click();
  await expect(dialog).toContainText("That password isn't right");
  await dialog.getByLabel("Admin password").fill(TEST_PASSWORD);
  await dialog.getByRole("button", { name: "Clear Attendance" }).click();
  await expect(admin.getByRole("status")).toContainText(`from ${dayName}`);
  expect((await db`select count(*)::int as n from attendance where event_day = ${day}`)[0].n).toBe(0);
  expect(await otherDays()).toBe(before);

  // Then everything: officers can't, and the password is checked.
  expect((await officerApi.post("/api/admin/attendance/clear", { data: { password: TEST_PASSWORD, day: "all" } })).status()).toBe(403);
  expect((await adminApi.post("/api/admin/attendance/clear", { data: { password: "nope", day: "all" } })).status()).toBe(403);
  expect((await adminApi.post("/api/admin/attendance/clear", { data: { password: TEST_PASSWORD, day: "all" } })).status()).toBe(200);
  expect((await db`select count(*)::int as n from attendance`)[0].n).toBe(0);
  expect((await db`select count(*)::int as n from audit_log where action = 'attendance.clear'`)[0].n).toBe(2);
});

test("Members can be filtered, and Admin can delete everyone a filter shows, behind the Admin password", async () => {
  // Their own center, so nobody from earlier tests is caught up in it.
  const add = async (name: string, gender: string, source: string) =>
    (await db`insert into members (name, gender, center, created_source) values (${name}, ${gender}, 'Filtertown', ${source}) returning id`)[0].id as number;
  const present = await add("Filter Present", "Female", "quick_entry");
  const never = await add("Filter Never", "Female", "quick_entry");
  const male = await add("Filter Male", "Male", "quick_entry");
  const registered = await add("Filter Register", "Female", "excel_import");
  await db`insert into attendance (member_id, event_day, marked_by) select ${present}, 1, id from app_users where username = 'admin'`;

  // The list's filters on the server, including days present.
  const names = async (query: string) =>
    ((await (await adminApi.get(`/api/admin/members?center=Filtertown&${query}`)).json()).members as { name: string }[]).map((m) => m.name).sort();
  expect(await names("")).toEqual(["Filter Male", "Filter Never", "Filter Present", "Filter Register"]);
  expect(await names("gender=Female&source=quick_entry")).toEqual(["Filter Never", "Filter Present"]);
  expect(await names("days=present")).toEqual(["Filter Present"]);
  expect(await names("days=never&gender=Male")).toEqual(["Filter Male"]);

  // Deleting is refused for officers, a wrong password, no filter at all, a value it doesn't know, or a count that's out of date.
  const filters = { q: "", gender: "Female", center: "Filtertown", source: "quick_entry", days: "all" };
  const del = (data: object, api = adminApi) => api.post("/api/admin/members/delete-filtered", { data: { password: TEST_PASSWORD, filters, expected: 2, ...data } });
  expect((await del({}, officerApi)).status()).toBe(403);
  expect((await del({ password: "wrong-password" })).status()).toBe(403);
  const unfiltered = await del({ filters: { q: "  ", gender: "all", center: "all", source: "all", days: "all" } });
  expect((await unfiltered.json()).code).toBe("no_filter");
  expect((await del({ filters: { ...filters, gender: "female" } })).status()).toBe(400);
  expect((await (await del({ expected: 5 })).json()).code).toBe("list_changed");
  expect((await db`select count(*)::int as n from members where center = 'Filtertown'`)[0].n).toBe(4);

  // On the screen: filters narrow the list, and Delete Filtered names them before deleting.
  await admin.goto("/admin/members");
  const list = admin.getByRole("region", { name: "Member list" });
  await expect(list.getByRole("heading", { name: /^All members/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Delete Filtered/ })).toHaveCount(0);
  await pick(admin, "Center", "Filtertown");
  await expect(list.getByRole("heading", { name: "Matching members (4)" })).toBeVisible();
  await pick(admin, "Gender", "Female");
  await pick(admin, "Member source", "Quick Member");
  await expect(list.getByRole("heading", { name: "Matching members (2)" })).toBeVisible();
  await list.getByRole("button", { name: "Delete Filtered (2)" }).click();
  const dialog = admin.getByRole("dialog", { name: "Delete filtered members" });
  await expect(dialog.getByRole("list", { name: "Filters in use" })).toContainText("Center: Filtertown");
  await expect(dialog.getByRole("list", { name: "Filters in use" })).toContainText("Gender: Female");
  await expect(dialog.getByRole("list", { name: "Filters in use" })).toContainText("Member source: Quick Member");
  await dialog.getByLabel("Admin password").fill("wrong-password");
  await dialog.getByRole("button", { name: "Delete 2 Members" }).click();
  await expect(dialog).toContainText("That password isn't right");

  // Someone new who matches arrives meanwhile: nothing is deleted until Admin has seen the new count.
  const late = await add("Filter Late", "Female", "quick_entry");
  await dialog.getByLabel("Admin password").fill(TEST_PASSWORD);
  await dialog.getByRole("button", { name: "Delete 2 Members" }).click();
  await expect(dialog).toContainText("The list changed while this was open: 3 members now match");
  expect((await db`select count(*)::int as n from members where center = 'Filtertown'`)[0].n).toBe(5);
  await dialog.getByRole("button", { name: "Delete 3 Members" }).click();
  await expect(admin.getByRole("status")).toContainText("Deleted 3 members, with 1 attendance mark.");
  await expect(dialog).toBeHidden();
  await expect(list.getByText("No member matches these filters")).toBeVisible();

  const left = await db`select id from members where center = 'Filtertown' order by id`;
  expect(left.map((m) => m.id)).toEqual([male, registered]);
  expect((await db`select count(*)::int as n from attendance where member_id = ${present}`)[0].n).toBe(0);
  const [log] = await db`select details from audit_log where action = 'member.delete_filtered' order by id desc limit 1`;
  expect(log.details.deleted).toBe(3);
  expect(log.details.members.map((m: { id: number }) => m.id).sort((a: number, b: number) => a - b)).toEqual([present, never, late]);
  expect(log.details.attendance.length).toBe(1);

  // Clear filters brings back everyone.
  await list.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(list.getByRole("heading", { name: /^All members/ })).toBeVisible();
});

test("no screen threw an error during this whole run", () => {
  expect(pageErrors).toEqual([]);
});

test("login locks briefly after repeated wrong passwords", async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    const res = await logIn(request, "female.officer", "nope");
    expect(res.status()).toBe(401);
  }
  const locked = await logIn(request, "female.officer");
  expect(locked.status()).toBe(429);
  // Devices already logged in on this account carry on working during the lockout.
  expect((await officer2Api.get("/api/events")).status()).toBe(200);
  await db`update app_users set locked_until = null where username = 'female.officer'`;
  const fine = await logIn(request, "female.officer");
  expect(fine.status()).toBe(200);
});

test("set-password sets a chosen password, logs out that account's devices, and refuses bad input", async ({ request }) => {
  const run = (username: string, password: string) =>
    spawnSync("npx", ["tsx", "scripts/set-password.ts", username], { env: { ...process.env, DATABASE_URL: TEST_DB, NEW_PASSWORD: password }, encoding: "utf8" });

  const before = (await db`select session_version from app_users where username = 'female.officer'`)[0].session_version as number;
  const done = run("female.officer", "Chosen@Pass20");
  expect(done.status).toBe(0);
  expect(done.stdout + done.stderr).not.toContain("Chosen@Pass20"); // never printed
  expect((await logIn(request, "female.officer", "Chosen@Pass20")).status()).toBe(200);
  expect((await logIn(request, "female.officer")).status()).toBe(401);
  // Devices already signed in have to log in again.
  expect((await db`select session_version from app_users where username = 'female.officer'`)[0].session_version).toBe(before + 1);
  expect((await officer2Api.get("/api/events")).status()).toBe(401);

  const short = run("female.officer", "short");
  expect(short.status).not.toBe(0);
  expect(short.stderr).toContain("at least 8");
  expect(run("someone.else", "Chosen@Pass20").status).not.toBe(0);
  expect((await logIn(request, "female.officer", "Chosen@Pass20")).status()).toBe(200); // unchanged by the refusals

  expect(run("female.officer", TEST_PASSWORD).status).toBe(0);
  expect((await logIn(request, "female.officer")).status()).toBe(200);
});
