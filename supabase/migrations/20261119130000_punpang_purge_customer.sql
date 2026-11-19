-- ลบข้อมูลลูกค้าตามคำขอ (PDPA) ที่ฐานข้อมูล ให้ลบครบไม่ว่าเครื่องแอดมินจะโหลดข้อมูลไว้แค่ไหน
-- เดิมลบในเครื่องแล้วซิงก์กลับ → พลาดออร์เดอร์ที่ส่งมอบแล้ว (ไม่ได้โหลด) แชทเก่า และตารางฝั่งเซิร์ฟเวอร์ (PIN/เซสชัน/OTP/LINE)
-- เก็บไว้: ออร์เดอร์ รายการ ยอดเงินและการชำระ (ตัดรายละเอียดส่วนตัว) ผูกกับ "ลูกค้าที่ลบแล้ว" · บันทึกความยินยอม (consents) เป็นหลักฐาน
-- ไฟล์ในที่เก็บ (สลิป/รูป) แอปลบต่อหลังฟังก์ชันนี้สำเร็จ (อ่านรายการไฟล์จากออร์เดอร์ก่อนเรียก)

-- ตัดข้อมูลส่วนตัวในออร์เดอร์ (เหมือน scrubCustomer ในแอป) · text_groups = กลุ่มตัวเลือกแบบข้อความ (ข้อความบนเค้ก)
create or replace function public.punpang__scrub_order_data(d jsonb, text_groups text[])
returns jsonb language sql immutable set search_path to '' as $$
  select d
    || jsonb_build_object('birthday', null, 'address', '', 'chatId', null, 'placeName', '', 'mapUrl', '', 'detail', '')
    || jsonb_build_object('items', coalesce((
      select jsonb_agg(
        (it || jsonb_build_object('workPhotos', '[]'::jsonb, 'note', '', 'images', '[]'::jsonb))
        || case when jsonb_typeof(it->'selections') = 'object' then jsonb_build_object('selections', (it->'selections') - text_groups) else '{}'::jsonb end
        || case when jsonb_typeof(it->'tiers') = 'array' then jsonb_build_object('tiers', coalesce((
             select jsonb_agg(case when jsonb_typeof(t->'selections') = 'object' then t || jsonb_build_object('selections', (t->'selections') - text_groups) else t end order by tn)
             from jsonb_array_elements(it->'tiers') with ordinality as tt(t, tn)), '[]'::jsonb)) else '{}'::jsonb end
        order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) with ordinality as x(it, n)), '[]'::jsonb))
    || jsonb_build_object('payments', coalesce((
      select jsonb_agg(p || jsonb_build_object('slip', '', 'note', '') order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'payments') = 'array' then d->'payments' else '[]'::jsonb end) with ordinality as y(p, n)), '[]'::jsonb))
    || case when jsonb_typeof(d->'cancel') = 'object' then jsonb_build_object('cancel', (d->'cancel') || '{"refundNote": ""}'::jsonb) else '{}'::jsonb end
$$;
revoke all on function public.punpang__scrub_order_data(jsonb, text[]) from public, anon, authenticated;

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

  select coalesce(array_agg(o.id), '{}') into v_orders from public.punpang_orders o where o.customer_id = p_customer;
  select coalesce(array_agg(c.id), '{}') into v_chats from public.punpang_chats c where c.customer_id = p_customer;
  v_addrs := array_remove(array[nullif(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), ''), nullif(cu.data->>'fbPsid', '')], null);
  select coalesce(array_agg(l.line_user_id), '{}') into v_lines from public.punpang_line_users l where l.customer_id = p_customer;

  -- ออร์เดอร์: เก็บยอดเงิน ตัดรายละเอียดส่วนตัว
  update public.punpang_orders o set data = public.punpang__scrub_order_data(o.data, coalesce(p_text_groups, '{}'))
  where o.customer_id = p_customer;
  get diagnostics n_orders = row_count;
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

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีฟังก์ชันใหม่ด้วย (ดู supabase/tests/mirror.test.sql ข้อ A6)
select punpang_test.punpang_test_sync();
