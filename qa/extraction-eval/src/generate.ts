// สร้างชุดเอกสารทดสอบสังเคราะห์ + เฉลย + fixture (phase 2 task 7.1, design D10)
// ใช้: pnpm generate [--count 30]  → out/docs, out/answers, out/fixtures, out/manifest.json
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { HEADER_FIELDS, validateDocument, type BBox, type DocumentData } from "./core.ts";
import { COMPANY, UPLOADED_AT, makeInvoice, rng, type Invoice } from "./data.ts";

const OUT = join(import.meta.dirname, "..", "out");
const W = 794; // A4 ที่ 96 dpi
const H = 1123;
const ROWS_FIRST = 14;
const ROWS_NEXT = 24;

type Format = "pdf" | "png" | "jpg" | "tiff";
/** รูปแบบไฟล์ตามลำดับเอกสาร: PDF ครึ่งหนึ่ง ที่เหลือเป็นภาพสแกน */
const FORMATS: Format[] = ["pdf", "pdf", "png", "pdf", "jpg", "tiff"];

const fmtMoney = (v: string | null) => (v === null ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtTax = (id: string, dashed: boolean) => (dashed ? `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}` : id);
const fmtBranch = (b: string | null) => (b === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${b}`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const v = (path: string, text: string) => `<span data-f="${path}">${esc(text)}</span>`;

function pagesOf(inv: Invoice): number[][] {
  const idx = inv.data.items.map((_, i) => i);
  const pages = [idx.slice(0, ROWS_FIRST)];
  for (let i = ROWS_FIRST; i < idx.length; i += ROWS_NEXT) pages.push(idx.slice(i, i + ROWS_NEXT));
  return pages;
}

function html(inv: Invoice): string {
  const d = inv.data;
  const dashed = inv.layout !== "modern";
  const accent = { classic: "#1b2b4b", modern: "#0f766e", receipt: "#333" }[inv.layout];
  const pages = pagesOf(inv);
  const row = (i: number) => {
    const it = d.items[i]!;
    return `<tr><td>${it.no}</td><td>${v(`items[${i}].description`, it.description!)}</td>
      <td class="r">${v(`items[${i}].quantity`, it.quantity!)}</td><td class="r">${v(`items[${i}].unitPrice`, fmtMoney(it.unitPrice))}</td>
      <td class="r">${it.discount ? v(`items[${i}].discount`, fmtMoney(it.discount)) : ""}</td><td class="r">${v(`items[${i}].amount`, fmtMoney(it.amount))}</td></tr>`;
  };
  const sumRow = (label: string, key: keyof DocumentData, strong = false) =>
    d[key] === null ? "" : `<tr class="${strong ? "b" : ""}"><td>${label}</td><td class="r">${v(`header.${key}`, fmtMoney(d[key] as string))}</td></tr>`;
  const summary = `<table class="sum">
      ${sumRow("รวมเป็นเงิน", "subtotal")}
      ${d.discount !== "0.00" ? sumRow("ส่วนลด", "discount") : ""}
      ${d.vatExempt ? `<tr><td colspan="2">${v("header.vatExempt", "ยกเว้นภาษีมูลค่าเพิ่ม")}</td></tr>` : `${sumRow("มูลค่าที่คำนวณภาษี", "vatBase")}<tr><td>ภาษีมูลค่าเพิ่ม ${v("header.vatRate", d.vatRate!)}%</td><td class="r">${v("header.vatAmount", fmtMoney(d.vatAmount))}</td></tr>`}
      ${sumRow("จำนวนเงินรวมทั้งสิ้น", "grandTotal", true)}
      ${d.whtAmount ? `<tr><td>หัก ณ ที่จ่าย ${v("header.whtRate", d.whtRate!)}% จากยอด ${v("header.whtBase", fmtMoney(d.whtBase))}</td><td class="r">${v("header.whtAmount", fmtMoney(d.whtAmount))}</td></tr>${sumRow("ยอดชำระสุทธิ", "netPayable", true)}` : ""}
    </table>`;
  const head = `<header>
      <div class="vendor">${v("header.vendorName", d.vendorName!)}<br><small>${esc(inv.vendorAddress)}</small><br>
        <small>เลขประจำตัวผู้เสียภาษี ${v("header.vendorTaxId", fmtTax(d.vendorTaxId!, dashed))} ${v("header.vendorBranch", fmtBranch(d.vendorBranch))}</small></div>
      <div class="title"><h1>${inv.layout === "receipt" ? "ใบเสร็จรับเงิน/ใบกำกับภาษี" : "ใบกำกับภาษี / ใบแจ้งหนี้"}</h1>
        เลขที่ ${v("header.invoiceNo", d.invoiceNo!)}<br>วันที่ ${v("header.invoiceDate", inv.printedDate)}</div>
    </header>
    <div class="buyer">ลูกค้า: ${esc(COMPANY.name)}<br><small>${esc(COMPANY.address)}</small><br>
      <small>เลขประจำตัวผู้เสียภาษี ${v("header.buyerTaxId", fmtTax(d.buyerTaxId!, dashed))} ${v("header.buyerBranch", fmtBranch(d.buyerBranch))}</small></div>`;
  const body = pages
    .map(
      (rows, p) => `<section class="page">
      ${p === 0 ? head : `<p class="cont">${esc(d.vendorName!)} — ต่อจากหน้าก่อน (หน้า ${p + 1}/${pages.length})</p>`}
      <table class="items"><thead><tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>ส่วนลด</th><th>จำนวนเงิน</th></tr></thead>
      <tbody>${rows.map(row).join("")}</tbody></table>
      ${p === pages.length - 1 ? summary : ""}
      <footer>หน้า ${p + 1}/${pages.length}</footer></section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${W}px ${H}px; margin: 0 }
    body { margin: 0; font-family: Tahoma, "Leelawadee UI", sans-serif; font-size: 12px; color: #222 }
    .page { position: relative; width: ${W}px; height: ${H}px; padding: 40px 48px; box-sizing: border-box; background: #fff; page-break-after: always; overflow: hidden }
    header { display: flex; justify-content: space-between; border-bottom: 3px solid ${accent}; padding-bottom: 10px }
    .vendor { font-size: 15px; font-weight: bold; max-width: 55% } .vendor small { font-weight: normal }
    .title { text-align: right } h1 { font-size: 17px; margin: 0 0 6px; color: ${accent} }
    .buyer { margin: 14px 0; padding: 8px; border: 1px solid #bbb }
    table.items { width: 100%; border-collapse: collapse } .items th { background: ${accent}; color: #fff; padding: 5px; font-weight: normal }
    .items td { padding: 4px 5px; border-bottom: 1px solid #ddd } .r { text-align: right }
    table.sum { margin: 14px 0 0 auto; width: 55% } .sum td { padding: 3px 5px } .sum .b td { font-weight: bold; border-top: 1px solid #333 }
    footer { position: absolute; bottom: 24px; right: 48px; color: #777 } .cont { color: #555 }
  </style></head><body>${body}</body></html>`;
}

type Measured = Record<string, BBox>;

async function render(page: import("playwright").Page, inv: Invoice) {
  await page.setContent(html(inv), { waitUntil: "load" });
  const boxes = await page.evaluate(() => {
    const out: Record<string, { page: number; x: number; y: number; w: number; h: number }> = {};
    document.querySelectorAll<HTMLElement>("section.page").forEach((sec, p) => {
      const s = sec.getBoundingClientRect();
      sec.querySelectorAll<HTMLElement>("[data-f]").forEach((el) => {
        const r = el.getBoundingClientRect();
        out[el.dataset.f!] = { page: p + 1, x: (r.left - s.left) / s.width, y: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height };
      });
    });
    return out;
  });
  return boxes as Measured;
}

/** ภาพสแกน: เอียงเล็กน้อย + noise + เบลอ — คำนวณกรอบใหม่ตามการหมุน */
async function scan(png: Buffer, boxes: Measured, pageNo: number, seed: number) {
  const r = rng(seed);
  const deg = (r.next() - 0.5) * 2; // −1°..+1°
  const rad = (deg * Math.PI) / 180;
  const noise = Buffer.alloc(W * H);
  for (let i = 0; i < noise.length; i++) noise[i] = r.next() < 0.015 ? r.int(0, 120) : 255;
  const noisy = await sharp(png)
    .composite([{ input: await sharp(noise, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer(), blend: "multiply" }])
    .blur(0.5)
    .rotate(deg, { background: "#ffffff" })
    .png()
    .toBuffer();
  const meta = await sharp(noisy).metadata();
  const W2 = meta.width!;
  const H2 = meta.height!;
  const map = (x: number, y: number) => {
    const dx = x - W / 2;
    const dy = y - H / 2;
    return [dx * Math.cos(rad) - dy * Math.sin(rad) + W2 / 2, dx * Math.sin(rad) + dy * Math.cos(rad) + H2 / 2] as const;
  };
  const moved: Measured = {};
  for (const [k, b] of Object.entries(boxes)) {
    if (b.page !== pageNo) continue;
    const pts = [map(b.x * W, b.y * H), map((b.x + b.w) * W, b.y * H), map(b.x * W, (b.y + b.h) * H), map((b.x + b.w) * W, (b.y + b.h) * H)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    moved[k] = { page: pageNo, x: Math.min(...xs) / W2, y: Math.min(...ys) / H2, w: (Math.max(...xs) - Math.min(...xs)) / W2, h: (Math.max(...ys) - Math.min(...ys)) / H2 };
  }
  return { image: noisy, boxes: moved };
}

/** เฉลยในรูป ExtractionResult สำหรับ FixtureExtractionProvider */
function fixtureOf(d: DocumentData, boxes: Measured) {
  const f = (path: string, value: string | boolean | null) => ({ value, confidence: value === null ? 0 : 0.97, bbox: value === null ? null : (boxes[path] ?? null) });
  const header = Object.fromEntries(HEADER_FIELDS.map((k) => [k, f(`header.${k}`, d[k] as string | boolean | null)]));
  const items = d.items.map((it, i) => ({
    no: it.no,
    description: f(`items[${i}].description`, it.description),
    quantity: f(`items[${i}].quantity`, it.quantity),
    unitPrice: f(`items[${i}].unitPrice`, it.unitPrice),
    discount: f(`items[${i}].discount`, it.discount ?? null),
    amount: f(`items[${i}].amount`, it.amount),
  }));
  return { modelVersion: "fixture-1", confidence: 0.97, header, items };
}

async function main() {
  const count = Number(process.argv[process.argv.indexOf("--count") + 1] || 30) || 30;
  rmSync(OUT, { recursive: true, force: true });
  for (const d of ["docs", "answers", "fixtures"]) mkdirSync(join(OUT, d), { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const manifest: { name: string; file: string; format: Format; pages: number; layout: string; lines: number; wht: boolean; vatExempt: boolean }[] = [];
  let invalid = 0;

  for (let i = 0; i < count; i++) {
    const inv = makeInvoice(i);
    const issues = validateDocument(inv.data, { companyTaxId: COMPANY.taxId, uploadedAt: UPLOADED_AT }).filter((x) => x.severity === "ERROR");
    if (issues.length) {
      invalid++;
      console.error(`${inv.name}: เฉลยไม่ผ่านกฎตรวจ`, issues.map((x) => x.code));
    }
    const pageCount = pagesOf(inv).length;
    // ภาพหน้าเดียว (PNG/JPG) เก็บได้หน้าเดียว — เอกสารหลายหน้าที่ตกรูปแบบนี้ใช้ TIFF แทน
    const planned = FORMATS[i % FORMATS.length]!;
    const format: Format = pageCount > 1 && (planned === "png" || planned === "jpg") ? "tiff" : planned;
    let boxes = await render(page, inv);
    let file: Buffer;
    if (format === "pdf") {
      file = await page.pdf({ width: `${W}px`, height: `${H}px`, printBackground: true });
    } else {
      const shots: Buffer[] = [];
      const scanned: Measured = {};
      const sections = await page.locator("section.page").all();
      for (let p = 0; p < sections.length; p++) {
        const s = await scan(await sections[p]!.screenshot(), boxes, p + 1, i * 100 + p);
        shots.push(s.image);
        Object.assign(scanned, s.boxes);
      }
      boxes = scanned;
      // sharp รวมหลายภาพได้เมื่อมีอย่างน้อย 2 ภาพ — หน้าเดียวแปลงตรง
      if (format === "tiff")
        file = await (shots.length > 1 ? sharp(shots, { join: { animated: true } }) : sharp(shots[0])).tiff({ compression: "lzw" }).toBuffer();
      else if (format === "jpg") file = await sharp(shots[0]).jpeg({ quality: 82 }).toBuffer();
      else file = shots[0]!;
    }
    const fileName = `${inv.name}.${format === "jpg" ? "jpg" : format}`;
    writeFileSync(join(OUT, "docs", fileName), file);
    writeFileSync(join(OUT, "answers", `${inv.name}.json`), JSON.stringify({ file: fileName, format, data: inv.data, boxes }, null, 2));
    const sha = createHash("sha256").update(file).digest("hex");
    writeFileSync(join(OUT, "fixtures", `${sha}.json`), JSON.stringify(fixtureOf(inv.data, boxes)));
    manifest.push({ name: inv.name, file: fileName, format, pages: pageCount, layout: inv.layout, lines: inv.data.items.length, wht: inv.data.whtAmount !== null, vatExempt: inv.data.vatExempt });
  }
  await browser.close();
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  const by = (k: Format) => manifest.filter((m) => m.format === k).length;
  console.log(
    `สร้าง ${manifest.length} ฉบับ: PDF ${by("pdf")}, PNG ${by("png")}, JPG ${by("jpg")}, TIFF ${by("tiff")} · หลายหน้า ${manifest.filter((m) => m.pages > 1).length} · มี WHT ${manifest.filter((m) => m.wht).length} · ยกเว้น VAT ${manifest.filter((m) => m.vatExempt).length}`,
  );
  console.log(invalid ? `เฉลยไม่ผ่านกฎตรวจ ${invalid} ฉบับ` : "เฉลยทุกฉบับผ่านกฎตรวจ (ไม่มี ERROR)");
  if (invalid) process.exit(1);
}

void main();
