// สะพานไปยัง @sdes/core ใน sdes-service (แพ็กเกจเป็น CommonJS จึง import ทั้งโมดูลแล้วแยกออก)
import * as ns from "../../../Service/packages/core/src/index.ts";

/** โมดูล CommonJS ผ่าน ESM ได้ค่าใน .default ตอนรัน แต่ type ตรงกับ namespace */
export const cjs = <T>(m: T): T => ((m as { default?: T }).default ?? m);
const core = cjs(ns);

export type {
  BBox,
  DocumentData,
  DocumentItem,
  ExtractionResult,
  ValidationIssue,
} from "../../../Service/packages/core/src/index.ts";

export const { HEADER_FIELDS, validateDocument, isValidTaxId, moneyEquals } = core;
