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

"${PSQL[@]}" -d "$DB" -f supabase/tests/shifts_guard.test.sql
shcode=$?
[ "$shcode" = "0" ] && echo "✓ shifts_guard.test.sql ผ่านทั้งหมด" || echo "✗ shifts_guard.test.sql ล้มเหลว"
[ "$shcode" = "0" ] || exit "$shcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/rate_limit.test.sql
rlcode=$?
[ "$rlcode" = "0" ] && echo "✓ rate_limit.test.sql ผ่านทั้งหมด" || echo "✗ rate_limit.test.sql ล้มเหลว"
[ "$rlcode" = "0" ] || exit "$rlcode"

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

"${PSQL[@]}" -d "$DB" -f supabase/tests/over_bill_shipping.test.sql
obscode=$?
[ "$obscode" = "0" ] && echo "✓ over_bill_shipping.test.sql ผ่านทั้งหมด" || echo "✗ over_bill_shipping.test.sql ล้มเหลว"
[ "$obscode" = "0" ] || exit "$obscode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/points_clear_guard.test.sql
pccode=$?
[ "$pccode" = "0" ] && echo "✓ points_clear_guard.test.sql ผ่านทั้งหมด" || echo "✗ points_clear_guard.test.sql ล้มเหลว"
[ "$pccode" = "0" ] || exit "$pccode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/card_gate.test.sql
cgcode=$?
[ "$cgcode" = "0" ] && echo "✓ card_gate.test.sql ผ่านทั้งหมด" || echo "✗ card_gate.test.sql ล้มเหลว"
[ "$cgcode" = "0" ] || exit "$cgcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/customer_deleted_guard.test.sql
cdgcode=$?
[ "$cdgcode" = "0" ] && echo "✓ customer_deleted_guard.test.sql ผ่านทั้งหมด" || echo "✗ customer_deleted_guard.test.sql ล้มเหลว"
[ "$cdgcode" = "0" ] || exit "$cdgcode"

# W-4 (ด่านลูกค้า FOR KEY SHARE): ทดสอบด้วยสองเซสชันจริง · ข้อมูลต้อง commit ให้เซสชันอื่นเห็น (ฐานทดสอบถูกทิ้งเมื่อจบ)
"${PSQL[@]}" -d "$DB" -c "insert into public.punpang_customers (id, name, data) values ('cdg_lock', 'ลูกค้าทดสอบล็อก', '{}')" >/dev/null || { echo "✗ เตรียมลูกค้าทดสอบ W-4 ไม่ได้"; exit 1; }
# รอจนเซสชันที่ถือล็อกเข้าสู่ pg_sleep แล้ว (ตอนนั้นล็อกได้ถูกถือไว้แล้วอย่างแน่นอน)
w4_wait_hold() {
  local n
  for _ in $(seq 1 50); do
    n=$("${PSQL[@]}" -d "$DB" -tA -c "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event = 'PgSleep'")
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 0.2
  done
  return 1
}
# (ก) การแก้ข้อมูลลูกค้า (NO KEY UPDATE) ต้องไม่รอออร์เดอร์ที่กำลังแทรก เพราะ FOR KEY SHARE ไม่ชนกับ NO KEY UPDATE
"${PSQL[@]}" -d "$DB" -c "begin; insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('cdg_lock_o1', 'OR-CDG-L1', 'cdg_lock', 'pos_pending', 'pickup', 'pos', '{\"items\":[{\"unitPrice\":100,\"qty\":1}],\"payments\":[]}'); select pg_sleep(4); rollback;" >/dev/null 2>&1 &
hold=$!
w4_wait_hold || { echo "✗ W-4: เซสชันทดสอบไม่ได้ถือล็อกของการแทรก"; wait "$hold"; exit 1; }
"${PSQL[@]}" -d "$DB" -c "set lock_timeout = '1s'; update public.punpang_customers set name = 'ลูกค้าทดสอบล็อก (แก้)' where id = 'cdg_lock'" >/dev/null 2>&1
upd=$?
wait "$hold"
[ "$upd" = "0" ] && echo "✓ W-4: การแก้ข้อมูลลูกค้าไม่รอออร์เดอร์ที่กำลังแทรก" || { echo "✗ W-4: การแก้ข้อมูลลูกค้ารอหรือถูกล็อกเกิน 1 วินาที"; exit 1; }
# (ข) การลบ (FOR UPDATE ของ purge) ต้องยังกันการแทรกออร์เดอร์ระหว่างลบได้เหมือนเดิม
"${PSQL[@]}" -d "$DB" -c "begin; select 1 from public.punpang_customers where id = 'cdg_lock' for update; select pg_sleep(4); rollback;" >/dev/null 2>&1 &
hold=$!
w4_wait_hold || { echo "✗ W-4: เซสชันทดสอบไม่ได้ถือล็อกของการลบ"; wait "$hold"; exit 1; }
blockerr=$("${PSQL[@]}" -d "$DB" -c "set lock_timeout = '1s'; insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('cdg_lock_o2', 'OR-CDG-L2', 'cdg_lock', 'pos_pending', 'pickup', 'pos', '{\"items\":[{\"unitPrice\":100,\"qty\":1}],\"payments\":[]}')" 2>&1 >/dev/null)
blockcode=$?
wait "$hold"
[ "$blockcode" != "0" ] && echo "$blockerr" | grep -qi "lock" && echo "✓ W-4: การลบยังกันการแทรกออร์เดอร์ได้" || { echo "✗ W-4: การแทรกออร์เดอร์ไม่ถูกกันระหว่างการลบ"; exit 1; }

"${PSQL[@]}" -d "$DB" -f supabase/tests/sync_review.test.sql
srcode=$?
[ "$srcode" = "0" ] && echo "✓ sync_review.test.sql ผ่านทั้งหมด" || echo "✗ sync_review.test.sql ล้มเหลว"
[ "$srcode" = "0" ] || exit "$srcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/review_resend.test.sql
rscode=$?
[ "$rscode" = "0" ] && echo "✓ review_resend.test.sql ผ่านทั้งหมด" || echo "✗ review_resend.test.sql ล้มเหลว"
[ "$rscode" = "0" ] || exit "$rscode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/points_vat.test.sql
pvcode=$?
[ "$pvcode" = "0" ] && echo "✓ points_vat.test.sql ผ่านทั้งหมด" || echo "✗ points_vat.test.sql ล้มเหลว"
[ "$pvcode" = "0" ] || exit "$pvcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/member_levels.test.sql
mlcode=$?
[ "$mlcode" = "0" ] && echo "✓ member_levels.test.sql ผ่านทั้งหมด" || echo "✗ member_levels.test.sql ล้มเหลว"
[ "$mlcode" = "0" ] || exit "$mlcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/member_benefits.test.sql
mbcode=$?
[ "$mbcode" = "0" ] && echo "✓ member_benefits.test.sql ผ่านทั้งหมด" || echo "✗ member_benefits.test.sql ล้มเหลว"
[ "$mbcode" = "0" ] || exit "$mbcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/birthday_pos.test.sql
bpcode=$?
[ "$bpcode" = "0" ] && echo "✓ birthday_pos.test.sql ผ่านทั้งหมด" || echo "✗ birthday_pos.test.sql ล้มเหลว"
[ "$bpcode" = "0" ] || exit "$bpcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/member_staff.test.sql
msfcode=$?
[ "$msfcode" = "0" ] && echo "✓ member_staff.test.sql ผ่านทั้งหมด" || echo "✗ member_staff.test.sql ล้มเหลว"
[ "$msfcode" = "0" ] || exit "$msfcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/no_points.test.sql
npcode2=0
"${PSQL[@]}" -d "$DB" -f supabase/tests/consign_rounds.test.sql
npcode2=$?
[ "$npcode2" = "0" ] && echo "✓ consign_rounds.test.sql ผ่านทั้งหมด" || echo "✗ consign_rounds.test.sql ล้มเหลว"
[ "$npcode2" = "0" ] || exit "$npcode2"
npcode=$?
[ "$npcode" = "0" ] && echo "✓ no_points.test.sql ผ่านทั้งหมด" || echo "✗ no_points.test.sql ล้มเหลว"
[ "$npcode" = "0" ] || exit "$npcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/hold_money.test.sql
hmcode=$?
[ "$hmcode" = "0" ] && echo "✓ hold_money.test.sql ผ่านทั้งหมด" || echo "✗ hold_money.test.sql ล้มเหลว"
[ "$hmcode" = "0" ] || exit "$hmcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_core.test.sql
pccode=$?
[ "$pccode" = "0" ] && echo "✓ preorder_core.test.sql ผ่านทั้งหมด" || echo "✗ preorder_core.test.sql ล้มเหลว"
[ "$pccode" = "0" ] || exit "$pccode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_guard.test.sql
pgcode=$?
[ "$pgcode" = "0" ] && echo "✓ preorder_guard.test.sql ผ่านทั้งหมด" || echo "✗ preorder_guard.test.sql ล้มเหลว"
[ "$pgcode" = "0" ] || exit "$pgcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_otp.test.sql
otpcode=$?
[ "$otpcode" = "0" ] && echo "✓ preorder_otp.test.sql ผ่านทั้งหมด" || echo "✗ preorder_otp.test.sql ล้มเหลว"
[ "$otpcode" = "0" ] || exit "$otpcode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_sessions.test.sql
sescode=$?
[ "$sescode" = "0" ] && echo "✓ preorder_sessions.test.sql ผ่านทั้งหมด" || echo "✗ preorder_sessions.test.sql ล้มเหลว"
[ "$sescode" = "0" ] || exit "$sescode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_points.test.sql
ptscode=$?
[ "$ptscode" = "0" ] && echo "✓ preorder_points.test.sql ผ่านทั้งหมด" || echo "✗ preorder_points.test.sql ล้มเหลว"
[ "$ptscode" = "0" ] || exit "$ptscode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_quota.test.sql
pqcode=$?
[ "$pqcode" = "0" ] && echo "✓ preorder_quota.test.sql ผ่านทั้งหมด" || echo "✗ preorder_quota.test.sql ล้มเหลว"
[ "$pqcode" = "0" ] || exit "$pqcode"

# W-5: จองพร้อมกันสองเซสชัน — เซสชันแรกถือล็อกแคมเปญ เซสชันที่สองต้องหมดเวลา และตัวนับต้องเท่าเพดาน (ไม่เกิน)
"${PSQL[@]}" -d "$DB" -c "insert into public.punpang_items (id, kind, name, price, active) values ('A', 'retail', 'A', 10, true) on conflict do nothing; insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data) values ('pqc', 'open', '2000-01-01', '2099-12-31', '2026-12-24', '2026-12-26', 50, 120, '{\"items\":[{\"retailId\":\"A\",\"dayCap\":2}]}')" >/dev/null
( psql -X -q -d "$DB" -c "select public.punpang_preorder_reserve('pqc', '2026-12-24', '[{\"itemId\":\"A\",\"qty\":2}]'::jsonb); select pg_sleep(3);" > /tmp/w5_first.out 2>&1 ) &
sleep 1
psql -X -q -d "$DB" -c "set lock_timeout = '500ms'; select public.punpang_preorder_reserve('pqc', '2026-12-24', '[{\"itemId\":\"A\",\"qty\":2}]'::jsonb);" > /tmp/w5_second.out 2>&1
wait
w5_reserved=$(psql -X -q -tA -d "$DB" -c "select reserved from public.punpang_preorder_slots where campaign_id = 'pqc' and item_id = 'A'")
if grep -q 'lock timeout' /tmp/w5_second.out && [ "$w5_reserved" = "2" ]; then
  echo "✓ W-5: จองพร้อมกันไม่เกินเพดาน (เซสชันที่สองถูกกั้นด้วยล็อก)"
else
  echo "✗ W-5: ตัวนับ=$w5_reserved (ควรเป็น 2) ผลเซสชันที่สอง:"; cat /tmp/w5_second.out; exit 1
fi

"${PSQL[@]}" -d "$DB" -f supabase/tests/preorder_number.test.sql
pncode=$?
[ "$pncode" = "0" ] && echo "✓ preorder_number.test.sql ผ่านทั้งหมด" || echo "✗ preorder_number.test.sql ล้มเหลว"
[ "$pncode" = "0" ] || exit "$pncode"

"${PSQL[@]}" -d "$DB" -f supabase/tests/mirror.test.sql
mcode=$?
[ "$mcode" = "0" ] && echo "✓ mirror.test.sql ผ่านทั้งหมด" || echo "✗ mirror.test.sql ล้มเหลว"
exit "$mcode"
