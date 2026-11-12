// เฉลยของ fixture provider สำหรับไฟล์ที่ E2E อัปโหลด — worker (EXTRACTION_PROVIDER=fixture) อ่านจากโฟลเดอร์นี้ที่ mount ไว้
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const FIXTURE_DIR = resolve(process.env.SDES_FIXTURE_DIR ?? resolve(import.meta.dirname, "../extraction-eval/out/fixtures"));

const HEADER = [
  "invoiceNo", "invoiceDate", "vendorName", "vendorTaxId", "vendorBranch", "buyerTaxId", "buyerBranch",
  "subtotal", "discount", "vatBase", "vatRate", "vatAmount", "vatExempt", "grandTotal",
  "whtBase", "whtRate", "whtAmount", "netPayable",
] as const;

export type Item = { description: string; quantity: string; unitPrice: string; amount: string };
export type Header = Partial<Record<(typeof HEADER)[number], string | boolean | null>>;

const field = (value: string | boolean | null | undefined, confidence = 0.97) => ({
  value: value ?? null,
  confidence: value === null || value === undefined ? 0 : confidence,
  bbox: value === null || value === undefined ? null : { page: 1, x: 0.55, y: 0.5, w: 0.3, h: 0.03 },
});

/** เขียนเฉลยของไฟล์นี้ (ไม่ใส่ header = ผลว่างแบบ fake provider) */
export function writeFixture(file: Buffer, header: Header = {}, items: Item[] = [], confidence = 0.97) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const sha = createHash("sha256").update(file).digest("hex");
  const answer = {
    modelVersion: "fixture-1",
    confidence: Object.keys(header).length ? confidence : 0,
    header: Object.fromEntries(HEADER.map((k) => [k, field(k === "vatExempt" ? (header[k] ?? false) : header[k], confidence)])),
    items: items.map((it, i) => ({
      no: i + 1,
      description: field(it.description),
      quantity: field(it.quantity),
      unitPrice: field(it.unitPrice),
      amount: field(it.amount),
    })),
  };
  writeFileSync(join(FIXTURE_DIR, `${sha}.json`), JSON.stringify(answer));
}

/** เลขประจำตัวผู้เสียภาษีสุ่มที่ผ่านสูตร mod 11 (ผู้ขายใหม่ทุกครั้งที่รัน) */
export function randomTaxId(): string {
  let base = "0105";
  while (base.length < 12) base += String(Math.floor(Math.random() * 10));
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (13 - i);
  return base + ((11 - (sum % 11)) % 10);
}
