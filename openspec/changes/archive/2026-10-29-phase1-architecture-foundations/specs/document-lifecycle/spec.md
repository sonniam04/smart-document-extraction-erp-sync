# Spec Delta

## Purpose

กำหนดสถานะของเอกสารและเส้นทางการเปลี่ยนสถานะที่อนุญาตตลอดวงจร ตั้งแต่อัปโหลดจนถึง sync เข้า ERP หรือถูกปฏิเสธ เพื่อให้ทุก phase ใช้กติกาเดียวกันและตรวจสอบย้อนหลังได้

## ADDED Requirements

### Requirement: Document states
เอกสารแต่ละฉบับ SHALL อยู่ในสถานะเดียวเสมอจากชุดต่อไปนี้: `UPLOADED`, `PROCESSING`, `FAILED`, `EXTRACTED`, `VERIFIED`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SYNCING`, `SYNCED`, `SYNC_FAILED` โดย `SYNCED` และ `REJECTED` เป็นสถานะสิ้นสุด

#### Scenario: เอกสารใหม่
- **WHEN** เอกสารถูกรับเข้าระบบสำเร็จ
- **THEN** สถานะเริ่มต้นคือ `UPLOADED`

#### Scenario: สถานะสิ้นสุด
- **WHEN** มีคำขอเปลี่ยนสถานะเอกสารที่เป็น `SYNCED` หรือ `REJECTED` อยู่แล้ว
- **THEN** ระบบปฏิเสธคำขอ

### Requirement: Allowed transitions
ระบบ SHALL อนุญาตเฉพาะการเปลี่ยนสถานะต่อไปนี้: `UPLOADED→PROCESSING`, `PROCESSING→EXTRACTED`, `PROCESSING→FAILED`, `FAILED→PROCESSING`, `EXTRACTED→VERIFIED`, `VERIFIED→PENDING_APPROVAL`, `VERIFIED→SYNCING`, `PENDING_APPROVAL→APPROVED`, `PENDING_APPROVAL→REJECTED`, `APPROVED→SYNCING`, `SYNCING→SYNCED`, `SYNCING→SYNC_FAILED`, `SYNC_FAILED→SYNCING` คำขออื่น MUST ถูกปฏิเสธโดยไม่เปลี่ยนข้อมูล

#### Scenario: ข้ามขั้นตอน
- **WHEN** มีคำขอเปลี่ยนเอกสารจาก `EXTRACTED` เป็น `SYNCING` โดยตรง
- **THEN** ระบบปฏิเสธพร้อมแจ้งว่าการเปลี่ยนสถานะไม่ได้รับอนุญาต และสถานะยังเป็น `EXTRACTED`

#### Scenario: อ่านใหม่หลังล้มเหลว
- **WHEN** ผู้ใช้ role `AP_CLERK` กด "อ่านใหม่" ที่เอกสารสถานะ `FAILED`
- **THEN** เอกสารเปลี่ยนเป็น `PROCESSING` และเข้าคิวประมวลผลอีกครั้งโดยไม่ต้องอัปโหลดใหม่

### Requirement: Transition authority
การเปลี่ยนสถานะ SHALL ทำได้เฉพาะผู้กระทำที่กำหนด: ระบบ (worker) สำหรับ `UPLOADED→PROCESSING`, `PROCESSING→EXTRACTED/FAILED`, `VERIFIED→PENDING_APPROVAL/SYNCING`, `APPROVED→SYNCING` และการเปลี่ยนจาก `SYNCING`; `AP_CLERK` หรือ `AP_LEAD` สำหรับ `FAILED→PROCESSING` และ `EXTRACTED→VERIFIED`; `AP_LEAD` สำหรับ `PENDING_APPROVAL→APPROVED/REJECTED`; `SYS_ADMIN` สำหรับ `SYNC_FAILED→SYNCING`

#### Scenario: Clerk พยายามอนุมัติ
- **WHEN** ผู้ใช้ที่มีเพียง role `AP_CLERK` ขออนุมัติเอกสารสถานะ `PENDING_APPROVAL`
- **THEN** ระบบตอบกลับ 403 และสถานะไม่เปลี่ยน

#### Scenario: Admin ส่ง sync ใหม่
- **WHEN** System Admin สั่งส่งเอกสารสถานะ `SYNC_FAILED` ใหม่จากคิวที่ล้มเหลว
- **THEN** เอกสารเปลี่ยนเป็น `SYNCING`

### Requirement: Concurrent transition safety
เมื่อมีคำขอเปลี่ยนสถานะเอกสารเดียวกันพร้อมกันหลายคำขอ ระบบ SHALL ให้สำเร็จได้เพียงคำขอเดียวที่สอดคล้องกับสถานะปัจจุบัน คำขออื่น MUST ได้รับแจ้งว่าเอกสารถูกเปลี่ยนไปแล้ว

#### Scenario: อนุมัติและปฏิเสธพร้อมกัน
- **WHEN** AP Lead สองคนกดอนุมัติและปฏิเสธเอกสารเดียวกันในเวลาเดียวกัน
- **THEN** มีเพียงคำขอเดียวที่สำเร็จ อีกคำขอได้รับแจ้งว่าสถานะเอกสารเปลี่ยนไปแล้ว (409)

### Requirement: Transition history
ทุกการเปลี่ยนสถานะ SHALL ถูกบันทึกพร้อมสถานะก่อน/หลัง, ผู้กระทำ (ผู้ใช้หรือระบบ), เวลา และเหตุผล (ถ้ามี) และผู้ที่มีสิทธิ์ดูเอกสาร MUST เห็นประวัตินี้เรียงตามเวลา

#### Scenario: ดูประวัติเอกสาร
- **WHEN** ผู้ใช้เปิดรายละเอียดเอกสารที่ผ่านมาแล้ว 4 สถานะ
- **THEN** ระบบแสดงประวัติ 4 รายการเรียงตามเวลา พร้อมผู้กระทำแต่ละครั้ง

#### Scenario: ปฏิเสธต้องมีเหตุผล
- **WHEN** AP Lead ปฏิเสธเอกสารโดยไม่กรอกเหตุผล
- **THEN** ระบบไม่ยอมเปลี่ยนสถานะจนกว่าจะกรอกเหตุผล
