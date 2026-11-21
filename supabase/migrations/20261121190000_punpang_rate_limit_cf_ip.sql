-- B7 (ต่อ): ใช้ cf-connecting-ip แทนค่าแรกของ x-forwarded-for เป็นตัวระบุ IP ของผู้เรียกในตัวจำกัดอัตรา
-- เหตุผล: x-forwarded-for ค่าแรกผู้เรียกใส่เองได้ (ทดสอบ production แล้ว: ค่าที่ส่งมาเป็นค่าแรกเสมอ)
--   cf-connecting-ip ถูกตั้งที่ขอบ Cloudflare · คำขอที่ผู้เรียกใส่ค่านี้เองถูกปฏิเสธ 403 ที่ขอบ (ทดสอบ production แล้ว)
-- ไม่มี cf-connecting-ip = ใช้ถังรวม 'noip' ที่ 3,000 ต่อนาที (เหมือนเดิม)
-- ตัวนับ/หน้าต่าง/เพดาน/การล้างแถว และฟังก์ชัน RPC สองตัวไม่เปลี่ยน (ใช้ punpang__rate_ok เดิม)

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
  ip := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'cf-connecting-ip', '')), '');
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

-- สำเนาโหมดทดสอบให้รับฉบับใหม่ของฟังก์ชันตัวนับ (รูปแบบเดียวกับ migration 20261121180000)
select punpang_test.punpang_test_sync();
