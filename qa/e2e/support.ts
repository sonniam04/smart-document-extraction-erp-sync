// ตัวช่วยของ E2E Phase 3: ฐานข้อมูล (บัญชี owner), Odoo ผ่าน JSON-2 และการเปิด/ปิด container ของ Odoo
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const SERVICE_DIR = resolve(process.env.SDES_SERVICE_DIR ?? resolve(import.meta.dirname, "../../Service"));

/**
 * ทำงานกับฐานข้อมูลด้วยบัญชี owner — ใช้จำลองสถานการณ์ที่ทำผ่านหน้าจอไม่ได้
 * fn ต้องไม่อ้างตัวแปรภายนอก (ส่งค่าผ่าน arg) เพราะ stack production รัน fn ใน image tools ผ่าน SDES_E2E_TOOLS_CMD
 */
export async function withOwnerDb<T, A>(fn: (prisma: any, arg: A) => Promise<T>, arg: A): Promise<T> {
  const tools = process.env.SDES_E2E_TOOLS_CMD;
  if (tools) {
    const script = `
      const { createPrisma } = require("./dist/index.js");
      (async () => {
        const prisma = createPrisma(process.env.DATABASE_OWNER_URL);
        try { process.stdout.write(JSON.stringify((await (${fn.toString()})(prisma, ${JSON.stringify(arg)})) ?? null)); }
        finally { await prisma.$disconnect(); }
      })().catch((e) => { console.error(e.message); process.exit(1); });`;
    return JSON.parse(execSync(tools, { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] }).trim().split(/\r?\n/).pop()!);
  }
  const require = createRequire(resolve(SERVICE_DIR, "package.json"));
  const { createPrisma } = require("./packages/db/dist/index.js");
  process.loadEnvFile(resolve(SERVICE_DIR, ".env"));
  const e = process.env;
  const prisma = createPrisma(`postgresql://${e.POSTGRES_OWNER_USER}:${e.POSTGRES_OWNER_PASSWORD}@127.0.0.1:${e.POSTGRES_HOST_PORT}/${e.POSTGRES_DB}`);
  try {
    return await fn(prisma, arg);
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
const run = (prefix: string, args: string) => execSync(`${prefix} ${args}`, { cwd: SERVICE_DIR, stdio: "pipe", timeout: 300_000 });
/** stack ของแอป (เช่น redis) — stack production ตั้ง SDES_E2E_COMPOSE เป็นคำสั่ง compose ของ sdes-prod (phase 4 task 4.1) */
export function compose(args: string) {
  run(process.env.SDES_E2E_COMPOSE ?? `${DOCKER} compose --profile odoo`, args);
}
/** Odoo อยู่ใน compose dev เสมอ (stack production ต่อ container นี้เข้า network ของตัวเองด้วยชื่อ odoo) */
export function odooCompose(args: string) {
  run(process.env.SDES_E2E_ODOO_COMPOSE ?? `${DOCKER} compose --profile odoo`, args);
}
/** ค่าในไฟล์ค่าตั้งของ stack (dev: Service/.env; production: SDES_E2E_ENV_FILE) — ห้ามพิมพ์ค่าออก */
export function stackEnv(key: string): string {
  const file = process.env.SDES_E2E_ENV_FILE ?? resolve(SERVICE_DIR, ".env");
  const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) throw new Error(`ไม่มี ${key} ใน ${file}`);
  return m[1]!.trim();
}
