-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108032828) · เนื้อตรงกับที่รันจริง

create table if not exists public.punpang_cake_clicks (
  v text not null check (char_length(v) between 8 and 64),
  photo_id text not null check (photo_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  at timestamptz not null default now(),
  primary key (v, photo_id)
);
create index if not exists punpang_cake_clicks_at_idx on public.punpang_cake_clicks (at desc);
alter table public.punpang_cake_clicks enable row level security;
-- ไม่มี policy: อ่าน/เขียนผ่าน RPC ด้านล่างเท่านั้น

create or replace function public.punpang_record_click(p_photo text, p_visitor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_photo is null or p_visitor is null or p_photo !~ '^[A-Za-z0-9_-]{1,64}$' or char_length(p_visitor) not between 8 and 64 then return; end if;
  -- กันถูกยิงถล่ม: ผู้เยี่ยมชมหนึ่งคนไม่เกิน 300 รูป · ทั้งระบบไม่เกิน 50,000 แถว
  if (select count(*) from public.punpang_cake_clicks where v = p_visitor) >= 300 then return; end if;
  if (select count(*) from public.punpang_cake_clicks) >= 50000 then return; end if;
  insert into public.punpang_cake_clicks (v, photo_id) values (p_visitor, p_photo) on conflict do nothing;
end $$;

-- คืนคู่ (ผู้เยี่ยมชมแบบแฮช, รูป) 5,000 แถวล่าสุด สำหรับคำนวณรูปแนะนำ — ไม่เปิดรหัสผู้เยี่ยมชมจริง
create or replace function public.punpang_click_pairs()
returns table (v text, photo_id text) language sql stable security definer set search_path = '' as $$
  select md5(c.v), c.photo_id from public.punpang_cake_clicks c order by c.at desc limit 5000
$$;

revoke all on function public.punpang_record_click(text, text) from public;
revoke all on function public.punpang_click_pairs() from public;
grant execute on function public.punpang_record_click(text, text) to anon, authenticated;
grant execute on function public.punpang_click_pairs() to anon, authenticated;
