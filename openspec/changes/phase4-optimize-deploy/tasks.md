# Tasks

> แตก branch `feat/phase4-optimize-deploy` ต่อจาก `feat/overview-dashboard` ใน Service/Web และ `docs/phase4-optimize-deploy` ต่อจาก `docs/overview-dashboard` ในรีโพหลัก จนกว่า PR ก่อนหน้าจะ merge
> งานที่มีป้าย **[ผู้ใช้]** ต้องใช้บัญชีของผู้ใช้ (OCI, DuckDNS, uptime monitor, GitHub secret) — Claude เตรียมคำสั่ง/คู่มือให้ และตรวจผลหลังผู้ใช้ทำ

## 1. ค่าตั้งและความปลอดภัยของ production (`apps/api`, `apps/worker`)

- [x] 1.1 ตรวจค่าตั้งด้วย schema ตอนเริ่มเมื่อ `NODE_ENV=production` (design D6) — ตรวจด้วย unit test: ขาด JWT secret/รหัสผ่านสั้น/ค่าตัวอย่าง/`COOKIE_SECURE=false` → exit พร้อมชื่อค่าโดยไม่มีค่าใน log; ค่าครบ → เริ่มได้
- [x] 1.2 `/health` ซ่อนข้อความ error เมื่อ production (design D9) — ตรวจด้วย e2e test: production ได้เฉพาะชื่อบริการ + ok, dev ได้ข้อความเต็มเหมือนเดิม
- [x] 1.3 rate limit และ audit ใช้ IP จาก proxy ที่เชื่อถือได้เท่านั้น — ตรวจด้วย e2e test ตาม spec `platform-security` "Client IP behind a reverse proxy": ตั้ง `TRUST_PROXY` เป็น IP เดียว, header ปลอมจาก IP อื่นไม่ถูกใช้, คำขอที่ 11 ได้ 429, audit บันทึก IP จาก header ของ proxy
- [x] 1.4 Prisma `binaryTargets` สำหรับ musl ARM64/x86-64 และ connection limit ของ api/worker (design D3, D5) — ตรวจด้วย `prisma generate` มี engine ทั้งสองแบบ และ integration test เดิมผ่าน

## 2. Production image และ compose

- [x] 2.1 `Service/Dockerfile` multi-stage (`tools`, `runtime` จาก `pnpm deploy --prod`) และปักเวอร์ชัน image ภายนอกทุกตัวที่มี ARM64 (design D3) — ตรวจด้วยการ build `linux/amd64` บนเครื่อง dev: runtime < 300 MB, `docker history`/การค้นในชั้นไม่พบ secret, api/worker เริ่มได้, `tools` รัน `migrate deploy` และ `seed` ได้
- [x] 2.2 `Web/Dockerfile` แบบ standalone + `NEXT_PUBLIC_SDES_WS_URL` เป็น build arg (design D3) — ตรวจด้วย image < 200 MB, หน้าล็อกอินตอบพร้อม security headers ครบ, CSP `connect-src` ตรงกับโดเมนที่ build
- [x] 2.3 `Service/docker-compose.prod.yml` + `deploy/Caddyfile`: route, network ภายในที่กำหนด subnet, ไม่มี `ports:` นอกจาก Caddy, restart/healthcheck/depends_on, `mem_limit`, log rotation, Redis `noeviction`, ClamAV `ConcurrentDatabaseReload no`, ค่า PostgreSQL ตาม D5 (design D2, D4, D5) — ตรวจด้วยการรันบนเครื่อง dev ด้วยโดเมน `localhost`: `https://localhost` ใช้งานได้, http พาไป https, port ของ db/redis/s3/clamav/api ต่อจาก host ไม่ได้, เพดาน RAM รวม ≤ 9.6 GB (สคริปต์ตรวจจาก compose config)
- [x] 2.4 ทดสอบการทำงานต่อเนื่องบน stack production ของเครื่อง dev — ตรวจตาม spec `production-deployment` "Self-healing services": kill worker ระหว่างมีงานในคิว → เริ่มใหม่เองและงานเสร็จ; `docker compose restart` ทั้งชุด → ข้อมูลอยู่ครบ

## 3. Deploy, rollback และ backup (`Service/deploy/`)

- [x] 3.1 `init-env.sh` สร้างไฟล์ค่าตั้ง production ด้วยค่าสุ่ม mode 600 และไม่เขียนทับไฟล์เดิม (design D6) — ตรวจด้วย test สคริปต์ (`node --test` หรือ bats): ค่าทุกตัวยาวพอ, ไม่มีค่าซ้ำกัน, รันซ้ำแล้วไฟล์เดิมไม่เปลี่ยน
- [x] 3.2 `deploy.sh` (build tag ด้วย SHA → สำรอง → migrate one-shot → up → รอ health → `releases.log`) และ `rollback.sh` (design D7) — ตรวจบน stack production ของเครื่อง dev ตาม spec "Repeatable deploy and rollback": deploy ref ใหม่ที่มี migration แล้วเอกสารเดิมเปิดได้; deploy ref ที่ api เริ่มไม่ขึ้น (ทดสอบด้วยค่าตั้งผิดชั่วคราว) → รายงานล้มเหลว → `rollback.sh` กลับมาใช้งานได้
- [x] 3.3 service `backup` + `restore.sh` (design D7) — ตรวจตาม spec "Backup and restore": สำรอง → ลบ volume ทั้งหมด → กู้คืน → ล็อกอินได้, เอกสารพร้อมไฟล์ต้นฉบับเปิดได้, จำนวน audit event เท่าเดิม; รันการสำรอง 8 ครั้ง (ปรับวันที่จำลอง) แล้วเหลือ 7 ชุด
- [x] 3.4 `bootstrap.sh` สำหรับ Ubuntu 24.04 ARM64: Docker, firewall (22/80/443), swap 2 GB, ผู้ใช้ deploy, โฟลเดอร์ `/opt/sdes` — ตรวจด้วยการรันใน container Ubuntu 24.04 (หรือ VM ทดสอบ) แล้ว `docker compose version` ใช้ได้และ firewall เปิดเฉพาะ 3 port
- [x] 3.5 GitHub Actions `deploy.yml` (`workflow_dispatch`, SSH ด้วย secret, ผู้ใช้ที่สั่งได้เฉพาะ `deploy.sh`) — ตรวจด้วย `actionlint` และ dry-run กับเครื่อง dev (SSH ไป WSL) ก่อนใช้กับเครื่องจริง

## 4. E2E กับ stack production บนเครื่อง dev

- [x] 4.1 รัน `qa/e2e` ทั้งชุดกับ `https://localhost` (stack production + fixture provider ผ่านค่าตั้งของ E2E) — ตรวจว่า Phase 1–3, ฟีเจอร์ที่ขาด และหน้าภาพรวมผ่าน รวม websocket ผ่าน Caddy (สถานะ real-time) และไม่มี request ใดไปที่ port 3000 โดยตรง

## 5. ขึ้นเครื่องจริง

- [ ] 5.1 **[ผู้ใช้]** สร้างบัญชี OCI, VM Ampere A1 (2 OCPU / 12 GB, Ubuntu 24.04) ด้วยบัญชี Free Tier ที่ไม่อัปเกรด, security list 22/80/443, subdomain DuckDNS + token สำหรับ cron อัปเดต IP — Claude เขียนคู่มือทีละขั้นใน `docs/deploy/oci.md` ของรีโพหลักก่อน และตรวจผลด้วย `ssh` + `dig`
- [ ] 5.2 bootstrap + `init-env.sh` + deploy ครั้งแรก (migrate + seed) บน VM — ตรวจตาม spec "Single HTTPS entry point": `https://<โดเมน>` ใบรับรองถูกต้อง, http พาไป https, สแกน port จากภายนอก (`nmap`) เห็นเฉพาะ 22/80/443; Admin ล็อกอินและถูกบังคับเปลี่ยนรหัส
- [ ] 5.3 smoke test บนเครื่องจริง: Admin สร้าง Clerk → Clerk อัปโหลดไฟล์ตัวอย่าง (provider ตามค่าตั้ง — `fake` ถ้ายังไม่มี key) → รอตรวจ → ยืนยัน → หน้าภาพรวมและ audit แสดงถูกต้อง — ตรวจด้วย Playwright smoke spec ที่ชี้ไปโดเมนจริง (บัญชีทดสอบลบทิ้งหลังรัน)
- [ ] 5.4 reboot VM แล้วระบบกลับมาเอง และทดสอบ `rollback.sh` บนเครื่องจริงหนึ่งรอบ — ตรวจด้วย smoke spec ผ่านหลังทั้งสองกรณี
- [ ] 5.5 **[ผู้ใช้]** ตั้ง uptime monitor ที่ `/api/health` และ (ถ้าต้องการ) `BACKUP_S3_*` ของ Object Storage — Claude ตรวจว่า backup คืนแรกเกิดขึ้นและ (ถ้าตั้ง) อัปโหลดสำเร็จ

## 6. วัดผลและ optimize บนเครื่องจริง

- [ ] 6.1 วัด baseline บน VM: ขนาด image, RAM ขณะว่างและขณะอ่าน 20 ฉบับต่อเนื่อง, เวลา build/deploy, `/dashboard` และรายงาน 12 เดือนด้วยฐาน `sdes_perf` (สร้างแล้วลบ), Lighthouse ของหน้าล็อกอินและหน้าภาพรวม (design D8) — ตรวจว่าผลบันทึกใน `qa/phase4/production-perf.md` พร้อมสเปกเครื่อง
- [ ] 6.2 แก้จุดที่ไม่ผ่านเกณฑ์ใน spec "Performance on the production host" และ "Resource budget" ตามลำดับใน design D8 — ตรวจด้วยการวัดซ้ำจนค่ากลาง < 1 วินาที, หน้าแรกหลังล็อกอิน < 3 วินาที, ไม่มี container ถูก OOM kill ระหว่างวัด (ถ้าผ่านตั้งแต่ 6.1 ให้บันทึกว่าไม่ต้องแก้)

## 7. เอกสารและ regression

- [ ] 7.1 คู่มือ deploy (`docs/deploy/`): สร้าง VM, bootstrap, ค่าตั้ง, deploy/rollback, backup/restore, ย้ายเครื่อง, แก้ปัญหาที่พบบ่อย (capacity, ใบรับรอง, RAM) + อัปเดต README ของ Service/Web — ตรวจด้วยการให้ผู้ใช้ทำตามคู่มือในข้อ 5.1–5.2 ได้โดยไม่ต้องถามเพิ่ม และทุกคำสั่งในคู่มือถูกรันจริงในงานนี้
- [ ] 7.2 test ทั้งหมดยังผ่าน: Service (`pnpm test`), Web (`pnpm test` + `pnpm test:e2e`), `qa/e2e` กับ stack dev เดิม และ CI ของทั้งสอง repo — ตรวจด้วยผลรันทั้งชุด

## Workflow follow-up

- เปิด draft PR (ต่อจาก PR #5 ของแต่ละรีโพ) และรอ CI เขียว
- รีวิวกับผู้ใช้แล้ว archive ด้วย `/opsx:archive`
- หลัง Phase 4: การทดสอบตาม BRD (task 7.3/7.4/8.2 ของ `phase2-core-features` ด้วย AI จริง, 500 ฉบับ, load test 50 คนพร้อมกัน / 1,000 ฉบับต่อชั่วโมง, pentest/TLS) บนเครื่อง production
