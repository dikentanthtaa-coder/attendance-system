import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
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
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(username === "admin" ? "**/admin" : "**/officer");
  return page;
}

const apiOf = (page: Page) => page.context().request;
const upload = (api: APIRequestContext, buffer: Buffer, name = "members.xlsx") =>
  api.post("/api/admin/members/import", {
    multipart: { file: { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer } },
  });
const setEvent = (api: APIRequestContext, day: number, action: string) =>
  api.post(`/api/admin/events/${day}`, { data: { action } });
const mark = (api: APIRequestContext, memberId: number, eventDay: number) =>
  api.post("/api/officer/attendance", { data: { memberId, eventDay } });
const search = async (api: APIRequestContext, q: string, day = 1) => {
  const res = await api.get(`/api/officer/search?day=${day}&q=${encodeURIComponent(q)}`);
  expect(res.status()).toBe(200);
  return (await res.json()).results as { id: number; name: string; global_member_id: string; mobile: string; center: string; present_at: string | null }[];
};
const memberId = async (globalId: string) => (await db`select id from members where global_member_id = ${globalId}`)[0].id as number;
const quick = (api: APIRequestContext, data: object) =>
  api.post("/api/officer/quick-entry", { data: { eventDay: 1, center: "Vapi", ...data } });

let admin: Page, male: Page, female: Page;
let adminApi: APIRequestContext, maleApi: APIRequestContext, femaleApi: APIRequestContext;

test("login: pre-created accounts only, no signup, wrong password refused", async ({ browser, page }) => {
  await page.goto("/");
  await page.waitForURL("**/login");
  await expect(page.getByText(/sign ?up|register/i)).toHaveCount(0);

  // Everything else here would still pass on an unstyled page, so check the styles really load.
  await expect(page.getByRole("button", { name: "Log in" })).toHaveCSS("background-color", "rgb(28, 90, 150)");
  await expect(page.getByLabel("Username")).toHaveCSS("min-height", "44px");

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Wrong username or password.")).toBeVisible();

  for (const route of ["/admin", "/officer", "/admin/members"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
  }

  admin = await loginPage(browser, "admin");
  male = await loginPage(browser, "male.officer", { width: 390, height: 844 });
  female = await loginPage(browser, "female.officer");
  [adminApi, maleApi, femaleApi] = [apiOf(admin), apiOf(male), apiOf(female)];

  // First run: the dashboard says what to do first.
  await expect(admin.getByText("No members yet.")).toBeVisible();

  const hash = (await db`select password_hash from app_users where username = 'admin'`)[0].password_hash as string;
  expect(hash).toMatch(/^\$2[aby]\$12\$/);
});

test("permissions are enforced on the server for every role", async ({ request }) => {
  // Anonymous
  expect((await request.get("/api/admin/report")).status()).toBe(401);
  expect((await request.get("/api/officer/search?day=1&q=a")).status()).toBe(401);
  expect((await request.post("/api/officer/attendance", { data: { memberId: 1, eventDay: 1 } })).status()).toBe(401);
  // Officer on admin endpoints
  expect((await maleApi.get("/api/admin/report")).status()).toBe(403);
  expect((await maleApi.get("/api/admin/report/export")).status()).toBe(403);
  expect((await setEvent(maleApi, 1, "start")).status()).toBe(403);
  expect((await upload(maleApi, await xlsx([]))).status()).toBe(403);
  expect((await maleApi.delete("/api/admin/members/1")).status()).toBe(403);
  // Admin on officer endpoints
  expect((await adminApi.get("/api/officer/search?day=1&q=a")).status()).toBe(403);
  // Officer pages redirect away from admin
  await male.goto("/admin");
  await expect(male).toHaveURL(/\/officer$/);
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
  const res = await mark(maleApi, id, 1);
  expect(res.status()).toBe(409);
  expect((await res.json()).code).toBe("event_not_active");
  expect((await quick(maleApi, { name: "Too Early", mobile: "9000000001" })).status()).toBe(409);
  expect((await db`select count(*)::int as n from members where name = 'Too Early'`)[0].n).toBe(0);

  await male.goto("/officer");
  const days = male.getByRole("navigation", { name: "Event days" }).getByRole("button");
  await expect(days).toHaveCount(3);
  await expect(days.nth(0)).toContainText("Not Started");
  await expect(male.getByLabel(/Search by Member ID/)).toHaveCount(0);
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

test("search: partial ID, name and mobile, scoped to the officer's gender", async () => {
  const ids = (await search(maleApi, "205")).map((r) => r.global_member_id);
  expect(ids).toEqual(["2051", "2052"]); // 2053 is Female
  expect((await search(femaleApi, "205")).map((r) => r.global_member_id)).toEqual(["2053"]);

  expect((await search(maleApi, "ra pa")).map((r) => r.global_member_id)).toEqual(expect.arrayContaining(["2051", "2052"]));
  expect((await search(maleApi, "ram pat")).map((r) => r.name)).toEqual(["Ramesh K Patel"]);
  expect((await search(maleApi, "RAM PAT")).length).toBe(1);
  expect(await search(maleApi, "radha")).toEqual([]);

  const byMobile = await search(maleApi, "500004");
  expect(byMobile.map((r) => r.name)).toEqual(["Suresh Shah"]);
  expect(await search(maleApi, "500003")).toEqual([]); // Radha's number, wrong officer

  const [row] = await search(maleApi, "3001");
  expect(row).toMatchObject({ global_member_id: "3001", name: "Suresh Shah", mobile: "9876500004", center: "Bharuch" });

  // LIKE wildcards and SQL are treated as plain text.
  expect(await search(maleApi, "%")).toEqual([]);
  expect(await search(maleApi, "_")).toEqual([]);
  expect(await search(maleApi, "' or 1=1 --")).toEqual([]);
});

test("mark attendance through the UI on a phone, then Already Present", async () => {
  await male.goto("/officer");
  const box = male.getByLabel(/Search by Member ID/);
  await box.fill("300");
  const row = male.getByRole("listitem").filter({ hasText: "Suresh Shah" });
  await expect(row).toContainText("9876500004");
  await expect(row).toContainText("Bharuch");
  await row.getByRole("button", { name: "Mark Present" }).click();
  const confirmation = male.getByRole("status");
  await expect(confirmation).toContainText("Present: Suresh Shah");
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  // The keyboard stays open for the next person, so the confirmation has to sit above where it opens.
  const box2 = (await confirmation.boundingBox())!;
  expect(box2.y + box2.height).toBeLessThan(844 * 0.5);

  await box.fill("3001");
  await expect(male.getByRole("listitem").filter({ hasText: "Suresh Shah" })).toContainText("Already Present");

  const [record] = await db`
    select a.event_day, a.marked_at, u.username, a.status from attendance a
    join app_users u on u.id = a.marked_by join members m on m.id = a.member_id
    where m.global_member_id = '3001'`;
  expect(record).toMatchObject({ event_day: 1, username: "male.officer", status: "present" });
  expect(record.marked_at).toBeInstanceOf(Date);
});

test("Enter marks only when there is exactly one match", async () => {
  await male.goto("/officer");
  const box = male.getByLabel(/Search by Member ID/);
  await box.fill("205");
  await expect(male.getByRole("button", { name: "Mark Present" })).toHaveCount(2);
  await box.press("Enter");
  await expect(male.getByRole("status")).toHaveCount(0);
  expect((await db`select count(*)::int as n from attendance a join members m on m.id=a.member_id where m.global_member_id in ('2051','2052')`)[0].n).toBe(0);

  await box.fill("2051");
  await expect(male.getByRole("button", { name: "Mark Present" })).toHaveCount(1);
  await box.press("Enter");
  await expect(male.getByRole("status")).toContainText("Present: Ramesh K Patel");
});

test("an officer cannot mark a member of the other gender, even with a forged request", async () => {
  const radha = await memberId("2053");
  const res = await mark(maleApi, radha, 1);
  expect(res.status()).toBe(404);
  expect((await db`select count(*)::int as n from attendance where member_id = ${radha}`)[0].n).toBe(0);
  expect((await mark(femaleApi, radha, 1)).status()).toBe(200);
  expect((await mark(femaleApi, await memberId("2052"), 1)).status()).toBe(404);
});

test("duplicate attendance is impossible, including simultaneous taps", async () => {
  const id = await memberId("2052");
  const results = await Promise.all(Array.from({ length: 8 }, () => mark(maleApi, id, 1)));
  const bodies = await Promise.all(results.map((r) => r.json()));
  expect(results.every((r) => r.status() === 200)).toBe(true);
  expect(bodies.filter((b) => b.status === "marked").length).toBe(1);
  expect(bodies.filter((b) => b.status === "already_present").length).toBe(7);
  expect((await db`select count(*)::int as n from attendance where member_id = ${id}`)[0].n).toBe(1);
});

test("Quick Entry through the UI: gender automatic, attendance automatic, duplicate-mobile warning", async () => {
  await male.goto("/officer");
  await male.getByLabel(/Search by Member ID/).fill("Kiran Desai");
  await expect(male.getByText("No male member matches")).toBeVisible();
  await male.getByRole("button", { name: /Quick Entry/ }).click();

  const dialog = male.getByRole("region", { name: "Quick Entry" });
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
  await expect(male.getByRole("status")).toContainText("Added and marked present: Kiran Desai");

  const [kiran] = await db`
    select m.gender, m.created_source, m.center, m.mobile, a.event_day, a.status
    from members m join attendance a on a.member_id = m.id where m.name = 'Kiran Desai'`;
  expect(kiran).toMatchObject({ gender: "Male", created_source: "quick_entry", center: "Navsari", event_day: 1, status: "present" });
  // Existing member untouched
  const [radha] = await db`select name, gender, center from members where global_member_id = '2053'`;
  expect(radha).toMatchObject({ name: "Radha Patel", gender: "Female", center: "Pune" });
  expect((await db`select count(*)::int as n from members where mobile = '9876500003'`)[0].n).toBe(2);
});

test("Quick Entry on the server: forged gender ignored, confirmation required, Other center, ID collisions", async () => {
  const noConfirm = await quick(femaleApi, { name: "Family Member", mobile: "9876500004" });
  expect(noConfirm.status()).toBe(409);
  const body = await noConfirm.json();
  expect(body.code).toBe("duplicate_mobile");
  expect(body.matches).toEqual(["Suresh Shah"]);
  expect((await db`select count(*)::int as n from members where name = 'Family Member'`)[0].n).toBe(0);

  const forged = await quick(femaleApi, {
    name: "Family Member", mobile: "9876500004", confirmDuplicateMobile: true, gender: "Male", center: "Surat",
  });
  expect(forged.status()).toBe(200);
  expect((await db`select gender, center from members where name = 'Family Member'`)[0]).toMatchObject({ gender: "Female", center: "Surat" });

  // Member ID already taken by the other gender: refused without naming them.
  const taken = await quick(femaleApi, { name: "X", mobile: "9000000002", globalMemberId: "3001" });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).message).not.toContain("Suresh");
  // Taken within the same gender: names them so the officer can search instead.
  const taken2 = await quick(maleApi, { name: "X", mobile: "9000000002", globalMemberId: "3001" });
  expect((await taken2.json()).message).toContain("Suresh Shah");

  for (const bad of [{ name: "", mobile: "9000000003" }, { name: "Y", mobile: "123" }, { name: "Y", mobile: "9000000003", center: "" }]) {
    expect((await quick(maleApi, bad)).status()).toBe(400);
  }

  // A later Excel file supplying an ID links to the Quick Entry member instead of duplicating.
  const ok = await quick(maleApi, { name: "Later Linked", mobile: "9000000004" });
  expect(ok.status()).toBe(200);
  const res = await (await upload(adminApi, await xlsx([[1, "7001", "later linked", "9000000004", "Male", "Vapi"]]))).json();
  expect(res).toMatchObject({ imported: 0, updated: 1 });
  const linked = await db`select global_member_id, created_source from members where mobile = '9000000004'`;
  expect(linked.length).toBe(1);
  expect(linked[0]).toMatchObject({ global_member_id: "7001", created_source: "quick_entry" });
});

test("ending the event stops marking at once, and the officer's screen locks by itself", async () => {
  await male.goto("/officer");
  await expect(male.getByLabel(/Search by Member ID/)).toBeVisible();

  await admin.goto("/admin");
  const card = admin.getByRole("article").filter({ hasText: "Gyansatr Day 1" });
  await card.getByRole("button", { name: "End Event" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "End Event" }).click();
  await expect(card).toContainText("Ended");

  // The server refuses straight away, before any screen has refreshed.
  const res = await mark(maleApi, await memberId("2051"), 1);
  expect(res.status()).toBe(409);
  expect((await quick(maleApi, { name: "Too Late", mobile: "9000000009" })).status()).toBe(409);

  await expect(male.getByLabel(/Search by Member ID/)).toHaveCount(0, { timeout: 8000 });
  await expect(male.getByText("This event has ended")).toBeVisible();
});

test("each day's attendance is separate, and the officer follows the newly active day", async () => {
  expect((await setEvent(adminApi, 2, "start")).status()).toBe(200);
  await expect(male.getByLabel(/Search by Member ID/)).toBeVisible({ timeout: 8000 });
  await expect(male.getByRole("heading", { name: "Marking Gyansatr Day 2" })).toBeVisible();

  const id = await memberId("3001");
  expect((await (await mark(maleApi, id, 2)).json()).status).toBe("marked");
  // A stale screen still pointed at Day 1 can't write to it.
  expect((await mark(maleApi, id, 1)).status()).toBe(409);
  const days = await db`select event_day from attendance where member_id = ${id} order by 1`;
  expect(days.map((d) => d.event_day)).toEqual([1, 2]);

  // A Quick Entry member from Day 1 can be found on Day 2.
  expect((await search(maleApi, "kiran", 2)).length).toBe(1);
});

test("dashboard: totals respond to filters and match the database", async () => {
  await admin.goto("/admin");
  const count = async (where: string) => (await db.unsafe(`
    select count(*)::int as n from attendance a join members m on m.id = a.member_id
    where a.status = 'present' ${where}`))[0].n as number;

  await expect(admin.getByTestId("stat-male")).toHaveText(String(await count("and m.gender='Male'")));
  await expect(admin.getByTestId("stat-female")).toHaveText(String(await count("and m.gender='Female'")));
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("")));

  await admin.getByLabel("Event", { exact: true }).selectOption("2");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and a.event_day=2")));
  await admin.getByLabel("Event", { exact: true }).selectOption("all");

  await admin.getByLabel("Gender").selectOption("Female");
  await expect(admin.getByTestId("stat-male")).toHaveText("0");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.gender='Female'")));
  await admin.getByLabel("Gender").selectOption("all");

  await admin.getByLabel("Center").selectOption("Bharuch");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.center='Bharuch'")));
  await admin.getByLabel("Center").selectOption("all");

  await admin.getByLabel("Member source").selectOption("quick_entry");
  await expect(admin.getByTestId("stat-total")).toHaveText(String(await count("and m.created_source='quick_entry'")));
  await expect(admin.getByRole("region", { name: "Attendance records" })).toContainText("Quick Entry");
  await admin.getByLabel("Member source").selectOption("all");

  const quickToday = (await db`select count(*)::int as n from members where created_source = 'quick_entry'`)[0].n;
  await expect(admin.getByTestId("stat-quick")).toHaveText(String(quickToday));
});

test("Excel export contains exactly the filtered data, and tells the sources apart", async () => {
  await admin.goto("/admin");
  await admin.getByLabel("Gender").selectOption("Male");
  await admin.getByLabel("Event", { exact: true }).selectOption("1");
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
    where a.status='present' and a.event_day=1 and m.gender='Male'`)[0].n;
  expect(rows.length).toBe(expected);
  expect(rows.every((r) => r[4] === "Male" && r[6] === "Gyansatr Day 1")).toBe(true);
  expect(new Set(rows.map((r) => r[9]))).toEqual(new Set(["Excel Import", "Quick Entry"]));
  expect(rows.find((r) => r[2] === "Suresh Shah")?.[8]).toBe("Male Officer");

  const summary = wb.getWorksheet("Summary")!;
  const cells = new Map<string, unknown>();
  summary.eachRow((row) => {
    // "Event" is also a table header further down; the filter block comes first.
    const key = String(row.getCell(1).value);
    if (!cells.has(key)) cells.set(key, row.getCell(2).value);
  });
  expect(cells.get("Gender")).toBe("Male");
  expect(cells.get("Event")).toBe("Gyansatr Day 1");
  expect(cells.get("Combined attendees")).toBe(expected);
});

test("Admin corrections: remove attendance with a reason, logged, and re-markable", async () => {
  await admin.goto("/admin");
  const row = admin.getByRole("row").filter({ hasText: "Raju Pandya" }).first();
  await row.getByRole("button", { name: "Remove" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Remove Attendance" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Marked by mistake");
  await dialog.getByRole("button", { name: "Remove Attendance" }).click();
  await expect(admin.getByRole("status")).toContainText("Attendance removed");
  await expect(admin.getByRole("row").filter({ hasText: "Raju Pandya" })).toHaveCount(0);

  const id = await memberId("2052");
  const [a] = await db`select status, cancel_reason from attendance where member_id = ${id} and event_day = 1`;
  expect(a).toMatchObject({ status: "cancelled", cancel_reason: "Marked by mistake" });

  // Officer can't cancel
  expect((await maleApi.post("/api/admin/attendance/1/cancel", { data: { reason: "x" } })).status()).toBe(403);

  // A cancelled day can be marked again when that day is active.
  await setEvent(adminApi, 2, "end");
  await setEvent(adminApi, 1, "restart");
  expect((await (await mark(maleApi, id, 1)).json()).status).toBe("marked");
  await setEvent(adminApi, 1, "end");
  await setEvent(adminApi, 2, "restart");
});

test("Admin can edit and delete members; history stays in the log", async () => {
  const id = await memberId("3001");
  expect((await maleApi.patch(`/api/admin/members/${id}`, { data: {} })).status()).toBe(403);

  await admin.goto("/admin/members");
  await admin.getByLabel("Search members").fill("Suresh");
  const row = admin.getByRole("row").filter({ hasText: "Suresh Shah" });
  await row.getByRole("button", { name: "Edit" }).click();
  await admin.getByRole("dialog").getByLabel("Center").fill("vapi");
  await admin.getByRole("dialog").getByRole("button", { name: "Save" }).click();
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
    "attendance.mark", "attendance.cancel", "member.quick_entry", "member.edit", "member.delete",
  ]));
  expect((await db`select count(*)::int as n from audit_log where username = '' or at is null`)[0].n).toBe(0);

  // Recorded for the database only: there is no screen or API that shows it.
  await admin.goto("/admin");
  await expect(admin.getByRole("navigation", { name: "Admin" }).getByRole("link")).toHaveText(["Dashboard", "Members"]);
  expect((await admin.goto("/admin/activity"))?.status()).toBe(404);
  expect((await maleApi.get("/api/admin/audit")).status()).toBe(404);
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
    const results = await search(maleApi, q, 2);
    timings[q] = Date.now() - t;
    expect(results.length).toBeLessThanOrEqual(30);
  }
  console.log(`upload ${(buffer.length / 1024).toFixed(0)} KB in ${uploadMs} ms; search ms:`, timings);
  expect(Math.max(...Object.values(timings))).toBeLessThan(300);
});

test("screens fit a phone with no sideways scroll; screenshots for review", async ({ browser }) => {
  const dir = "test-results/screens";
  await male.setViewportSize({ width: 390, height: 844 });
  await male.goto("/officer");
  await male.getByLabel(/Search by Member ID/).fill("person19");
  await expect(male.getByRole("button", { name: "Mark Present" }).first()).toBeVisible();
  await male.screenshot({ path: `${dir}/officer-phone.png` });
  expect(await male.locator("h1").count()).toBe(1);
  // Numbers line up only if the font really has tabular figures.
  const digitWidths = await male.evaluate(() => {
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
  expect(await overflow(male)).toBeLessThanOrEqual(0);

  await male.getByRole("button", { name: /Quick Entry/ }).click();
  const panel = male.getByRole("region", { name: "Quick Entry" });
  await panel.getByLabel("Mobile Number").fill("9876500003");
  await expect(panel.getByRole("alert")).toBeVisible();
  await male.screenshot({ path: `${dir}/quick-entry-phone.png` });

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
  await adminPhone.getByRole("button", { name: "Filters" }).click();
  await adminPhone.goto("/admin/members");
  await expect(adminPhone.getByRole("region", { name: "Member list" }).getByRole("listitem").first()).toBeVisible();
  expect(await overflow(adminPhone)).toBeLessThanOrEqual(0);
  await adminPhone.screenshot({ path: `${dir}/members-phone.png` });
});

test("idle officer screen and login, for review", async ({ browser }) => {
  const dir = "test-results/screens";
  await male.goto("/officer");
  const box = male.getByLabel(/Search by Member ID/);
  for (const q of ["100001", "100003"]) {
    await box.fill(q);
    await male.getByRole("button", { name: "Mark Present" }).click();
    await expect(box).toHaveValue("");
  }
  await expect(male.getByRole("status")).toHaveCSS("opacity", "1");
  await male.screenshot({ path: `${dir}/officer-idle-phone.png` });
  const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await fresh.goto("/login");
  await fresh.screenshot({ path: `${dir}/login-phone.png` });
  await fresh.setViewportSize({ width: 1280, height: 800 });
  await fresh.screenshot({ path: `${dir}/login-desktop.png` });
  await fresh.close();
});

test("no screen threw an error during this whole run", () => {
  expect(pageErrors).toEqual([]);
});

test("login locks briefly after repeated wrong passwords", async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    const res = await request.post("/api/auth/login", { data: { username: "female.officer", password: "nope" } });
    expect(res.status()).toBe(401);
  }
  const locked = await request.post("/api/auth/login", { data: { username: "female.officer", password: TEST_PASSWORD } });
  expect(locked.status()).toBe(429);
  await db`update app_users set locked_until = null where username = 'female.officer'`;
  const fine = await request.post("/api/auth/login", { data: { username: "female.officer", password: TEST_PASSWORD } });
  expect(fine.status()).toBe(200);
});
