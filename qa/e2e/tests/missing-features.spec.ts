// complete-missing-features task 6.1 — E2E กับ stack จริง (worker ใช้ EXTRACTION_PROVIDER=fixture)
// Admin สร้าง API key → ระบบภายนอกอัปโหลดด้วย key → Clerk เห็นในคิว → Exec เห็นผู้อัปโหลดเป็นชื่อ key ใน audit
// → Admin เพิกถอน → key ใช้ไม่ได้; Clerk เห็นผู้ขายในทะเบียน; Exec เปิดรายงานแล้วยอดตรง; Admin เห็น error ที่จำลองใน System logs
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { QA_ADMIN_EMAIL } from "../global-setup";
import { randomTaxId, writeFixture, type Header, type Item } from "../fixtures";
import { SERVICE_DIR, compose } from "../support";

const run = Date.now().toString(36);
const API = process.env.SDES_API_URL ?? "http://127.0.0.1:3000";
const COMPANY = "0994000165617";
const SAMPLE = resolve(import.meta.dirname, "../../extraction-eval/out/docs/inv-01.pdf");
// เดือนในใบกำกับที่ไม่ชนกับเอกสาร dev อื่น — รายงานเทียบยอดก่อน/หลังของเดือนนี้
const INVOICE_DATE = "2015-03-15";

type U = { email: string; name: string; password: string; roles: string[] };
const user = (key: string, roles: string[]): U => ({
  email: `qa4-${key}-${run}@sdes.local`,
  name: `QA4 ${key} ${run}`,
  password: `qa4-${key}-${randomBytes(9).toString("base64url")}`,
  roles,
});
const clerk = user("clerk", ["AP_CLERK"]);
const exec = user("exec", ["FINANCE_EXEC"]);
const admin: U = { email: QA_ADMIN_EMAIL, name: "QA Admin", password: "", roles: ["SYS_ADMIN"] };

const vendorTaxId = randomTaxId();
const header: Header = {
  invoiceNo: `K-${run}`,
  invoiceDate: INVOICE_DATE,
  vendorName: `บริษัท ส่งผ่าน key ${vendorTaxId.slice(-4)} จำกัด`,
  vendorTaxId,
  vendorBranch: "00000",
  buyerTaxId: COMPANY,
  buyerBranch: "00000",
  subtotal: "10000.00",
  discount: "0.00",
  vatBase: "10000.00",
  vatRate: "7",
  vatAmount: "700.00",
  grandTotal: "10700.00",
};
const lines: Item[] = [{ description: "ค่าบริการ", quantity: "2", unitPrice: "5000.00", amount: "10000.00" }];

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

async function login(browser: Browser, u: U): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(u.email);
  await page.getByLabel("รหัสผ่าน").fill(u.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  return page;
}

/** อัปโหลดแบบที่ระบบภายนอกทำ: multipart ตรงไปที่ API พร้อม Authorization: Bearer <key> */
async function uploadWithKey(request: APIRequestContext, key: string, file: { name: string; buffer: Buffer }) {
  return request.post(`${API}/documents`, {
    headers: { Authorization: `Bearer ${key}` },
    multipart: { files: { name: file.name, mimeType: "application/pdf", buffer: file.buffer } },
  });
}

test("ฟีเจอร์ที่ขาด: API key, ทะเบียนผู้ขาย, รายงาน และ System logs บน stack จริง", async ({ browser, request }) => {
  test.setTimeout(600_000);
  admin.password = process.env.QA_ADMIN_PASSWORD!;
  const adminH = await token(request, admin.email, admin.password);
  for (const u of [clerk, exec]) await provision(request, adminH, u);
  expect(
    (await request.put("/api/settings/risk", { headers: adminH, data: { confidenceThreshold: 0.85, highAmountThreshold: null, companyTaxId: COMPANY, companyName: "บริษัททดสอบ E2E" } })).status(),
  ).toBe(200);
  const execH = await token(request, exec.email, exec.password);
  const keyName = `เครื่องสแกน E2E ${run}`;
  let key = "";
  let docId = "";
  let docNo = "";

  await test.step("Admin สร้าง API key ขอบเขตอัปโหลดที่หน้า /admin/api-keys และเห็นค่าครั้งเดียว", async () => {
    const page = await login(browser, admin);
    await page.goto("/admin/api-keys");
    await page.getByRole("button", { name: "สร้าง API key" }).click();
    const form = page.getByRole("dialog", { name: "สร้าง API key" });
    await form.getByLabel("ชื่อ (บอกว่าใช้กับระบบไหน)").fill(keyName);
    await form.getByRole("button", { name: "สร้าง" }).click();
    const reveal = page.getByRole("dialog", { name: `API key: ${keyName}` });
    key = ((await reveal.getByTestId("api-key-value").textContent()) ?? "").trim();
    expect(key).toMatch(/^sdes_/);
    await reveal.getByLabel("ฉันเก็บ key นี้ไว้แล้ว").check();
    await reveal.getByRole("button", { name: "ปิด" }).click();
    await expect(page.getByText(key)).toHaveCount(0);
    await page.context().close();
  });

  await test.step("ระบบภายนอกอัปโหลดด้วย key แล้วเอกสารถูกอ่านและเข้าคิวของ Clerk", async () => {
    const buffer = Buffer.concat([readFileSync(SAMPLE), Buffer.from(`\n% qa4 ${run} ${randomBytes(6).toString("hex")}\n`)]);
    writeFixture(buffer, header, lines);
    const r = await uploadWithKey(request, key, { name: `qa4-${run}.pdf`, buffer });
    expect(r.status()).toBe(201);
    const result = (await r.json()).results[0];
    expect(result.ok).toBe(true);
    docId = result.id;
    docNo = result.docNo;
    await expect
      .poll(async () => (await (await request.get(`/api/documents/${docId}`, { headers: execH })).json()).status, { timeout: 60_000 })
      .toBe("EXTRACTED");

    const page = await login(browser, clerk);
    await page.getByRole("tab", { name: /รอตรวจ/ }).click();
    await expect(page.locator(`tr[data-doc='${docNo}']`)).toContainText("รอตรวจ");
    await page.context().close();
  });

  await test.step("Exec เห็นผู้อัปโหลดเป็นชื่อ key ใน audit trail", async () => {
    const page = await login(browser, exec);
    await page.goto("/audit");
    await page.getByLabel("เลขเอกสาร").fill(docNo);
    await page.getByRole("button", { name: "ค้นหา" }).click();
    const uploaded = page.getByRole("region", { name: "ผลการค้นหา" }).locator("tbody tr", { hasText: "อัปโหลดเอกสาร" });
    await expect(uploaded).toContainText(keyName);
    await page.context().close();
  });

  await test.step("Admin เพิกถอน key แล้ว key อัปโหลดไม่ได้ทันที (401)", async () => {
    const page = await login(browser, admin);
    await page.goto("/admin/api-keys");
    const row = page.locator(`[data-key="${keyName}"]`);
    await expect(row.getByTestId("last-used")).not.toHaveText("ยังไม่เคยใช้");
    await row.getByRole("button", { name: "เพิกถอน" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "เพิกถอน" }).click();
    await expect(row.getByTestId("key-status")).toHaveText("เพิกถอนแล้ว");
    await page.context().close();
    const r = await uploadWithKey(request, key, { name: "after-revoke.pdf", buffer: Buffer.from(`%PDF-1.7\n${randomBytes(64).toString("hex")}`) });
    expect(r.status()).toBe(401);
  });

  const reportTotal = async () =>
    (await (await request.get("/api/reports/summary?from=2015-03&to=2015-03", { headers: execH })).json()).totals.grandTotal as string;
  const before = Number(await reportTotal());

  await test.step("Clerk ยืนยันเอกสาร แล้วเห็นผู้ขายรายใหม่ในทะเบียนผู้ขายพร้อมเอกสารฉบับนี้", async () => {
    const page = await login(browser, clerk);
    await page.goto(`/documents/${docId}`);
    await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
    await expect(page.getByText(`ยืนยัน ${docNo} แล้ว ส่งให้หัวหน้าอนุมัติแล้ว`, { exact: true })).toBeVisible();

    await page.goto("/vendors");
    await page.getByRole("searchbox", { name: "ค้นหาผู้ขาย" }).fill(vendorTaxId);
    const row = page.getByRole("region", { name: "รายการผู้ขาย" }).locator("tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(vendorTaxId);
    await expect(row).toContainText("10,700.00");
    await expect(row.getByTestId("new-vendor")).toBeVisible();
    await row.getByRole("link").first().click();
    await expect(page.getByRole("region", { name: "เอกสารของผู้ขาย" }).locator(`[data-doc='${docNo}']`)).toContainText("รออนุมัติ", { timeout: 30_000 });
    await page.context().close();
  });

  await test.step("Exec เปิดรายงานเดือนของใบกำกับ ยอดรวมเพิ่มขึ้นเท่ากับเอกสารฉบับนี้", async () => {
    const after = Number(await reportTotal());
    expect(after - before).toBeCloseTo(10700, 2);
    const page = await login(browser, exec);
    await page.goto("/reports");
    await page.getByLabel("ตั้งแต่เดือน").fill("2015-03");
    await page.getByLabel("ถึงเดือน").fill("2015-03");
    await page.getByRole("button", { name: "แสดง" }).click();
    await expect(page.getByTestId("report-period")).toContainText("มี.ค. 2558");
    await expect(page.getByTestId("total-grand")).toHaveText(after.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    await page.screenshot({ path: "../complete-missing-features/evidence/e2e-reports.png" });
    await page.context().close();
  });

  await test.step("Admin เห็น error ที่จำลองใน System logs", async () => {
    // ข้อความสถานะที่ผิดรูปแบบใน Redis → api เขียน warning (StatusGateway) ลง system_logs
    const pw = readFileSync(resolve(SERVICE_DIR, ".env"), "utf8").match(/^REDIS_PASSWORD=(.*)$/m)![1]!.trim();
    compose(`exec -T redis redis-cli -a ${pw} --no-auth-warning publish document-status e2e-bad-${run}`);
    const page = await login(browser, admin);
    await page.goto("/admin/logs");
    await page.getByLabel("คำในข้อความ").fill(`e2e-bad-${run}`);
    await expect(async () => {
      await page.getByRole("button", { name: "ค้นหา" }).click();
      await expect(page.getByRole("region", { name: "ผลการค้นหา" }).locator("[data-log]")).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const row = page.getByRole("region", { name: "ผลการค้นหา" }).locator("[data-log]").first();
    await expect(row).toContainText("StatusGateway");
    await expect(row).toContainText("api");
    await page.screenshot({ path: "../complete-missing-features/evidence/e2e-system-logs.png" });
    await page.context().close();
  });
});
