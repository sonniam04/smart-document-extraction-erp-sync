// เตรียมข้อมูลสาธิตบนเครื่อง dev สำหรับลองเล่น flow ของระบบ (ไม่ใช่ test)
// ต้องมี: stack ของ Service รันอยู่, worker ใช้ EXTRACTION_PROVIDER=fixture ที่ชี้ไป qa/extraction-eval/out/fixtures,
//          `pnpm generate` ใน qa/extraction-eval และ `pnpm build` ใน Service แล้ว
// รัน:   node qa/demo/seed-demo.mjs <ไฟล์สำหรับเขียนบัญชีสาธิต (นอก repo)>
// ผล:   ผู้ใช้สาธิตทุก role (รหัสสุ่มต่อรอบ เขียนลงไฟล์ที่ระบุเท่านั้น), เอกสารหลายสถานะผ่าน API จริง,
//        ไฟล์สำรองให้ลองอัปโหลดเองใน qa/demo/uploads/ (ไม่เข้า git)
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

await call("PUT", "/settings/risk", T.admin, { confidenceThreshold: 0.85, highAmountThreshold: null, companyTaxId: COMPANY.taxId, companyName: COMPANY.name });

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

// ---------- เอกสาร: สำเนาของชุดวัดผลที่มีเฉลย (ต่อท้ายด้วยรหัสรอบเพื่อไม่ซ้ำกับของเดิม) ----------
const run = Date.now().toString(36);
const docs = readdirSync(join(EVAL, "docs")).sort();
/** สำเนาไฟล์ + เขียนเฉลยของสำเนา (tweak ใช้ปรับเฉลยเพื่อสร้างเคสที่ต้องแก้) */
function copyWithAnswer(file, tweak) {
  const original = readFileSync(join(EVAL, "docs", file));
  const answer = JSON.parse(readFileSync(join(FIXTURES, `${sha(original)}.json`), "utf8"));
  const copy = Buffer.concat([original, Buffer.from(`\n% sdes-demo ${run} ${randomBytes(4).toString("hex")}\n`)]);
  tweak?.(answer);
  writeFileSync(join(FIXTURES, `${sha(copy)}.json`), JSON.stringify(answer));
  return copy;
}
const mime = (f) => ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", tiff: "image/tiff" })[f.split(".").pop()];

const seeded = docs.slice(0, 22);
const reserved = docs.slice(22);
// เคสที่ต้องแก้: ฉบับที่ 1 AI ไม่มั่นใจยอดภาษีและยอดรวม, ฉบับที่ 2 ยอดรวมไม่ตรงกับผลคำนวณ (+1.00)
const tweaks = {
  0: (a) => {
    a.header.vatAmount.confidence = 0.62;
    a.header.grandTotal.confidence = 0.66;
    a.confidence = 0.64;
  },
  1: (a) => {
    a.header.grandTotal.value = (Number(a.header.grandTotal.value) + 1).toFixed(2);
  },
};
const form = new FormData();
seeded.forEach((f, i) => form.append("files", new Blob([copyWithAnswer(f, tweaks[i])], { type: mime(f) }), `${f.replace(/\.\w+$/, "")}-${run}.${f.split(".").pop()}`));
// ไฟล์ที่ไม่มีเฉลย → อ่านไม่สำเร็จ (ตัวอย่างเคสล้มเหลว)
form.append("files", new Blob([Buffer.concat([readFileSync(join(EVAL, "docs", docs[0])), Buffer.from(`\n% no-answer ${run}\n`)])], { type: "application/pdf" }), `scan-blurry-${run}.pdf`);
const up = await call("POST", "/documents", T.clerk, form);
const ok = up.results.filter((r) => r.ok);
log(`อัปโหลด ${ok.length}/${up.results.length} ไฟล์`);

const status = async (id) => (await call("GET", `/documents/${id}`, T.exec)).status;
for (let t = 0; t < 120; t++) {
  const s = await Promise.all(ok.map((r) => status(r.id)));
  if (s.every((x) => !["UPLOADED", "PROCESSING"].includes(x))) break;
  await sleep(1000);
}
const ids = seeded.map((f) => ok.find((r) => r.fileName.startsWith(f.replace(/\.\w+$/, "")))?.id).filter(Boolean);

// ---------- เดินสถานะ: ฉบับ 1–8 ค้างรอตรวจ, 9–18 Clerk ยืนยัน, จากนั้นหัวหน้าอนุมัติ/ปฏิเสธบางฉบับ ----------
const toVerify = ids.slice(8, 18);
const verified = [];
for (const id of toVerify) {
  const d = await call("GET", `/documents/${id}`, T.clerk);
  if (d.status !== "EXTRACTED") continue;
  const r = await call("POST", `/documents/${id}/verify`, T.clerk, { version: d.version });
  verified.push({ id, status: r.status ?? r.document?.status });
}
log(`Clerk ยืนยัน ${verified.length} ฉบับ`);
await sleep(1500);
const pending = [];
for (const v of verified) if ((await status(v.id)) === "PENDING_APPROVAL") pending.push(v.id);
const approve = pending.slice(0, 5);
const reject = pending.slice(5, 6);
for (const id of approve) {
  const d = await call("GET", `/documents/${id}`, T.lead);
  await call("POST", `/documents/${id}/approve`, T.lead, { version: d.version });
}
for (const id of reject) {
  const d = await call("GET", `/documents/${id}`, T.lead);
  await call("POST", `/documents/${id}/reject`, T.lead, { version: d.version, reason: "ราคาต่อหน่วยสูงกว่าใบเสนอราคาที่อนุมัติไว้ — ขอให้ผู้ขายออกใบใหม่" });
}
log(`หัวหน้าอนุมัติ ${approve.length} ฉบับ, ปฏิเสธ ${reject.length} ฉบับ`);

// ---------- API key ที่ใกล้หมดอายุ (เห็นในหน้าภาพรวมของ Admin) ----------
try {
  await call("POST", "/admin/api-keys", T.admin, { name: `เครื่องสแกนชั้น 2 (${run})`, scopes: ["document.upload"], expiresInDays: 7 });
} catch (err) {
  log(`ข้าม API key: ${err.message}`);
}

// ---------- ไฟล์ให้ลองอัปโหลดเอง ----------
mkdirSync(UPLOADS, { recursive: true });
for (const f of reserved) writeFileSync(join(UPLOADS, f), copyWithAnswer(f));
copyFileSync(join(EVAL, "docs", docs[0]), join(UPLOADS, `ซ้ำ-${docs[0]}`)); // ไว้ลองอัปโหลดไฟล์ซ้ำ (ต้นฉบับอาจยังไม่อยู่ในระบบ จึงอัปโหลดซ้ำกันเองได้)
log(`ไฟล์ให้ลองอัปโหลดเอง ${reserved.length} ไฟล์ → ${UPLOADS}`);

await sleep(8000);
const counts = {};
for (const id of ok.map((r) => r.id)) {
  const s = await status(id);
  counts[s] = (counts[s] ?? 0) + 1;
}
log("สถานะเอกสารสาธิต:", counts);
