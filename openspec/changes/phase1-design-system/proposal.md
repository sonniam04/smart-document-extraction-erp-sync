# Proposal

## Why

Phase 2 ต้องสร้างหน้าจอหลักของระบบ ได้แก่หน้าอัปโหลด/คิวเอกสาร และหน้าตรวจข้อมูลแบบ split-view (BRD FR-04) ซึ่งเป็นหน้าที่ AP Clerk ใช้ทั้งวัน ถ้ายังไม่มีภาษาภาพและ component กลาง การตัดสินเรื่องสี ตัวอักษร และพฤติกรรมของ UI จะเกิดไปพร้อมกับการเขียนหน้าจอ ทำให้หน้าจอไม่สอดคล้องกันและต้องรื้อภายหลัง การทำ design system ใน Phase 1 คู่ขนานกับงาน backend จึงลดความเสี่ยงของ Phase 2 โดยตรง

## What Changes

- `DESIGN.md` ใน `sdes-web`: หลักการออกแบบ, น้ำเสียงของข้อความบน UI ภาษาไทย, ระดับความหนาแน่นของข้อมูลสำหรับงานบัญชี
- Design tokens: สี, สีสถานะเอกสารทั้ง 11 สถานะ, ระดับ confidence, typography ที่รองรับภาษาไทยและตัวเลขความกว้างเท่ากัน, spacing, radius, elevation, motion
- Component พื้นฐานใน `sdes-web`: ปุ่ม, ช่องกรอก, ช่องกรอกจำนวนเงิน, select, ตารางข้อมูล, badge สถานะ, badge confidence, กรอบไฮไลต์ bounding box, พื้นที่อัปโหลดแบบลากวาง, toast, modal ยืนยัน (อนุมัติ/ปฏิเสธพร้อมเหตุผล), empty/loading/error state, app shell (เมนูตาม role)
- หน้ารวม component (component gallery) สำหรับ dev
- Wireframe ของ 2 หน้าหลัก (อัปโหลด/คิว และ split-view) ให้ผู้ใช้อนุมัติก่อน Phase 2

นอกขอบเขต: หน้าจอจริงของ Phase 2 (split-view ที่ทำงานได้), dark mode (token เตรียมโครงไว้แต่ยังไม่ส่งมอบ), การแปลภาษาอังกฤษ

## Capabilities

### New Capabilities
- `ui-design-system`: กติกาการแสดงผลที่ผู้ใช้เห็นได้และทุกหน้าจอต้องทำตาม — การแสดงสถานะ, การแสดงและกรอกจำนวนเงิน, ภาษาและข้อความ, การเข้าถึง (accessibility), การรองรับขนาดจอ และพฤติกรรมของ feedback/การยืนยัน

### Modified Capabilities
- (ไม่มี)

## Impact

- Repo `sonniam04/sdes-web` (โฟลเดอร์ `Web/`): `DESIGN.md`, ไฟล์ token, โฟลเดอร์ component, หน้า gallery
- Change `phase1-architecture-foundations` กลุ่มงาน 7 (หน้า login, เอกสาร, จัดการผู้ใช้) ใช้ component จาก change นี้
- เครื่องมือ: skill Impeccable สำหรับการออกแบบและตรวจ UI
- สมมติฐาน: องค์กรยังไม่มี CI/แบรนด์ที่ต้องใช้ (ผู้ใช้ไม่ได้ระบุ) จึงออกแบบโทนใหม่แบบสุขุม น่าเชื่อถือ เหมาะกับระบบการเงิน หากภายหลังมีแบรนด์ จะแก้ที่ token โดยไม่ต้องแก้ component
