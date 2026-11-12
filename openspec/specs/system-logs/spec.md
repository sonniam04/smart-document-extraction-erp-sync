# system-logs Specification

## Purpose

ให้ผู้ดูแลระบบเห็นปัญหาการทำงานของ api และ worker (คำเตือนและข้อผิดพลาด) ได้จากหน้าเว็บโดยไม่ต้องเข้าถึงเครื่องหรือ container และไม่เปิดเผยข้อมูลอ่อนไหว

## Requirements

### Requirement: Log capture
api และ worker SHALL เก็บ log ระดับ warning และ error ลงที่เก็บที่ค้นได้ พร้อมเวลา, บริการ (api/worker), ระดับ, ส่วนของระบบที่เกิด, ข้อความ และรายละเอียด การเก็บ log ที่ล้มเหลว MUST ไม่ทำให้คำขอหรืองานที่กำลังทำล้มเหลว

#### Scenario: งานอ่านเอกสารล้มเหลว
- **WHEN** worker อ่านเอกสารไม่สำเร็จและเขียน log ระดับ error
- **THEN** log นั้นค้นเจอในหน้า System Logs ภายใน 10 วินาที ระบุบริการ worker และเลขเอกสาร

#### Scenario: ฐานข้อมูลไม่พร้อมขณะเขียน log
- **WHEN** การเก็บ log ล้มเหลวเพราะฐานข้อมูลไม่ตอบสนอง
- **THEN** log ยังถูกพิมพ์ออก stdout และคำขอหรืองานเดิมทำงานต่อตามปกติ

### Requirement: Log redaction
ก่อนเก็บ log ระบบ SHALL ลบหรือปิดบังรหัสผ่าน, token, API key, secret, connection string และเลขบัตรประชาชน/บัญชีธนาคารส่วนบุคคล

#### Scenario: error มี header Authorization
- **WHEN** error ที่ถูก log มีรายละเอียดคำขอที่มี header Authorization
- **THEN** log ที่เก็บแสดงค่า header นั้นเป็นค่าที่ถูกปิดบัง

### Requirement: Log retention
ระบบ SHALL เก็บ log ไว้ 30 วันแล้วลบอัตโนมัติวันละครั้ง

#### Scenario: log อายุเกิน 30 วัน
- **WHEN** งานลบรอบประจำวันทำงาน
- **THEN** log ที่เก่ากว่า 30 วันถูกลบ และ log ที่ใหม่กว่ายังอยู่

### Requirement: Log viewer
System Admin SHALL ค้น log ตามช่วงเวลา, ระดับ, บริการ และคำในข้อความ เรียงจากใหม่ไปเก่าแบบแบ่งหน้า และดูรายละเอียดของแต่ละรายการได้ role อื่น MUST ไม่เห็นเมนูและได้ 403 จาก API

#### Scenario: ค้น error ของ worker วันนี้
- **WHEN** System Admin เลือกระดับ error บริการ worker และช่วงเวลาวันนี้
- **THEN** เห็นเฉพาะ log ที่ตรงเงื่อนไข เรียงจากใหม่ไปเก่า

#### Scenario: Finance Exec เรียก API system logs
- **WHEN** ผู้ใช้ที่มีเพียง role `FINANCE_EXEC` เรียก API ค้น system logs
- **THEN** ระบบตอบกลับ 403
