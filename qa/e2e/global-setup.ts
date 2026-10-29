// เตรียม System Admin สำหรับ QA โดยไม่แตะบัญชี Admin ที่ seed ไว้ (ซึ่งยังใช้รหัสชั่วคราวจาก .env)
// รหัสผ่านสุ่มใหม่ทุกครั้ง ส่งให้ test ผ่าน process.env เท่านั้น — ไม่เขียนลงไฟล์ ไม่พิมพ์ออก
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const QA_ADMIN_EMAIL = "qa-admin@sdes.local";

export default async function globalSetup() {
  const serviceDir = resolve(process.env.SDES_SERVICE_DIR ?? resolve(import.meta.dirname, "../../Service"));
  const require = createRequire(resolve(serviceDir, "package.json"));
  const { createPrisma } = require("./packages/db/dist/index.js");
  const argon2 = require(resolve(serviceDir, "packages/db/node_modules/argon2"));

  process.loadEnvFile(resolve(serviceDir, ".env"));
  const e = process.env;
  const prisma = createPrisma(`postgresql://${e.POSTGRES_OWNER_USER}:${e.POSTGRES_OWNER_PASSWORD}@127.0.0.1:${e.POSTGRES_HOST_PORT}/${e.POSTGRES_DB}`);
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  try {
    await prisma.user.upsert({
      where: { email: QA_ADMIN_EMAIL },
      update: { passwordHash, mustChangePassword: false, isActive: true, failedLoginCount: 0, lockedUntil: null },
      create: { email: QA_ADMIN_EMAIL, displayName: "QA Admin", passwordHash, mustChangePassword: false, roles: { create: [{ role: "SYS_ADMIN" }] } },
    });
  } finally {
    await prisma.$disconnect();
  }
  process.env.QA_ADMIN_PASSWORD = password;

  const health = await fetch(`${process.env.SDES_API_URL ?? "http://127.0.0.1:3000"}/health`).then((r) => r.json());
  if (health.status !== "ok") throw new Error(`stack ยังไม่พร้อม: ${JSON.stringify(health.checks)}`);
}
