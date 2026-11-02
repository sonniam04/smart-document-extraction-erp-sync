# Spec Delta

## ADDED Requirements

### Requirement: Client IP behind a reverse proxy
เมื่อ API อยู่หลัง reverse proxy ระบบ SHALL ใช้ IP ของผู้ใช้จาก header ที่ proxy ที่กำหนดว่าเชื่อถือได้ส่งมาเท่านั้น ทั้งในการจำกัดอัตราการเรียกและในการบันทึก audit ค่า header ที่มาจากต้นทางอื่น MUST ไม่ถูกใช้ เพื่อไม่ให้ผู้ใช้ปลอม IP เลี่ยงการจำกัดอัตราได้

#### Scenario: ผู้ใช้ปลอม header
- **WHEN** ผู้ใช้ส่ง `X-Forwarded-For` ที่เป็น IP สุ่มมาในคำขอล็อกอินทุกครั้งผ่าน reverse proxy
- **THEN** ระบบนับทุกคำขอเป็น IP จริงของผู้ใช้ และคำขอที่ 11 ภายใน 1 นาทีได้ 429

#### Scenario: audit บันทึก IP จริง
- **WHEN** ผู้ใช้ล็อกอินผ่าน reverse proxy
- **THEN** audit ของการล็อกอินบันทึก IP ของผู้ใช้ ไม่ใช่ IP ของ proxy
