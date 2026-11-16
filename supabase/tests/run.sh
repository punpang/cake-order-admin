#!/usr/bin/env bash
# ทดสอบ migration + นโยบาย RLS/RPC บน Postgres จริง (จำลองส่วนของ Supabase ด้วย stubs.sql)
# รัน: bash supabase/tests/run.sh
#   ต้องมี psql และเชื่อม Postgres ได้ตามตัวแปรมาตรฐาน (PGHOST / PGPORT / PGUSER / PGPASSWORD)
#   ผู้ใช้ต้องสร้างฐานข้อมูลและ role ได้ (เช่น postgres) · ฐานทดสอบสร้างใหม่ทุกครั้งแล้วลบทิ้ง (KEEP_DB=1 = ไม่ลบ)
# ขั้นตอน: stubs.sql → migration ทุกไฟล์ตามลำดับชื่อ → security.test.sql (assert ล้ม = สคริปต์ล้ม)
# ข้อผิดพลาดที่ยอมรับตอนรัน migration: เฉพาะที่เกิดจากส่วนเสริมของแพลตฟอร์มซึ่ง Postgres ธรรมดาไม่มี (pg_net)
set -uo pipefail
cd "$(dirname "$0")/../.."

DB="punpang_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL[@]}" -d postgres -c "drop database if exists \"$DB\"" >/dev/null 2>&1; }
trap cleanup EXIT

# เลขเวอร์ชัน (ส่วนก่อน _ ของชื่อไฟล์) ต้องไม่ซ้ำ ไม่เช่นนั้น supabase db push ชนกันที่ schema_migrations
dups=$(ls supabase/migrations | sed 's/_.*//' | sort | uniq -d)
[ -z "$dups" ] || { echo "✗ เลขเวอร์ชัน migration ซ้ำ: $dups"; exit 1; }

"${PSQL[@]}" -d postgres -c "create database \"$DB\"" || { echo "สร้างฐานทดสอบไม่ได้"; exit 2; }
"${PSQL[@]}" -d "$DB" -f supabase/tests/stubs.sql >/dev/null 2>/dev/null || { echo "stubs.sql ล้มเหลว"; "${PSQL[@]}" -d "$DB" -f supabase/tests/stubs.sql; exit 2; }

ALLOWED='extension "pg_net" is not available'
bad=0
for f in $(ls supabase/migrations/*.sql | sort); do
  out=$(psql -X -q -v ON_ERROR_STOP=0 -d "$DB" -f "$f" 2>&1 | grep -E "ERROR|FATAL" || true)
  [ -z "$out" ] && continue
  unexpected=$(printf '%s\n' "$out" | grep -vF "$ALLOWED" || true)
  if [ -n "$unexpected" ]; then
    echo "✗ migration ล้มเหลว: $f"
    printf '%s\n' "$unexpected" | head -5
    bad=1
  fi
done
[ "$bad" = "0" ] || { echo "migration ไม่ผ่าน"; exit 1; }
echo "✓ migration ทุกไฟล์ผ่าน ($(ls supabase/migrations/*.sql | wc -l) ไฟล์)"

"${PSQL[@]}" -d "$DB" -f supabase/tests/security.test.sql
code=$?
[ "$code" = "0" ] && echo "✓ security.test.sql ผ่านทั้งหมด" || echo "✗ security.test.sql ล้มเหลว"
[ "$code" = "0" ] || exit "$code"

"${PSQL[@]}" -d "$DB" -f supabase/tests/lucky.test.sql
lcode=$?
[ "$lcode" = "0" ] && echo "✓ lucky.test.sql ผ่านทั้งหมด" || echo "✗ lucky.test.sql ล้มเหลว"
[ "$lcode" = "0" ] || exit "$lcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/mirror.test.sql
mcode=$?
[ "$mcode" = "0" ] && echo "✓ mirror.test.sql ผ่านทั้งหมด" || echo "✗ mirror.test.sql ล้มเหลว"
exit "$mcode"
