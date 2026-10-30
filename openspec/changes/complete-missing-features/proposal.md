# Proposal

## Why

หลังจบ Phase 3 ยังมีความสามารถที่ BRD และเมนูของระบบกำหนดไว้ แต่ยังไม่มี phase ใดสร้าง:
- BRD ข้อ 4 ให้ IT & System Auditor "จัดการ Token/API Keys" และดู "System Logs" ใน Admin Console แต่ตอนนี้มีเพียงชื่อสิทธิ์ `apikey.manage` และ log ก็พิมพ์ลง stdout ของ container เท่านั้น
- เมนู "ผู้ขาย" (AP Clerk/AP Lead) และ "รายงาน" (Finance Exec) แสดงอยู่แล้ว แต่กดแล้วไม่มีหน้า

ผู้ใช้กำหนดให้ทำส่วนนี้ให้เสร็จก่อน Phase 4 เพราะ Phase 4 เป็นการ optimize และ deploy ซึ่งต้องทำกับระบบที่ฟีเจอร์ครบแล้ว

## What Changes

- **API keys สำหรับระบบภายนอก:** System Admin สร้าง API key ให้ระบบอื่น (เช่น เครื่องสแกน, สคริปต์นำเข้า, ERP ที่ต้องอ่านสถานะ) เรียก API ของ SDES ได้โดยไม่ต้องล็อกอิน กำหนดชื่อ ขอบเขตสิทธิ์ (อัปโหลดเอกสาร, อ่านสถานะเอกสาร) และวันหมดอายุ ค่า key แสดงครั้งเดียว เก็บแบบ hash เพิกถอนได้ทันที แสดงเวลาใช้ล่าสุด และทุกการสร้าง/เพิกถอน/ใช้งานถูกบันทึกใน audit ในชื่อของ key นั้น
- **System Logs:** api และ worker เก็บ log ระดับ warning และ error ลงฐานข้อมูล (ปิดบังข้อมูลอ่อนไหวก่อนเก็บ) เก็บไว้ 30 วัน System Admin ค้นตามช่วงเวลา ระดับ บริการ และข้อความได้จากหน้า Admin Console
- **ทะเบียนผู้ขาย:** หน้า "ผู้ขาย" สำหรับ AP Clerk/AP Lead แสดงผู้ขายทุกรายพร้อม Tax ID สาขา จำนวนเอกสาร ยอดรวม เอกสารล่าสุด สถานะ "ผู้ขายรายใหม่" และรหัสคู่ค้าใน ERP ค้นด้วยชื่อหรือ Tax ID และดูเอกสารของผู้ขายแต่ละรายได้ (อ่านอย่างเดียว)
- **รายงานการเงิน:** หน้า "รายงาน" สำหรับ Finance Exec สรุปตามช่วงเวลา: ยอดซื้อ ภาษีซื้อ และภาษีหัก ณ ที่จ่ายรายเดือน, ผู้ขายที่มียอดสูงสุด, ปริมาณเอกสารตามสถานะ, เวลาเฉลี่ยในแต่ละขั้น และสัดส่วนเอกสารที่ไม่ต้องแก้ค่าที่ AI อ่าน พร้อมส่งออก CSV
- **สิทธิ์:** เพิ่มสิทธิ์ดูทะเบียนผู้ขาย (AP Clerk, AP Lead) และดู system logs (System Admin) ใน permission matrix

## Capabilities

### New Capabilities
- `api-keys`: การออก ใช้ และเพิกถอน API key สำหรับระบบภายนอก ขอบเขตสิทธิ์ของ key และการตรวจสอบย้อนหลัง
- `system-logs`: การเก็บ log ปฏิบัติการของ api/worker แบบปิดบังข้อมูล การเก็บรักษา และการค้นดูโดยผู้ดูแลระบบ
- `vendor-directory`: ทะเบียนผู้ขายที่ระบบรู้จัก พร้อมสถิติเอกสารและสถานะในการตรวจความเสี่ยง/ERP
- `finance-reports`: รายงานสรุปยอดซื้อ ภาษี และประสิทธิภาพของกระบวนการ สำหรับผู้บริหารฝ่ายการเงิน

### Modified Capabilities
- `user-access`: permission matrix เพิ่มการดูทะเบียนผู้ขาย (AP Clerk, AP Lead) และการดู system logs (System Admin) และระบุว่าบัญชีของ API key ล็อกอินด้วยรหัสผ่านไม่ได้

## Impact

- **Service (`sdes-service`):** migration ใหม่ (`api_keys`, `system_logs`, ชนิดบัญชีบริการใน `users`), การยืนยันตัวตนด้วย API key ใน `AuthGuard`, logger ที่เก็บลงฐาน, งานลบ log เก่าใน worker, endpoint ใหม่ `/admin/api-keys`, `/admin/system-logs`, `/vendors`, `/reports/*`, permission ใหม่ใน `packages/core` (ต้อง `pnpm sync:core` ไปเว็บ)
- **Web (`sdes-web`):** หน้า `/admin/api-keys`, `/admin/logs`, `/vendors`, `/vendors/[id]`, `/reports` และเมนูใน `lib/roles.ts`
- **ไม่กระทบ:** การอ่านเอกสาร การตรวจ/อนุมัติ และการส่ง ERP เดิม; ผู้ใช้เดิมล็อกอินและใช้งานได้เหมือนเดิม
- **นอกขอบเขต:** การแก้ไข/รวมข้อมูลผู้ขาย, การจัดการ session ของผู้ใช้, รายงานแบบกำหนดเอง, การส่ง log ไประบบภายนอก (Phase 4 พิจารณาพร้อมการ deploy)
- **Branch:** แตกต่อจาก `feat/phase3-erp-integration` (Service/Web) และ `docs/phase3-planning` (repo หลัก) จนกว่า PR ของ Phase 2–3 จะ merge
