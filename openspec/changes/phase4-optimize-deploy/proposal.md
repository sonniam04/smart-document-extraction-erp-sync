# Proposal

## Why

ระบบมีฟีเจอร์ครบตาม BRD แล้ว (Phase 1–3, ฟีเจอร์ที่ขาด และหน้าภาพรวม) แต่ยังรันได้แค่บนเครื่อง dev ด้วย dev server ของ Next.js และ image ของ api/worker ที่คัดลอก repo ทั้งก้อนรวม dev dependencies ผู้ใช้กำหนดให้ Phase 4 เป็นการ optimize และ deploy บน **hosting ฟรี** เพราะเป็นโปรเจกต์ส่วนตัวที่ไม่มีงบ server ส่วนการวัดผลตาม BRD (ความแม่นยำของ AI จริง, 500 ฉบับ, load test, pentest) ทำหลัง Phase 4

ข้อจำกัดที่กำหนดแนวทาง:
- stack ต้องมีหลาย service ที่รันตลอดเวลา: api, worker (BullMQ), PostgreSQL 16, Redis, S3 และ ClamAV ที่ใช้ RAM ประมาณ 1 GB ขณะรันบนเครื่อง dev
- PaaS ฟรี (เช่น Render, Koyeb) ให้ container ละประมาณ 512 MB, หยุดเมื่อไม่มีคนใช้ และไม่รัน docker compose ทั้งชุด จึงรัน worker ที่ต้องทำงานตลอดและ ClamAV ไม่ได้
- Oracle Cloud Always Free ยังมี VM ARM (Ampere A1) ฟรีถาวร แต่ปี 2026 ลดเหลือ 2 OCPU / 12 GB รวมทุก instance ซึ่งพอสำหรับทั้ง stack ถ้าคุมทรัพยากร

## What Changes

- **Production image:** api/worker เหลือเฉพาะ production dependencies และไฟล์ที่ build แล้ว, เว็บมี Dockerfile แบบ Next.js standalone, ทุก image รันบน ARM64 (และ x86-64 สำหรับเครื่อง dev), ปักเวอร์ชันของ image ภายนอกทุกตัว (เลิกใช้ `latest`)
- **Production compose:** ชุด compose สำหรับ production ที่มี reverse proxy เป็นทางเข้าเดียว (HTTPS อัตโนมัติ, port 80 พาไป 443) ส่วน api, ฐานข้อมูล, Redis, S3 และ ClamAV ไม่เปิดสู่ภายนอก; จำกัด RAM ต่อ service ให้รวมแล้วอยู่ในงบของเครื่อง; ทุก service เริ่มใหม่เองเมื่อล้มหรือเครื่องรีบูต; migration รันก่อน api เริ่มรับคำขอ
- **ค่าตั้งและ secret:** สคริปต์สร้างไฟล์ค่าตั้งบนเครื่อง production ด้วยค่าสุ่ม (ไม่อยู่ใน repo หรือ image), api และ worker ตรวจค่าที่จำเป็นตอนเริ่มและหยุดพร้อมข้อความที่บอกว่าขาดอะไร, `TRUST_PROXY` ชี้เฉพาะ reverse proxy เพื่อให้ rate limit ใช้ IP จริงของผู้ใช้
- **Deploy และ rollback:** คำสั่งเดียวที่ดึงเวอร์ชันที่ระบุ, build บนเครื่อง, migrate, เริ่ม service ใหม่และรอ health check; ย้อนกลับไปเวอร์ชันก่อนหน้าได้ด้วยคำสั่งเดียว; GitHub Actions เรียกคำสั่งนี้แบบกดสั่งเอง
- **Backup:** สำรองฐานข้อมูลและไฟล์เอกสารทุกวัน เก็บ 7 ชุด และมีขั้นตอนกู้คืนที่ทดสอบแล้ว
- **Optimize:** ปรับ PostgreSQL ให้เหมาะกับ RAM ที่จัดให้, บีบอัดคำตอบที่ reverse proxy, cache ไฟล์ static ของเว็บ, ตั้ง concurrency ของ worker ให้พอดีกับ 2 OCPU, วัดเวลาตอบของหน้าภาพรวมและรายงานซ้ำบนเครื่อง production (ด้วยฐาน perf แยก) และแก้จุดที่ไม่ผ่านเกณฑ์
- **คู่มือ deploy:** ขั้นตอนตั้งแต่สร้างบัญชีและ VM, เปิด port, ตั้งชื่อโดเมนฟรี, deploy ครั้งแรก, สร้าง Admin, ตรวจสุขภาพ, backup/restore และการย้ายไปเครื่องอื่น

## Capabilities

### New Capabilities
- `production-deployment`: การรันระบบบนเครื่อง production — ทางเข้า HTTPS เดียว, การจัดการค่าตั้งและ secret, การเริ่มใหม่และ health check, การ deploy/rollback, backup/restore, งบทรัพยากร และเกณฑ์ประสิทธิภาพบนเครื่องจริง

### Modified Capabilities
- `platform-security`: เพิ่ม requirement ว่าเมื่ออยู่หลัง reverse proxy ระบบใช้ IP จริงของผู้ใช้เฉพาะจาก proxy ที่เชื่อถือได้ (ใช้กับ rate limit และ audit) และไม่เชื่อ header ที่ผู้ใช้ส่งมาเอง

## Impact

- **Service (`sdes-service`):** `Dockerfile` (multi-stage, prod deps, ARM64), `docker-compose.prod.yml`, สคริปต์ `deploy/` (สร้างค่าตั้ง, deploy, rollback, backup, restore), การตรวจค่าตั้งตอนเริ่มใน api/worker, ค่า PostgreSQL ของ production, README
- **Web (`sdes-web`):** `Dockerfile` แบบ standalone, `next.config.ts` (`output: "standalone"`, cache header ของไฟล์ static), README
- **Planning repo:** คู่มือ deploy, ผลวัดบนเครื่อง production ใน `qa/phase4/`
- **ไม่กระทบ:** API, หน้าจอ และพฤติกรรมของฟีเจอร์ทั้งหมด; การพัฒนาบนเครื่อง dev ยังใช้ `docker-compose.yml` เดิม
- **นอกขอบเขต:** การทดสอบตาม BRD (ความแม่นยำของ AI จริง > 92%, < 30 วินาที, 500 ฉบับ, load test 50 คนพร้อมกัน, pentest) — ทำหลัง Phase 4 ตามที่ผู้ใช้กำหนด; high availability หลายเครื่อง; CDN; การ deploy Odoo บน production (ยังเปิดด้วย profile ได้ถ้า RAM พอ)
- **Branch:** แตกต่อจาก `feat/overview-dashboard` (Service/Web) และ `docs/overview-dashboard` (repo หลัก) จนกว่า PR ก่อนหน้าจะ merge
- **สมมติฐานที่ต้องรีวิว** (เลือกค่าแนะนำแทนการถาม — ปรับได้ตอนรีวิว):
  1. **Host:** VM ARM ของ Oracle Cloud Always Free เครื่องเดียว (2 OCPU / 12 GB) — ผู้ใช้ต้องสมัครบัญชีเอง (ต้องใช้บัตรยืนยันตัวตน) และอาจเจอ "Out of host capacity" ในบาง region
  2. **ชื่อโดเมน:** subdomain ฟรีจาก DuckDNS (เปลี่ยนเป็นโดเมนของผู้ใช้ได้ด้วยค่าตั้งเดียว)
  3. **การอ่านเอกสารบน production:** Gemini ด้วย API key ของผู้ใช้ (มีโควตาฟรี) — ระหว่างยังไม่มี key ใช้ provider `fake` สำหรับสาธิต
  4. **Odoo:** ไม่ deploy เป็นค่าเริ่มต้น การส่ง ERP ใช้ webhook หรือปิดไว้
  5. **Build:** build image บนเครื่อง production จาก git แทนการใช้ registry เพราะ repo เป็น private และโควตา GitHub Packages ฟรีของ private repo น้อย
