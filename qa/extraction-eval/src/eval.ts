// วัดผลการอ่านเอกสารกับชุดทดสอบ (phase 2 task 7.2, design D10)
// ใช้: pnpm eval [--provider fixture|claude|gemini] [--limit N] [--report ../phase2/extraction-eval.md]
// provider claude/gemini เรียก API จริงและมีค่าใช้จ่าย — ใช้ ANTHROPIC_API_KEY / GEMINI_API_KEY, EXTRACTION_MODEL, EXTRACTION_EFFORT จาก env หรือ Service/.env
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Anthropic from "../../../Service/apps/worker/node_modules/@anthropic-ai/sdk/index.js";
import * as claudeMod from "../../../Service/apps/worker/src/providers/claude.ts";
import * as fixtureMod from "../../../Service/apps/worker/src/providers/fixture.ts";
import * as geminiMod from "../../../Service/apps/worker/src/providers/gemini.ts";
import { GoogleGenAI } from "@google/genai";
import * as coreMod from "../../../Service/packages/core/src/index.ts";
import { cjs, type BBox, type DocumentData, type ExtractionResult } from "./core.ts";
import { COMPANY, UPLOADED_AT } from "./data.ts";

const { ClaudeExtractionProvider } = cjs(claudeMod);
const { FixtureExtractionProvider } = cjs(fixtureMod);
const { GeminiExtractionProvider } = cjs(geminiMod);
const { HEADER_FIELDS, applyValidationPenalty, toDocumentData, validateDocument } = cjs(coreMod);

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "out");
const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const envFile = resolve(ROOT, "../../Service/.env");
if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

/** ราคา USD ต่อ 1 ล้าน token (input, output) ตามตารางรุ่นปัจจุบัน */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  // paid tier ณ 2026-10-29 (3.8-flash ราคานี้ถึง 31 ธ.ค. 2026); PDF คิดราคาเดียวกับภาพ
  "gemini-3.8-flash": [0.75, 3.75],
  "gemini-3.5-flash-lite": [0.3, 2.5],
};
const DEFAULT_MODEL = { claude: "claude-opus-5-5", gemini: "gemini-3.8-flash" } as const;
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", tiff: "image/tiff" };

type Answer = { file: string; format: string; data: DocumentData; boxes: Record<string, BBox> };
type Manifest = { name: string; file: string; format: string; pages: number; lines: number }[];

const norm = (v: unknown) => (v === null || v === undefined ? null : typeof v === "boolean" ? v : String(v).replace(/\s+/g, " ").trim());
/** ตัวเลขเทียบเป็นค่า (2 กับ "2.00" ถือว่าตรง) */
const same = (a: unknown, b: unknown, numeric: boolean) => {
  const x = norm(a);
  const y = norm(b);
  if (numeric && x !== null && y !== null && typeof x === "string" && typeof y === "string") return Number(x) === Number(y);
  return x === y;
};
const NUMERIC = new Set(["subtotal", "discount", "vatBase", "vatRate", "vatAmount", "grandTotal", "whtBase", "whtRate", "whtAmount", "netPayable"]);
const ITEM_KEYS = ["description", "quantity", "unitPrice", "discount", "amount"] as const;

/** กรอบของ AI ครอบจุดกึ่งกลางของค่าจริง (เผื่อ 1% ของหน้า) */
function covers(pred: BBox | null | undefined, truth: BBox | undefined) {
  if (!pred || !truth || pred.page !== truth.page) return false;
  const cx = truth.x + truth.w / 2;
  const cy = truth.y + truth.h / 2;
  const m = 0.01;
  return cx >= pred.x - m && cx <= pred.x + pred.w + m && cy >= pred.y - m && cy <= pred.y + pred.h + m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ลองซ้ำเฉพาะข้อผิดพลาดชั่วคราว (แบบเดียวกับที่ worker ให้ BullMQ retry) — ms คือเวลาของครั้งที่สำเร็จ ไม่รวมการรอ */
async function extractWithRetry<T>(fn: () => Promise<T>, retries: number, name: string): Promise<{ result: T; ms: number }> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const result = await fn();
      return { result, ms: Date.now() - started };
    } catch (e) {
      const transient = (e as { permanent?: boolean }).permanent === false;
      if (!transient || attempt >= retries) throw e;
      const wait = 15_000 * (attempt + 1);
      console.log(`${name}: พลาดชั่วคราว (${(e as Error).message}) — ลองใหม่ใน ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function main() {
  const providerName = arg("provider", "fixture")!;
  const limit = Number(arg("limit", "0"));
  const report = resolve(ROOT, arg("report", "../phase2/extraction-eval.md")!);
  if (!existsSync(join(OUT, "manifest.json"))) throw new Error("ยังไม่มีชุดทดสอบ — รัน pnpm generate ก่อน");
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as Manifest;
  const docs = limit ? manifest.slice(0, limit) : manifest;

  const model = process.env.EXTRACTION_MODEL || (providerName === "gemini" ? DEFAULT_MODEL.gemini : DEFAULT_MODEL.claude);
  const effort = (process.env.EXTRACTION_EFFORT || "low") as "low";
  let provider: { name: string; extract: (i: { file: Uint8Array; mime: string }) => Promise<ExtractionResult> };
  if (providerName === "claude") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ต้องตั้ง ANTHROPIC_API_KEY (env หรือ Service/.env)");
    // SDK ตัวเดียวกับที่ worker ใช้ แต่ TypeScript เห็นเป็นสองเส้นทาง (symlink ของ pnpm) จึงต้อง cast
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as ConstructorParameters<typeof ClaudeExtractionProvider>[0];
    provider = new ClaudeExtractionProvider(client, { model, effort, timeoutMs: 120_000 });
  } else if (providerName === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("ต้องตั้ง GEMINI_API_KEY (env หรือ Service/.env)");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as ConstructorParameters<typeof GeminiExtractionProvider>[0];
    provider = new GeminiExtractionProvider(client, { model, timeoutMs: 120_000 });
  } else if (providerName === "fixture") {
    provider = new FixtureExtractionProvider(join(OUT, "fixtures"));
  } else throw new Error(`ไม่รู้จัก provider ${providerName} (fixture | claude | gemini)`);

  let fieldTotal = 0;
  let fieldOk = 0;
  const perField: Record<string, { ok: number; total: number }> = {};
  let lineTotal = 0;
  let lineOk = 0;
  let boxTotal = 0;
  let boxOk = 0;
  const latencies: number[] = [];
  let inTok = 0;
  let outTok = 0;
  let failed = 0;
  const calib = { high: { n: 0, wrong: 0 }, low: { n: 0, wrong: 0 } };
  let flaggedWrongDocs = 0;
  let wrongDocs = 0;
  const rows: string[] = [];

  // --delay เว้นระหว่างเอกสาร (Gemini free tier จำกัด 5 ครั้ง/นาที → 13000), --retries ลองซ้ำเมื่อพลาดชั่วคราว (429/503)
  const delayMs = Number(arg("delay", "0"));
  const retries = Number(arg("retries", "3"));
  for (const [i, m] of docs.entries()) {
    if (i && delayMs) await sleep(delayMs);
    const ans = JSON.parse(readFileSync(join(OUT, "answers", `${m.name}.json`), "utf8")) as Answer;
    const file = readFileSync(join(OUT, "docs", m.file));
    let result: ExtractionResult;
    let ms: number;
    try {
      ({ result, ms } = await extractWithRetry(() => provider.extract({ file, mime: MIME[m.format]! }), retries, m.name));
    } catch (e) {
      failed++;
      rows.push(`| ${m.name} | ${m.format} | ${m.pages} | — | — | — | อ่านไม่สำเร็จ: ${(e as Error).message} |`);
      continue;
    }
    latencies.push(ms);
    const usage = (result.raw as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
    inTok += usage?.input_tokens ?? 0;
    outTok += usage?.output_tokens ?? 0;

    const truth = ans.data;
    const issues = validateDocument(toDocumentData(result), { companyTaxId: COMPANY.taxId, uploadedAt: UPLOADED_AT });
    const penalized = applyValidationPenalty(result, issues);
    let docWrong = false;

    let docFieldOk = 0;
    for (const k of HEADER_FIELDS) {
      const f = penalized.header[k];
      // ส่วนลดเป็น 0 เอกสารไม่พิมพ์แถว "ส่วนลด" (generate.ts) — อ่านเป็นว่าง (null) จึงถือว่าถูก
      const ok = same(f.value, truth[k], NUMERIC.has(k)) || (k === "discount" && f.value === null && Number(truth[k]) === 0);
      perField[k] ??= { ok: 0, total: 0 };
      perField[k].total++;
      fieldTotal++;
      if (ok) {
        perField[k].ok++;
        fieldOk++;
        docFieldOk++;
      } else docWrong = true;
      if (f.value !== null || truth[k] !== null) {
        const bucket = f.confidence >= 0.85 ? calib.high : calib.low;
        bucket.n++;
        if (!ok) bucket.wrong++;
      }
      if (truth[k] !== null && truth[k] !== false && ans.boxes[`header.${k}`]) {
        boxTotal++;
        if (covers(f.bbox, ans.boxes[`header.${k}`])) boxOk++;
      }
    }

    let docLineOk = 0;
    truth.items.forEach((t, i) => {
      lineTotal++;
      const p = penalized.items[i];
      const ok =
        !!p &&
        ITEM_KEYS.every((k) => same(k === "discount" ? (p.discount?.value ?? null) : p[k].value, t[k] ?? null, k !== "description"));
      if (ok) {
        lineOk++;
        docLineOk++;
      } else docWrong = true;
    });
    if (penalized.items.length !== truth.items.length) docWrong = true;
    if (docWrong) {
      wrongDocs++;
      // เอกสารที่อ่านผิดถูกจับได้ด้วยกฎตรวจหรือความมั่นใจต่ำ (จะไม่ผ่านไปโดยไม่มีคนตรวจ)
      if (issues.some((x) => x.severity === "ERROR") || result.confidence < 0.85) flaggedWrongDocs++;
    }
    rows.push(
      `| ${m.name} | ${m.format} | ${m.pages} | ${docFieldOk}/${HEADER_FIELDS.length} | ${docLineOk}/${truth.items.length} | ${(ms / 1000).toFixed(1)} | ${issues.filter((x) => x.severity === "ERROR").map((x) => x.code).join(", ") || "—"} |`,
    );
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000 : 0;
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]! / 1000 : 0;
  const [pin, pout] = PRICES[model] ?? [0, 0];
  const cost = (inTok / 1e6) * pin + (outTok / 1e6) * pout;
  const n = docs.length - failed;
  const lineAcc = lineTotal ? lineOk / lineTotal : 0;

  const md = `# ผลวัดการอ่านเอกสาร (phase 2 task 7.2–7.4)

- วันที่รัน: ${new Date().toISOString()}
- Provider: \`${providerName}\`${providerName === "claude" ? ` · รุ่น \`${model}\` · effort \`${effort}\`` : providerName === "gemini" ? ` · รุ่น \`${model}\`` : ""}
- ชุดทดสอบ: ${docs.length} ฉบับ (สังเคราะห์จาก \`qa/extraction-eval\` — \`pnpm generate\`) · อ่านไม่สำเร็จ ${failed} ฉบับ

## สรุป

| ตัววัด | ผล | เกณฑ์ |
|---|---|---|
| ความแม่นยำรายบรรทัด (ทุกช่องของบรรทัดตรง) | **${pct(lineOk, lineTotal)}** (${lineOk}/${lineTotal}) | > 92% ${lineAcc > 0.92 ? "✅" : "❌"} |
| ความแม่นยำราย field หัวเอกสาร | ${pct(fieldOk, fieldTotal)} (${fieldOk}/${fieldTotal}) | — |
| เวลาเฉลี่ยต่อเอกสาร (เฉพาะการอ่าน) | ${avg.toFixed(1)} วินาที · p95 ${p95.toFixed(1)} วินาที | ≤ 30 วินาที ${avg <= 30 ? "✅" : "❌"} |
| กรอบของ AI ครอบค่าจริง | ${pct(boxOk, boxTotal)} (${boxOk}/${boxTotal}) | — |
| ค่าใช้จ่ายโดยประมาณ | ${providerName !== "fixture" ? `$${cost.toFixed(4)} รวม · $${(n ? cost / n : 0).toFixed(4)} ต่อฉบับ (input ${inTok} / output ${outTok} tokens)` : "ไม่มี (fixture)"} | — |
| เอกสารที่อ่านผิดแต่ถูกจับได้ (ERROR หรือความมั่นใจ < 85%) | ${flaggedWrongDocs}/${wrongDocs} | ทุกฉบับ |

## ความมั่นใจเทียบความถูกต้อง (task 7.4)

| ความมั่นใจ (หลังลดตามกฎตรวจ) | field ที่มีค่า | อ่านผิด | สัดส่วนผิด |
|---|---|---|---|
| ≥ 0.85 | ${calib.high.n} | ${calib.high.wrong} | ${pct(calib.high.wrong, calib.high.n)} |
| < 0.85 | ${calib.low.n} | ${calib.low.wrong} | ${pct(calib.low.wrong, calib.low.n)} |

## ราย field

| field | ถูก | ทั้งหมด | % |
|---|---|---|---|
${Object.entries(perField)
  .map(([k, v]) => `| ${k} | ${v.ok} | ${v.total} | ${pct(v.ok, v.total)} |`)
  .join("\n")}

## รายเอกสาร

| เอกสาร | ชนิด | หน้า | field ถูก | บรรทัดถูก | วินาที | ผลตรวจ ERROR |
|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
  writeFileSync(report, md);
  console.log(`ความแม่นยำรายบรรทัด ${pct(lineOk, lineTotal)} · field ${pct(fieldOk, fieldTotal)} · เวลาเฉลี่ย ${avg.toFixed(1)}s · รายงาน ${report}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
