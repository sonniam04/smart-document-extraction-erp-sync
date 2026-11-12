#!/bin/sh
# ล้างข้อมูลบนเครื่อง dev ให้เริ่ม demo ใหม่ — เครื่อง dev เท่านั้น ห้ามรันกับ production
# ลบฐาน sdes (เอกสาร ผู้ใช้ audit ทั้งหมด) + คิวใน Redis + ฐาน Odoo sdes_erp แล้วสร้าง Odoo ใหม่
# ฐานอื่นในเครื่อง (sdes_test, sdes_perf) ไม่ถูกแตะ
# รันใน WSL:  sh qa/demo/reset-dev.sh <ไฟล์ผล Odoo setup (นอก repo — มี API key)>
# จากนั้นบน Windows:  pnpm --filter @sdes/db migrate:deploy && pnpm --filter @sdes/db seed  (ใน Service/)
set -e
OUT="$1"
[ -n "$OUT" ] || { echo "ระบุไฟล์สำหรับเขียนผล Odoo setup (นอก repo) เป็นอาร์กิวเมนต์แรก" >&2; exit 1; }
cd "$(dirname "$0")/../../Service"

docker compose stop api worker
# audit_events เป็น append-only (trigger) จึงล้างด้วยการสร้างฐานใหม่ ไม่ลบรายแถว
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""'
docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning FLUSHALL'

docker compose --profile odoo up -d --wait odoo-db
docker compose --profile odoo stop odoo
docker compose --profile odoo exec -T odoo-db psql -q -U odoo -d postgres -c "DROP DATABASE IF EXISTS sdes_erp WITH (FORCE)"
sh docker/odoo/setup.sh | grep '^{' > "$OUT"
chmod 600 "$OUT"
# อีเมลแจ้งการชำระเงินถึงผู้ขาย → Mailpit http://127.0.0.1:8025
sh docker/odoo/mail-demo.sh
echo "ล้างแล้ว — ผล Odoo setup อยู่ที่ $OUT"
