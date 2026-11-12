# Design

## Context

ดูเหตุผลและสมมติฐานใน proposal.md ข้อเท็จจริงจากโค้ดและเครื่อง dev ที่กำหนดแนวทาง:
- `Service/Dockerfile` ใช้ image เดียวสำหรับ api/worker แต่ runtime stage คัดลอก `/repo` ทั้งก้อน (รวม dev dependencies, source และ Prisma CLI) และ build นาน > 10 นาทีบนเครื่อง dev; เว็บยังไม่มี Dockerfile
- การ migrate ใช้ `pnpm --filter @sdes/db migrate:deploy` (Prisma CLI เป็น dependency ของ `@sdes/db`) และ Admin คนแรกมาจาก `seed` ด้วย `SEED_ADMIN_*` (บังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรก)
- เว็บ proxy `/auth/*` และ `/api/*` ไป api ผ่าน rewrite ของ Next (`SDES_API_ORIGIN`) ส่วน socket.io ต่อตรงที่ `NEXT_PUBLIC_SDES_WS_URL` path `/ws` ซึ่งเป็นค่าตอน build และอยู่ใน CSP `connect-src`
- เดิม api เห็นทุกคำขอมาจาก IP ของ Next จึงต้องตั้ง `TRUST_PROXY=loopback, uniquelocal` (หมายเหตุใน Phase 3: Phase 4 ต้องชี้ proxy จริงและไม่เปิด port ของ api)
- RAM ที่ใช้จริงบนเครื่อง dev ขณะว่าง: ClamAV ~1.0 GB, PostgreSQL ~200 MB, SeaweedFS ~110 MB, api/worker ~90 MB, Redis ~17 MB
- `seaweedfs:latest` ไม่ปักเวอร์ชัน; worker มี `WORKER_CONCURRENCY` (ค่าเริ่มต้น 2)
- ผลวัดบนเครื่อง dev: หน้าภาพรวมค่ากลาง 186–260 ms, รายงาน 12 เดือน 420–533 ms ที่ 42,000 ฉบับ — เครื่อง production มี CPU น้อยกว่า
- repo ทั้งสามเป็น private

## Goals / Non-Goals

**Goals:**
- deploy ทั้ง stack บน VM ฟรีเครื่องเดียวได้ด้วยคำสั่งเดียว และย้ายไปเครื่องอื่นได้ด้วยคู่มือ + ชุดสำรอง
- ลดขนาด image และ RAM ให้มีที่เหลือสำหรับการ build บนเครื่องและ Odoo (ถ้าเปิด)
- การตั้งค่า production ปลอดภัยตั้งแต่ค่าเริ่มต้น: ไม่มี port ภายในเปิดออกนอก, secret ไม่ออกจากเครื่อง

**Non-Goals:**
- Kubernetes, หลายเครื่อง, zero-downtime deploy (ยอมรับ downtime ไม่กี่วินาทีตอนสลับ container)
- ระบบ log/metrics ภายนอก (ใช้ System logs, health check และ uptime monitor ฟรี)
- การทดสอบตาม BRD (หลัง Phase 4)

## Decisions

### D1. Host: Oracle Cloud Always Free VM ARM เครื่องเดียว + docker compose
- Ampere A1 2 OCPU / 12 GB, Ubuntu 24.04 ARM64, boot volume 100 GB (อยู่ในโควตาฟรี 200 GB)
- ทางเลือกที่ไม่เลือก: แยก PaaS ฟรี (Render/Koyeb สำหรับเว็บ+api, Neon สำหรับ Postgres, Upstash สำหรับ Redis, R2 สำหรับไฟล์) — container 512 MB ที่หยุดเมื่อว่างรัน worker ที่ต้องทำงานตลอดและ ClamAV (~1 GB) ไม่ได้ และ Redis แบบนับคำสั่งจะหมดโควตาเร็วเพราะ BullMQ poll ตลอด
- **ฟรี 100% (ข้อกำหนดของผู้ใช้):** ใช้เฉพาะทรัพยากรที่ติดป้าย Always Free และ**ไม่อัปเกรดบัญชีเป็น Pay As You Go** — บัญชี Free Tier สร้างทรัพยากรเกินโควตาไม่ได้อยู่แล้ว จึงไม่มีทางถูกเรียกเก็บเงิน; ใช้ ephemeral public IP + DuckDNS updater แทน reserved IP; boot volume 100 GB จากโควตาฟรี 200 GB; Object Storage สำหรับชุดสำรองไม่เกิน 20 GB; หลังเครดิตทดลอง 30 วันหมด VM ที่อยู่ในโควตาฟรีทำงานต่อ
- ความเสี่ยงเรื่องนโยบายฟรีเปลี่ยน (ลดจาก 4/24 เหลือ 2/12 ในปี 2026) รับมือด้วยการออกแบบให้ทุกอย่างอยู่ใน compose + สำรองข้อมูลออกนอก volume เพื่อย้ายไป VPS อื่นได้ภายในชั่วโมง

### D2. ทางเข้า: Caddy เป็น reverse proxy ตัวเดียว
- เปิดออกนอกเฉพาะ 80/443 (Caddy) และ 22 (SSH ด้วย key เท่านั้น) ทั้งใน security list ของ OCI และ firewall ของเครื่อง; service อื่นไม่มี `ports:` ใน compose production
- HTTPS อัตโนมัติจาก Let's Encrypt ด้วยชื่อใน `SDES_DOMAIN` (ค่าเริ่มต้น subdomain ของ DuckDNS ที่ cron บน VM อัปเดต IP ทุก 5 นาที — รองรับ ephemeral IP ที่เปลี่ยนเมื่อสร้าง VM ใหม่)
- route: `/api/*` (ตัด prefix) และ `/auth/*` → api, `/ws/*` → api (websocket), ที่เหลือ → web; จึงเลิกผ่าน rewrite ของ Next ใน production (ลด hop และให้ api เห็น IP จาก Caddy โดยตรง) — rewrite ยังอยู่สำหรับ dev
- Caddy บีบอัด `zstd`/`gzip`, ส่ง `X-Forwarded-For` เป็น IP จริง และลบค่าที่ผู้ใช้ส่งมา; เว็บ build ด้วย `NEXT_PUBLIC_SDES_WS_URL=https://<โดเมน>` จึงต่อ socket.io origin เดียวกับหน้าเว็บ (CSP `connect-src 'self'`)
- compose ใช้ network ภายในที่กำหนด subnet ตายตัว และ api ตั้ง `TRUST_PROXY=<IP ของ Caddy>` (ไม่ใช่ทั้ง subnet) — ตรงกับ spec platform-security "Client IP behind a reverse proxy"

### D3. Image
- **api/worker:** multi-stage — `deps` (pnpm fetch), `build` (tsc + prisma generate), `tools` (มี Prisma CLI และ seed — ใช้รัน migrate/seed แบบ one-shot), `runtime` จาก `pnpm deploy --prod --filter <app>` ให้เหลือเฉพาะ production dependencies + `dist` + Prisma engine ของ `linux-musl-arm64-openssl-3.0.x` และ `linux-musl-openssl-3.0.x` (`binaryTargets`); ผู้ใช้ `node`; เป้า image runtime < 300 MB
- **web:** `output: "standalone"` เฉพาะตอน build production, runtime คัดลอก `.next/standalone` + `.next/static` + `public` บน `node:22-alpine`, `NEXT_PUBLIC_*` เป็น build arg; เป้า < 200 MB
- ปักเวอร์ชันทุก image ภายนอก (`postgres:16.x-alpine`, `redis:7.x-alpine`, `chrislusf/seaweedfs:<version>`, `clamav/clamav:<version>`, `caddy:2.x-alpine`) — เลือกเวอร์ชันที่มี ARM64 และบันทึกใน compose
- ทางเลือกที่ไม่เลือก: build บน GitHub Actions แล้ว push ไป GHCR — repo private ทำให้โควตา Packages ฟรี (500 MB, transfer 1 GB/เดือน) ไม่พอ และ runner ARM ของ private repo ไม่ฟรี; build บนเครื่องใช้ CPU ของ VM ได้ฟรี (ประมาณ 10–20 นาทีต่อครั้ง ยอมรับได้)

### D4. Compose production และงบ RAM
- ไฟล์ `Service/docker-compose.prod.yml` แยกจากของ dev (ไม่ใช้ override เพื่อไม่ให้ `ports:` ของ dev หลุดมา) build เว็บจาก `../web` (เครื่อง production clone ทั้งสอง repo ไว้ข้างกันใน `/opt/sdes/`)
- ทุก service: `restart: unless-stopped`, `healthcheck`, `depends_on: condition: service_healthy`, `mem_limit`, log driver `json-file` จำกัด 10 MB × 3 ไฟล์ (กัน disk เต็ม)
- งบ RAM (เพดาน, เครื่อง 12 GB, งบ 80% = 9.6 GB):

| service | เพดาน | หมายเหตุ |
|---|---|---|
| caddy | 128 MB | |
| web | 384 MB | Next standalone |
| api | 512 MB | `NODE_OPTIONS=--max-old-space-size=384` |
| worker | 1 GB | แปลง PDF/รูปก่อนส่ง AI; `WORKER_CONCURRENCY=2` (เท่า OCPU) |
| postgres | 1.5 GB | D5 |
| redis | 256 MB | `maxmemory 192mb`, `maxmemory-policy noeviction` (BullMQ ต้องไม่ลบ key) |
| seaweedfs | 512 MB | |
| clamav | 2 GB | `ConcurrentDatabaseReload no` ลด peak ตอนอัปเดต signature (ไม่ต้องมีสองชุดในหน่วยความจำ) |
| backup (cron) | 256 MB | D7 |
| **รวม** | **~6.5 GB** | เหลือ ~3 GB สำหรับการ build บนเครื่องและ Odoo (profile `odoo` ~1.5 GB) |

### D5. PostgreSQL บน 1.5 GB / 2 OCPU
- `shared_buffers=384MB`, `effective_cache_size=1GB`, `work_mem=8MB`, `maintenance_work_mem=128MB`, `max_connections=50`, `random_page_cost=1.1` (block volume เป็น SSD), `wal_compression=on`, ส่งผ่าน `command:` ของ compose
- connection pool ของ Prisma: api `connection_limit=10`, worker `connection_limit=5`

### D6. ค่าตั้ง, secret และการตรวจตอนเริ่ม
- `deploy/init-env.sh` สร้าง `/opt/sdes/.env.production` (mode 600, เจ้าของคือผู้ดูแล) ด้วย `openssl rand` สำหรับรหัสผ่านฐานข้อมูล/Redis/S3, JWT secret, `ERP_SECRET_KEY` และรหัสชั่วคราวของ Admin; ถาม `SDES_DOMAIN`, อีเมลสำหรับ Let's Encrypt, `SEED_ADMIN_EMAIL`, `COMPANY_TAX_ID`/`COMPANY_NAME`, provider ของการอ่านเอกสาร (+ key); ไม่เขียนทับไฟล์เดิม
- api และ worker ตรวจค่าตั้งด้วย schema (zod) ตอนเริ่มเมื่อ `NODE_ENV=production`: ค่าที่ขาด/สั้นเกิน/ยังเป็นค่าตัวอย่าง → log ชื่อค่าแล้ว exit 1 (ไม่ log ค่า); `COOKIE_SECURE` ต้องเป็น `true`
- ทางเลือกที่ไม่เลือก: secret manager ของ OCI — เพิ่มความซับซ้อนโดยไม่จำเป็นสำหรับเครื่องเดียว

### D7. Deploy, rollback และ backup
- `deploy/deploy.sh --service <ref> --web <ref>`: `git fetch` + checkout ref ใน `/opt/sdes/{service,web}` → `docker compose build` โดย tag image ด้วย short SHA (`sdes-api:<sha>` ฯลฯ) → สำรองฐานข้อมูลก่อน migrate → รัน `tools` image `migrate deploy` แบบ one-shot (ล้ม = หยุด, container เดิมยังทำงาน) → `up -d` → รอ health ของ api/web/worker สูงสุด 120 วินาที → เขียน `/opt/sdes/releases.log` (เวลา, ref, SHA, ผล)
- `deploy/rollback.sh`: สลับ tag ไปแถวสำเร็จก่อนหน้าใน `releases.log` แล้ว `up -d` โดยไม่ build — migration เป็นแบบเพิ่ม (additive) มาตลอดทุก phase จึงให้โค้ดเวอร์ชันก่อนทำงานกับ schema ใหม่ได้; ถ้า migration ไม่ใช่แบบเพิ่ม ให้กู้จากชุดสำรองก่อน migrate (อยู่ในคู่มือ)
- GitHub Actions workflow `deploy.yml` (ใน repo ของ Service) แบบ `workflow_dispatch` รับ ref ทั้งสอง แล้ว SSH เข้าเครื่อง (key ใน GitHub secret, ผู้ใช้ deploy ที่สั่งได้เฉพาะสคริปต์นี้) — ใช้นาทีของ Actions น้อยเพราะ build อยู่บนเครื่อง
- Backup: service `backup` (image เล็กที่มี `pg_dump` + `weed`/`aws s3 sync` ของ S3 ภายใน) รันวันละครั้ง 02:00 น. เวลาไทย: `pg_dump -Fc` + คัดลอก bucket เอกสาร → `/opt/sdes/backups/<วันที่>/` (bind mount นอก volume ข้อมูล) เก็บ 7 ชุด; ถ้าตั้ง `BACKUP_S3_*` อัปโหลดไป Object Storage ของ OCI (Always Free 20 GB) ด้วย
- `deploy/restore.sh <ชุด>`: หยุด api/worker → `pg_restore --clean` → คืนไฟล์ → เริ่ม service → ตรวจ health; ทดสอบบนเครื่อง dev ด้วย stack production ในงาน 6.x

### D8. Optimize ที่วัดได้
- ตรวจด้วยการวัดก่อน/หลังบนเครื่อง production: ขนาด image, RAM ขณะว่างและขณะอ่านเอกสาร, เวลา build, เวลาตอบหน้าภาพรวม/รายงาน (สคริปต์ `load/*-perf.mjs` เดิมกับฐาน `sdes_perf` บนเครื่อง production แล้วลบทิ้ง), Lighthouse ของหน้าล็อกอินและหน้าภาพรวม
- ไฟล์ static ของ Next (`/_next/static/*`) ส่ง `Cache-Control: public, max-age=31536000, immutable` (Next ทำให้แล้ว — ตรวจว่า Caddy ไม่ทับ)
- ถ้าเวลาตอบเกินเกณฑ์บน 2 OCPU: ขั้นแรกเพิ่ม cache ผลของ `/dashboard` 15 วินาทีต่อชุดสิทธิ์ใน Redis และ index `document_status_history (to_status, created_at)`; ขั้นต่อไปค่อยพิจารณาเก็บ `extracted_at`/`verified_at` ใน `documents` (ตามข้อสังเกตใน `qa/complete-missing-features/reports-perf.md`) — ทำเฉพาะเมื่อวัดแล้วไม่ผ่าน

### D9. การเฝ้าดู
- `/health` ที่มีอยู่คืนข้อความ error ของแต่ละบริการ (อาจมีชื่อ host ภายใน) — เมื่อ `NODE_ENV=production` คำตอบที่มาจากภายนอกแสดงเฉพาะชื่อบริการและ ok/ไม่ ok ส่วนข้อความเต็มอยู่ใน System logs
- ใช้ `/health` (ตรวจ DB/Redis/S3/ClamAV) ผ่าน Caddy ที่ `/api/health` ให้ uptime monitor ฟรี (เช่น UptimeRobot) เรียกทุก 5 นาทีและแจ้งเตือนทางอีเมล — ผู้ใช้ตั้งเอง ระบุในคู่มือ
- System logs ที่มีอยู่เก็บ warning/error ของ api/worker ส่วน log ของ container ดูด้วย `docker compose logs`

## Risks / Trade-offs

- [Oracle เปลี่ยนนโยบายฟรีอีก, บัญชีถูกระงับ หรือสร้าง VM ไม่ได้เพราะ capacity] → ทุกอย่างอยู่ใน compose + ชุดสำรองนอกเครื่อง (ถ้าตั้ง) คู่มือมีหัวข้อย้ายไป VPS อื่น; ถ้าสร้างไม่ได้ให้ลอง region อื่นหรือ shape เล็กลง (1 OCPU / 6 GB ยังรันได้ถ้าปิด Odoo และลดเพดาน ClamAV)
- [build บนเครื่อง production ใช้ RAM/CPU แย่งกับระบบที่รันอยู่] → เหลือ RAM ~3 GB ตามงบ, จำกัด `docker build` ด้วย `--memory` และ deploy ช่วงที่ไม่มีคนใช้; ถ้าไม่พอค่อยย้ายไป build บน Actions แล้วส่ง image ด้วย `docker save | ssh docker load`
- [downtime ไม่กี่วินาทีตอนสลับ container] → ยอมรับ (โปรเจกต์ส่วนตัว); health check กันไม่ให้สลับไปตัวที่เสีย
- [rollback กับ migration ที่ไม่ใช่แบบเพิ่ม] → สำรองก่อน migrate ทุกครั้ง + คู่มือกู้คืน; code review ตรวจว่า migration เป็นแบบเพิ่ม
- [Gemini free tier มีโควตาต่อนาที/ต่อวัน] → คิวของ worker ลองซ้ำแบบ backoff อยู่แล้ว; การวัดความแม่นยำจริงอยู่ในการทดสอบหลัง Phase 4
- [IP สาธารณะของ VM เปลี่ยนเมื่อสร้างใหม่] → cron อัปเดต DuckDNS (ไม่ใช้ reserved IP เพื่อไม่ต้องพึ่งโควตาที่ไม่แน่ใจว่าฟรี)
- [Gemini API แบบฟรี: Google อาจนำเนื้อหาที่ส่งไปใช้ปรับปรุงผลิตภัณฑ์] → ใช้กับเอกสารตัวอย่าง/สาธิตเท่านั้น ห้ามส่งใบกำกับภาษีจริงของบริษัทจนกว่าจะใช้แผนที่ไม่เอาข้อมูลไปใช้ (คู่มือเตือนไว้); ค่าเริ่มต้นของ production เป็น `fake`

## Migration Plan

1. ทำทุกอย่างบนเครื่อง dev ก่อน: build image production, รัน `docker-compose.prod.yml` ด้วยชื่อ `localhost` (Caddy ใช้ใบรับรองภายใน) และรัน E2E ของ `qa/e2e` กับ stack นี้
2. ผู้ใช้สร้างบัญชี OCI (Free Tier ไม่อัปเกรด) + VM + DuckDNS ตามคู่มือ (ขั้นตอนที่ต้องใช้บัญชีของผู้ใช้ — Claude ทำแทนไม่ได้)
3. `bootstrap.sh` บน VM: ติดตั้ง Docker, ตั้ง firewall, swap 2 GB, ผู้ใช้ deploy, clone repo (deploy key แบบอ่านอย่างเดียวต่อ repo)
4. `init-env.sh` → `deploy.sh` ครั้งแรก (migrate + seed) → ล็อกอิน Admin และเปลี่ยนรหัส → วัดผล → ตั้ง backup และ uptime monitor
- rollback ของทั้ง phase: เครื่อง dev ไม่เปลี่ยน; ถ้าเลิกใช้ VM ก็แค่ปิด instance

## Open Questions

- เวอร์ชันที่จะปักของ SeaweedFS/ClamAV/Caddy ที่มี ARM64 — เลือกตอนทำงาน 2.1 จาก tag ล่าสุดที่เสถียร ไม่กระทบแนวทาง
