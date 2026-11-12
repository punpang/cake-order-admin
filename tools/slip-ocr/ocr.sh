#!/usr/bin/env bash
# อ่านสลิปด้วย Tesseract 3 รอบ (ต่างโมเดล/ต่างการจัดหน้า) → เขียนข้อความลงโฟลเดอร์ผลลัพธ์ แล้วให้ merge.ts โหวตรวมผล
# ใช้: tools/slip-ocr/ocr.sh <รูปสลิป> <โฟลเดอร์ผลลัพธ์>
# ต้องมี: tesseract (พร้อมภาษา tha, eng), ImageMagick (convert), curl · โมเดลรุ่นแม่น (tessdata_best) โหลดครั้งแรกอัตโนมัติ
set -euo pipefail
IMG="$1"; OUT="$2"
BEST="${SLIP_OCR_TESSDATA:-$HOME/.cache/slip-ocr/tessdata_best}"
mkdir -p "$OUT" "$BEST"
for l in tha eng; do
  [ -s "$BEST/$l.traineddata" ] || curl -fsSL -o "$BEST/$l.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/$l.traineddata"
done
# ขยาย 2 เท่า + ขาวดำ + ปรับระดับ: ตัวเลขเล็ก ๆ และวันที่อ่านได้ดีขึ้นชัดเจน
convert "$IMG" -resize 200% -colorspace Gray -normalize "$OUT/pre.png"
tesseract "$OUT/pre.png" "$OUT/pass1" --tessdata-dir "$BEST" -l tha+eng --psm 4 >/dev/null 2>&1
tesseract "$OUT/pre.png" "$OUT/pass2" --tessdata-dir "$BEST" -l tha+eng --psm 6 >/dev/null 2>&1
tesseract "$OUT/pre.png" "$OUT/pass3" -l tha+eng --psm 4 >/dev/null 2>&1
rm -f "$OUT/pre.png"
