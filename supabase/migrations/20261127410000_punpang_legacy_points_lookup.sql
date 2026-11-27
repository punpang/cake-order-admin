-- คะแนนเก่าจากระบบเดิม จับคู่ด้วยแฮชของเบอร์โทร (ไม่เก็บเบอร์ดิบ)
-- ตารางไม่มี policy: เข้าถึงได้เฉพาะเจ้าของโปรเจกต์/service role (นำเข้าข้อมูล) · พนักงานค้นหาผ่าน RPC เท่านั้น

create table if not exists public.punpang_legacy_points (
  tel_hash text primary key,
  points numeric not null check (points >= 0),
  imported_at timestamptz not null default now()
);

alter table public.punpang_legacy_points enable row level security;
revoke all on public.punpang_legacy_points from public, anon, authenticated;

-- ค้นหาคะแนนเก่าด้วยแฮชเบอร์ · คืน { points } (ปัดลงเป็นจำนวนเต็ม) หรือ null ถ้าไม่พบ · ต้องมีสิทธิ์ adjustPoints
create or replace function public.punpang_legacy_lookup(p_tel_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_tel_hash is null or p_tel_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  return (select jsonb_build_object('points', floor(points)) from public.punpang_legacy_points where tel_hash = p_tel_hash);
end $$;

revoke all on function public.punpang_legacy_lookup(text) from public, anon;
grant execute on function public.punpang_legacy_lookup(text) to authenticated;
