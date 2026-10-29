// ข้อมูลใบกำกับภาษีสังเคราะห์ (design D10): สุ่มแบบกำหนด seed จึงสร้างซ้ำได้ผลเดิม
import Decimal from "decimal.js";
import type { DocumentData, DocumentItem } from "./core.ts";

export const COMPANY = { taxId: "0994000165617", branch: "00000", name: "บริษัท ทดสอบระบบบัญชี จำกัด", address: "99 ถนนสาทร แขวงสีลม เขตบางรัก กรุงเทพฯ 10500" };
/** วันที่อัปโหลดสมมติของชุดทดสอบ — ใช้ตรวจกฎวันที่ */
export const UPLOADED_AT = "2026-10-29T03:00:00Z";

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/** เลขประจำตัวผู้เสียภาษี 13 หลักที่หลักสุดท้ายถูกต้องตามสูตร mod 11 */
export function taxId(r: Rng, prefix = "0105"): string {
  let base = prefix;
  while (base.length < 12) base += String(r.int(0, 9));
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (13 - i);
  return base + ((11 - (sum % 11)) % 10);
}

const VENDOR_NAMES = [
  "บริษัท สยามซัพพลาย จำกัด",
  "บริษัท ไทยออฟฟิศเทรด จำกัด",
  "ห้างหุ้นส่วนจำกัด เจริญพาณิชย์",
  "บริษัท บางกอก ไอที โซลูชั่น จำกัด",
  "บริษัท รุ่งเรืองขนส่ง จำกัด",
  "บริษัท กรีนคลีน เซอร์วิส จำกัด",
  "บริษัท แสงทองการพิมพ์ จำกัด (มหาชน)",
  "บริษัท นครชัยวัสดุภัณฑ์ จำกัด",
];

const CATALOG: { name: string; price: [number, number]; service: boolean }[] = [
  { name: "กระดาษ A4 80 แกรม (รีม)", price: [95, 140], service: false },
  { name: "หมึกพิมพ์เลเซอร์ รุ่น TN-2480", price: [1450, 2900], service: false },
  { name: "แฟ้มเอกสาร 3 นิ้ว", price: [45, 89], service: false },
  { name: "เก้าอี้สำนักงาน รุ่น ERGO-21", price: [3200, 5900], service: false },
  { name: "สาย LAN CAT6 ยาว 305 เมตร", price: [2500, 4200], service: false },
  { name: "จอภาพ 24 นิ้ว", price: [3900, 6500], service: false },
  { name: "ค่าบริการบำรุงรักษาระบบเครือข่าย (รายเดือน)", price: [8000, 25000], service: true },
  { name: "ค่าบริการทำความสะอาดสำนักงาน", price: [12000, 30000], service: true },
  { name: "ค่าขนส่งสินค้า กรุงเทพฯ–ชลบุรี", price: [1800, 4500], service: true },
  { name: "ค่าที่ปรึกษาด้านระบบบัญชี", price: [15000, 45000], service: true },
  { name: "ค่าพิมพ์โบรชัวร์ 4 สี", price: [6, 18], service: false },
  { name: "ค่าติดตั้งอุปกรณ์", price: [2000, 7500], service: true },
];

const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export type Invoice = {
  name: string;
  layout: "classic" | "modern" | "receipt";
  /** วันที่ที่พิมพ์บนเอกสาร (อาจเป็น พ.ศ.) — เฉลยใช้ ค.ศ. ใน data.invoiceDate */
  printedDate: string;
  vendorAddress: string;
  data: DocumentData;
  /** บรรทัดที่เป็นค่าบริการ (ใช้คำนวณฐานหัก ณ ที่จ่าย) */
  services: boolean[];
};

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function makeInvoice(index: number): Invoice {
  const r = rng(1000 + index * 7919);
  const layout = (["classic", "modern", "receipt"] as const)[index % 3]!;
  // เอกสารยาวหลายหน้าทุก ๆ 7 ฉบับ
  const long = index % 7 === 3;
  const lines = long ? r.int(22, 30) : r.int(1, 8);
  const items: DocumentItem[] = [];
  const services: boolean[] = [];
  let sum = new Decimal(0);
  for (let i = 0; i < lines; i++) {
    const c = r.pick(CATALOG);
    const qty = c.service ? 1 : r.int(1, 24);
    const price = new Decimal(r.int(c.price[0] * 100, c.price[1] * 100)).dividedBy(100);
    const lineDiscount = !c.service && r.chance(0.15) ? new Decimal(r.int(1, 20) * 10) : new Decimal(0);
    const amount = price.times(qty).minus(lineDiscount);
    sum = sum.plus(amount);
    services.push(c.service);
    items.push({
      no: i + 1,
      description: c.name,
      quantity: String(qty),
      unitPrice: money(price),
      discount: lineDiscount.isZero() ? null : money(lineDiscount),
      amount: money(amount),
    });
  }
  const subtotal = sum;
  const discount = r.chance(0.2) ? subtotal.times(r.pick([0.02, 0.05])).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : new Decimal(0);
  const net = subtotal.minus(discount);
  const vatExempt = index % 8 === 5;
  const vatBase = vatExempt ? new Decimal(0) : net;
  const vat = vatBase.times(7).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const grand = net.plus(vat);
  const serviceSum = items.reduce((a, it, i) => (services[i] ? a.plus(it.amount!) : a), new Decimal(0));
  const withWht = !serviceSum.isZero() && r.chance(0.6);
  const whtRate = withWht ? (items.some((it) => it.description!.startsWith("ค่าขนส่ง")) ? 1 : 3) : 0;
  // ส่วนลดท้ายบิลกระจายตามสัดส่วน — ฐาน WHT ไม่เกินยอดหลังส่วนลด
  const whtBase = withWht ? Decimal.min(serviceSum, net) : null;
  const whtAmount = whtBase ? whtBase.times(whtRate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;

  const year = 2026;
  const month = r.int(8, 10);
  const day = r.int(1, month === 10 ? 28 : 30);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const printedDate = r.pick([
    `${day}/${month}/${year + 543}`,
    `${day} ${THAI_MONTHS[month - 1]} ${year + 543}`,
    `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
  ]);
  const vendorBranch = r.chance(0.75) ? "00000" : String(r.int(1, 12)).padStart(5, "0");

  return {
    name: `inv-${String(index + 1).padStart(2, "0")}`,
    layout,
    printedDate,
    vendorAddress: `${r.int(1, 999)}/${r.int(1, 99)} ถนน${r.pick(["พระราม 4", "รัชดาภิเษก", "ลาดพร้าว", "สุขุมวิท", "เพชรบุรี"])} กรุงเทพฯ ${r.int(10100, 10900)}`,
    services,
    data: {
      invoiceNo: r.pick([`IV${year + 543}-${String(r.int(1, 9999)).padStart(5, "0")}`, `INV-${year}/${String(r.int(1, 999)).padStart(4, "0")}`, `TX${r.int(100000, 999999)}`]),
      invoiceDate: iso,
      vendorName: r.pick(VENDOR_NAMES),
      vendorTaxId: taxId(r),
      vendorBranch,
      buyerTaxId: COMPANY.taxId,
      buyerBranch: COMPANY.branch,
      subtotal: money(subtotal),
      discount: money(discount),
      vatBase: money(vatBase),
      vatRate: vatExempt ? "0" : "7",
      vatAmount: money(vat),
      vatExempt,
      grandTotal: money(grand),
      whtBase: whtBase ? money(whtBase) : null,
      whtRate: withWht ? String(whtRate) : null,
      whtAmount: whtAmount ? money(whtAmount) : null,
      netPayable: whtAmount ? money(grand.minus(whtAmount)) : null,
      items,
    },
  };
}
