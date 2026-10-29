// Phase 2 task 8.1 — E2E กับ stack จริง (worker ใช้ EXTRACTION_PROVIDER=fixture)
// อัปโหลด → EXTRACTED → Clerk แก้ยอดตามรายการ "ต้องตรวจ" → ยืนยัน → เคสเสี่ยงเข้าคิว → AP Lead อีกคนอนุมัติ
// เคสไม่เสี่ยงคงที่ VERIFIED, AP Lead ที่แก้เองอนุมัติไม่ได้, Exec เห็น audit การแก้ field และการอนุมัติ
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { QA_ADMIN_EMAIL } from "../global-setup";
import { randomTaxId, writeFixture, type Header, type Item } from "../fixtures";

const run = Date.now().toString(36);
const COMPANY = "0994000165617";
const SAMPLE = resolve(import.meta.dirname, "../../extraction-eval/out/docs/inv-01.pdf");

type U = { email: string; name: string; password: string; roles: string[] };
const user = (key: string, roles: string[]): U => ({
  email: `qa2-${key}-${run}@sdes.local`,
  name: `QA ${key} ${run}`,
  password: `qa2-${key}-${randomBytes(9).toString("base64url")}`,
  roles,
});
const clerk = user("clerk", ["AP_CLERK"]);
const lead1 = user("lead1", ["AP_LEAD"]);
const lead2 = user("lead2", ["AP_LEAD"]);
const exec = user("exec", ["FINANCE_EXEC"]);

/** PDF ตัวอย่างจากชุดวัดผล + ไบต์ท้ายไฟล์ที่ไม่ซ้ำ (sha256 ใหม่ทุกครั้ง) พร้อมเฉลยที่กำหนดเอง */
function doc(label: string, header: Header, items: Item[]) {
  const file = Buffer.concat([readFileSync(SAMPLE), Buffer.from(`\n% qa ${run} ${label} ${randomBytes(6).toString("hex")}\n`)]);
  writeFixture(file, header, items);
  return { name: `qa2-${run}-${label}.pdf`, mimeType: "application/pdf", buffer: file };
}

const invoice = (vendorTaxId: string, invoiceNo: string, grandTotal: string): Header => ({
  invoiceNo,
  invoiceDate: new Date().toISOString().slice(0, 10),
  vendorName: `บริษัท ผู้ขาย ${vendorTaxId.slice(-4)} จำกัด`,
  vendorTaxId,
  vendorBranch: "00000",
  buyerTaxId: COMPANY,
  buyerBranch: "00000",
  subtotal: "10000.00",
  discount: "0.00",
  vatBase: "10000.00",
  vatRate: "7",
  vatAmount: "700.00",
  grandTotal,
});
const lines: Item[] = [{ description: "ค่าบริการ", quantity: "2", unitPrice: "5000.00", amount: "10000.00" }];

async function token(request: APIRequestContext, email: string, password: string) {
  const r = await request.post("/auth/login", { data: { email, password } });
  expect(r.status(), `login ${email}`).toBe(200);
  return { Authorization: `Bearer ${(await r.json()).accessToken as string}` };
}

/** Admin สร้างผู้ใช้ผ่าน API แล้วเปลี่ยนรหัสชั่วคราว (หน้าจอจัดการผู้ใช้ทดสอบแล้วใน Phase 1) */
async function provision(request: APIRequestContext, admin: Record<string, string>, u: U) {
  const r = await request.post("/api/admin/users", { headers: admin, data: { email: u.email, displayName: u.name, roles: u.roles } });
  expect(r.status()).toBe(201);
  const temp = (await r.json()).temporaryPassword as string;
  const h = await token(request, u.email, temp);
  const c = await request.post("/auth/change-password", { headers: h, data: { currentPassword: temp, newPassword: u.password } });
  expect(c.status()).toBe(200);
}

async function login(browser: Browser, u: U): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(u.email);
  await page.getByLabel("รหัสผ่าน").fill(u.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/(documents|approvals)/);
  return page;
}

test("Phase 2: อ่าน → ตรวจแก้ → ยืนยัน → ประเมินความเสี่ยง → อนุมัติ → audit", async ({ browser, request }) => {
  const admin = await token(request, QA_ADMIN_EMAIL, process.env.QA_ADMIN_PASSWORD!);
  for (const u of [clerk, lead1, lead2, exec]) await provision(request, admin, u);
  const settings = await request.put("/api/settings/risk", {
    headers: admin,
    data: { confidenceThreshold: 0.85, highAmountThreshold: null, companyTaxId: COMPANY, companyName: "บริษัททดสอบ E2E" },
  });
  expect(settings.status()).toBe(200);

  const v1 = randomTaxId();
  const v2 = randomTaxId();
  const files = {
    a: doc("a", invoice(v1, `A-${run}`, "10700.00"), lines),
    b: doc("b", invoice(v2, `B-${run}`, "10070.00"), lines), // ยอดรวมผิด 630 บาท
    c: doc("c", invoice(v1, `C-${run}`, "10700.00"), lines),
  };
  const ids: Record<string, string> = {};
  const docNos: Record<string, string> = {};
  const execH = await token(request, exec.email, exec.password);
  const statusOf = async (key: string) => (await (await request.get(`/api/documents/${ids[key]}`, { headers: execH })).json()).status as string;

  const page = await login(browser, clerk);

  await test.step("อัปโหลด 3 ไฟล์แล้วเห็น EXTRACTED โดยไม่รีเฟรช", async () => {
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
    await expect(page.locator(`tr[data-doc='${docNos.b}']`).getByTestId("issue-count")).toHaveText("ต้องแก้ 1");
  });

  await test.step("Clerk ยืนยัน A (ผู้ขายใหม่) → เข้าคิวรออนุมัติ", async () => {
    await page.goto(`/documents/${ids.a}`);
    await expect(page.getByTestId("check-bar")).toContainText("พร้อมยืนยัน");
    await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
    await expect(page.getByText(`ยืนยัน ${docNos.a} แล้ว ส่งให้หัวหน้าอนุมัติแล้ว`, { exact: true })).toBeVisible();
    expect(await statusOf("a")).toBe("PENDING_APPROVAL");
  });

  await test.step("AP Lead คนที่ 1 อนุมัติ A จากคิวรออนุมัติ", async () => {
    const lead = await login(browser, lead1);
    await lead.goto("/approvals");
    await lead.locator(`tr[data-doc='${docNos.a}']`).getByRole("link").click();
    await expect(lead.getByTestId("risk-reasons")).toContainText("ผู้ขายรายใหม่");
    await lead.getByRole("button", { name: "อนุมัติ", exact: true }).click();
    await lead.getByRole("dialog").getByRole("button", { name: "อนุมัติ" }).click();
    await expect(lead).toHaveURL(/\/approvals$/);
    expect(await statusOf("a")).toBe("APPROVED");
    await lead.context().close();
  });

  await test.step("Clerk ยืนยัน C (ผู้ขายเดิม ไม่มีความเสี่ยง) → คงที่ VERIFIED", async () => {
    await page.goto(`/documents/${ids.c}`);
    await page.getByRole("button", { name: /ยืนยันและไปใบถัดไป/ }).click();
    await expect(page.getByText(`ยืนยัน ${docNos.c} แล้ว`, { exact: true })).toBeVisible();
    expect(await statusOf("c")).toBe("VERIFIED");
  });

  await test.step("AP Lead คนที่ 1 แก้ยอดรวมของ B ตามรายการต้องตรวจ แล้วยืนยัน", async () => {
    const lead = await login(browser, lead1);
    await lead.goto(`/documents/${ids.b}`);
    await lead.getByTestId("check-bar").getByRole("button", { name: /ยอดรวมไม่ตรง/ }).click();
    const total = lead.locator('[data-field="header.grandTotal"] input');
    await expect(total).toBeFocused();
    await total.fill("10700.00");
    await expect(lead.getByTestId("check-bar")).toContainText("พร้อมยืนยัน");
    await lead.keyboard.press("Control+Enter");
    await expect(lead.getByText(`ยืนยัน ${docNos.b} แล้ว ส่งให้หัวหน้าอนุมัติแล้ว`, { exact: true })).toBeVisible();
    expect(await statusOf("b")).toBe("PENDING_APPROVAL");

    await test.step("ผู้ที่แก้เองอนุมัติไม่ได้", async () => {
      await lead.goto(`/documents/${ids.b}`);
      await expect(lead.getByTestId("self-approval")).toBeVisible();
      await expect(lead.getByRole("button", { name: "อนุมัติ", exact: true })).toBeDisabled();
      const h = await token(request, lead1.email, lead1.password);
      const r = await request.post(`/api/documents/${ids.b}/approve`, { headers: h, data: {} });
      expect(r.status()).toBe(403);
    });
    await lead.context().close();
  });

  await test.step("AP Lead คนที่ 2 เห็นเหตุผลและประวัติการแก้ แล้วอนุมัติ B", async () => {
    const lead = await login(browser, lead2);
    await lead.goto(`/documents/${ids.b}`);
    await expect(lead.getByTestId("risk-reasons")).toContainText("มีการแก้ยอดเงินหลังการอ่าน");
    await expect(lead.getByTestId("edit-history")).toContainText(lead1.name);
    await lead.getByRole("button", { name: "อนุมัติ", exact: true }).click();
    await lead.getByRole("dialog").getByRole("button", { name: "อนุมัติ" }).click();
    await expect(lead).toHaveURL(/\/approvals$/);
    expect(await statusOf("b")).toBe("APPROVED");
    await lead.screenshot({ path: "../phase2/evidence/e2e-approvals-after.png" });
    await lead.context().close();
  });

  await test.step("Exec เห็น audit การแก้ field และการอนุมัติ", async () => {
    const res = await request.get("/api/audit-events?limit=200", { headers: execH });
    expect(res.status()).toBe(200);
    type Ev = { action: string; actorUserId: string | null; entityId: string | null; details: Record<string, unknown> | null };
    const items: Ev[] = (await res.json()).items;
    const forB = items.filter((e) => e.entityId === ids.b);
    const edit = forB.find((e) => e.action === "document.field_edited" && e.details?.field === "header.grandTotal");
    expect(edit?.details).toMatchObject({ aiValue: "10070.00", before: "10070.00", after: "10700.00" });
    const steps = forB
      .filter((e) => e.action === "document.status_changed")
      .map((e) => `${e.details?.before}→${e.details?.after}`)
      .reverse();
    expect(steps).toEqual(["UPLOADED→PROCESSING", "PROCESSING→EXTRACTED", "EXTRACTED→VERIFIED", "VERIFIED→PENDING_APPROVAL", "PENDING_APPROVAL→APPROVED"]);
    expect(forB.some((e) => e.action === "document.risk_assessed")).toBe(true);
    const approvedBy = forB.find((e) => e.action === "document.status_changed" && e.details?.after === "APPROVED")?.actorUserId;
    expect(approvedBy).not.toBe(edit?.actorUserId);
  });

  await page.context().close();
});
