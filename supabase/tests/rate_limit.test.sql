-- ทดสอบการจำกัดอัตราของ RPC สาธารณะที่เขียนข้อมูล (B7): ต่อ IP ต่อนาที · IP อื่นไม่ได้รับผลกระทบ · ไม่มี IP ใช้ถังรวม · ข้อมูลไม่ถูกต้องไม่กินโควตา · แยกโควตาระหว่าง click กับ pageview · ใช้ cf-connecting-ip (x-forwarded-for ที่ผู้เรียกใส่เองไม่มีผล)
-- รันโดย run.sh หลัง security.test.sql (ใช้ test.as_anon) · ทั้งหมดอยู่ในธุรกรรมเดียวเพื่อให้ now() คงที่ตลอดการทดสอบ (ไม่ข้ามนาที) และยกเลิกเมื่อจบ
-- แต่ละข้อใช้ rl.ok(ชื่อ, เงื่อนไข) · เงื่อนไขไม่เป็นจริง = ล้มทันที

begin;

create schema rl;

create function rl.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- ค่านับ pageview ของ "วันนี้" (ตามเวลาไทย): ฟังก์ชันจริงนับเข้าวันปัจจุบันเสมอ ไม่ใช้ p_day ที่ส่งมา
create function rl.today() returns text language sql stable as $$
  select to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD')
$$;

create function rl.pv_n() returns integer language sql as $$
  select (data->>'n')::int from public.punpang_kv where collection = 'pageViews' and id = rl.today()
$$;

-- ล้างตัวนับที่ security.test.sql ทิ้งไว้ในวันเดียวกันก่อนเริ่ม (ธุรกรรมนี้จะถูกยกเลิกเมื่อจบ จึงไม่กระทบข้อมูลอื่น)
delete from public.punpang_kv where collection = 'rateLimit';
delete from public.punpang_kv where collection = 'pageViews' and id = rl.today();

-- ชื่อแถวตัวนับของ IP หนึ่ง (ต้องตรงกับฟังก์ชันจริง: แฮช sha256 ของ IP หรือ 'noip')
create function rl.bucket(fn text, who text) returns text language sql as $$
  select 'rl:' || fn || ':' || encode(sha256(convert_to(who, 'UTF8')), 'hex')
$$;

create function rl.hits(fn text, who text) returns integer language sql as $$
  select (data->>'n')::int from public.punpang_kv where collection = 'rateLimit' and id = rl.bucket(fn, who)
$$;

-- R1 IP เดียวกันเรียกได้ 60 ครั้งต่อนาที ครั้งที่ 61 ถูกเงียบ (จำนวนนับหยุดที่ 60)
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.7"}', true);
do $$
begin
  for i in 1..61 loop
    perform test.as_anon($q$ select public.punpang_record_pageview('2026-03-14') $q$);
  end loop;
end $$;
select rl.ok('R1 IP เดียวกันเรียกได้ 60 ครั้งต่อนาที (ครั้งที่ 61 ถูกเงียบ)', rl.pv_n() = 60);
-- ตัวนับของ IP นับความพยายามทั้งหมดในนาทีนั้น (รวมครั้งที่ถูกเงียบ) แต่จำนวนนับ pageview หยุดที่ 60
select rl.ok('R1 ตัวนับของ IP นับความพยายามทั้งหมด (61) ส่วนจำนวน pageview หยุดที่ 60', rl.hits('pageview', '198.51.100.7') = 61 and rl.pv_n() = 60);

-- R2 IP อื่นยังเรียกได้ตามปกติ
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.8"}', true);
select test.as_anon($q$ select public.punpang_record_pageview('2026-03-14') $q$);
select rl.ok('R2 IP อื่นไม่ถูกกระทบ (จำนวนนับเป็น 61)', rl.pv_n() = 61);

-- R3 IP แรกยังถูกจำกัดต่อ (ยังไม่เพิ่มจำนวนนับ)
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.7"}', true);
select test.as_anon($q$ select public.punpang_record_pageview('2026-03-14') $q$);
select rl.ok('R3 IP ที่เต็มโควตาแล้วยังไม่เพิ่มจำนวนนับ', rl.pv_n() = 61);

-- R4 x-forwarded-for ที่ผู้เรียกใส่เองไม่มีผล: ใช้เฉพาะ cf-connecting-ip (ตัวนับของ 10.0.0.1 ต้องไม่เกิด)
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.1","cf-connecting-ip":"198.51.100.8"}', true);
select test.as_anon($q$ select public.punpang_record_pageview('2026-03-14') $q$);
select rl.ok('R4 ใช้ cf-connecting-ip และไม่นับ x-forwarded-for', rl.hits('pageview', '198.51.100.8') = 2 and rl.hits('pageview', '10.0.0.1') is null and rl.pv_n() = 62);

-- R5 ไม่มี IP ในคำขอ: ใช้ถังรวม noip (x-forwarded-for อย่างเดียวไม่นับเป็น IP)
select set_config('request.headers', '', true);
select test.as_anon($q$ select public.punpang_record_pageview('2026-03-14') $q$);
select rl.ok('R5 ไม่มี IP ใช้ถังรวม noip', rl.hits('pageview', 'noip') = 1 and rl.pv_n() = 63);

-- R6 ข้อมูลไม่ถูกต้องไม่กินโควตา (ไม่สร้างตัวนับ และไม่เพิ่มจำนวนนับ)
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.9"}', true);
do $$
begin
  for i in 1..60 loop
    perform test.as_anon($q$ select public.punpang_record_pageview('not-a-date') $q$);
  end loop;
end $$;
select rl.ok('R6 การเรียกที่ข้อมูลไม่ถูกต้องไม่สร้างตัวนับ', rl.hits('pageview', '198.51.100.9') is null and rl.pv_n() = 63);
select test.as_anon($q$ select public.punpang_record_pageview('2026-03-14') $q$);
select rl.ok('R6 หลังข้อมูลไม่ถูกต้อง การเรียกที่ถูกต้องยังนับได้เต็มโควตา', rl.hits('pageview', '198.51.100.9') = 1 and rl.pv_n() = 64);

-- R7 click มีโควตาแยกจาก pageview: IP เดิม (เต็มโควตา pageview แล้ว) ยังบันทึก click ได้ 60 รายการ
-- security.test.sql เติมตารางคลิกถึง 50,000 แถวไว้ (เพดานทั้งระบบ) จึงล้างตารางและวิเคราะห์สถิติใหม่ก่อน (ยกเลิกเมื่อจบธุรกรรม)
delete from public.punpang_cake_clicks;
analyze public.punpang_cake_clicks;
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.7"}', true);
do $$
begin
  for i in 1..61 loop
    perform test.as_anon(format($q$ select public.punpang_record_click('rl%s', 'visitor_rl_01') $q$, i));
  end loop;
end $$;
select rl.ok('R7 click บันทึกได้ 60 รายการต่อนาทีต่อ IP แม้ pageview เต็มโควตาแล้ว', (select count(*) from public.punpang_cake_clicks where v = 'visitor_rl_01') = 60);

rollback;
