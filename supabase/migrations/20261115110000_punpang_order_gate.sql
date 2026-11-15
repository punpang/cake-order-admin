-- รอบแก้ 2026-11-15 (ด่านตรวจออร์เดอร์เสี่ยงก่อนยืนยันชำระ/ส่งมอบ · ตัวเลือก B) · รันหลัง 20261115100000 และก่อน deploy order-audit ที่ตั้งค่า hold · รันซ้ำได้ปลอดภัย
-- ออร์เดอร์ตรง (ไม่ใช่บิลหน้าร้าน) ที่ผลตรวจล่าสุดมีรายการ high (hold = true) เปลี่ยนสถานะเป็น payment_confirmed / delivered ไม่ได้
-- จนกว่าผู้จัดการ (สิทธิ์ manage) จะตรวจ "หลัง" ผลตรวจล่าสุด (reviewed_at >= checked_at)
-- ไม่บังคับกับคำขอที่ไม่มี JWT (service role / Edge Function) · แอปตรวจล่วงหน้าก่อนเปลี่ยนสถานะ เพื่อไม่ให้การซิงก์ค้างเมื่อถูกปฏิเสธ · ดู docs/security.md

-- ============================================================================
-- 1) ธงบล็อกในผลตรวจ (order-audit เป็นผู้ตั้งจากรายการ high)
-- ============================================================================
alter table public.punpang_order_audits add column if not exists hold boolean not null default false;

-- ============================================================================
-- 2) บันทึกการตรวจโดยผู้จัดการ (เขียนได้ผ่าน RPC punpang_review_order เท่านั้น)
-- ============================================================================
create table if not exists public.punpang_order_reviews (
  id bigint generated always as identity primary key,
  order_id text not null references public.punpang_orders (id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid,
  note text not null default ''
);
create index if not exists punpang_order_reviews_order_idx on public.punpang_order_reviews (order_id, reviewed_at);

alter table public.punpang_order_reviews enable row level security;
revoke all on public.punpang_order_reviews from public, anon, authenticated;
grant select on public.punpang_order_reviews to authenticated;

drop policy if exists order_reviews_read on public.punpang_order_reviews;
create policy order_reviews_read on public.punpang_order_reviews for select to authenticated
  using (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));

-- ============================================================================
-- 3) สถานะด่านของออร์เดอร์ (แอปใช้ตรวจก่อนยืนยันชำระ/ส่งมอบ) · คืน null เมื่อไม่มีผลตรวจหรือไม่มีสิทธิ์ดู
-- ============================================================================
create or replace function public.punpang_order_gate(p_order text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage')
                or public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('deliverPickup')
                or public.punpang_has_perm('deliverShipping')
    then (
      select jsonb_build_object(
        'hold', a.hold,
        'checkedAt', a.checked_at,
        'flags', coalesce(a.flags, '[]'::jsonb),
        'reviewedAt', (select max(r.reviewed_at) from public.punpang_order_reviews r
                        where r.order_id = a.order_id and r.reviewed_at >= a.checked_at))
        from public.punpang_order_audits a
       where a.order_id = p_order)
  end;
$$;
revoke all on function public.punpang_order_gate(text) from public, anon;
grant execute on function public.punpang_order_gate(text) to authenticated;

-- ============================================================================
-- 4) ผู้จัดการตรวจออร์เดอร์ที่มีรายการเสี่ยง (ไม่แก้ตัวออร์เดอร์)
-- ============================================================================
create or replace function public.punpang_review_order(p_order text, p_note text default '')
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  ts timestamptz := now();
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'ต้องเป็นผู้จัดการจึงตรวจได้' using errcode = '42501';
  end if;
  if not exists (select 1 from public.punpang_order_audits a where a.order_id = p_order and a.hold) then
    raise exception 'ไม่มีรายการเสี่ยงที่ต้องตรวจ' using errcode = 'P0002';
  end if;
  insert into public.punpang_order_reviews (order_id, reviewed_at, reviewed_by, note)
  values (p_order, ts, auth.uid(), left(coalesce(p_note, ''), 500));
  return ts;
end $$;
revoke all on function public.punpang_review_order(text, text) from public, anon;
grant execute on function public.punpang_review_order(text, text) to authenticated;

-- ============================================================================
-- 5) ด่านที่ฐานข้อมูล (BEFORE UPDATE): เฉพาะคำขอที่มีผู้ใช้ล็อกอิน · บิลหน้าร้านไม่เข้าเงื่อนไข
-- ============================================================================
create or replace function public.punpang_orders_review_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a_hold boolean;
  a_at timestamptz;
begin
  if (select auth.uid()) is null then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if coalesce(new.status, '') not in ('payment_confirmed', 'delivered') then return new; end if;
  if coalesce(new.channel, '') = 'pos' then return new; end if;

  select a.hold, a.checked_at into a_hold, a_at from public.punpang_order_audits a where a.order_id = new.id;
  if not coalesce(a_hold, false) then return new; end if;
  if exists (select 1 from public.punpang_order_reviews r where r.order_id = new.id and r.reviewed_at >= a_at) then return new; end if;

  raise exception 'ออร์เดอร์นี้มีรายการเสี่ยง ต้องให้ผู้จัดการตรวจก่อน' using errcode = 'P0001', hint = 'ORDER_REVIEW_REQUIRED';
end $$;
revoke all on function public.punpang_orders_review_gate() from public, anon, authenticated;

drop trigger if exists punpang_orders_review_gate on public.punpang_orders;
create trigger punpang_orders_review_gate before update on public.punpang_orders
  for each row execute function public.punpang_orders_review_gate();
