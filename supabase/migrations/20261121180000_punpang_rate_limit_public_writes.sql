-- B7: จำกัดอัตราการเรียก RPC สาธารณะที่เขียนข้อมูล (punpang_record_click · punpang_record_pageview) ต่อ IP ภายในฐานข้อมูล
-- ตัวนับเก็บใน punpang_kv (collection 'rateLimit') เป็นแฮช sha256 ของ IP (ไม่เก็บ IP ดิบ) · หน้าต่างนับเป็นนาที · แถวเก่ากว่า 1 ชั่วโมงถูกล้างเป็นครั้งคราว
-- เกินเพดานแล้วคืนค่าเงียบ ๆ (เหมือนกรณีข้อมูลไม่ถูกต้อง จึงไม่เปิดเผยว่าถูกจำกัด) · ไม่พบ IP ในคำขอ = ใช้ถังรวม 'noip' ที่เพดาน 3,000 ต่อนาที
-- เลือก 60 ต่อนาทีต่อ IP ต่อฟังก์ชัน: ลูกค้าที่เลื่อนดูรูปปกติไม่ถึงเพดาน
-- ฉบับโหมดทดสอบ (punpang_test) ไม่มีสำเนาของ 2 ฟังก์ชันนี้ จึงไม่ต้องแก้ที่นั่น

create or replace function public.punpang__rate_ok(p_fn text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text;
  who text;
  win timestamptz := date_trunc('minute', now());
  lim integer := p_limit;
  n integer;
begin
  ip := nullif(btrim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1)), '');
  if ip is null then
    who := 'noip';
    lim := greatest(p_limit, 3000);
  else
    who := ip;
  end if;
  insert into public.punpang_kv (collection, id, data)
  values ('rateLimit', 'rl:' || p_fn || ':' || encode(sha256(convert_to(who, 'UTF8')), 'hex'), jsonb_build_object('w', win, 'n', 1))
  on conflict (collection, id) do update
    set data = jsonb_build_object(
      'w', win,
      'n', case when (public.punpang_kv.data->>'w')::timestamptz = win then (public.punpang_kv.data->>'n')::integer + 1 else 1 end)
  returning (public.punpang_kv.data->>'n')::integer into n;
  -- ล้างแถวที่หมดอายุแล้วเป็นครั้งคราว (ราว 2% ของการเรียก) เพื่อไม่ให้ตารางโตไม่หยุด
  if random() < 0.02 then
    delete from public.punpang_kv where collection = 'rateLimit' and (data->>'w')::timestamptz < win - interval '1 hour';
  end if;
  return n <= lim;
end
$$;
revoke all on function public.punpang__rate_ok(text, integer) from public, anon, authenticated;

-- punpang_record_pageview: เนื้อเดิมจาก migration 20261120100000 + จำกัดอัตราต่อ IP
create or replace function public.punpang_record_pageview(p_day text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  today_ text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
begin
  if p_day is null or p_day !~ '^\d{4}-\d{2}-\d{2}$' then
    return;
  end if;
  if not public.punpang__rate_ok('pageview', 60) then
    return;
  end if;
  -- เพดาน 100,000 ครั้งต่อวัน (ร้านจริงไม่ถึง) · ถึงเพดานแล้วหยุดนับ
  insert into public.punpang_kv (collection, id, data)
  values ('pageViews', today_, jsonb_build_object('n', 1))
  on conflict (collection, id) do update
    set data = jsonb_build_object('n', least(coalesce((public.punpang_kv.data->>'n')::integer, 0) + 1, 100000));
end;
$$;

-- punpang_record_click: เนื้อเดิมจาก migration 20261115030000 + จำกัดอัตราต่อ IP (หลังตรวจข้อมูลที่ส่งมา)
create or replace function public.punpang_record_click(p_photo text, p_visitor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  est bigint;
  removed bigint;
begin
  if p_photo is null or p_visitor is null or p_photo !~ '^[A-Za-z0-9_-]{1,64}$' or char_length(p_visitor) not between 8 and 64 then
    return;
  end if;
  if not public.punpang__rate_ok('click', 60) then
    return;
  end if;
  -- ผู้เยี่ยมชมหนึ่งคนไม่เกิน 300 รูป
  if (select count(*) from (select 1 from public.punpang_cake_clicks where v = p_visitor limit 300) s) >= 300 then
    return;
  end if;
  -- ทั้งระบบไม่เกิน 50,000 แถว (ค่าประมาณจากสถิติ) · เต็มแล้วลบแถวที่เก่ากว่า 90 วันก่อน แทนการหยุดบันทึกถาวร
  select greatest(c.reltuples::bigint, 0) into est from pg_class c where c.oid = 'public.punpang_cake_clicks'::regclass;
  if est >= 50000 then
    delete from public.punpang_cake_clicks where at < now() - interval '90 days';
    get diagnostics removed = row_count;
    if removed > 0 then
      -- อัปเดตสถิติเฉพาะตอนที่ลบจริง (ไม่วิเคราะห์ตารางทุกครั้งที่คนกดตอนตารางเต็ม)
      analyze public.punpang_cake_clicks;
      select greatest(c.reltuples::bigint, 0) into est from pg_class c where c.oid = 'public.punpang_cake_clicks'::regclass;
    end if;
    if est >= 50000 then
      return;
    end if;
  end if;
  insert into public.punpang_cake_clicks (v, photo_id) values (p_visitor, p_photo) on conflict do nothing;
end $$;

-- ตัวนับเป็นข้อมูลภายในของระบบ: พนักงานที่มี viewAllOrders ไม่ควรอ่านได้ (ผู้จัดการยังอ่านได้ตามเดิม)
-- เนื้อนโยบายเดิมจาก migration 20261107184217 + เพิ่ม 'rateLimit' ในรายการที่ยกเว้น
alter policy kv_staff_read on public.punpang_kv using (
  public.punpang_has_perm('manage')
  or ((collection = any (array['item_costs', 'materials'])) and (public.punpang_has_perm('viewProfit') or public.punpang_has_perm('viewMaterials')))
  or ((collection <> all (array['item_costs', 'materials', 'acct', 'audit', 'rateLimit'])) and public.punpang_has_perm('viewAllOrders'))
);

-- สำเนาโหมดทดสอบให้มีฟังก์ชันตัวนับและฉบับใหม่ของ 2 RPC (รูปแบบเดียวกับ migration 20261121160000)
select punpang_test.punpang_test_sync();
