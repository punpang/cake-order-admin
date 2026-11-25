-- สั่งล่วงหน้า เฟส 2C: ตารางเซสชันสั่งล่วงหน้า (แยกจากเซสชันลูกค้า) และการลบข้อมูลลูกค้ารวมออร์เดอร์/เซสชันสั่งล่วงหน้า
-- นิยาม punpang_purge_customer คัดลอกจาก 20261119130000 และเพิ่มด่านของสั่งล่วงหน้า (ออร์เดอร์ค้าง/ยอดค้างกั้น · ปกปิดออร์เดอร์ · ลบเซสชัน)

create table if not exists public.punpang_preorder_sessions (
  token_hash text primary key,
  customer_id text not null references public.punpang_customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists punpang_preorder_sessions_customer_idx on public.punpang_preorder_sessions (customer_id);

-- เซสชันไม่มี policy: บทบาทแอปและ anon อ่าน/เขียนไม่ได้ · เฉพาะ service_role (Edge Function) ออก อ่าน และลบได้
alter table public.punpang_preorder_sessions enable row level security;
revoke all on public.punpang_preorder_sessions from public, anon, authenticated;
grant select, insert, delete on public.punpang_preorder_sessions to service_role;

create or replace function public.punpang_purge_customer(p_customer text, p_text_groups text[] default '{}')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  cu public.punpang_customers%rowtype;
  v_orders text[];
  v_chats text[];
  v_addrs text[];
  v_lines text[];
  n_orders int := 0; n_chats int := 0; n_quotes int := 0; n_records int := 0; n_auth int := 0; n_line int := 0; k int;
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'เฉพาะแอดมิน' using errcode = '42501';
  end if;
  select * into cu from public.punpang_customers where id = p_customer for update;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  if coalesce((cu.data->>'deleted')::boolean, false) then return jsonb_build_object('ok', true, 'already', true); end if;
  -- ด่านเดียวกับแอป: ออร์เดอร์ยังไม่จบ / ยอดค้างชำระ
  if exists (select 1 from public.punpang_orders o where o.customer_id = p_customer and o.status not in ('cancelled', 'delivered')) then
    return jsonb_build_object('error', 'open_orders');
  end if;
  if exists (select 1 from public.punpang_orders o where o.customer_id = p_customer and o.status <> 'cancelled' and coalesce(o.balance, 0) > 0) then
    return jsonb_build_object('error', 'balance_due');
  end if;
  -- สั่งล่วงหน้า: ออร์เดอร์ที่ยังไม่จบ/ยอดค้างกั้นการลบเหมือนออร์เดอร์ปกติ
  if exists (select 1 from public.punpang_preorder_orders p where p.customer_id = p_customer and p.status not in ('cancelled', 'delivered')) then
    return jsonb_build_object('error', 'open_orders');
  end if;
  if exists (select 1 from public.punpang_preorder_orders p where p.customer_id = p_customer and p.status <> 'cancelled' and coalesce((p.data->>'balance')::numeric, 0) > 0) then
    return jsonb_build_object('error', 'balance_due');
  end if;

  select coalesce(array_agg(o.id), '{}') into v_orders from public.punpang_orders o where o.customer_id = p_customer;
  select coalesce(array_agg(c.id), '{}') into v_chats from public.punpang_chats c where c.customer_id = p_customer;
  v_addrs := array_remove(array[nullif(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), ''), nullif(cu.data->>'fbPsid', '')], null);
  select coalesce(array_agg(l.line_user_id), '{}') into v_lines from public.punpang_line_users l where l.customer_id = p_customer;

  -- ออร์เดอร์: เก็บยอดเงิน ตัดรายละเอียดส่วนตัว
  update public.punpang_orders o set data = public.punpang__scrub_order_data(o.data, coalesce(p_text_groups, '{}'))
  where o.customer_id = p_customer;
  get diagnostics n_orders = row_count;
  -- สั่งล่วงหน้า: ปกปิดรายละเอียดส่วนตัวในออร์เดอร์เดียวกับออร์เดอร์ปกติ
  update public.punpang_preorder_orders p set data = public.punpang__scrub_order_data(p.data, coalesce(p_text_groups, '{}'))
  where p.customer_id = p_customer;
  update public.punpang_payments p set slip_path = null where p.order_id = any(v_orders) and p.slip_path is not null;

  -- แชท ใบเสนอ และสถานะการพิมพ์/อ่าน
  delete from public.punpang_chat_presence where chat_id = any(v_chats);
  delete from public.punpang_quotes q where q.chat_id = any(v_chats) or q.customer_id = p_customer;
  get diagnostics n_quotes = row_count;
  delete from public.punpang_chats c where c.id = any(v_chats);
  get diagnostics n_chats = row_count;
  delete from public.punpang_chat_topics where customer_id = p_customer;

  -- ข้อมูลรายแถว: คูปอง รีวิว คิวข้อความ ร่างแชท ลิงก์ออร์เดอร์ และ key กันส่งซ้ำ
  delete from public.punpang_records r where
    (r.collection in ('coupons', 'reviews') and r.data->>'customerId' = p_customer)
    or (r.collection = 'outbox' and (r.data->>'orderId' = any(v_orders) or r.data->>'to' = any(v_addrs)))
    or (r.collection = 'chatDrafts' and r.id = any(v_chats))
    or (r.collection = 'orderLinks' and r.data->>'orderId' = any(v_orders))
    or (r.collection = 'birthdayGreeted' and left(r.id, length(p_customer) + 1) = p_customer || '|')
    or (r.collection = 'notifySent' and position('|' || p_customer || '|' in r.id) > 0);
  get diagnostics n_records = row_count;

  -- บัญชีลูกค้า: PIN เซสชัน อุปกรณ์ push และ OTP
  delete from public.punpang_customer_auth where customer_id = p_customer;
  get diagnostics k = row_count; n_auth := n_auth + k;
  delete from public.punpang_customer_sessions where customer_id = p_customer;
  get diagnostics k = row_count; n_auth := n_auth + k;
  delete from public.punpang_customer_push_devices where customer_id = p_customer;
  get diagnostics k = row_count; n_auth := n_auth + k;
  delete from public.punpang_preorder_sessions where customer_id = p_customer;
  get diagnostics k = row_count; n_auth := n_auth + k;
  delete from public.punpang_otps o where o.customer_id = p_customer or regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') = any(v_addrs);
  get diagnostics k = row_count; n_auth := n_auth + k;

  -- LINE ที่ผูกกับลูกค้านี้: ข้อความและโปรไฟล์
  delete from public.punpang_line_messages where line_user_id = any(v_lines);
  delete from public.punpang_line_users where line_user_id = any(v_lines);
  get diagnostics n_line = row_count;

  -- ตัวลูกค้า: ตัดตัวตนและข้อมูลส่วนตัว (รวมข้อมูลใบกำกับภาษีและสถานที่จัดส่ง)
  update public.punpang_customers set
    name = 'ลูกค้าที่ลบแล้ว', phone = '', note = '',
    data = (coalesce(data, '{}'::jsonb) - 'tax' - 'birthday' - 'birthdays' - 'email' - 'address' - 'promoConsentAt')
      || jsonb_build_object('places', '[]'::jsonb, 'fbPsid', '', 'promoOptIn', false, 'active', false, 'deleted', true,
                            'deletedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'ledger', '[]'::jsonb, 'spins', 0)
  where id = p_customer;

  return jsonb_build_object('ok', true, 'orders', n_orders, 'chats', n_chats, 'quotes', n_quotes, 'records', n_records, 'auth', n_auth, 'line', n_line,
                            'orderIds', to_jsonb(v_orders), 'chatIds', to_jsonb(v_chats));
end
$$;
revoke all on function public.punpang_purge_customer(text, text[]) from public, anon;
grant execute on function public.punpang_purge_customer(text, text[]) to authenticated;

-- โหมดทดสอบ: ตารางเซสชันเป็น iso และซิงก์นิยามใหม่
do $$
declare d text; n text; pat text := '''punpang_otp_log''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_preorder_sessions''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'ไม่พบรายการ iso ที่คาดไว้ใน punpang_test_sync (ตรวจ migration โหมดทดสอบ)';
  end if;
  n := replace(d, pat, '''punpang_otp_log'', ''punpang_preorder_sessions''];');
  execute n;
end $$;
select punpang_test.punpang_test_sync();
