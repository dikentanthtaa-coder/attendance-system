import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { SignJWT } from "jose";
import postgres from "postgres";
import { TEST_DB } from "../playwright.config";
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

const LOGIN_LABEL = "Email, Mobile or Username";

const OFFICER = { firstName: "Asha", lastName: "Mehta", mobile: "9000011111", email: "asha.mehta@gmail.com" };
const OFFICER2 = { firstName: "Bharat", lastName: "Joshi", mobile: "9000022222", email: "bharat@yahoo.com" };
const OFFICER_NAME = "Asha Mehta";

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
const pick = async (page: Page, label: string, option: string) => {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const upload = (api: APIRequestContext, buffer: Buffer, name = "members.xlsx") =>
  api.post("/api/admin/members/import", {
    multipart: { file: { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer } },
  });
const setEvent = (api: APIRequestContext, day: number, action: string) =>
  api.post(`/api/admin/events/${day}`, { data: { action } });
const mark = (api: APIRequestContext, memberId: number, eventDay: number, status?: "present" | "absent") =>
  api.post("/api/officer/attendance", { data: { memberId, eventDay, status } });
const register = (api: APIRequestContext, data: object) =>
  api.post("/api/auth/register", { data: { password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD, ...data } });
const logIn = (api: APIRequestContext, username: string, password = TEST_PASSWORD) =>
  api.post("/api/auth/login", { data: { username, password } });
const search = async (api: APIRequestContext, q: string, day = 1) => {
  const res = await api.get(`/api/officer/search?day=${day}&q=${encodeURIComponent(q)}`);
  expect(res.status()).toBe(200);
  return (await res.json()).results as { id: number; name: string; global_member_id: string; mobile: string; gender: string; center: string; attendance_status: string | null }[];
};
const memberId = async (globalId: string) => (await db`select id from members where global_member_id = ${globalId}`)[0].id as number;
const quick = (api: APIRequestContext, data: object) =>
  api.post("/api/officer/quick-entry", { data: { eventDay: 1, center: "Vapi", gender: "Male", ...data } });

let admin: Page, officer: Page, officer2: Page;
let adminApi: APIRequestContext, officerApi: APIRequestContext, officer2Api: APIRequestContext;

test("login: wrong password refused, pages closed, Admin can log in", async ({ browser, page }) => {
  await page.goto("/");
  await page.waitForURL("**/login");

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
  await expect(page.getByText("Wrong login details or password.")).toBeVisible();

  for (const route of ["/admin", "/officer", "/admin/members", "/admin/officers"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
  }

  admin = await loginPage(browser, "admin");
  adminApi = apiOf(admin);

  // First run: the dashboard says what to do first.
  await expect(admin.getByText("No members yet.")).toBeVisible();

  const hash = (await db`select password_hash from app_users where username = 'admin'`)[0].password_hash as string;
  expect(hash).toMatch(/^\$2[aby]\$12\$/);
});

test("registration: fields are checked on the server, and nobody can register themselves into access", async ({ request }) => {
  const valid = { ...OFFICER, email: "checks@gmail.com", mobile: "9000033333" };
  const bad: [object, string][] = [
    [{ firstName: "" }, "First name is required."],
    [{ lastName: "   " }, "Last name is required."],
    [{ mobile: "12345" }, "10-digit"],
    [{ email: "not-an-email" }, "valid email"],
    [{ password: "short", confirmPassword: "short" }, "at least 8"],
    [{ confirmPassword: "something-else" }, "don't match"],
    [{ password: "x".repeat(73), confirmPassword: "x".repeat(73) }, "too long"],
  ];
  for (const [change, message] of bad) {
    const res = await register(request, { ...valid, ...change });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain(message);
  }
  expect((await db`select count(*)::int as n from app_users where email = 'checks@gmail.com'`)[0].n).toBe(0);

  // Asking for more access in the request does nothing.
  const forged = await register(request, { ...valid, role: "admin", approval_status: "approved", approvalStatus: "approved", is_active: true });
  expect(forged.status()).toBe(201);
  const [row] = await db`select role, approval_status, display_name, mobile, password_hash from app_users where email = 'checks@gmail.com'`;
  expect(row).toMatchObject({ role: "officer", approval_status: "pending", display_name: "Asha Mehta", mobile: "9000033333" });
  expect(row.password_hash).toMatch(/^\$2[aby]\$12\$/);

  // One registration per email and per mobile, however they're typed, including at the same moment.
  const again = await register(request, { ...valid, mobile: "9000044444", email: "CHECKS@gmail.com" });
  expect(again.status()).toBe(409);
  expect((await again.json()).message).toContain("email is already registered");
  const sameMobile = await register(request, { ...valid, email: "other@gmail.com", mobile: "+91 90000 33333" });
  expect(sameMobile.status()).toBe(409);
  expect((await sameMobile.json()).message).toContain("mobile number is already registered");
  const race = await Promise.all([0, 1, 2, 3].map(() => register(request, { ...valid, email: "race@gmail.com", mobile: "9000055555" })));
  expect(race.map((r) => r.status()).sort()).toEqual([201, 409, 409, 409]);

  // Waiting accounts can't log in, and only the right password learns why.
  const wrong = await logIn(request, "checks@gmail.com", "wrong-password");
  expect(wrong.status()).toBe(401);
  const waiting = await logIn(request, "checks@gmail.com");
  expect(waiting.status()).toBe(403);
  expect((await waiting.json()).code).toBe("pending_approval");
  expect((await request.get("/api/events")).status()).toBe(401);

  // Clean up, so these don't count as officers waiting for approval in later tests.
  await db`delete from audit_log where username in ('checks@gmail.com', 'race@gmail.com')`;
  await db`delete from app_users where email in ('checks@gmail.com', 'race@gmail.com')`;
});

test("an officer registers on the page, Admin approves, and they log in with email or mobile", async ({ browser, page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Register here" }).click();
  await page.waitForURL("**/register");

  await page.getByLabel("First Name").fill(OFFICER.firstName);
  await page.getByLabel("Last Name").fill(OFFICER.lastName);
  await page.getByLabel("Mobile Number").fill(OFFICER.mobile);
  await page.getByLabel("Email").fill(OFFICER.email);
  await page.getByLabel("Set Password").fill(TEST_PASSWORD);
  await page.getByLabel("Confirm Password").fill("not-the-same");
  await expect(page.getByText("The two passwords don't match yet.")).toBeVisible();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  expect((await db`select count(*)::int as n from app_users where email = ${OFFICER.email}`)[0].n).toBe(0);
  
  await page.getByLabel("Confirm Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration received" })).toBeVisible();

  // Not logged in, and the login page says why.
  await page.getByRole("link", { name: "Back to log in" }).click();
  await page.getByLabel(LOGIN_LABEL).fill(OFFICER.email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("waiting for Admin to approve")).toBeVisible();
  await page.goto("/officer");
  await expect(page).toHaveURL(/\/login$/);

  // Admin sees it on the dashboard and approves it on the Officers page.
  expect((await register(page.context().request, OFFICER2)).status()).toBe(201);
  await admin.goto("/admin");
  await expect(admin.getByText("2 new officers are waiting for your approval.")).toBeVisible();
  await admin.getByRole("link", { name: "Review" }).click();
  await admin.waitForURL("**/admin/officers");
  await expect(admin.getByRole("region", { name: "Officer list" }).getByRole("row").nth(1)).toBeVisible();
  await admin.screenshot({ path: "test-results/screens/officers-desktop.png" });
  const asha = admin.getByRole("row").filter({ hasText: OFFICER_NAME });
  await expect(asha).toContainText("Waiting for approval");
  await expect(asha).toContainText(OFFICER.email);
  await expect(asha).toContainText(OFFICER.mobile);
  await asha.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByRole("status")).toContainText(`Approved: ${OFFICER_NAME}`);
  await expect(asha).toContainText("Approved");
  await admin.getByRole("row").filter({ hasText: "Bharat Joshi" }).getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByRole("row").filter({ hasText: "Bharat Joshi" })).toContainText("Approved");

  const [approved] = await db`select approval_status, reviewed_at, reviewed_by from app_users where email = ${OFFICER.email}`;
  expect(approved.approval_status).toBe("approved");
  expect(approved.reviewed_at).toBeInstanceOf(Date);

  // Either one works as the login, however the number is typed.
  officer = await loginPage(browser, OFFICER.email, { width: 390, height: 844 });
  officer2 = await loginPage(browser, "+91 90000 22222");
  [officerApi, officer2Api] = [apiOf(officer), apiOf(officer2)];
  await expect(officer.getByText(`${OFFICER_NAME} · Attendance Officer`)).toBeVisible();
});

test("Admin can reject an officer or remove access, and it takes effect at once", async ({ browser, request }) => {
  const person = { firstName: "Chirag", lastName: "Shah", mobile: "9000066666", email: "chirag@gmail.com" };
  expect((await register(request, person)).status()).toBe(201);
  const [{ id }] = await db`select id from app_users where email = ${person.email}`;

  await admin.goto("/admin/officers");
  const row = admin.getByRole("row").filter({ hasText: "Chirag Shah" });
  await row.getByRole("button", { name: "Reject" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
  await expect(row).toContainText("No access");
  const refused = await logIn(request, person.email);
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("no_access");

  await row.getByRole("button", { name: "Restore access" }).click();
  await expect(row).toContainText("Approved");
  const page = await loginPage(browser, person.email);
  await expect(page.getByLabel(/Search by Member ID/).or(page.getByText("Not Started").first())).toBeVisible();

  // Already logged in: the next request is refused, and the screen goes back to login by itself.
  await row.getByRole("button", { name: "Remove access" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Remove Access" }).click();
  await expect(row).toContainText("No access");
  expect((await apiOf(page).get("/api/events")).status()).toBe(401);
  await page.waitForURL("**/login", { timeout: 8000 });

  // Only Admin can do this, it can't touch Admin's own account, and it's filterable.
  expect((await officerApi.get("/api/admin/officers")).status()).toBe(403);
  expect((await officerApi.patch(`/api/admin/officers/${id}`, { data: { action: "approve" } })).status()).toBe(403);
  const [adminRow] = await db`select id from app_users where username = 'admin'`;
  expect((await adminApi.patch(`/api/admin/officers/${adminRow.id}`, { data: { action: "reject" } })).status()).toBe(404);
  await pick(admin, "Status", "Approved");
  await expect(admin.getByRole("row").filter({ hasText: "Chirag Shah" })).toHaveCount(0);
  await expect(admin.getByRole("row").filter({ hasText: OFFICER_NAME })).toHaveCount(1);
});

test("reset password: temporary password shown once, old logins end, and a new password must be chosen", async ({ browser, request }) => {
  const person = { firstName: "Dev", lastName: "Rana", mobile: "9000077777", email: "dev.rana@gmail.com" };
  expect((await register(request, person)).status()).toBe(201);
  const [{ id }] = await db`select id from app_users where email = ${person.email}`;

  // Not offered, and refused, until they're approved. Officers and strangers can't do it at all.
  await admin.goto("/admin/officers");
  await pick(admin, "Status", "All officers");
  const row = admin.getByRole("row").filter({ hasText: "Dev Rana" });
  await expect(row).toContainText("Waiting for approval");
  await expect(row.getByRole("button", { name: "Reset password" })).toHaveCount(0);
  expect((await adminApi.post(`/api/admin/officers/${id}/reset-password`, { data: {} })).status()).toBe(404);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toContainText("Approved");
  expect((await request.post(`/api/admin/officers/${id}/reset-password`, { data: {} })).status()).toBe(401);
  expect((await officerApi.post(`/api/admin/officers/${id}/reset-password`, { data: {} })).status()).toBe(403);
  const [adminRow] = await db`select id, password_hash from app_users where username = 'admin'`;
  expect((await adminApi.post(`/api/admin/officers/${adminRow.id}/reset-password`, { data: {} })).status()).toBe(404);
  expect((await db`select password_hash from app_users where username = 'admin'`)[0].password_hash).toBe(adminRow.password_hash);

  // Logged in on a device, and locked out from guessing.
  const device = await loginPage(browser, person.email);
  for (let i = 0; i < 5; i++) await logIn(request, person.email, "wrong-guess");
  expect((await logIn(request, person.email)).status()).toBe(429);

  await admin.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await row.getByRole("button", { name: "Reset password" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Reset Password" }).click();
  const shown = admin.getByTestId("temporary-password");
  await expect(shown).toBeVisible();
  const temporary = (await shown.textContent())!.trim();
  expect(temporary).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/);
  await admin.getByRole("dialog").getByRole("button", { name: "Copy" }).click();
  await expect(admin.getByRole("dialog").getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(temporary);
  await admin.screenshot({ path: "test-results/screens/reset-password-dialog.png" });
  await admin.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(shown).toHaveCount(0);

  // The old password and the old device stop working at once, and the lockout is cleared.
  expect((await apiOf(device).get("/api/events")).status()).toBe(401);
  await device.waitForURL("**/login", { timeout: 8000 });
  expect((await logIn(request, person.email)).status()).toBe(401);

  // Only a hash is stored, and the password isn't in the log.
  const [stored] = await db`select password_hash, must_change_password from app_users where id = ${id}`;
  expect(stored.password_hash).toMatch(/^\$2[aby]\$12\$/);
  expect(stored.must_change_password).toBe(true);
  expect((await db`select count(*)::int as n from audit_log where action = 'officer.password_reset' and entity_id = ${id}`)[0].n).toBe(1);
  expect((await db`select count(*)::int as n from audit_log where details::text like ${`%${temporary}%`}`)[0].n).toBe(0);

  // With the temporary password, the only thing they can do is choose a new one.
  await device.getByLabel(LOGIN_LABEL).fill(person.mobile);
  await device.getByLabel("Password", { exact: true }).fill(temporary);
  await device.getByRole("button", { name: "Log in" }).click();
  await device.waitForURL("**/change-password");
  await device.screenshot({ path: "test-results/screens/change-password.png" });
  const api = apiOf(device);
  for (const path of ["/api/events", "/api/officer/search?day=1&q=a"]) {
    const blocked = await api.get(path);
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).code).toBe("password_change_required");
  }
  expect((await api.post("/api/officer/attendance", { data: { memberId: 1, eventDay: 1 } })).status()).toBe(403);
  await device.goto("/officer");
  await expect(device).toHaveURL(/\/change-password$/);
  await device.goto("/");
  await expect(device).toHaveURL(/\/change-password$/);

  const change = (password: string, confirmPassword = password) => api.post("/api/auth/change-password", { data: { password, confirmPassword } });
  expect((await change("short")).status()).toBe(400);
  expect((await change("long-enough-1", "long-enough-2")).status()).toBe(400);
  const same = await change(temporary);
  expect(same.status()).toBe(400);
  expect((await same.json()).code).toBe("same_password");
  expect((await request.post("/api/auth/change-password", { data: { password: "long-enough-1", confirmPassword: "long-enough-1" } })).status()).toBe(401);

  const fresh = "my-own-password-9";
  await device.getByLabel("New Password").fill(fresh);
  await device.getByLabel("Confirm Password").fill("something-else");
  await expect(device.getByText("The two passwords don't match yet.")).toBeVisible();
  await device.getByLabel("Confirm Password").fill(fresh);
  await device.getByRole("button", { name: "Save New Password" }).click();
  await device.waitForURL("**/officer");
  expect((await apiOf(device).get("/api/events")).status()).toBe(200);
  await device.goto("/change-password");
  await expect(device).toHaveURL(/\/officer$/);

  expect((await logIn(request, person.email, temporary)).status()).toBe(401);
  expect((await logIn(request, person.email, fresh)).status()).toBe(200);
  expect((await db`select must_change_password as m from app_users where id = ${id}`)[0].m).toBe(false);
  await device.context().close();

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
  expect((await officerApi.get("/api/admin/report/export")).status()).toBe(403);
  expect((await setEvent(officerApi, 1, "start")).status()).toBe(403);
  expect((await upload(officerApi, await xlsx([]))).status()).toBe(403);
  expect((await officerApi.delete("/api/admin/members/1")).status()).toBe(403);
  expect((await officerApi.post("/api/admin/attendance/1/correct", { data: { action: "remove", reason: "x" } })).status()).toBe(403);
  // Admin on officer endpoints
  expect((await adminApi.get("/api/officer/search?day=1&q=a")).status()).toBe(403);
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
    [6, 3002, "Bad Gender", "9876500006", "M", "Vapi"],
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
  await expect(summary.locator("dd")).toHaveText(["9", "5", "0", "4"]);
  await expect(summary).toContainText('Gender "M" must be Male or Female');
  await expect(summary).toContainText("not a valid 10-digit number");
  await expect(summary).toContainText("Name is missing");
  await expect(summary).toContainText("repeated (first seen on row 2)");

  // Numbers typed differently all normalize; a listed center's casing is folded.
  const [raju] = await db`select mobile, center, gender from members where global_member_id = '2052'`;
  expect(raju).toMatchObject({ mobile: "9876500002", center: "Varachha", gender: "Male" });

  const before = (await db`select count(*)::int as n from members`)[0].n;
  const again = await (await upload(adminApi, await xlsx([
    [1, 2051, "Ramesh K Patel", 9876500001, "Male", "Varachha"],
    [2, "", "No Id Man", "9876500005", "Male", "Navsari"],
  ]))).json();
  expect(again).toMatchObject({ totalRows: 2, imported: 0, updated: 2, errorRows: 0 });
  expect((await db`select count(*)::int as n from members`)[0].n).toBe(before);
  expect((await db`select name from members where global_member_id = '2051'`)[0].name).toBe("Ramesh K Patel");
  expect((await db`select center from members where name = 'No Id Man'`)[0].center).toBe("Navsari");
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

test("search: partial ID, name and mobile, across all members whatever the officer", async () => {
  const ids = (await search(officerApi, "205")).map((r) => r.global_member_id);
  expect(ids).toEqual(["2051", "2052", "2053"]);
  expect((await search(officer2Api, "205")).map((r) => r.global_member_id)).toEqual(["2051", "2052", "2053"]);

  expect((await search(officerApi, "ra pa")).map((r) => r.global_member_id)).toEqual(expect.arrayContaining(["2051", "2052", "2053"]));
  expect((await search(officerApi, "ram pat")).map((r) => r.name)).toEqual(["Ramesh K Patel"]);
  expect((await search(officerApi, "RAM PAT")).length).toBe(1);
  expect((await search(officerApi, "radha"))[0]).toMatchObject({ name: "Radha Patel", gender: "Female" });

  const byMobile = await search(officerApi, "500004");
  expect(byMobile.map((r) => r.name)).toEqual(["Suresh Shah"]);

  const [row] = await search(officerApi, "3001");
  expect(row).toMatchObject({ global_member_id: "3001", name: "Suresh Shah", mobile: "9876500004", center: "Bharuch" });

  // LIKE wildcards and SQL are treated as plain text.
  expect(await search(officerApi, "%")).toEqual([]);
  expect(await search(officerApi, "_")).toEqual([]);
  expect(await search(officerApi, "' or 1=1 --")).toEqual([]);
});

test("mark attendance through the UI on a phone, then Already Present", async () => {
  await officer.goto("/officer");
  const box = officer.getByLabel(/Search by Member ID/);
  await box.fill("300");
  const row = officer.getByRole("listitem").filter({ hasText: "Suresh Shah" });
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
  await expect(officer.getByRole("listitem").filter({ hasText: "Suresh Shah" })).toContainText("Already Present");

  const [record] = await db`
    select a.event_day, a.marked_at, u.username, a.status from attendance a
    join app_users u on u.id = a.marked_by join members m on m.id = a.member_id
    where m.global_member_id = '3001'`;
  expect(record).toMatchObject({ event_day: 1, username: OFFICER.email, status: "present" });
  expect(record.marked_at).toBeInstanceOf(Date);
});

test("Enter marks only when there is exactly one match", async () => {
  await officer.goto("/officer");
  const box = officer.getByLabel(/Search by Member ID/);
  await box.fill("205");
  await expect(officer.getByRole("button", { name: "Mark Present" })).toHaveCount(3);
  await box.press("Enter");
  await expect(officer.getByRole("status")).toHaveCount(0);
  expect((await db`select count(*)::int as n from attendance a join members m on m.id=a.member_id where m.global_member_id in ('2051','2052')`)[0].n).toBe(0);

  await box.fill("2051");
  await expect(officer.getByRole("button", { name: "Mark Present" })).toHaveCount(1);
  await box.press("Enter");
  await expect(officer.getByRole("status")).toContainText("Present: Ramesh K Patel");
});

test("any officer can mark any member, and a second officer sees it's already done", async () => {
  const radha = await memberId("2053");
  expect((await (await mark(officer2Api, radha, 1)).json()).status).toBe("marked");
  const second = await (await mark(officerApi, radha, 1)).json();
  expect(second).toMatchObject({ status: "already_present", markedBy: "Bharat Joshi" });
  expect((await db`select count(*)::int as n from attendance where member_id = ${radha}`)[0].n).toBe(1);
});

test("absent: an officer can mark it, late arrivals can become present, but present can never be undone", async () => {
  const addMember = async (id: string, name: string, mobile: string) => {
    await db`insert into members (global_member_id, name, mobile, gender, center, created_source) values (${id}, ${name}, ${mobile}, 'Male', 'Vapi', 'excel_import')`;
    return memberId(id);
  };
  const statusOf = async (id: number) => (await db`select status, marked_by from attendance where member_id = ${id} and event_day = 1`)[0];

  // On the screen: two buttons, then a confirmation, then only the allowed one left.
  const late = await addMember("4001", "Late Lalit", "9876540001");
  await officer.goto("/officer");
  const box = officer.getByLabel(/Search by Member ID/);
  await box.fill("4001");
  const row = officer.getByRole("listitem").filter({ hasText: "Late Lalit" });
  await expect(row.getByRole("button", { name: "Mark Present" })).toBeVisible();
  await officer.screenshot({ path: "test-results/screens/officer-mark-phone.png" });
  await row.getByRole("button", { name: "Mark Absent" }).click();
  await expect(officer.getByRole("status")).toContainText("Absent: Late Lalit");
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  expect((await statusOf(late)).status).toBe("absent");

  await box.fill("4001");
  await expect(row).toContainText("Absent");
  await expect(row.getByRole("button", { name: "Mark Absent" })).toHaveCount(0);

  // They arrive late.
  await row.getByRole("button", { name: "Mark Present" }).click();
  await expect(officer.getByRole("status")).toContainText("Present: Late Lalit");
  expect((await statusOf(late)).status).toBe("present");
  const [log] = await db`select details from audit_log where action = 'attendance.mark' and details->>'member_id' = ${String(late)} order by id desc limit 1`;
  expect(log.details).toMatchObject({ status: "present", previous_status: "absent" });

  // Present is final for an officer: no button on screen, and a forged request changes nothing.
  await box.fill("4001");
  await expect(row).toContainText("Already Present");
  await expect(row.getByRole("button")).toHaveCount(0);
  const undo = await (await mark(officerApi, late, 1, "absent")).json();
  expect(undo.status).toBe("already_present");
  const undo2 = await (await mark(officer2Api, late, 1, "absent")).json();
  expect(undo2.status).toBe("already_present");
  expect(await statusOf(late)).toMatchObject({ status: "present" });

  // Marking absent twice is harmless, and whichever order two taps land in, Present wins.
  const absent = await addMember("4002", "Absent Anil", "9876540002");
  expect((await (await mark(officerApi, absent, 1, "absent")).json())).toMatchObject({ status: "marked", attendance: "absent" });
  expect((await (await mark(officer2Api, absent, 1, "absent")).json()).status).toBe("already_absent");
  expect((await statusOf(absent)).status).toBe("absent");
  const raced = await addMember("4003", "Raced Ravi", "9876540003");
  await Promise.all([mark(officerApi, raced, 1, "absent"), mark(officer2Api, raced, 1, "present"), mark(officerApi, raced, 1, "absent")]);
  expect((await statusOf(raced)).status).toBe("present");

  // Officers have no way to remove attendance at all, and can't send a made-up status.
  const [record] = await db`select id from attendance where member_id = ${late} and event_day = 1`;
  expect((await officerApi.post(`/api/admin/attendance/${record.id}/correct`, { data: { action: "remove", reason: "x" } })).status()).toBe(403);
  expect((await officerApi.post(`/api/admin/attendance/${record.id}/correct`, { data: { action: "absent", reason: "x" } })).status()).toBe(403);
  expect((await officerApi.delete(`/api/admin/members/${late}`)).status()).toBe(403);
  expect((await mark(officerApi, late, 1, "cancelled" as "absent")).status()).toBe(400);
  expect(await statusOf(late)).toMatchObject({ status: "present" });
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
  await expect(dialog).toContainText("marked present for Gyansatr Day 1");

  // The officer's account no longer decides gender, so it has to be chosen.
  await dialog.getByRole("combobox", { name: "Gender" }).click();
  await dialog.getByRole("option", { name: "Male", exact: true }).click();

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

test("Quick Entry on the server: gender required, confirmation required, Other center, ID collisions", async () => {
  const noConfirm = await quick(officer2Api, { name: "Family Member", mobile: "9876500004", gender: "Female" });
  expect(noConfirm.status()).toBe(409);
  const body = await noConfirm.json();
  expect(body.code).toBe("duplicate_mobile");
  expect(body.matches).toEqual(["Suresh Shah"]);
  expect((await db`select count(*)::int as n from members where name = 'Family Member'`)[0].n).toBe(0);

  const saved = await quick(officer2Api, { name: "Family Member", mobile: "9876500004", confirmDuplicateMobile: true, gender: "Female", center: "Surat" });
  expect(saved.status()).toBe(200);
  expect((await db`select gender, center from members where name = 'Family Member'`)[0]).toMatchObject({ gender: "Female", center: "Surat" });

  // Member ID already taken: names the holder so the officer can search instead.
  const taken = await quick(officer2Api, { name: "X", mobile: "9000000002", globalMemberId: "3001" });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).message).toContain("Suresh Shah");

  for (const bad of [{ name: "", mobile: "9000000003" }, { name: "Y", mobile: "123" }, { name: "Y", mobile: "9000000003", center: "" }, { name: "Y", mobile: "9000000003", gender: "" }, { name: "Y", mobile: "9000000003", gender: "Other" }]) {
    expect((await quick(officerApi, bad)).status()).toBe(400);
  }

  // A later Excel file supplying an ID links to the Quick Entry member instead of duplicating.
  const ok = await quick(officerApi, { name: "Later Linked", mobile: "9000000004" });
  expect(ok.status()).toBe(200);
  const res = await (await upload(adminApi, await xlsx([[1, "7001", "later linked", "9000000004", "Male", "Vapi"]]))).json();
  expect(res).toMatchObject({ imported: 0, updated: 1 });
  const linked = await db`select global_member_id, created_source from members where mobile = '9000000004'`;
  expect(linked.length).toBe(1);
  expect(linked[0]).toMatchObject({ global_member_id: "7001", created_source: "quick_entry" });
});

test("ending the event stops marking at once, and the officer's screen locks by itself", async () => {
  await officer.goto("/officer");
  await expect(officer.getByLabel(/Search by Member ID/)).toBeVisible();

  await admin.goto("/admin");
  const card = admin.getByRole("article").filter({ hasText: "Gyansatr Day 1" });
  await card.getByRole("button", { name: "End Event" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "End Event" }).click();
  await expect(card).toContainText("Ended");

  // The server refuses straight away, before any screen has refreshed.
  const res = await mark(officerApi, await memberId("2051"), 1);
  expect(res.status()).toBe(409);
  expect((await quick(officerApi, { name: "Too Late", mobile: "9000000009" })).status()).toBe(409);

  await expect(officer.getByLabel(/Search by Member ID/)).toHaveCount(0, { timeout: 8000 });
  await expect(officer.getByText("This event has ended")).toBeVisible();
});

test("each day's attendance is separate, and the officer follows the newly active day", async () => {
  expect((await setEvent(adminApi, 2, "start")).status()).toBe(200);
  await expect(officer.getByLabel(/Search by Member ID/)).toBeVisible({ timeout: 8000 });
  await expect(officer.getByRole("heading", { name: "Marking Gyansatr Day 2" })).toBeVisible();

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

  await pick(admin, "Event", "Gyansatr Day 2");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and a.event_day=2")));
  await pick(admin, "Event", "All Days");

  await pick(admin, "Gender", "Female");
  await expect(admin.getByTestId("stat-male")).toHaveText("0");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.gender='Female'")));
  await pick(admin, "Gender", "All");

  await pick(admin, "Center", "Bharuch");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.center='Bharuch'")));
  await pick(admin, "Center", "All Centers");

  await pick(admin, "Member source", "Quick Entry");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.created_source='quick_entry'")));
  await expect(admin.getByRole("region", { name: "Attendance records" })).toContainText("Quick Entry");
  await pick(admin, "Member source", "All");

  // Absent is counted on its own, and never as an attendee.
  const absent = (await db`select count(*)::int as n from attendance where status = 'absent'`)[0].n as number;
  expect(absent).toBeGreaterThan(0);
  await expect(admin.getByTestId("stat-absent")).toHaveText(String(absent));
  await pick(admin, "Status", "Absent");
  await expect(admin.getByTestId("stat-total")).toHaveText("0");
  await expect(admin.getByRole("region", { name: "Attendance records" })).toContainText("Absent Anil");
  await expect(admin.getByRole("region", { name: "Attendance records" })).not.toContainText("Suresh Shah");
  await pick(admin, "Status", "All");

  const quickToday = (await db`select count(*)::int as n from members where created_source = 'quick_entry'`)[0].n;
  await expect(admin.getByTestId("stat-quick")).toHaveText(String(quickToday));
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

test("Excel export contains exactly the filtered data, and tells the sources apart", async () => {
  await admin.goto("/admin");
  await pick(admin, "Gender", "Male");
  await pick(admin, "Event", "Gyansatr Day 1");
  await expect(admin.getByTestId("stat-female")).toHaveText("0");

  const [download] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Export to Excel" }).click()]);
  expect(download.suggestedFilename()).toBe("attendance_day-1_male.xlsx");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await download.path());
  const data = wb.getWorksheet("Attendance")!;
  const rows: string[][] = [];
  data.eachRow((row, n) => {
    if (n > 1) rows.push((row.values as string[]).slice(1).map(String));
  });
  const expected = (await db`
    select count(*)::int as n from attendance a join members m on m.id = a.member_id
    where a.status in ('present', 'absent') and a.event_day=1 and m.gender='Male'`)[0].n;
  expect(rows.length).toBe(expected);
  expect(rows.find((r) => r[2] === "Absent Anil")?.[10]).toBe("Absent");
  expect(rows.find((r) => r[2] === "Suresh Shah")?.[10]).toBe("Present");
  expect(rows.every((r) => r[4] === "Male" && r[6] === "Gyansatr Day 1")).toBe(true);
  expect(new Set(rows.map((r) => r[9]))).toEqual(new Set(["Excel Import", "Quick Entry"]));
  expect(rows.find((r) => r[2] === "Suresh Shah")?.[8]).toBe(OFFICER_NAME);

  const summary = wb.getWorksheet("Summary")!;
  const cells = new Map<string, unknown>();
  summary.eachRow((row) => {
    // "Event" is also a table header further down; the filter block comes first.
    const key = String(row.getCell(1).value);
    if (!cells.has(key)) cells.set(key, row.getCell(2).value);
  });
  expect(cells.get("Gender")).toBe("Male");
  expect(cells.get("Event")).toBe("Gyansatr Day 1");
  expect(cells.get("Combined attendees")).toBe(rows.filter((r) => r[10] === "Present").length);
  expect(cells.get("Marked absent")).toBe(rows.filter((r) => r[10] === "Absent").length);
});

test("Admin corrections: change or remove attendance with a reason, logged, and re-markable", async () => {
  await admin.goto("/admin");
  const correct = async (name: string) => {
    await admin.getByRole("row").filter({ hasText: name }).first().getByRole("button", { name: "Correct" }).click();
    return admin.getByRole("dialog");
  };

  // Present to Absent is the change officers can't make.
  const ramesh = await memberId("2051");
  let dialog = await correct("Ramesh K Patel");
  await expect(dialog.getByRole("button", { name: "Change to Absent" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Left before the session");
  await dialog.getByRole("button", { name: "Change to Absent" }).click();
  await expect(admin.getByRole("status")).toContainText("Changed to Absent.");
  await expect(admin.getByRole("row").filter({ hasText: "Ramesh K Patel" }).first()).toContainText("Absent");
  expect((await db`select status from attendance where member_id = ${ramesh} and event_day = 1`)[0].status).toBe("absent");

  // And back.
  dialog = await correct("Ramesh K Patel");
  await dialog.getByLabel("Reason").fill("Came back");
  await dialog.getByRole("button", { name: "Change to Present" }).click();
  await expect(admin.getByRole("row").filter({ hasText: "Ramesh K Patel" }).first()).toContainText("Present");
  const [log] = await db`select details from audit_log where action = 'attendance.correct' order by id desc limit 1`;
  expect(log.details).toMatchObject({ reason: "Came back", previous_status: "absent", status: "present", member_name: "Ramesh K Patel" });

  // Removing.
  dialog = await correct("Raju Pandya");
  await pick(admin, "What should change?", "Remove this attendance");
  await expect(dialog.getByRole("button", { name: "Remove Attendance" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Marked by mistake");
  await dialog.getByRole("button", { name: "Remove Attendance" }).click();
  await expect(admin.getByRole("status")).toContainText("Attendance removed");
  await expect(admin.getByRole("row").filter({ hasText: "Raju Pandya" })).toHaveCount(0);

  const id = await memberId("2052");
  const [a] = await db`select status, cancel_reason from attendance where member_id = ${id} and event_day = 1`;
  expect(a).toMatchObject({ status: "cancelled", cancel_reason: "Marked by mistake" });

  // Officer can't cancel
  expect((await officerApi.post("/api/admin/attendance/1/correct", { data: { action: "remove", reason: "x" } })).status()).toBe(403);
  // The old route is gone, so there's only the one way in.
  expect((await adminApi.post("/api/admin/attendance/1/cancel", { data: { reason: "x" } })).status()).toBe(404);

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

  const clash = await adminApi.patch(`/api/admin/members/${id}`, {
    data: { globalMemberId: "2051", name: "Suresh Shah", mobile: "9876500004", gender: "Male", center: "Vapi" },
  });
  expect(clash.status()).toBe(409);

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
    "attendance.mark", "attendance.cancel", "attendance.correct", "member.quick_entry", "member.edit", "member.delete",
    "officer.register", "officer.approve", "officer.reject", "officer.password_reset", "auth.password_change",
  ]));
  expect((await db`select count(*)::int as n from audit_log where username = '' or at is null`)[0].n).toBe(0);

  // Recorded for the database only: there is no screen or API that shows it.
  await admin.goto("/admin");
  await expect(admin.getByRole("navigation", { name: "Admin" }).getByRole("link")).toHaveText(["Dashboard", "Members", "Officers"]);
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
  const buffer = await xlsx(rows);
  const started = Date.now();
  const res = await upload(adminApi, buffer, "big.xlsx");
  const uploadMs = Date.now() - started;
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ totalRows: 20000, imported: 20000, errorRows: 0 });

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
  // With members in place, the one-off upload box stays out of the way until asked for.
  await expect(admin.getByRole("button", { name: "Upload file" })).toBeHidden();
  await admin.getByRole("button", { name: "Upload Excel" }).click();
  await expect(admin.getByRole("button", { name: "Upload file" })).toBeVisible();
  await admin.getByRole("button", { name: "Upload Excel" }).click();
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
  await fresh.goto("/register");
  await fresh.screenshot({ path: `${dir}/register-phone.png`, fullPage: true });
  await fresh.setViewportSize({ width: 1280, height: 800 });
  await fresh.screenshot({ path: `${dir}/register-desktop.png` });
  await fresh.goto("/login");
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
  await admin.getByRole("button", { name: "Upload Excel" }).click();
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

test("no screen threw an error during this whole run", () => {
  expect(pageErrors).toEqual([]);
});

test("login locks briefly after repeated wrong passwords", async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    const res = await logIn(request, OFFICER2.email, "nope");
    expect(res.status()).toBe(401);
  }
  const locked = await logIn(request, OFFICER2.email);
  expect(locked.status()).toBe(429);
  await db`update app_users set locked_until = null where email = ${OFFICER2.email}`;
  const fine = await logIn(request, OFFICER2.email);
  expect(fine.status()).toBe(200);
});
