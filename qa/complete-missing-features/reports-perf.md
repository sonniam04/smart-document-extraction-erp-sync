# เวลาตอบของรายงาน (`GET /reports/summary`) — task 4.4 ของ `complete-missing-features`

**วันที่วัด:** 2026-10-30 · **เครื่อง:** โน้ตบุ๊ก dev (Windows 10 + Docker ใน WSL, RAM 8 GB, PostgreSQL 16 ค่าเริ่มต้น `work_mem 4MB`, `shared_buffers 128MB`) ขณะ stack ของ SDES และ container อื่นรันอยู่ด้วย

**เกณฑ์:** รายงาน 12 เดือนตอบภายใน 1 วินาที (design D6)

## ข้อมูลจำลอง

ฐานแยก `sdes_perf` (ไม่ใช่ฐาน dev) สร้างด้วย `Service/load/reports-perf-seed.sql`:
- เอกสาร 42,000 ฉบับ = 12 เดือน × 3,500 ฉบับ (ปริมาณตาม BRD) จากผู้ขาย 300 ราย สถานะผสม (SYNCED 40%, APPROVED/VERIFIED/PENDING_APPROVAL/EXTRACTED/REJECTED/SYNC_FAILED อย่างละ 10%)
- ประวัติสถานะ 210,000 แถว (5 แถวต่อฉบับ)
- audit `document.field_edited` 8,497 แถว (~20% ของเอกสาร)

## ผล (ms, วัดผ่าน HTTP กับ api ที่ build แล้ว — `node Service/load/reports-perf.mjs`)

| รอบ | ช่วง | ครั้งแรก | ค่ากลาง (5 ครั้งถัดไป) | สูงสุด |
|---|---|---|---|---|
| ก่อนปรับ | 12 เดือน | 3,224 | 3,356 | 3,697 |
| ก่อนปรับ | 1 เดือน | 319 | 373 | 442 |
| หลังปรับ #1 | 12 เดือน | 2,020 | 533 | 1,993 |
| หลังปรับ #2 | 12 เดือน | 812 | 494 | 538 |
| หลังปรับ #3 | 12 เดือน | 538 | 420 | 649 |
| หลังปรับ #1 | 1 เดือน | 101 | 126 | 147 |

**ผล: ผ่าน** — ค่ากลางของรายงาน 12 เดือนอยู่ที่ 420–533 ms; ค่าที่เกือบ 2 วินาทีในรอบ #1 เป็นครั้งแรกหลัง build (cache ของฐานยังเย็น) และเครื่อง dev ที่ผันผวน (query เดียวกันใน psql แกว่ง 0.3–1.7 วินาทีในช่วงเดียวกัน)

## สิ่งที่ปรับ

query ตัวชี้วัดกระบวนการเดิมใช้ subquery 5 ตัวต่อเอกสาร (หาเวลาครั้งแรกที่เข้าแต่ละสถานะ) และกรองด้วย `created_at AT TIME ZONE 'Asia/Bangkok'` ทำให้ planner ประเมินว่ามีเอกสารแค่ 315 ฉบับ (จริง 42,000) แล้วเลือก nested loop ที่ไล่ index 42,000 รอบ (1.2 วินาทีใน psql) แก้เป็น:
1. กรองด้วย `created_at >= ('YYYY-MM-01'::timestamp AT TIME ZONE 'Asia/Bangkok')` — ผลเหมือนเดิมแต่ planner ใช้สถิติได้
2. `documents LEFT JOIN document_status_history` + `GROUP BY` ครั้งเดียวด้วย `min(...) FILTER (WHERE to_status = ...)` แทน subquery ต่อแถว
3. รวมรายการเอกสารที่มีการแก้ field เป็น `DISTINCT entity_id` ครั้งเดียวแล้ว join

## ข้อสังเกตสำหรับ Phase 4

- hosting ฟรีมักได้ CPU/RAM น้อยกว่าเครื่องนี้ ควรวัดซ้ำบนเครื่องจริงหลัง deploy; ถ้าช้าเกิน ให้พิจารณาเก็บเวลาที่เข้าแต่ละขั้น (`extracted_at`) ลงตาราง `documents` แทนการรวมจากประวัติทุกครั้ง หรือ materialized view รายวัน
- รายงานทั้งหน้าถูกคำนวณสดทุกครั้ง ยังไม่มี cache

## รันซ้ำ

```bash
# ใน Service/ — สร้างฐานแยก แล้ว migrate และใส่ข้อมูล
wsl docker exec -e PGPASSWORD=<owner> sdes-postgres-1 psql -U sdes_owner -d postgres -c "CREATE DATABASE sdes_perf"
DATABASE_OWNER_URL=postgresql://sdes_owner:<owner>@127.0.0.1:5433/sdes_perf pnpm --filter @sdes/db migrate:deploy
wsl docker exec -i -e PGPASSWORD=<owner> sdes-postgres-1 psql -U sdes_owner -d sdes_perf < load/reports-perf-seed.sql
pnpm build && node load/reports-perf.mjs
```
