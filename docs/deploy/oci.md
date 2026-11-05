# สร้างเครื่อง production ฟรีบน Oracle Cloud (Always Free)

คู่มือนี้เป็นขั้นตอนที่ต้องใช้บัญชีของคุณเอง (phase 4 task 5.1) ทำครั้งเดียวประมาณ 30–60 นาที
เมื่อเสร็จแล้วให้ทำต่อที่ [README.md](README.md) หัวข้อ "ติดตั้งครั้งแรก"

> **ฟรี 100%:** ใช้เฉพาะทรัพยากรที่ติดป้าย **Always Free** และ **ห้ามกด Upgrade เป็น Pay As You Go**
> บัญชี Free Tier สร้างของเกินโควตาฟรีไม่ได้อยู่แล้ว จึงไม่มีทางถูกเรียกเก็บเงิน
> ตอนสมัครต้องใช้บัตรเครดิต/เดบิตเพื่อยืนยันตัวตน (อาจมีการกันวงเงินชั่วคราวเล็กน้อยแล้วคืน) แต่ไม่ตัดเงิน

## สิ่งที่จะได้

| รายการ | ค่า |
|---|---|
| เครื่อง | VM.Standard.A1.Flex (ARM Ampere) 2 OCPU / 12 GB RAM |
| ระบบปฏิบัติการ | Ubuntu 24.04 (aarch64) |
| ดิสก์ | boot volume 100 GB (โควตาฟรีรวม 200 GB) |
| IP | ephemeral public IP (ฟรี) + ชื่อจาก DuckDNS ที่อัปเดตตาม IP เอง |
| port ที่เปิด | 22 (SSH ด้วย key), 80, 443 |

## 1. สมัครบัญชี

1. ไปที่ <https://signup.cloud.oracle.com> กรอกอีเมล ประเทศ Thailand
2. **Home Region** เลือกครั้งเดียวเปลี่ยนไม่ได้ — แนะนำ **Singapore (ap-singapore-1)** (ใกล้ไทย) ถ้าภายหลังสร้าง VM ไม่ได้เพราะ capacity ดูหัวข้อ "แก้ปัญหา"
3. ยืนยันบัตร แล้วรอบัญชีพร้อม (ไม่กี่นาทีถึงหลายชั่วโมง จะมีอีเมลแจ้ง)
4. **อย่า** กด "Upgrade to Pay As You Go" ในหน้า Billing ไม่ว่ากรณีใด

## 2. สร้าง SSH key บนเครื่องของคุณ

PowerShell หรือ Git Bash:

```sh
ssh-keygen -t ed25519 -C "sdes-admin" -f ~/.ssh/sdes_admin
```

จะได้ `~/.ssh/sdes_admin` (เก็บไว้ห้ามส่งให้ใคร) และ `~/.ssh/sdes_admin.pub` (ใช้ในขั้นต่อไป)

## 3. สร้าง VM

เมนู ☰ → **Compute → Instances → Create instance**

1. **Name:** `sdes-prod`
2. **Image and shape → Edit**
   - Image: **Canonical Ubuntu 24.04** (ไม่ใช่ Minimal)
   - Shape: **Change shape → Ampere → VM.Standard.A1.Flex** → OCPU **2**, Memory **12 GB** (ต้องเห็นป้าย *Always Free-eligible*)
3. **Networking:** ปล่อยให้สร้าง VCN ใหม่ + public subnet, **Assign a public IPv4 address: Yes**
4. **Add SSH keys → Paste public keys:** วางเนื้อหาของ `sdes_admin.pub`
5. **Boot volume:** ติ๊ก *Specify a custom boot volume size* → **100 GB**
6. กด **Create** แล้วรอสถานะ **Running** จด **Public IP address**

## 4. เปิด port 80/443 ที่ security list

Instance → **Primary VNIC → Subnet → Security → Default Security List → Add Ingress Rules** สองรายการ:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(port 22 มีอยู่แล้ว) firewall ภายในเครื่องจะถูกตั้งโดย `bootstrap.sh` ในขั้นติดตั้ง

## 5. ชื่อโดเมนฟรีจาก DuckDNS

1. ไปที่ <https://www.duckdns.org> ล็อกอินด้วยบัญชี GitHub/Google
2. ตั้งชื่อ subdomain เช่น `sdes-demo` → **add domain** → ใส่ Public IP ของ VM ในช่อง *current ip* → **update ip**
3. จด **token** ที่ด้านบนของหน้า (ใช้ตั้งตัวอัปเดต IP อัตโนมัติในขั้น bootstrap — อย่าวางลงในแชทหรือ repo)

โดเมนของระบบคือ `sdes-demo.duckdns.org`

## 6. ตรวจว่าพร้อม

```sh
ssh -i ~/.ssh/sdes_admin ubuntu@<Public IP> 'uname -m && lsb_release -ds'   # ต้องได้ aarch64 และ Ubuntu 24.04
nslookup sdes-demo.duckdns.org                                             # ต้องได้ Public IP เดียวกัน
```

แจ้ง Claude ว่า "VM พร้อม" พร้อม **Public IP และชื่อโดเมน** (ไม่ต้องส่ง key หรือ token) แล้วทำต่อที่ [README.md](README.md)

## แก้ปัญหา

- **"Out of capacity for shape VM.Standard.A1.Flex"** — Ampere ฟรีมีจำกัดต่อ region: ลองเปลี่ยน *Availability domain* (AD-1/2/3) แล้วสร้างใหม่, ลองช่วงเวลาอื่น (เช้าตรู่เวลาไทย) หรือลด shape เป็น 1 OCPU / 6 GB ชั่วคราว (ระบบรันได้ถ้าไม่เปิด Odoo — ดู README หัวข้อ RAM)
- **ไม่เห็นป้าย Always Free-eligible** — แปลว่าเลือก shape/ขนาดเกินโควตา ห้ามสร้าง
- **SSH ไม่ได้** — ตรวจว่าใช้ผู้ใช้ `ubuntu` และ key ที่ถูก (`-i ~/.ssh/sdes_admin`) และ security list มี port 22
- **บัญชีถูกแจ้งว่า idle** — Oracle อาจเรียกคืน VM ของบัญชีฟรีที่ใช้ CPU ต่ำมากเป็นเวลานาน ระบบนี้มี worker และ ClamAV ทำงานตลอดจึงมักไม่เข้าเกณฑ์ แต่ควรตั้ง backup ไป Object Storage ไว้เสมอ (README หัวข้อ Backup)
