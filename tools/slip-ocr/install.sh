#!/usr/bin/env bash
# ติดตั้งบริการอ่านสลิปบนเครื่อง Linux (Ubuntu/Debian) ของร้าน
# ใช้: bash tools/slip-ocr/install.sh <โฟลเดอร์ repo>
# ทำให้: ติดตั้ง tesseract (ไทย/อังกฤษ), ImageMagick, Deno · โหลดโมเดลรุ่นแม่น · สร้างโทเคน · ตั้งให้รันเองตอนเปิดเครื่อง
# ไม่ทำ: การตั้งค่า Cloudflare Tunnel (ต้องล็อกอินบัญชีของร้านเอง ดูคำสั่งท้ายสคริปต์)
set -euo pipefail

REPO="${1:?ระบุโฟลเดอร์ repo เช่น: bash tools/slip-ocr/install.sh /home/shop/cake-order-admin}"
REPO="$(cd "$REPO" && pwd)"
[ -f "$REPO/tools/slip-ocr/service.ts" ] || { echo "ไม่พบ tools/slip-ocr/service.ts ใน $REPO"; exit 1; }

echo "[1/5] ติดตั้งโปรแกรมที่ต้องใช้ (ต้องมีสิทธิ์ sudo)"
sudo apt-get update -qq
sudo apt-get install -y -qq tesseract-ocr tesseract-ocr-tha imagemagick curl unzip openssl

if ! command -v deno >/dev/null 2>&1 && [ ! -x "$HOME/.deno/bin/deno" ]; then
  echo "[1b] ติดตั้ง Deno"
  curl -fsSL https://deno.land/install.sh | sh -s -- -y
fi
export PATH="$HOME/.deno/bin:$PATH"
DENO="$(command -v deno)"

echo "[2/5] โหลดโมเดลรุ่นแม่น (tessdata_best) ภาษาไทยและอังกฤษ"
TESSDATA="$HOME/.cache/slip-ocr/tessdata_best"
mkdir -p "$TESSDATA"
for l in tha eng; do
  curl -fsSL -o "$TESSDATA/$l.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/$l.traineddata"
done

echo "[3/5] สร้างไฟล์ตั้งค่าและโทเคน (เก็บไว้เฉพาะเครื่องนี้)"
CONF_DIR="$HOME/.config/slip-ocr"
ENV_FILE="$CONF_DIR/env"
mkdir -p "$CONF_DIR"
if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(openssl rand -hex 32)"
  umask 077
  printf 'SLIP_OCR_TOKEN=%s\nPORT=8787\nSLIP_OCR_TESSDATA=%s\n' "$TOKEN" "$TESSDATA" > "$ENV_FILE"
  echo "สร้างโทเคนใหม่แล้ว (จะแสดงครั้งเดียวด้านล่าง ใช้ตั้งค่า SLIP_OCR_TOKEN ใน Supabase)"
else
  echo "พบไฟล์ตั้งค่าเดิม $ENV_FILE ใช้ค่าเดิม"
fi

echo "[4/5] ตั้งให้บริการรันเองตอนเปิดเครื่อง (systemd)"
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/slip-ocr.service" <<UNIT
[Unit]
Description=Slip OCR (Tesseract) for cake-order-admin
After=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$DENO run --allow-run --allow-read --allow-write --allow-env --allow-net --no-prompt --no-lock --node-modules-dir=none $REPO/tools/slip-ocr/service.ts
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now slip-ocr.service
loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER" || true

echo "[5/5] ทดสอบว่าบริการตอบ"
sleep 5
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/ || true)"
echo "ได้รับสถานะ $CODE (401 = ปกติ เพราะยังไม่ส่งโทเคน)"

cat <<'NEXT'

--- ขั้นต่อไป (ทำด้วยบัญชี Cloudflare ของร้าน) ---
1. ติดตั้ง cloudflared แล้วล็อกอิน:
     cloudflared tunnel login
2. สร้าง Tunnel และผูกโดเมนย่อย (โดเมนต้องอยู่บน Cloudflare):
     cloudflared tunnel create slip-ocr
     cloudflared tunnel route dns slip-ocr ocr.<โดเมนของร้าน>
3. รัน Tunnel ชี้ไปที่บริการ:
     cloudflared tunnel --url http://127.0.0.1:8787 run slip-ocr
4. ใน Supabase (Edge Functions secrets) ตั้งค่า:
     SLIP_OCR_URL = https://ocr.<โดเมนของร้าน>/
     SLIP_OCR_TOKEN = ค่าที่แสดงตอนติดตั้ง (หรือดูในไฟล์ ~/.config/slip-ocr/env)
5. ให้ deploy fb-webhook ใหม่ แล้วเปิดสวิตช์อ่านภาพสลิปในหน้าตั้งค่า
NEXT
if [ -f "$ENV_FILE" ] && grep -q '^SLIP_OCR_TOKEN=' "$ENV_FILE"; then
  echo "โทเคน: $(grep '^SLIP_OCR_TOKEN=' "$ENV_FILE" | cut -d= -f2)"
fi
