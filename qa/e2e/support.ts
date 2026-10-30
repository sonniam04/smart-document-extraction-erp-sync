// ตัวช่วยของ E2E Phase 3: ฐานข้อมูล (บัญชี owner), Odoo ผ่าน JSON-2 และการเปิด/ปิด container ของ Odoo
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const SERVICE_DIR = resolve(process.env.SDES_SERVICE_DIR ?? resolve(import.meta.dirname, "../../Service"));

/** ทำงานกับฐานข้อมูลด้วยบัญชี owner จาก Service/.env — ใช้จำลองสถานการณ์ที่ทำผ่านหน้าจอไม่ได้ */
export async function withOwnerDb<T>(fn: (prisma: any) => Promise<T>): Promise<T> {
  const require = createRequire(resolve(SERVICE_DIR, "package.json"));
  const { createPrisma } = require("./packages/db/dist/index.js");
  process.loadEnvFile(resolve(SERVICE_DIR, ".env"));
  const e = process.env;
  const prisma = createPrisma(`postgresql://${e.POSTGRES_OWNER_USER}:${e.POSTGRES_OWNER_PASSWORD}@127.0.0.1:${e.POSTGRES_HOST_PORT}/${e.POSTGRES_DB}`);
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** ผลของ `sh docker/odoo/setup.sh` (JSON หนึ่งบรรทัด) ที่บันทึกไว้นอก repo — มี API key จึงห้าม commit */
export type OdooSetup = { apiKey: string; login: string; journalId: number; purchaseTaxId: number; expenseAccountId: number };
export function odooSetup(): OdooSetup | null {
  const path = process.env.SDES_ODOO_SETUP;
  if (!path) return null;
  const line = readFileSync(path, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).pop()!;
  return JSON.parse(line);
}

/** Odoo จากฝั่งเครื่อง (port ที่ compose เปิด) — worker ใช้ http://odoo:8069 ใน docker network */
export const ODOO_HOST_URL = process.env.SDES_ODOO_URL ?? "http://127.0.0.1:8069";

export async function odooCall<T>(setup: OdooSetup, model: string, method: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${ODOO_HOST_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: { Authorization: `bearer ${setup.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Odoo ${model}.${method}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

/** docker compose ของ Service (Windows ใช้ docker ใน WSL) */
const DOCKER = process.env.SDES_DOCKER ?? (process.platform === "win32" ? "wsl docker" : "docker");
export function compose(args: string) {
  execSync(`${DOCKER} compose --profile odoo ${args}`, { cwd: SERVICE_DIR, stdio: "pipe", timeout: 300_000 });
}
