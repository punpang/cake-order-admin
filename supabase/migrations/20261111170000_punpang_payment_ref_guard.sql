-- กันเลขอ้างอิงการชำระซ้ำข้ามออร์เดอร์ที่ระดับฐานข้อมูล (แก้ race: สองออร์เดอร์รับเลขเดียวกันพร้อมกันแล้วตรวจไม่เจอทั้งคู่)
-- ตรวจเฉพาะเลขที่เพิ่มใหม่ในการเขียนนั้น · รายการที่ยกเลิกแล้วไม่นับ · payments ที่ไม่ใช่อาร์เรย์ข้ามการตรวจ (ไม่ทำให้บันทึกออร์เดอร์พัง)
-- ล็อกต่อเลขด้วย advisory lock ระดับธุรกรรม · ซ้ำ → SQLSTATE 23505 ข้อความ punpang_duplicate_ref: <เลข>
create or replace function public.punpang_guard_payment_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r text;
  taken boolean;
  new_pays jsonb := case when jsonb_typeof(new.data->'payments') = 'array' then new.data->'payments' else '[]'::jsonb end;
  old_pays jsonb := case when tg_op = 'UPDATE' and jsonb_typeof(old.data->'payments') = 'array' then old.data->'payments' else '[]'::jsonb end;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then
    return new;
  end if;
  for r in
    select distinct upper(regexp_replace(p->>'ref', '[\s-]', '', 'g'))
      from jsonb_array_elements(new_pays) as p
     where coalesce(p->>'status', '') <> 'cancelled'
       and coalesce(p->>'ref', '') <> ''
       and upper(regexp_replace(p->>'ref', '[\s-]', '', 'g')) not in (
         select upper(regexp_replace(q->>'ref', '[\s-]', '', 'g'))
           from jsonb_array_elements(old_pays) as q
          where coalesce(q->>'status', '') <> 'cancelled'
            and coalesce(q->>'ref', '') <> ''
       )
  loop
    perform pg_advisory_xact_lock(hashtextextended('punpang_ref:' || r, 0));
    select exists (
      select 1
        from public.punpang_orders o
        cross join lateral jsonb_array_elements(
               case when jsonb_typeof(o.data->'payments') = 'array' then o.data->'payments' else '[]'::jsonb end) as p
       where o.id <> new.id
         and coalesce(p->>'status', '') <> 'cancelled'
         and upper(regexp_replace(coalesce(p->>'ref', ''), '[\s-]', '', 'g')) = r
    ) into taken;
    if taken then
      raise exception 'punpang_duplicate_ref: %', r using errcode = 'unique_violation';
    end if;
  end loop;
  return new;
end
$$;

revoke all on function public.punpang_guard_payment_ref() from public, anon, authenticated;

drop trigger if exists punpang_orders_payment_ref on public.punpang_orders;
create trigger punpang_orders_payment_ref
  before insert or update on public.punpang_orders
  for each row execute function public.punpang_guard_payment_ref();
