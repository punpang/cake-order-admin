-- รอบตรวจฟังก์ชัน SECURITY DEFINER (หลังเปิด repo เป็นสาธารณะ) · ความเสี่ยงต่ำทั้งหมด ปิดช่องที่เหลือ
-- 1) punpang_record_pageview: ผู้ไม่ล็อกอินเรียกได้ (ตั้งใจ) → จำกัดยอดต่อวัน ไม่ให้ปั่นตัวเลขได้ไม่จำกัด
-- 2) punpang_click_pairs: แอปไม่เรียกแล้ว → ตัดสิทธิ์ผู้ที่ล็อกอิน (anon ตัดไปแล้วใน 20261117033616)
-- 3) punpang__coupon_entry_ok / punpang__quote_check: trigger ของออร์เดอร์ (SECURITY INVOKER) เรียกด้วยสิทธิ์พนักงาน จึงตัดสิทธิ์ทิ้งไม่ได้
--    → บัญชีที่ล็อกอินแต่ไม่ใช่พนักงาน = ปฏิเสธ · Edge Function (service_role) และงานในฐานข้อมูลไม่มี uid จึงทำงานเหมือนเดิม
-- 4) punpang_set_status: ตรวจว่าเป็นพนักงานก่อนล็อกแถวออร์เดอร์ (เดิมล็อกแถว/บอกว่ามีออร์เดอร์ไหม ก่อนตรวจสิทธิ์)
-- เพิ่มบรรทัดตรวจต่อจาก begin แรกของตัวฟังก์ชัน (ไม่คัดลอกตัวฟังก์ชันซ้ำ) · หาตำแหน่งไม่เจอ = ล้มทั้ง migration

create or replace function public.punpang_record_pageview(p_day text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  today_ text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
begin
  if p_day is null or p_day !~ '^\d{4}-\d{2}-\d{2}$' then
    return;
  end if;
  -- เพดาน 100,000 ครั้งต่อวัน (ร้านจริงไม่ถึง) · ถึงเพดานแล้วหยุดนับ
  insert into public.punpang_kv (collection, id, data)
  values ('pageViews', today_, jsonb_build_object('n', 1))
  on conflict (collection, id) do update
    set data = jsonb_build_object('n', least(coalesce((public.punpang_kv.data->>'n')::integer, 0) + 1, 100000));
end;
$$;

revoke execute on function public.punpang_click_pairs() from public, anon, authenticated;

do $$
declare
  guard_bool constant text := E'\n  if (select auth.uid()) is not null and not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then return false; end if;';
  guard_text constant text := E'\n  if (select auth.uid()) is not null and not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then return ''forbidden''; end if;';
  guard_raise constant text := E'\n  if not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then raise exception ''no permission'' using errcode = ''42501''; end if;';
  f record;
  d text;
  n text;
begin
  for f in
    select * from (values
      ('public.punpang__coupon_entry_ok(text,text,text,jsonb,jsonb)', guard_bool),
      ('public.punpang__quote_check(text,text,text,jsonb,jsonb,numeric)', guard_text),
      ('public.punpang_set_status(text,text)', guard_raise)
    ) v(fn, guard)
  loop
    d := pg_get_functiondef(f.fn::regprocedure);
    if position('public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then' in d) > 0 then continue; end if; -- รันซ้ำได้
    n := regexp_replace(d, E'\nbegin\n', E'\nbegin' || f.guard || E'\n');
    if n = d then raise exception 'definer hardening: หา begin ของ % ไม่เจอ', f.fn; end if;
    execute n;
  end loop;
end $$;

select punpang_test.punpang_test_sync();
-- test_sync สร้างฟังก์ชันในโหมดทดสอบใหม่ด้วยสิทธิ์เริ่มต้น → ตัดสิทธิ์ตัวเดียวกันในโหมดทดสอบด้วย
revoke execute on function punpang_test.punpang_click_pairs() from public, anon, authenticated;
