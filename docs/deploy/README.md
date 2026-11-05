# คู่มือ deploy SDES บนเครื่อง production

ระบบทั้งชุดรันบน VM เครื่องเดียวด้วย Docker Compose (`Service/docker-compose.prod.yml`) โดยมี Caddy เป็นทางเข้า HTTPS เดียว
ออกแบบตาม `openspec/changes/phase4-optimize-deploy/design.md` — เครื่องเป้าหมายคือ Oracle Cloud Always Free (ARM 2 OCPU / 12 GB) แต่ใช้กับ VPS Ubuntu 24.04 ใดก็ได้

```
อินเทอร์เน็ต ──443/80──► caddy ─┬─ /api/*, /auth/*, /ws/* ──► api ──┬─ postgres
                               └─ อื่น ๆ ───────────────► web     ├─ redis ◄── worker
                                                                  ├─ seaweedfs (ไฟล์เอกสาร)
                                                                  └─ clamav
                               backup (cron 02:00) ──► /opt/sdes/backups
```

| หัวข้อ | ไฟล์/คำสั่ง |
|---|---|
| สร้าง VM + DuckDNS | [oci.md](oci.md) |
| เตรียมเครื่อง | `deploy/bootstrap.sh` |
| ค่าตั้ง + secret | `deploy/init-env.sh` → `/opt/sdes/.env.production` |
| deploy / rollback | `deploy/deploy.sh`, `deploy/rollback.sh`, GitHub Actions `Deploy` |
| สำรอง / กู้คืน | service `backup`, `deploy/restore.sh` |
| ตรวจงบ RAM | `deploy/check-budget.sh` |

โครงบนเครื่อง:

```
/opt/sdes/
├── service/            clone ของ sdes-service (มี deploy/ และ docker-compose.prod.yml)
├── web/                clone ของ sdes-web
├── .env.production     ค่าตั้งและ secret (mode 600) — สำรองแยกไว้ที่ปลอดภัย
├── releases.log        ประวัติ deploy (เวลา, ref, tag, ผล)
└── backups/
    ├── daily/<วันเวลา>/   db.dump + files/ + manifest   (เก็บ 7 ชุด)
    └── pre-deploy/        ฐานข้อมูลก่อน migrate ทุกครั้ง (เก็บ 5 ชุด)
```

## ติดตั้งครั้งแรก

ทำหลังจาก [oci.md](oci.md) เสร็จ — คำสั่งทั้งหมดรันบน VM

### 1. เตรียมเครื่อง (root)

```sh
ssh -i ~/.ssh/sdes_admin ubuntu@<โดเมนหรือ IP>
curl -fsSL -o bootstrap.sh https://raw.githubusercontent.com/<owner>/sdes-service/main/deploy/bootstrap.sh   # repo private: scp ไฟล์นี้ขึ้นไปแทน
sudo DUCKDNS_DOMAIN=sdes-demo DUCKDNS_TOKEN=<token> sh bootstrap.sh
```

ได้: Docker + compose, firewall เปิด 22/80/443, swap 2 GB, ผู้ใช้ `deploy`, `/opt/sdes`, cron อัปเดต DuckDNS ทุก 5 นาที

### 2. ให้เครื่องดึง repo ได้ (deploy key แบบอ่านอย่างเดียว)

```sh
sudo -iu deploy
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_service -C sdes-service-deploy
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_web -C sdes-web-deploy
cat ~/.ssh/github_service.pub ~/.ssh/github_web.pub
```

นำ public key แต่ละตัวไปใส่ที่ GitHub → repo → **Settings → Deploy keys → Add deploy key** (ไม่ติ๊ก *Allow write access*) แล้ว:

```sh
cat >> ~/.ssh/config <<'EOF'
Host github-service
  HostName github.com
  IdentityFile ~/.ssh/github_service
Host github-web
  HostName github.com
  IdentityFile ~/.ssh/github_web
EOF
git clone git@github-service:<owner>/sdes-service.git /opt/sdes/service
git clone git@github-web:<owner>/sdes-web.git /opt/sdes/web
```

### 3. ค่าตั้ง

```sh
sh /opt/sdes/service/deploy/init-env.sh
```

ถามโดเมน, อีเมล Admin คนแรก, ข้อมูลบริษัท และการอ่านเอกสาร (`fake` = สาธิต ไม่ใช้ AI)
ค่าสุ่มทั้งหมด (รหัสฐานข้อมูล, Redis, S3, JWT, `ERP_SECRET_KEY`, รหัสชั่วคราวของ Admin) ถูกสร้างให้และไม่แสดงบนจอ

> **Gemini แผนฟรี** อาจนำเนื้อหาที่ส่งไปใช้ปรับปรุงผลิตภัณฑ์ — ใช้กับเอกสารตัวอย่างเท่านั้น ห้ามส่งใบกำกับภาษีจริงของบริษัท

**สำรอง `/opt/sdes/.env.production` ไว้นอกเครื่อง** (เช่น password manager) — ถ้าหาย ชุดสำรองฐานข้อมูลจะกู้ได้แต่ secret ของ ERP ที่เข้ารหัสไว้จะใช้ไม่ได้

### 4. deploy ครั้งแรก

```sh
cd /opt/sdes/service
sh deploy/check-budget.sh                       # เพดาน RAM รวม ≤ 80% ของเครื่อง
sh deploy/deploy.sh --service main --web main --seed
```

ครั้งแรกใช้เวลา build ประมาณ 15–25 นาที (ARM 2 OCPU) — เสร็จแล้วเปิด `https://<โดเมน>`
ล็อกอินด้วย `SEED_ADMIN_EMAIL` และรหัสชั่วคราว (`grep SEED_ADMIN_PASSWORD /opt/sdes/.env.production`) ระบบจะบังคับเปลี่ยนรหัส

### 5. ตรวจสุขภาพ

```sh
curl -s https://<โดเมน>/api/health          # {"status":"ok","checks":[...]}
docker compose -p sdes-prod ps              # ทุก service healthy
```

ตั้ง uptime monitor ฟรี (เช่น UptimeRobot) ชี้ไปที่ `https://<โดเมน>/api/health` ทุก 5 นาที แจ้งเตือนทางอีเมล

## deploy เวอร์ชันใหม่

```sh
sh /opt/sdes/service/deploy/deploy.sh --service <ref> --web <ref>
```

ลำดับ: checkout → build (tag = `<SHA service>-<SHA web>`) → สำรองฐานข้อมูล → migrate (ล้ม = หยุด ระบบเดิมทำงานต่อ) → สลับ container → รอ health ≤ 120 วินาที → บันทึก `releases.log`
มี downtime ไม่กี่วินาทีตอนสลับ container

- health ไม่ผ่าน → `deploy.sh` จบด้วย exit ≠ 0, บันทึก `failed` ใน `releases.log` และแสดง log 30 บรรทัดท้ายของ api/worker/web (บอกชื่อค่าตั้งที่ขาดถ้าเป็นสาเหตุ) → สั่ง `rollback.sh`
- เก็บ image ของ release ที่สำเร็จ 3 ชุดล่าสุดไว้ rollback — ชุดเก่ากว่าและชุดที่ล้มเหลวถูกลบอัตโนมัติ (กัน disk เต็ม)

**ผ่าน GitHub Actions:** repo sdes-service → Actions → **Deploy** → Run workflow (เลือก ref) — ตั้งค่าครั้งเดียว:

1. บน VM (ผู้ใช้ deploy) สร้าง key สำหรับ Actions: `ssh-keygen -t ed25519 -N '' -f ~/actions_key`
2. เพิ่มบรรทัดนี้ใน `/home/deploy/.ssh/authorized_keys` (key นี้สั่งได้แค่ deploy/rollback):
   `command="/opt/sdes/service/deploy/ssh-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <เนื้อหาของ ~/actions_key.pub>`
3. GitHub → sdes-service → Settings → Environments → สร้าง `production` → secrets:
   `DEPLOY_HOST` = โดเมน, `DEPLOY_SSH_KEY` = เนื้อหาของ `~/actions_key`, `DEPLOY_KNOWN_HOSTS` = ผลของ `ssh-keyscan -t ed25519 <โดเมน>` (ตรวจ fingerprint กับ `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` บน VM)
4. ลบ `~/actions_key` ออกจาก VM

## rollback

```sh
sh /opt/sdes/service/deploy/rollback.sh          # กลับไป release ก่อนหน้าที่สำเร็จ (ไม่ build)
sh /opt/sdes/service/deploy/rollback.sh <tag>    # เลือก tag จาก releases.log (ต้องยังมี image บนเครื่อง = 3 release ล่าสุด)
```

migration ทุกครั้งเป็นแบบเพิ่ม โค้ดเวอร์ชันก่อนจึงทำงานกับฐานข้อมูลใหม่ได้ ถ้าวันหนึ่งมี migration ที่ไม่ใช่แบบเพิ่ม ให้กู้ฐานข้อมูลก่อน deploy ด้วย `restore.sh backups/pre-deploy/<ไฟล์>.dump` แล้วค่อย rollback

## Backup และกู้คืน

service `backup` สำรองทุกวัน 02:00 (เวลาไทย): `pg_dump` + ไฟล์เอกสารทั้ง bucket + `manifest` (จำนวนเอกสาร/audit/ไฟล์) เก็บ 7 ชุดล่าสุดใน `/opt/sdes/backups/daily`

```sh
cd /opt/sdes/service
docker compose -p sdes-prod --env-file /opt/sdes/.env.production -f docker-compose.prod.yml exec backup backup.sh   # สำรองทันที
sh deploy/restore.sh                       # รายการชุดที่มี
sh deploy/restore.sh 2026-11-05_0200       # กู้ชุดนั้น (หยุด api/worker ระหว่างกู้)
```

ไฟล์ชุดสำรองเป็นของ root และอ่านได้เฉพาะ root (มีข้อมูลทั้งระบบ) — คัดลอกออกนอกเครื่องด้วย `sudo` เช่น `sudo tar -C /opt/sdes/backups/daily -czf - 2026-11-05_0200 | ssh <ปลายทาง> 'cat > sdes-backup.tgz'`
กู้คืนบนฐานว่างได้ (เช่น เครื่องใหม่ หรือหลัง `docker compose down -v`): `restore.sh` สร้างตารางและคืนไฟล์เอกสารทั้ง bucket ให้เอง — ทดสอบแล้วว่าจำนวนเอกสาร/audit event และ checksum ของทุกไฟล์ตรงกับตอนสำรอง

**ส่งออกนอกเครื่อง (แนะนำ):** Object Storage ของ OCI มีโควตาฟรี 20 GB — สร้าง bucket แล้วสร้าง *Customer Secret Key* (Profile → Customer secret keys) ใส่ใน `.env.production`:

```
BACKUP_S3_ENDPOINT=https://<namespace>.compat.objectstorage.ap-singapore-1.oraclecloud.com
BACKUP_S3_BUCKET=sdes-backups
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
```

แล้ว `sh deploy/deploy.sh ...` (หรือ `docker compose ... up -d backup`) ให้ service backup ได้ค่าใหม่

## ทดสอบบนเครื่อง dev ก่อนขึ้นเครื่องจริง

ใช้ชุดเดียวกันทั้งหมดบน Linux/WSL ได้ด้วยโดเมน `localhost` (ตั้ง `SDES_DOMAIN=localhost` ตอน `init-env.sh`) — Caddy ออกใบรับรองจาก CA ภายในของตัวเองแทน Let's Encrypt

```sh
export SDES_ROOT=$HOME/sdes-root          # แทน /opt/sdes (lib.sh อ่าน SDES_ROOT, SDES_ENV_FILE, SDES_BACKUP_DIR)
sh deploy/init-env.sh $SDES_ROOT/.env.production
git clone <sdes-service> $SDES_ROOT/service && git clone <sdes-web> $SDES_ROOT/web
sh $SDES_ROOT/service/deploy/deploy.sh --service <ref> --web <ref> --seed
docker exec sdes-prod-caddy-1 cat /data/caddy/pki/authorities/local/root.crt > $SDES_ROOT/caddy-root.crt
curl --cacert $SDES_ROOT/caddy-root.crt https://localhost/api/health
```

- browser จะเตือนใบรับรอง (CA ภายใน) — ใช้ได้ตามปกติสำหรับทดสอบ; ลบ volume ของ stack เมื่อไรก็ต้องดึง `root.crt` ใหม่
- `qa/e2e` รันกับ stack นี้ได้ (ตัวแปร `SDES_E2E_*` ใน `qa/e2e/README.md`)
- Docker Desktop/WSL บน Windows: ดิสก์ของ WSL (`ext4.vhdx`) ไม่หดเองหลังลบ image — build หลายรอบแล้ว disk C: เต็มได้ ล้างด้วย `docker builder prune -af` แล้วบีบไฟล์ด้วย `diskpart` → `compact vdisk` (ต้อง `wsl --shutdown` และสิทธิ์ admin)

## ย้ายไปเครื่องอื่น

1. เครื่องใหม่: `bootstrap.sh` → clone repo ทั้งสอง (ขั้น 1–2)
2. คัดลอก `.env.production` เดิมไปที่ `/opt/sdes/.env.production` (ค่าเดิมทุกตัว) และชุดสำรองล่าสุดไปที่ `/opt/sdes/backups/daily/`
3. แก้ `SDES_DOMAIN` ถ้าเปลี่ยนโดเมน แล้วชี้ DNS/DuckDNS ไปเครื่องใหม่
4. `sh deploy/deploy.sh --service <ref> --web <ref>` (ไม่ต้อง `--seed`) แล้ว `sh deploy/restore.sh <ชุด>`

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| api/worker ไม่เริ่ม log ขึ้น "ค่าตั้ง production ไม่ถูกต้อง" | บอกชื่อค่าที่ขาด/สั้น/เป็นค่าตัวอย่าง — แก้ใน `.env.production` แล้ว deploy ใหม่ |
| เปิดเว็บแล้วใบรับรองไม่ถูกต้อง | DNS ยังไม่ชี้มาที่เครื่อง หรือ port 80/443 ถูกปิด (security list ของ OCI + `sudo ufw status`) — ดู `docker compose -p sdes-prod logs caddy` |
| ใบรับรองไม่ออกเพราะ rate limit ของ Let's Encrypt | รอ 1 ชั่วโมง; อย่าลบ volume `caddydata` บ่อย ๆ |
| container ถูกปิดเพราะหน่วยความจำ (`OOMKilled`) | `docker inspect <container> --format '{{.State.OOMKilled}}'` · ปรับ `mem_limit` ใน compose ให้รวมไม่เกินงบ (`check-budget.sh`) · เครื่อง 6 GB: ไม่เปิด Odoo และลด clamav เหลือ 1.5 GB |
| build ช้าหรือเครื่องค้างตอน deploy | deploy ช่วงไม่มีคนใช้; swap 2 GB ช่วยกัน OOM |
| disk เต็ม (`No space left on device`) | `docker system df` · ลบ build cache: `docker builder prune -af` (build ครั้งถัดไปช้าขึ้น) · ชุดสำรองเก่า: `sudo ls /opt/sdes/backups/daily` |
| ClamAV ไม่ healthy หลังเริ่มใหม่ | ครั้งแรกโหลด signature 2–3 นาที (start_period 180 วินาที) |
| ลืมรหัส Admin | ผู้ดูแลอีกคนรีเซ็ตให้ในหน้า "ผู้ใช้" หรือ seed Admin ใหม่ด้วยอีเมลอื่น: แก้ `SEED_ADMIN_EMAIL` แล้ว `docker compose ... --profile tools run --rm migrate node dist/seed-cli.js` |
