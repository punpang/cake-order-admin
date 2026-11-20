-- บันทึกข้อผิดพลาดของแอปพนักงาน (ติดตามปัญหาหลังเปิดใช้จริง) · เก็บในฐานข้อมูลของร้านเอง ไม่ส่งข้อมูลออกนอกระบบ
-- เขียน: เฉพาะพนักงานที่ active ผ่าน punpang_log_error (รวมข้อผิดพลาดซ้ำ · เพดาน 200 รายการใหม่ต่อชั่วโมง · ตัดตัวเลขยาว ๆ เช่นเบอร์โทร)
-- อ่าน/ลบ: เฉพาะผู้จัดการ (manage) · เก็บ 30 วัน (ลบของเก่าทุกครั้งที่มีรายการใหม่)

create table if not exists public.punpang_error_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  n integer not null default 1,
  sig text not null,
  staff_id uuid,
  message text not null,
  stack text,
  url text,
  ua text,
  build text
);
create index if not exists punpang_error_log_last_idx on public.punpang_error_log (last_at desc);
create index if not exists punpang_error_log_sig_idx on public.punpang_error_log (sig, last_at desc);

alter table public.punpang_error_log enable row level security;
revoke all on public.punpang_error_log from public, anon, authenticated;
grant select, delete on public.punpang_error_log to authenticated;
drop policy if exists err_read on public.punpang_error_log;
create policy err_read on public.punpang_error_log for select to authenticated using ((select public.punpang_has_perm('manage')));
drop policy if exists err_del on public.punpang_error_log;
create policy err_del on public.punpang_error_log for delete to authenticated using ((select public.punpang_has_perm('manage')));

create or replace function public.punpang_log_error(p_message text, p_stack text, p_url text, p_ua text, p_build text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  clean text := '\d{9,}';
  m text;
  st text;
  sg text;
begin
  if uid is null or not exists (select 1 from public.punpang_staff s where s.user_id = uid and s.active) then return; end if;
  m := left(btrim(regexp_replace(coalesce(p_message, ''), clean, '[ตัวเลข]', 'g')), 500);
  if m = '' then return; end if;
  st := left(regexp_replace(coalesce(p_stack, ''), clean, '[ตัวเลข]', 'g'), 4000);
  sg := md5(m || '|' || left(st, 300));
  -- ข้อผิดพลาดเดียวกันภายใน 24 ชั่วโมง = นับรวม
  update public.punpang_error_log set n = n + 1, last_at = now() where sig = sg and last_at > now() - interval '24 hours';
  if found then return; end if;
  if (select count(*) from public.punpang_error_log where at > now() - interval '1 hour') >= 200 then return; end if;
  insert into public.punpang_error_log (sig, staff_id, message, stack, url, ua, build)
  values (sg, uid, m, nullif(st, ''), left(regexp_replace(coalesce(p_url, ''), clean, '[ตัวเลข]', 'g'), 300), left(coalesce(p_ua, ''), 200), left(coalesce(p_build, ''), 40));
  delete from public.punpang_error_log where last_at < now() - interval '30 days';
end $$;
revoke execute on function public.punpang_log_error(text, text, text, text, text) from public, anon;
grant execute on function public.punpang_log_error(text, text, text, text, text) to authenticated;

-- โหมดทดสอบ: ตารางนี้เป็นข้อมูลร่วม (view อ่านอย่างเดียว) · แอปไม่ส่งข้อผิดพลาดตอนอยู่โหมดทดสอบ
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_error_log''' in d) > 0 then return; end if;
  n := replace(d, '''tungngern_transfers''];', '''tungngern_transfers'', ''punpang_error_log''];');
  if n = d then raise exception 'error log: หารายการตารางข้อมูลร่วมใน punpang_test_sync ไม่เจอ'; end if;
  execute n;
end $$;

select punpang_test.punpang_test_sync();
revoke execute on function punpang_test.punpang_click_pairs() from public, anon, authenticated;
