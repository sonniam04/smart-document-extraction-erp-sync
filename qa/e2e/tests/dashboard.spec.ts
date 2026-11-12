// overview-dashboard task 4.1 — E2E หน้าภาพรวมกับ stack จริง (worker ใช้ EXTRACTION_PROVIDER=fixture)
// Clerk อัปโหลด → หน้าภาพรวมที่เปิดค้างไว้แสดงรอตรวจเพิ่มขึ้นเองภายใน 30 วินาที → กดไปคิวแท็บรอตรวจ → ยืนยัน
// → ตรวจแล้ววันนี้เพิ่ม; Exec เห็นยอดเดือนนี้ตรงกับหน้ารายงาน; Admin เห็นสุขภาพระบบและ error ที่จำลอง
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { QA_ADMIN_EMAIL } from "../global-setup";
import { randomTaxId, writeFixture, type Header, type Item } from "../fixtures";

const run = Date.now().toString(36);
const COMPANY = "0994000165617";
const SAMPLE = resolve(import.meta.dirname, "../../extraction-eval/out/docs/inv-01.pdf");
// ใบกำกับลงวันที่วันนี้ (เวลาไทย) เพื่อให้นับในการเงินเดือนนี้ของหน้าภาพรวม
const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

type U = { email: string; name: string; password: string; roles: string[] };
const user = (key: string, roles: string[]): U => ({
  email: `qa5-${key}-${run}@sdes.local`,
  name: `QA5 ${key} ${run}`,
  password: `qa5-${key}-${randomBytes(9).toString("base64url")}`,
  roles,
});
const clerk = user("clerk", ["AP_CLERK"]);
const exec = user("exec", ["FINANCE_EXEC"]);
const admin: U = { email: QA_ADMIN_EMAIL, name: "QA Admin", password: "", roles: ["SYS_ADMIN"] };

const vendorTaxId = randomTaxId();
const header: Header = {
  invoiceNo: `D-${run}`,
  invoiceDate: TODAY,
  vendorName: `บริษัท ภาพรวม ${vendorTaxId.slice(-4)} จำกัด`,
  vendorTaxId,
  vendorBranch: "00000",
  buyerTaxId: COMPANY,
  buyerBranch: "00000",
  subtotal: "2000.00",
  discount: "0.00",
  vatBase: "2000.00",
  vatRate: "7",
  vatAmount: "140.00",
  grandTotal: "2140.00",
};
const lines: Item[] = [{ description: "ค่าบริการ", quantity: "1", unitPrice: "2000.00", amount: "2000.00" }];

async function token(request: APIRequestContext, email: string, password: string) {
  const r = await request.post("/auth/login", { data: { email, password } });
  expect(r.status(), `login ${email}`).toBe(200);
  return { Authorization: `Bearer ${(await r.json()).accessToken as string}` };
}

async function provision(request: APIRequestContext, adminH: Record<string, string>, u: U) {
  const r = await request.post("/api/admin/users", { headers: adminH, data: { email: u.email, displayName: u.name, roles: u.roles } });
  expect(r.status()).toBe(201);
  const temp = (await r.json()).temporaryPassword as string;
  const h = await token(request, u.email, temp);
  expect((await request.post("/auth/change-password", { headers: h, data: { currentPassword: temp, newPassword: u.password } })).status()).toBe(200);
}

/** ล็อกอินที่หน้า /login แล้วต้องมาจบที่หน้าภาพรวม (หน้าแรกของทุก role) */
async function login(browser: Browser, u: U): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(u.email);
  await page.getByLabel("รหัสผ่าน").fill(u.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "ภาพรวม", level: 1 })).toBeVisible();
  return page;
}

const num = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).textContent()) ?? "").replace(/[^\d.]/g, ""));
const waitingCount = async (page: Page) =>
  Number(((await page.getByRole("region", { name: "งานค้าง" }).locator("[data-group=waiting]").locator(".num").textContent()) ?? "").replace(/\D/g, ""));

test("หน้าภาพรวมบน stack จริง: งานค้างอัปเดตเอง, ลิงก์ไปคิว, ตัวเลขวันนี้, การเงินตรงรายงาน, สุขภาพระบบ", async ({ browser, request }) => {
  test.setTimeout(600_000);
  admin.password = process.env.QA_ADMIN_PASSWORD!;
  const adminH = await token(request, admin.email, admin.password);
  for (const u of [clerk, exec]) await provision(request, adminH, u);
  expect(
    (await request.put("/api/settings/risk", { headers: adminH, data: { confidenceThreshold: 0.85, highAmountThreshold: null, companyTaxId: COMPANY, companyName: "บริษัททดสอบ E2E" } })).status(),
  ).toBe(200);
  const clerkH = await token(request, clerk.email, clerk.password);
  let docId = "";
  let docNo = "";

  const page = await login(browser, clerk);
  const before = await waitingCount(page);
  const verifiedBefore = await num(page, "today-verified");

  await test.step("Clerk อัปโหลด แล้วหน้าภาพรวมที่เปิดค้างไว้แสดงรอตรวจเพิ่มขึ้นเองภายใน 30 วินาที", async () => {
    const buffer = Buffer.concat([readFileSync(SAMPLE), Buffer.from(`\n% qa5 ${run} ${randomBytes(6).toString("hex")}\n`)]);
    writeFixture(buffer, header, lines);
    const r = await request.post("/api/documents", { headers: clerkH, multipart: { files: { name: `qa5-${run}.pdf`, mimeType: "application/pdf", buffer } } });
    expect(r.status()).toBe(201);
    const result = (await r.json()).results[0];
    docId = result.id;
    docNo = result.docNo;
    await expect.poll(async () => (await (await request.get(`/api/documents/${docId}`, { headers: clerkH })).json()).status, { timeout: 60_000 }).toBe("EXTRACTED");
    const extractedAt = Date.now();
    // ไม่รีเฟรชหน้า: รอบอัปเดตถัดไป (ทุก 30 วินาที) ต้องเห็นเอกสารใหม่
    await expect.poll(() => waitingCount(page), { timeout: 35_000, intervals: [1_000] }).toBe(before + 1);
    expect(Date.now() - extractedAt).toBeLessThan(31_000);
  });

  await test.step("กดรอตรวจแล้วไปคิวแท็บรอตรวจที่มีเอกสารนี้ แล้วยืนยัน → ตรวจแล้ววันนี้เพิ่ม", async () => {
    await page.getByRole("region", { name: "งานค้าง" }).locator("[data-group=waiting]").click();
    await expect(page).toHaveURL(/\/documents\?tab=waiting$/);
    await expect(page.getByRole("tab", { name: /รอตรวจ/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`tr[data-doc='${docNo}']`)).toBeVisible();
    await page.goto(`/documents/${docId}`);
    await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
    await expect(page.getByText(`ยืนยัน ${docNo} แล้ว ส่งให้หัวหน้าอนุมัติแล้ว`, { exact: true })).toBeVisible();
    // หน้าตรวจพาไปใบถัดไปเอง — รอให้ออกจากใบนี้ก่อน ไม่งั้น goto ชนกับการนำทางนั้น (ERR_ABORTED)
    await expect(page).not.toHaveURL(new RegExp(`/documents/${docId}$`));
    await page.goto("/");
    await expect.poll(() => num(page, "today-verified"), { timeout: 15_000 }).toBe(verifiedBefore + 1);
    await page.screenshot({ path: "../overview-dashboard/evidence/e2e-dashboard-clerk.png", fullPage: true });
    await page.context().close();
  });

  await test.step("Exec เห็นยอดรวมเดือนนี้ในหน้าภาพรวมเท่ากับหน้ารายงานของเดือนเดียวกัน", async () => {
    const p = await login(browser, exec);
    const dash = ((await p.getByTestId("finance-grand").locator(".num").last().textContent()) ?? "").trim();
    expect(dash).toMatch(/^\d{1,3}(,\d{3})*\.\d{2}$/);
    await p.getByRole("link", { name: "ดูรายงาน" }).click();
    await expect(p).toHaveURL(/\/reports$/);
    await expect(p.getByTestId("total-grand")).toHaveText(dash);
    await p.context().close();
  });

  await test.step("Admin เห็นสุขภาพระบบ และ error ที่จำลองเพิ่มในจำนวน error 24 ชั่วโมง", async () => {
    const p = await login(browser, admin);
    const health = p.getByRole("region", { name: "สุขภาพระบบ" });
    await expect(health).toContainText("การเชื่อมต่อ ERP");
    await expect(p.getByRole("region", { name: "งานค้าง" })).toHaveCount(0);
    const errorsBefore = await num(p, "health-errors");
    // ไฟล์ที่ไม่มีเฉลยใน fixture → worker อ่านไม่สำเร็จแบบถาวรและเขียน log ระดับ error
    const bad = Buffer.concat([readFileSync(SAMPLE), Buffer.from(`\n% qa5-nofixture ${run} ${randomBytes(6).toString("hex")}\n`)]);
    const r = await request.post("/api/documents", { headers: clerkH, multipart: { files: { name: `qa5-bad-${run}.pdf`, mimeType: "application/pdf", buffer: bad } } });
    expect(r.status()).toBe(201);
    await expect.poll(() => num(p, "health-errors"), { timeout: 45_000, intervals: [2_000] }).toBeGreaterThan(errorsBefore);
    await p.getByRole("link", { name: /error ใน 24 ชั่วโมง/ }).click();
    await expect(p).toHaveURL(/\/admin\/logs\?level=error$/);
    await expect(p.getByRole("region", { name: "ผลการค้นหา" }).locator("[data-log]").first()).toContainText("error");
    await p.goto("/");
    await p.screenshot({ path: "../overview-dashboard/evidence/e2e-dashboard-admin.png", fullPage: true });
    await p.context().close();
  });
});
