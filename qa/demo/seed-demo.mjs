// เตรียมข้อมูลสาธิตบนเครื่อง dev สำหรับลองเล่น flow ของระบบ (ไม่ใช่ test)
// ต้องมี: stack ของ Service รันอยู่, worker ใช้ EXTRACTION_PROVIDER=fixture ที่ชี้ไป qa/extraction-eval/out/fixtures,
//          `pnpm generate` ใน qa/extraction-eval และ `pnpm build` ใน Service แล้ว
// ล้างก่อน (ถ้าต้องการ): sh qa/demo/reset-dev.sh <ไฟล์ผล Odoo setup> ใน WSL แล้ว migrate:deploy + seed ใน Service/
// รัน:   SDES_ODOO_SETUP=<ไฟล์ผล Odoo setup> node qa/demo/seed-demo.mjs <ไฟล์สำหรับเขียนบัญชีสาธิต (นอก repo)>
// ผล:   ผู้ใช้สาธิตทุก role (รหัสสุ่มต่อรอบ เขียนลงไฟล์ที่ระบุเท่านั้น), เอกสารหลายสถานะผ่าน API จริง,
//        ไฟล์สำรองให้ลองอัปโหลดเองใน qa/demo/uploads/ (ไม่เข้า git)
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const SERVICE = join(ROOT, "Service");
const EVAL = join(ROOT, "qa/extraction-eval/out");
const FIXTURES = join(EVAL, "fixtures");
const UPLOADS = join(here, "uploads");
const API = process.env.SDES_API_URL ?? "http://127.0.0.1:3000";
const COMPANY = { taxId: "0994000165617", name: "บริษัท ทดสอบระบบบัญชี จำกัด" };
const credsFile = process.argv[2];
if (!credsFile) throw new Error("ระบุไฟล์สำหรับเขียนบัญชีสาธิต (นอก repo) เป็นอาร์กิวเมนต์แรก");

process.loadEnvFile(join(SERVICE, ".env"));
const e = process.env;
const require = createRequire(join(SERVICE, "packages/db/package.json"));
const argon2 = require("argon2");
const { createPrisma } = await import(pathToFileURL(join(SERVICE, "packages/db/dist/index.js")).href);
const db = createPrisma(`postgresql://${e.POSTGRES_OWNER_USER}:${encodeURIComponent(e.POSTGRES_OWNER_PASSWORD)}@127.0.0.1:${e.POSTGRES_HOST_PORT ?? 5433}/${e.POSTGRES_DB}`);

const log = (...a) => console.log(new Date().toLocaleTimeString("th-TH"), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------- ผู้ใช้สาธิต ----------
const USERS = [
  { key: "admin", name: "แอดมิน สาธิต", roles: ["SYS_ADMIN"] },
  { key: "clerk", name: "สมศรี บัญชี", roles: ["AP_CLERK"] },
  { key: "lead", name: "สมชาย หัวหน้า", roles: ["AP_LEAD"] },
  { key: "lead2", name: "วิไล หัวหน้า", roles: ["AP_LEAD"] },
  { key: "exec", name: "ประภา ผู้บริหาร", roles: ["FINANCE_EXEC"] },
];
const accounts = {};
for (const u of USERS) {
  const email = `${u.key}@demo.sdes.local`;
  const password = `demo-${randomBytes(9).toString("base64url")}`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    await db.userRole.deleteMany({ where: { userId: existing.id } });
    await db.user.update({
      where: { email },
      data: { passwordHash, displayName: u.name, isActive: true, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, roles: { create: u.roles.map((role) => ({ role })) } },
    });
  } else {
    await db.user.create({ data: { email, displayName: u.name, passwordHash, mustChangePassword: false, roles: { create: u.roles.map((role) => ({ role })) } } });
  }
  accounts[u.key] = { email, password, roles: u.roles, name: u.name };
}
mkdirSync(dirname(resolve(credsFile)), { recursive: true });
writeFileSync(
  credsFile,
  [
    "บัญชีสาธิต SDES (เครื่อง dev เท่านั้น — รหัสสุ่มใหม่ทุกครั้งที่รัน seed-demo.mjs)",
    "เว็บ: http://localhost:3100/login",
    "",
    ...USERS.map((u) => `${accounts[u.key].roles.join("+").padEnd(13)} ${u.name.padEnd(16)} ${accounts[u.key].email.padEnd(26)} ${accounts[u.key].password}`),
    "",
  ].join("\n"),
  { mode: 0o600 },
);
log(`สร้างบัญชีสาธิต ${USERS.length} บัญชี → ${credsFile}`);
await db.$disconnect();

// ---------- เรียก API ----------
async function call(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && !(body instanceof FormData) && { "Content-Type": "application/json" }) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
  return data;
}
const token = async (k) => (await call("POST", "/auth/login", null, { email: accounts[k].email, password: accounts[k].password })).accessToken;
const T = {};
for (const u of USERS) T[u.key] = await token(u.key);

await call("PUT", "/settings/risk", T.admin, { confidenceThreshold: 0.85, highAmountThreshold: "500000.00", companyTaxId: COMPANY.taxId, companyName: COMPANY.name });

// ---------- ERP: ใช้ Odoo ของ dev ถ้าตั้งค่าไว้และทดสอบผ่าน ----------
let erp = "ปิด";
try {
  const setupFile = process.env.SDES_ODOO_SETUP;
  if (setupFile && existsSync(setupFile)) {
    const o = JSON.parse(readFileSync(setupFile, "utf8"));
    await call("PUT", "/erp/connection", T.admin, { adapter: "odoo", url: "http://odoo:8069", database: "sdes_erp", apiMode: "json2", journalId: o.journalId, purchaseTaxId: o.purchaseTaxId, expenseAccountId: o.expenseAccountId, secret: o.apiKey });
  }
  const test = await call("POST", "/erp/connection/test", T.admin);
  if (test.checks?.every((c) => c.ok)) {
    await call("PUT", "/erp/connection/auto-sync", T.admin, { enabled: true });
    erp = "Odoo (ส่งอัตโนมัติ)";
  }
} catch (err) {
  log(`ข้าม ERP: ${err.message}`);
}
log(`ERP: ${erp}`);

// ---------- เอกสาร: สำเนาของชุดวัดผลที่มีเฉลย ----------
// ออกแบบให้มีงานค้างทุกขั้นของ flow หลังล้างข้อมูลด้วย reset-dev.sh — ผู้ขายในชุดวัดผลไม่ซ้ำกันเลย
// "ผู้ขายเดิม" จึงสร้างจากสำเนาที่สองของเอกสารที่อนุมัติแล้ว โดยเปลี่ยนเลขที่เอกสาร
const run = Date.now().toString(36);
const ALL = readdirSync(join(EVAL, "docs")).sort();
const file = (n) => ALL.find((f) => f.startsWith(`inv-${String(n).padStart(2, "0")}.`));
const ext = (f) => f.split(".").pop();
const mime = (f) => ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", tiff: "image/tiff" })[ext(f)];
const answerOf = (f) => JSON.parse(readFileSync(join(FIXTURES, `${sha(readFileSync(join(EVAL, "docs", f)))}.json`), "utf8"));

/** สำเนาไฟล์ (ไบต์ต่างจากต้นฉบับ) + เขียนเฉลยของสำเนา — suffix เปลี่ยนเลขที่เอกสาร, tweak ปรับเฉลยเพื่อสร้างเคส */
function copyWithAnswer(f, { suffix, tweak } = {}) {
  const original = readFileSync(join(EVAL, "docs", f));
  const answer = answerOf(f);
  const copy = Buffer.concat([original, Buffer.from(`\n% sdes-demo ${run} ${randomBytes(4).toString("hex")}\n`)]);
  if (suffix && answer.header?.invoiceNo?.value) answer.header.invoiceNo.value = `${answer.header.invoiceNo.value}${suffix}`;
  tweak?.(answer);
  writeFileSync(join(FIXTURES, `${sha(copy)}.json`), JSON.stringify(answer));
  return copy;
}
const lowConfidence = (a) => {
  a.header.vatAmount.confidence = 0.62;
  a.header.grandTotal.confidence = 0.66;
  a.confidence = 0.64;
};
const totalOffByOne = (a) => {
  a.header.grandTotal.value = (Number(a.header.grandTotal.value) + 1).toFixed(2);
};
/** ไฟล์ที่ไม่มีเฉลย → fixture provider อ่านไม่ได้ → FAILED */
const unreadable = () => Buffer.concat([readFileSync(join(EVAL, "docs", file(1))), Buffer.from(`\n% no-answer ${run} ${randomBytes(4).toString("hex")}\n`)]);

// key = ชื่อไฟล์ที่อัปโหลด
const SCENARIOS = [
  // ประวัติ: Clerk ยืนยัน → รอหัวหน้า (ผู้ขายใหม่) → อนุมัติ → ส่งเข้า Odoo
  ...[1, 2, 3, 5, 6, 7, 8].map((n) => ({ key: `inv-${n}`, n, walk: "approve" })),
  { key: "inv-9", n: 9, walk: "reject" },
  // รอหัวหน้าตัดสิน
  { key: "inv-4", n: 4, walk: "pending" }, // ผู้ขายใหม่ + ยอดสูงกว่า 500,000
  { key: "inv-10", n: 10, walk: "pending" }, // ผู้ขายใหม่
  { key: "inv-11", n: 11, walk: "pending", tweak: lowConfidence }, // ผู้ขายใหม่ + AI ไม่มั่นใจ + ยอดสูง
  { key: "inv-12", n: 12, walk: "fix-then-pending", tweak: totalOffByOne }, // Clerk แก้ยอดรวมแล้วยืนยัน → มีการแก้ยอดเงิน
  // คิวของ Clerk (ให้ลองเอง)
  { key: "ผู้ขายเดิม-1", n: 1, suffix: "/2", walk: "leave" }, // ยืนยันแล้วส่ง ERP ทันที ไม่ผ่านหัวหน้า
  { key: "ผู้ขายเดิม-5", n: 5, suffix: "/2", walk: "leave" },
  { key: "ผู้ขายเดิม-7", n: 7, suffix: "/2", walk: "leave" },
  { key: "inv-13", n: 13, walk: "leave" }, // ผู้ขายใหม่ → ยืนยันแล้วไปรอหัวหน้า
  { key: "inv-14", n: 14, walk: "leave", tweak: lowConfidence }, // ช่องเหลือง ต้องตรวจกับภาพ
  { key: "inv-15", n: 15, walk: "leave", tweak: totalOffByOne }, // ยอดรวมไม่ลงตัว ต้องแก้ก่อนยืนยัน
  { key: "เลขที่ซ้ำ-2", n: 2, walk: "leave" }, // เลขที่เดียวกับ inv-2 ที่ส่ง ERP แล้ว → ยืนยันไม่ได้
  { key: "สแกนไม่ชัด", n: 1, walk: "leave", unreadable: true }, // อ่านไม่ได้ → FAILED
];

const form = new FormData();
for (const sc of SCENARIOS) {
  const f = file(sc.n);
  const bytes = sc.unreadable ? unreadable() : copyWithAnswer(f, sc);
  form.append("files", new Blob([bytes], { type: mime(f) }), `${sc.key}.${ext(f)}`);
}
const up = await call("POST", "/documents", T.clerk, form);
const ok = up.results.filter((r) => r.ok);
log(`อัปโหลด ${ok.length}/${up.results.length} ไฟล์`);
const idOf = Object.fromEntries(SCENARIOS.map((sc) => [sc.key, ok.find((r) => r.fileName.startsWith(`${sc.key}.`))?.id]));

const get = (id, k = "exec") => call("GET", `/documents/${id}`, T[k]);
async function waitFor(ids, done, label, seconds = 180) {
  for (let t = 0; t < seconds; t++) {
    const s = await Promise.all(ids.map(async (id) => (await get(id)).status));
    if (s.every(done)) return;
    await sleep(1000);
  }
  log(`รอ${label}ไม่ครบใน ${seconds} วินาที — ดูสถานะในหน้าเว็บ`);
}
await waitFor(ok.map((r) => r.id), (s) => !["UPLOADED", "PROCESSING"].includes(s), "การอ่าน");

// ---------- เดินสถานะ ----------
for (const sc of SCENARIOS.filter((x) => x.walk !== "leave")) {
  const id = idOf[sc.key];
  let d = await get(id, "clerk");
  if (d.status !== "EXTRACTED") {
    log(`ข้าม ${sc.key}: สถานะ ${d.status}`);
    continue;
  }
  if (sc.walk === "fix-then-pending") {
    const correct = answerOf(file(sc.n)).header.grandTotal.value;
    await call("PATCH", `/documents/${id}/data`, T.clerk, { version: d.version, changes: { grandTotal: correct } });
    d = await get(id, "clerk");
  }
  await call("POST", `/documents/${id}/verify`, T.clerk, { version: d.version });
}
const decide = SCENARIOS.filter((x) => ["approve", "reject"].includes(x.walk));
await waitFor(decide.map((x) => idOf[x.key]), (s) => s === "PENDING_APPROVAL", "เข้าคิวอนุมัติ", 30);
for (const [i, sc] of decide.entries()) {
  const id = idOf[sc.key];
  const who = i % 2 ? "lead2" : "lead";
  const d = await get(id, who);
  if (sc.walk === "approve") await call("POST", `/documents/${id}/approve`, T[who], { version: d.version });
  else await call("POST", `/documents/${id}/reject`, T[who], { version: d.version, reason: "ราคาต่อหน่วยสูงกว่าใบเสนอราคาที่อนุมัติไว้ — ขอให้ผู้ขายออกใบใหม่" });
}
log(`หัวหน้าอนุมัติ ${decide.filter((x) => x.walk === "approve").length} ฉบับ, ปฏิเสธ ${decide.filter((x) => x.walk === "reject").length} ฉบับ`);
const approvedIds = decide.filter((x) => x.walk === "approve").map((x) => idOf[x.key]);
if (erp !== "ปิด") await waitFor(approvedIds, (s) => ["SYNCED", "SYNC_FAILED"].includes(s), "การส่ง ERP", 120);

// เลขที่ซ้ำถูกตรวจตอนอ่าน (ตอนนั้นต้นฉบับยังไม่ยืนยัน) — ลองยืนยันหนึ่งครั้งให้ระบบบันทึก error เลขที่ซ้ำไว้ให้เห็นตั้งแต่เปิดเอกสาร
{
  const id = idOf["เลขที่ซ้ำ-2"];
  const d = await get(id, "clerk");
  await call("POST", `/documents/${id}/verify`, T.clerk, { version: d.version }).catch(() => {});
}

// ---------- API key ที่ใกล้หมดอายุ (เห็นในหน้าภาพรวมของ Admin) ----------
try {
  await call("POST", "/admin/api-keys", T.admin, { name: "เครื่องสแกนชั้น 2", scopes: ["document.upload"], expiresInDays: 7 });
} catch (err) {
  log(`ข้าม API key: ${err.message}`);
}

// ---------- ไฟล์ให้ลองอัปโหลดเอง (ชื่อไฟล์บอกผลที่ควรเห็น) ----------
rmSync(UPLOADS, { recursive: true, force: true });
mkdirSync(UPLOADS, { recursive: true });
const put = (name, n, bytes) => writeFileSync(join(UPLOADS, `${name}.${ext(file(n))}`), bytes);
put("01-ผู้ขายเดิม-ยืนยันแล้วส่งERPทันที", 3, copyWithAnswer(file(3), { suffix: "/2" }));
put("02-ผู้ขายใหม่-ยืนยันแล้วรอหัวหน้า", 16, copyWithAnswer(file(16)));
put("03-ยอดสูง-ยืนยันแล้วรอหัวหน้า", 18, copyWithAnswer(file(18)));
put("04-ยอดไม่ลงตัว-ต้องแก้ก่อนยืนยัน", 19, copyWithAnswer(file(19), { tweak: totalOffByOne }));
put("05-AIไม่มั่นใจ-ช่องเหลือง", 20, copyWithAnswer(file(20), { tweak: lowConfidence }));
put("06-เลขที่ซ้ำกับฉบับที่ส่งแล้ว", 6, copyWithAnswer(file(6)));
put("07-สแกนไม่ชัด-อ่านไม่ได้", 1, unreadable());
for (const n of [21, 22, 23, 24]) put(`08-ปกติ-ผู้ขายใหม่-inv-${n}`, n, copyWithAnswer(file(n)));
const twin = readdirSync(UPLOADS).find((f) => f.startsWith("02-"));
copyFileSync(join(UPLOADS, twin), join(UPLOADS, `09-ไฟล์ซ้ำกับ02-อัปโหลดหลัง02.${ext(twin)}`)); // ไบต์เดียวกับ 02 → ระบบเตือนไฟล์ซ้ำ
log(`ไฟล์ให้ลองอัปโหลดเอง ${readdirSync(UPLOADS).length} ไฟล์ → ${UPLOADS}`);

const counts = {};
for (const id of ok.map((r) => r.id)) {
  const s = (await get(id)).status;
  counts[s] = (counts[s] ?? 0) + 1;
}
log("สถานะเอกสารสาธิต:", counts);
