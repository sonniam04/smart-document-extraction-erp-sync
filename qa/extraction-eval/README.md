# ชุดวัดผลการอ่านเอกสาร (Phase 2 กลุ่ม 7)

ชุดใบกำกับภาษีสังเคราะห์พร้อมเฉลย และสคริปต์วัดความแม่นยำของ provider ที่ worker ใช้จริง (design D10)

## สร้างชุดทดสอบ

```bash
pnpm install --ignore-workspace
pnpm generate            # 30 ฉบับ (--count N เปลี่ยนจำนวน)
```

- ข้อมูลสุ่มแบบกำหนด seed จึงสร้างซ้ำได้ผลเดิม: 3 รูปแบบ, มี/ไม่มีหัก ณ ที่จ่าย, ส่วนลด, ยกเว้น VAT, เอกสารหลายหน้า, วันที่ พ.ศ./ค.ศ., Tax ID ที่ผ่านสูตร mod 11
- ไฟล์: PDF (มีชั้นข้อความ) และภาพสแกน PNG/JPG/TIFF ที่ใส่ noise และเอียง ±1° (เอกสารหลายหน้าที่เป็นภาพใช้ TIFF)
- `out/docs` ไฟล์เอกสาร, `out/answers` เฉลย + ตำแหน่งจริงของแต่ละค่า (วัดจาก DOM), `out/fixtures/<sha256>.json` เฉลยในรูปที่ `EXTRACTION_PROVIDER=fixture` ใช้ (ตั้ง `EXTRACTION_FIXTURE_HOST_DIR` ของ sdes-service ให้ชี้มาที่นี่)
- ตรวจว่าเฉลยทุกฉบับผ่านกฎตรวจของระบบ (ไม่มี ERROR) ทุกครั้งที่สร้าง
- `out/` และ `private/` (เอกสารจริงที่ปิดข้อมูลแล้ว) ไม่เข้า git

## วัดผล

ต้อง `pnpm build` ใน `Service/` ก่อน เพราะ provider ของ worker ใช้ `@sdes/core` ที่ build แล้ว

```bash
pnpm eval                               # fixture provider — ต้องได้ 100% (ตรวจว่าชุดวัดผลถูกต้อง)
pnpm eval --provider claude --limit 5   # เรียก Claude API จริง มีค่าใช้จ่าย — ขออนุมัติก่อนรัน
pnpm eval --provider gemini --limit 5   # เรียก Gemini API จริง (ควรเป็น paid tier)
```

- ค่า `ANTHROPIC_API_KEY` หรือ `GEMINI_API_KEY`, `EXTRACTION_MODEL`, `EXTRACTION_EFFORT` อ่านจาก env หรือ `Service/.env`
- รายงานเขียนที่ `qa/phase2/extraction-eval.md` (เปลี่ยนด้วย `--report`): ความแม่นยำรายบรรทัด (เกณฑ์ > 92%), ราย field, เวลาเฉลี่ย/p95 (เกณฑ์ ≤ 30 วินาที), อัตรากรอบครอบค่าจริง, ค่าใช้จ่ายโดยประมาณ และตารางความมั่นใจเทียบความถูกต้อง
