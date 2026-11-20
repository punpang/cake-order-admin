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

"${PSQL[@]}" -d "$DB" -f supabase/tests/coupon_modes.test.sql
ccode=$?
[ "$ccode" = "0" ] && echo "✓ coupon_modes.test.sql ผ่านทั้งหมด" || echo "✗ coupon_modes.test.sql ล้มเหลว"
[ "$ccode" = "0" ] || exit "$ccode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/points_coupon.test.sql
pcc=$?
[ "$pcc" = "0" ] && echo "✓ points_coupon.test.sql ผ่านทั้งหมด" || echo "✗ points_coupon.test.sql ล้มเหลว"
[ "$pcc" = "0" ] || exit "$pcc"

"${PSQL[@]}" -d "$DB" -f supabase/tests/lucky.test.sql
lcode=$?
[ "$lcode" = "0" ] && echo "✓ lucky.test.sql ผ่านทั้งหมด" || echo "✗ lucky.test.sql ล้มเหลว"
[ "$lcode" = "0" ] || exit "$lcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/payment_over_bill.test.sql
pcode=$?
[ "$pcode" = "0" ] && echo "✓ payment_over_bill.test.sql ผ่านทั้งหมด" || echo "✗ payment_over_bill.test.sql ล้มเหลว"
[ "$pcode" = "0" ] || exit "$pcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/payment_bill_parity.test.sql
bcode=$?
[ "$bcode" = "0" ] && echo "✓ payment_bill_parity.test.sql ผ่านทั้งหมด" || echo "✗ payment_bill_parity.test.sql ล้มเหลว"
[ "$bcode" = "0" ] || exit "$bcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/credit_coupons.test.sql
kcode=$?
[ "$kcode" = "0" ] && echo "✓ credit_coupons.test.sql ผ่านทั้งหมด" || echo "✗ credit_coupons.test.sql ล้มเหลว"
[ "$kcode" = "0" ] || exit "$kcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/member_scan.test.sql
kcode=$?
[ "$kcode" = "0" ] && echo "✓ member_scan.test.sql ผ่านทั้งหมด" || echo "✗ member_scan.test.sql ล้มเหลว"
[ "$kcode" = "0" ] || exit "$kcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/purge_customer.test.sql
gcode=$?
[ "$gcode" = "0" ] && echo "✓ purge_customer.test.sql ผ่านทั้งหมด" || echo "✗ purge_customer.test.sql ล้มเหลว"
[ "$gcode" = "0" ] || exit "$gcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/acct_opening.test.sql
ocode=$?
[ "$ocode" = "0" ] && echo "✓ acct_opening.test.sql ผ่านทั้งหมด" || echo "✗ acct_opening.test.sql ล้มเหลว"
[ "$ocode" = "0" ] || exit "$ocode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/status_reversal.test.sql
scode=$?
[ "$scode" = "0" ] && echo "✓ status_reversal.test.sql ผ่านทั้งหมด" || echo "✗ status_reversal.test.sql ล้มเหลว"
[ "$scode" = "0" ] || exit "$scode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/quote_order.test.sql
qcode=$?
[ "$qcode" = "0" ] && echo "✓ quote_order.test.sql ผ่านทั้งหมด" || echo "✗ quote_order.test.sql ล้มเหลว"
[ "$qcode" = "0" ] || exit "$qcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/pickup_guard.test.sql
pgcode=$?
[ "$pgcode" = "0" ] && echo "✓ pickup_guard.test.sql ผ่านทั้งหมด" || echo "✗ pickup_guard.test.sql ล้มเหลว"
[ "$pgcode" = "0" ] || exit "$pgcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/balance_sync.test.sql
bscode=$?
[ "$bscode" = "0" ] && echo "✓ balance_sync.test.sql ผ่านทั้งหมด" || echo "✗ balance_sync.test.sql ล้มเหลว"
[ "$bscode" = "0" ] || exit "$bscode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/mirror.test.sql
mcode=$?
[ "$mcode" = "0" ] && echo "✓ mirror.test.sql ผ่านทั้งหมด" || echo "✗ mirror.test.sql ล้มเหลว"
exit "$mcode"
