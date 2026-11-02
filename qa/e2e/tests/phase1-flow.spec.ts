// Phase 1 task 8.1 — E2E ตลอดสายกับ stack จริง (ไม่มี mock)
// Admin สร้าง Clerk/Exec → Clerk ล็อกอิน/เปลี่ยนรหัส → อัปโหลด 3 ไฟล์ (1 ซ้ำ) → เห็นสถานะ real-time → Exec เห็น audit ของทุกขั้น
import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { QA_ADMIN_EMAIL } from "../global-setup";
import { writeFixture } from "../fixtures";

const run = Date.now().toString(36);
const clerk = { email: `qa-clerk-${run}@sdes.local`, name: `QA Clerk ${run}`, password: `qa-clerk-${randomBytes(9).toString("base64url")}` };
const exec = { email: `qa-exec-${run}@sdes.local`, name: `QA Exec ${run}`, password: `qa-exec-${randomBytes(9).toString("base64url")}` };

/** PDF เล็กที่มีเนื้อหาไม่ซ้ำกันทุกครั้งที่รัน เพื่อไม่ชนกับเอกสารจากรอบก่อน */
// มีเฉลยผลว่างให้ fixture provider ด้วย (worker ใน E2E ใช้ EXTRACTION_PROVIDER=fixture)
const pdf = (label: string) => {
  const b = Buffer.from(`%PDF-1.4\n% SDES QA ${run} ${label} ${randomBytes(8).toString("hex")}\n%%EOF\n`);
  writeFixture(b);
  return b;
};

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
}

async function changeTempPassword(page: Page, temp: string, next: string) {
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel("รหัสผ่านปัจจุบัน").fill(temp);
  await page.getByLabel("รหัสผ่านใหม่", { exact: true }).fill(next);
  await page.getByLabel("ยืนยันรหัสผ่านใหม่").fill(next);
  await page.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" }).click();
}

async function createUser(page: Page, u: { email: string; name: string }, roleLabel: RegExp) {
  // ฟอร์มติ๊ก "เจ้าหน้าที่บัญชี" ไว้เป็นค่าเริ่มต้น — ให้ผู้ใช้มีเฉพาะ role ที่ต้องการ
  await page.getByRole("button", { name: "เพิ่มผู้ใช้" }).click();
  const dialog = page.getByRole("dialog", { name: "เพิ่มผู้ใช้" });
  await dialog.getByLabel("อีเมล").fill(u.email);
  await dialog.getByLabel("ชื่อที่แสดง").fill(u.name);
  await dialog.getByLabel(roleLabel).check();
  for (const box of await dialog.getByRole("checkbox").all()) {
    const label = (await box.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? "")) || "";
    if (!roleLabel.test(label)) await box.uncheck();
  }
  await dialog.getByRole("button", { name: "สร้างผู้ใช้" }).click();
  const temp = (await page.getByTestId("temp-password").textContent())!.trim();
  expect(temp.length).toBeGreaterThanOrEqual(12);
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(page.locator(`tr[data-user='${u.email}']`)).toContainText("รอเปลี่ยนรหัสผ่าน");
  return temp;
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test("Phase 1: ผู้ใช้ → อัปโหลด → สถานะ real-time → audit", async ({ browser, request }) => {
  const temps: Record<string, string> = {};
  const docs: Record<string, string> = {};

  await test.step("Admin สร้าง Clerk และ Exec", async () => {
    const admin = await newPage(browser);
    await login(admin, QA_ADMIN_EMAIL, process.env.QA_ADMIN_PASSWORD!);
    // หน้าแรกหลังล็อกอินของทุก role คือหน้าภาพรวม (overview-dashboard)
    await expect(admin).toHaveURL(/:\d+\/$/);
    await admin.goto("/admin/users");
    temps.clerk = await createUser(admin, clerk, /เจ้าหน้าที่บัญชี/);
    temps.exec = await createUser(admin, exec, /ผู้บริหารฝ่ายการเงิน/);
    await admin.context().close();
  });

  const page = await newPage(browser);

  await test.step("Clerk ล็อกอินด้วยรหัสชั่วคราวและถูกบังคับเปลี่ยนรหัส", async () => {
    await login(page, clerk.email, temps.clerk!);
    await changeTempPassword(page, temps.clerk!, clerk.password);
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByRole("heading", { name: "ภาพรวม", level: 1 })).toBeVisible();
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "คิวเอกสาร" })).toBeVisible();
  });

  await test.step("อัปโหลด 3 ไฟล์ (1 ไฟล์ซ้ำ) แล้วเห็น EXTRACTED โดยไม่รีเฟรช", async () => {
    // เครื่องหมายบน window หายไปถ้าหน้าถูกโหลดใหม่
    await page.evaluate(() => ((window as unknown as { __qaNoReload: boolean }).__qaNoReload = true));
    let navigations = 0;
    // การเปลี่ยนแท็บอัปเดต ?tab= ผ่าน history (ไม่โหลดหน้าใหม่ — __qaNoReload ยืนยันอีกชั้น) จึงไม่นับ
    page.on("framenavigated", (f) => f === page.mainFrame() && !/\/documents\?tab=\w+$/.test(f.url()) && navigations++);

    const a = pdf("A");
    await page.getByTestId("file-input").setInputFiles([
      { name: `qa-${run}-a.pdf`, mimeType: "application/pdf", buffer: a },
      { name: `qa-${run}-b.pdf`, mimeType: "application/pdf", buffer: pdf("B") },
      { name: `qa-${run}-a-copy.pdf`, mimeType: "application/pdf", buffer: a },
    ]);
    const results = page.getByRole("region", { name: "ผลการอัปโหลด" });
    await expect(results).toContainText("รับ 2 จาก 3 ไฟล์");
    const docNoOf = async (file: string) => (await results.locator("li", { hasText: file }).locator("span.num").textContent())?.trim() ?? "";
    docs.b = await docNoOf(`qa-${run}-b.pdf`);
    // ไฟล์ในชุดเดียวกันถูกประมวลผลพร้อมกัน — ตัวไหนของคู่ที่ซ้ำได้รับก่อนก็ได้ อีกตัวต้องถูกปฏิเสธโดยอ้างถึงตัวที่รับ
    const pair = [`qa-${run}-a.pdf`, `qa-${run}-a-copy.pdf`];
    const pairDocNos = await Promise.all(pair.map(docNoOf));
    const winner = pairDocNos.findIndex((d) => d !== "");
    expect(pairDocNos.filter((d) => d !== ""), "รับเพียงหนึ่งไฟล์จากคู่ที่ซ้ำ").toHaveLength(1);
    docs.a = pairDocNos[winner]!;
    for (const d of Object.values(docs)) expect(d).toMatch(/^DOC-\d+$/);
    await expect(results.locator("li", { hasText: pair[1 - winner]! })).toContainText(`ไฟล์ซ้ำกับเอกสาร ${docs.a}`);

    await page.getByRole("tab", { name: /รอตรวจ/ }).click();
    for (const docNo of Object.values(docs)) {
      await expect(page.locator(`tr[data-doc='${docNo}']`)).toContainText("รอตรวจ");
    }
    await expect(page.getByText("การเชื่อมต่อแบบ real-time หลุด")).toHaveCount(0);
    expect(navigations).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __qaNoReload?: boolean }).__qaNoReload)).toBe(true);
    await page.screenshot({ path: "../phase1/evidence/e2e-documents-extracted.png" });
  });

  await test.step("Exec ล็อกอิน เปลี่ยนรหัส และเห็นคิวแบบอ่านอย่างเดียว", async () => {
    const execPage = await newPage(browser);
    await login(execPage, exec.email, temps.exec!);
    await changeTempPassword(execPage, temps.exec!, exec.password);
    await expect(execPage).toHaveURL(/:\d+\/$/);
    await execPage.goto("/documents");
    await expect(execPage.getByText("ลากไฟล์มาวาง")).toHaveCount(0);
    await execPage.getByRole("tab", { name: /รอตรวจ/ }).click();
    await expect(execPage.locator(`tr[data-doc='${docs.a}']`)).toBeVisible();
    await execPage.context().close();
  });

  await test.step("Exec เห็น audit ของทุกขั้น", async () => {
    const auth = await request.post("/auth/login", { data: { email: exec.email, password: exec.password } });
    expect(auth.status()).toBe(200);
    const { accessToken } = await auth.json();
    const res = await request.get("/api/audit-events?limit=200", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status()).toBe(200);
    type Ev = { action: string; actorUserId: string | null; entityId: string | null; details: Record<string, unknown> | null };
    const items: Ev[] = (await res.json()).items;

    const created = items.filter((e) => e.action === "user.created");
    const clerkId = created.find((e) => e.details?.email === clerk.email)?.entityId;
    const execId = created.find((e) => e.details?.email === exec.email)?.entityId;
    expect(clerkId, "user.created ของ Clerk").toBeTruthy();
    expect(execId, "user.created ของ Exec").toBeTruthy();

    const has = (pred: (e: Ev) => boolean, what: string) => expect(items.some(pred), what).toBe(true);
    for (const id of [clerkId, execId]) {
      has((e) => e.action === "auth.login" && e.entityId === id, `auth.login ${id}`);
      has((e) => e.action === "user.password_changed" && e.entityId === id, `user.password_changed ${id}`);
    }

    const uploaded = items.filter((e) => e.action === "document.uploaded" && e.actorUserId === clerkId);
    expect(uploaded.map((e) => e.details?.docNo).sort()).toEqual([docs.a, docs.b].sort());
    has((e) => e.action === "document.upload_rejected" && e.actorUserId === clerkId && e.details?.reason === "duplicate", "upload_rejected (duplicate)");

    for (const ev of uploaded) {
      const steps = items
        .filter((e) => e.action === "document.status_changed" && e.entityId === ev.entityId)
        .map((e) => `${e.details?.before}→${e.details?.after}`)
        .reverse(); // API เรียงใหม่ → เก่า
      expect(steps, `ประวัติสถานะ ${ev.details?.docNo}`).toEqual(["UPLOADED→PROCESSING", "PROCESSING→EXTRACTED"]);
    }
  });

  await page.context().close();
});
