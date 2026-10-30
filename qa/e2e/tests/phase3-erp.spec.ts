// Phase 3 task 7.1 — E2E กับ stack จริง + Odoo 19 (compose profile `odoo`, design D10)
// Admin ตั้งค่า/ทดสอบ/เปิดส่งอัตโนมัติ → อนุมัติ/ยืนยันแล้วเห็นใบแจ้งหนี้ร่างใน Odoo ยอดตรงและมีไฟล์แนบ
// → ส่งใหม่ไม่เกิดใบซ้ำ → Odoo ปิด → SYNC_FAILED → เปิด Odoo → Admin ส่งใหม่ → SYNCED → Exec เห็น audit ของการส่ง
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { QA_ADMIN_EMAIL } from "../global-setup";
import { randomTaxId, writeFixture, type Header, type Item } from "../fixtures";
import { compose, odooCall, odooSetup, withOwnerDb, type OdooSetup } from "../support";

const setup = odooSetup();
test.skip(!setup, "ตั้ง SDES_ODOO_SETUP เป็นไฟล์ผลของ docker/odoo/setup.sh (ดู README)");

const run = Date.now().toString(36);
const COMPANY = "0994000165617";
const SAMPLE = resolve(import.meta.dirname, "../../extraction-eval/out/docs/inv-01.pdf");

type U = { email: string; name: string; password: string; roles: string[] };
const user = (key: string, roles: string[]): U => ({
  email: `qa3-${key}-${run}@sdes.local`,
  name: `QA3 ${key} ${run}`,
  password: `qa3-${key}-${randomBytes(9).toString("base64url")}`,
  roles,
});
const clerk = user("clerk", ["AP_CLERK"]);
const lead = user("lead", ["AP_LEAD"]);
const exec = user("exec", ["FINANCE_EXEC"]);
const admin: U = { email: QA_ADMIN_EMAIL, name: "QA Admin", password: "", roles: ["SYS_ADMIN"] };

const vendorTaxId = randomTaxId();
const invoice = (invoiceNo: string): Header => ({
  invoiceNo,
  invoiceDate: new Date().toISOString().slice(0, 10),
  vendorName: `บริษัท ผู้ขาย ERP ${vendorTaxId.slice(-4)} จำกัด`,
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
});
const lines: Item[] = [{ description: "ค่าบริการ", quantity: "2", unitPrice: "5000.00", amount: "10000.00" }];

function doc(label: string) {
  const file = Buffer.concat([readFileSync(SAMPLE), Buffer.from(`\n% qa3 ${run} ${label} ${randomBytes(6).toString("hex")}\n`)]);
  writeFixture(file, invoice(`${label.toUpperCase()}-${run}`), lines);
  return { name: `qa3-${run}-${label}.pdf`, mimeType: "application/pdf", buffer: file };
}

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
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** ใบแจ้งหนี้ผู้ขายใน Odoo ที่สร้างจากเลขเอกสารนี้ */
type Move = { id: number; state: string; move_type: string; amount_total: number; partner_id: [number, string] };
const billsOf = (s: OdooSetup, docNo: string) =>
  odooCall<Move[]>(s, "account.move", "search_read", {
    domain: [["move_type", "=", "in_invoice"], ["invoice_origin", "=", docNo]],
    fields: ["id", "state", "move_type", "amount_total", "partner_id"],
  });

let adminH: Record<string, string>;

test.afterAll(async ({ request }) => {
  // ให้ E2E ของ Phase 1–2 ที่คาดว่าเอกสารคงที่ VERIFIED/APPROVED ไม่ถูกส่งต่อ และ Odoo กลับมาเปิดเสมอ
  if (adminH) await request.put("/api/erp/connection/auto-sync", { headers: adminH, data: { enabled: false } });
  compose("up -d --wait odoo");
});

test("Phase 3: ส่งเข้า Odoo หลังยืนยัน/อนุมัติ, ไม่ซ้ำเมื่อส่งใหม่, Odoo ปิดแล้วส่งใหม่สำเร็จ, audit", async ({ browser, request }) => {
  test.setTimeout(600_000);
  const odoo = setup!;
  admin.password = process.env.QA_ADMIN_PASSWORD!;
  adminH = await token(request, admin.email, admin.password);
  for (const u of [clerk, lead, exec]) await provision(request, adminH, u);
  expect(
    (await request.put("/api/settings/risk", { headers: adminH, data: { confidenceThreshold: 0.85, highAmountThreshold: null, companyTaxId: COMPANY, companyName: "บริษัททดสอบ E2E" } })).status(),
  ).toBe(200);

  const execH = await token(request, exec.email, exec.password);
  const detail = async (id: string) => (await request.get(`/api/documents/${id}`, { headers: execH })).json();
  const waitStatus = (id: string, status: string, timeout = 90_000) =>
    expect.poll(async () => (await detail(id)).status, { timeout, intervals: [1000] }).toBe(status);

  await test.step("Admin ตั้งค่า Odoo ผ่านหน้า /admin/erp ทดสอบผ่านทุกข้อ แล้วเปิดส่งอัตโนมัติ", async () => {
    const page = await login(browser, admin);
    await page.goto("/admin/erp");
    await page.getByLabel("URL ของ Odoo").fill("http://odoo:8069");
    await page.getByLabel("ฐานข้อมูล").fill("sdes_erp");
    await page.getByLabel("Journal ซื้อ (id)").fill(String(odoo.journalId));
    await page.getByLabel("ภาษีซื้อ 7% (id)").fill(String(odoo.purchaseTaxId));
    await page.getByLabel("บัญชีค่าใช้จ่าย (id)").fill(String(odoo.expenseAccountId));
    await page.getByLabel("API key").fill(odoo.apiKey);
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByText(/บันทึก(การตั้งค่า)?แล้ว/).first()).toBeVisible();
    await expect(page.getByLabel("API key")).toHaveValue("");

    await page.getByRole("button", { name: "ทดสอบการเชื่อมต่อ" }).click();
    const results = page.getByRole("region", { name: "ผลการทดสอบ" });
    for (const k of ["reach", "auth", "journal", "tax", "account"]) await expect(results.locator(`[data-check="${k}"]`)).toHaveAttribute("data-ok", "true");

    const sw = page.getByRole("switch", { name: "ส่งเอกสารไป ERP อัตโนมัติ" });
    await expect(sw).toBeEnabled();
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    // secret ไม่กลับมาทาง API
    const conn = await (await request.get("/api/erp/connection", { headers: adminH })).json();
    expect(JSON.stringify(conn)).not.toContain(odoo.apiKey);
    expect(conn).toMatchObject({ hasSecret: true, autoSync: true, testPassed: true });
    await page.context().close();
  });

  const files = { a: doc("a"), b: doc("b"), c: doc("c") };
  const ids: Record<string, string> = {};
  const docNos: Record<string, string> = {};
  const page = await login(browser, clerk);

  await test.step("Clerk อัปโหลด 3 ฉบับของผู้ขายรายใหม่", async () => {
    await page.getByTestId("file-input").setInputFiles(Object.values(files));
    const results = page.getByRole("region", { name: "ผลการอัปโหลด" });
    await expect(results).toContainText("รับ 3 จาก 3 ไฟล์");
    for (const [k, f] of Object.entries(files))
      docNos[k] = ((await results.locator("li", { hasText: f.name }).locator("span.num").textContent()) ?? "").trim();
    await page.getByRole("tab", { name: /รอตรวจ/ }).click();
    for (const [k, docNo] of Object.entries(docNos)) {
      const row = page.locator(`tr[data-doc='${docNo}']`);
      await expect(row).toContainText("รอตรวจ");
      ids[k] = ((await row.getByRole("link").first().getAttribute("href")) ?? "").split("/").pop()!;
    }
  });

  await test.step("A (ผู้ขายใหม่): ยืนยัน → AP Lead อนุมัติ → SYNCED และหน้าที่ Exec เปิดค้างไว้เห็นเลขอ้างอิง ERP แบบ real-time", async () => {
    await page.goto(`/documents/${ids.a}`);
    await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
    await expect(page.getByText(`ยืนยัน ${docNos.a} แล้ว ส่งให้หัวหน้าอนุมัติแล้ว`, { exact: true })).toBeVisible();

    const execPage = await login(browser, exec);
    await execPage.goto(`/documents/${ids.a}`);
    await expect(execPage.getByText(docNos.a!, { exact: true })).toBeVisible();

    const leadPage = await login(browser, lead);
    await leadPage.goto(`/documents/${ids.a}`);
    await leadPage.getByRole("button", { name: "อนุมัติ", exact: true }).click();
    await leadPage.getByRole("dialog").getByRole("button", { name: "อนุมัติ" }).click();
    await expect(leadPage).toHaveURL(/\/approvals$/);
    await leadPage.context().close();

    await waitStatus(ids.a!, "SYNCED");
    const d = await detail(ids.a!);
    await expect(execPage.getByTestId("erp-ref")).toContainText(`เลขอ้างอิง ERP ${d.erpTransactionId}`);
    await execPage.screenshot({ path: "../phase3/evidence/e2e-review-synced.png" });
    await execPage.context().close();
  });

  const checkBill = async (key: string) => {
    const bills = await billsOf(odoo, docNos[key]!);
    expect(bills, `ใบแจ้งหนี้ของ ${docNos[key]}`).toHaveLength(1);
    const bill = bills[0]!;
    expect(bill).toMatchObject({ state: "draft", move_type: "in_invoice", amount_total: 10700 });
    expect(String(bill.id)).toBe((await detail(ids[key]!)).erpTransactionId);
    const [partner] = await odooCall<{ vat: string }[]>(odoo, "res.partner", "read", { ids: [bill.partner_id[0]], fields: ["vat"] });
    expect(partner!.vat).toBe(vendorTaxId);
    const files = await odooCall<{ name: string }[]>(odoo, "ir.attachment", "search_read", {
      domain: [["res_model", "=", "account.move"], ["res_id", "=", bill.id]],
      fields: ["name"],
    });
    expect(files.length, "ไฟล์แนบต้นฉบับ").toBeGreaterThan(0);
    return bill;
  };

  await test.step("ใบแจ้งหนี้ร่างของ A อยู่ใน Odoo: ยอดตรง คู่ค้าตาม Tax ID และมีไฟล์แนบ", async () => {
    await checkBill("a");
  });

  await test.step("B (ผู้ขายเดิม ไม่มีความเสี่ยง): ยืนยันแล้วส่งเข้า Odoo ทันที", async () => {
    await page.goto(`/documents/${ids.b}`);
    await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
    await expect(page.getByText(`ยืนยัน ${docNos.b} แล้ว`, { exact: true })).toBeVisible();
    await waitStatus(ids.b!, "SYNCED");
    await checkBill("b");
  });

  await test.step("ส่งใหม่ไม่เกิดใบซ้ำ: Odoo สร้างใบแล้วแต่ระบบไม่ได้รับคำตอบ → SYNC_FAILED → Admin ส่งใหม่ → ใช้ใบเดิม", async () => {
    const before = await detail(ids.b!);
    // จำลองคำตอบที่หายระหว่างทาง: Odoo มีใบแล้ว แต่ฝั่งเราเป็น SYNC_FAILED
    await withOwnerDb((db) =>
      db.document.update({ where: { id: ids.b }, data: { status: "SYNC_FAILED", syncError: "จำลอง: หมดเวลารอคำตอบจาก Odoo", erpTransactionId: null, syncedAt: null } }),
    );
    const adminPage = await login(browser, admin);
    await adminPage.goto("/admin/sync");
    await adminPage.getByLabel(`เลือก ${docNos.b}`).check();
    await adminPage.getByRole("button", { name: "ส่งใหม่ (1)" }).click();
    await adminPage.getByRole("dialog").getByRole("button", { name: "ส่งใหม่" }).click();
    await expect(adminPage.getByText("ส่งใหม่แล้ว 1 ฉบับ", { exact: true })).toBeVisible();
    await adminPage.context().close();

    await waitStatus(ids.b!, "SYNCED");
    const after = await detail(ids.b!);
    expect(after.erpTransactionId).toBe(before.erpTransactionId);
    expect(after.syncAttempts.at(-1)).toMatchObject({ status: "SUCCESS", reused: true });
    await checkBill("b");
  });

  await test.step("Odoo ปิด → C เป็น SYNC_FAILED พร้อมเหตุผล; Clerk เห็นเหตุผลแต่ไม่มีปุ่มส่งใหม่", async () => {
    compose("stop odoo");
    try {
      await page.goto(`/documents/${ids.c}`);
      await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
      await expect(page.getByText(`ยืนยัน ${docNos.c} แล้ว`, { exact: true })).toBeVisible();
      await waitStatus(ids.c!, "SYNC_FAILED", 180_000);
      const d = await detail(ids.c!);
      expect(d.syncError).toBeTruthy();
      expect(d.syncAttempts.filter((a: { status: string }) => a.status === "FAILED").length).toBe(3);

      await page.goto(`/documents/${ids.c}`);
      await expect(page.getByTestId("sync-error")).toContainText(d.syncError);
      await expect(page.getByRole("button", { name: /ส่งใหม่/ })).toHaveCount(0);
    } finally {
      compose("up -d --wait odoo");
    }
  });

  await test.step("Odoo เปิดแล้ว Admin ส่งใหม่จากหน้าติดตาม → C เป็น SYNCED และมีใบเดียว", async () => {
    const adminPage = await login(browser, admin);
    await adminPage.goto("/admin/sync");
    const row = adminPage.getByRole("region", { name: "ส่ง ERP ไม่สำเร็จ" }).locator("tr", { hasText: docNos.c! });
    await expect(row).toContainText("3");
    await adminPage.screenshot({ path: "../phase3/evidence/e2e-sync-failed.png" });
    await adminPage.getByLabel(`เลือก ${docNos.c}`).check();
    await adminPage.getByRole("button", { name: "ส่งใหม่ (1)" }).click();
    await adminPage.getByRole("dialog").getByRole("button", { name: "ส่งใหม่" }).click();
    await expect(adminPage.getByText("ส่งใหม่แล้ว 1 ฉบับ", { exact: true })).toBeVisible();
    await adminPage.context().close();
    await waitStatus(ids.c!, "SYNCED");
    await checkBill("c");
  });

  await test.step("Exec เห็น audit ของการส่ง ERP ของเอกสาร และการตั้งค่าการเชื่อมต่อ", async () => {
    const execPage = await login(browser, exec);
    await execPage.goto("/audit");
    await execPage.getByLabel("เลขเอกสาร").fill(docNos.c!);
    await execPage.getByRole("button", { name: "ค้นหา" }).click();
    const rows = execPage.getByRole("region", { name: "ผลการค้นหา" }).locator("tbody tr");
    await expect(rows.filter({ hasText: "ส่ง ERP ไม่สำเร็จ → กำลังส่ง ERP" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "กำลังส่ง ERP → ส่ง ERP แล้ว" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "กำลังส่ง ERP → ส่ง ERP ไม่สำเร็จ" })).toHaveCount(1);
    await execPage.screenshot({ path: "../phase3/evidence/e2e-audit-sync.png" });
    await execPage.context().close();

    const res = await request.get("/api/audit-events?limit=200&entityType=erp_connection", { headers: execH });
    const actions = ((await res.json()).items as { action: string; details: Record<string, unknown> }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["erp.connection_updated", "erp.secret_changed", "erp.connection_tested", "erp.auto_sync_changed"]));
    // secret ไม่อยู่ใน audit
    expect(JSON.stringify((await res.json()).items)).not.toContain(odoo.apiKey);
  });

  await page.context().close();
});
