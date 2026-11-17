-- บันทึกทุกคำขอที่ผ่านลายเซ็นจากแอปส่งต่อ (แอป · ข้อความ · ผ่าน/ไม่ผ่าน · เหตุผล) สำหรับรายงานแอปที่ส่งเข้ามา
-- อ่านได้เฉพาะพนักงานที่มีสิทธิ์ pos · เขียนโดย Edge Function manee-receiver (service role) เท่านั้น
create table if not exists public.manee_inbox (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  app text not null default '',
  app_name text not null default '',
  event text not null default '',
  text text not null default '',
  stored boolean not null default false,
  reason text not null default ''
);
alter table public.manee_inbox enable row level security;
create policy manee_inbox_pos_read on public.manee_inbox for select to authenticated using (public.punpang_has_perm('pos'));
create index if not exists manee_inbox_app_idx on public.manee_inbox (app, received_at desc);
