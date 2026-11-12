// เตรียม System Admin สำหรับ QA โดยไม่แตะบัญชี Admin ที่ seed ไว้ (ซึ่งยังใช้รหัสชั่วคราวจาก .env)
// รหัสผ่านสุ่มใหม่ทุกครั้ง ส่งให้ test ผ่าน process.env เท่านั้น — ไม่เขียนลงไฟล์ ไม่พิมพ์ออก
//
// stack dev: ต่อฐานข้อมูลตรงที่ port ของเครื่อง (Service/.env)
// stack production (ไม่มี port ของฐานข้อมูลเปิดออกนอก — phase 4 task 4.1): ตั้ง SDES_E2E_TOOLS_CMD เป็นคำสั่งที่รัน
//   `node -` ใน image tools ของ production แล้วส่งสคริปต์ทาง stdin (รหัสผ่านจึงไม่อยู่ใน argument ของ process ใด) เช่น
//   SDES_E2E_TOOLS_CMD="wsl docker compose -p sdes-prod --env-file ~/sdes-root/.env.production -f <Service>/docker-compose.prod.yml --profile tools run --rm -T migrate node -"
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const QA_ADMIN_EMAIL = "qa-admin@sdes.local";

const upsert = (passwordHash: string) => ({
  where: { email: QA_ADMIN_EMAIL },
  update: { passwordHash, mustChangePassword: false, isActive: true, failedLoginCount: 0, lockedUntil: null },
  create: { email: QA_ADMIN_EMAIL, displayName: "QA Admin", passwordHash, mustChangePassword: false, roles: { create: [{ role: "SYS_ADMIN" }] } },
});

async function viaDatabase(password: string) {
  const serviceDir = resolve(process.env.SDES_SERVICE_DIR ?? resolve(import.meta.dirname, "../../Service"));
  const require = createRequire(resolve(serviceDir, "package.json"));
  const { createPrisma } = require("./packages/db/dist/index.js");
  const argon2 = require(resolve(serviceDir, "packages/db/node_modules/argon2"));
  process.loadEnvFile(resolve(serviceDir, ".env"));
  const e = process.env;
  const prisma = createPrisma(`postgresql://${e.POSTGRES_OWNER_USER}:${e.POSTGRES_OWNER_PASSWORD}@127.0.0.1:${e.POSTGRES_HOST_PORT}/${e.POSTGRES_DB}`);
  try {
    await prisma.user.upsert(upsert(await argon2.hash(password, { type: argon2.argon2id })));
  } finally {
    await prisma.$disconnect();
  }
}

/** รันใน image tools (cwd = packages/db, มี DATABASE_OWNER_URL) */
function viaTools(cmd: string, password: string) {
  const script = `
    const { createPrisma } = require("./dist/index.js");
    const argon2 = require("argon2");
    (async () => {
      const prisma = createPrisma(process.env.DATABASE_OWNER_URL);
      const hash = await argon2.hash(${JSON.stringify(password)}, { type: argon2.argon2id });
      const q = ${JSON.stringify(upsert("__HASH__"))};
      q.update.passwordHash = q.create.passwordHash = hash;
      await prisma.user.upsert(q);
      await prisma.$disconnect();
    })().catch((e) => { console.error(e.message); process.exit(1); });`;
  execSync(cmd, { input: script, stdio: ["pipe", "ignore", "inherit"] });
}

export default async function globalSetup() {
  const password = randomBytes(18).toString("base64url");
  const tools = process.env.SDES_E2E_TOOLS_CMD;
  if (tools) viaTools(tools, password);
  else await viaDatabase(password);
  process.env.QA_ADMIN_PASSWORD = password;

  const health = await fetch(`${process.env.SDES_API_URL ?? "http://127.0.0.1:3000"}/health`).then((r) => r.json());
  if (health.status !== "ok") throw new Error(`stack ยังไม่พร้อม: ${JSON.stringify(health.checks)}`);
}
