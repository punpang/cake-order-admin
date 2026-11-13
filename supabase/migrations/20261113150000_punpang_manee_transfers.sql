-- ยอดรับเงินจากแอปแม่มณี (ส่งต่อจาก SMS Gateway → Edge Function manee-receiver)
-- ยังไม่มีผลจนกว่าจะรัน migration นี้ใน SQL Editor และตั้ง secret MANEE_FORWARD_SECRET บน Supabase
-- เข้าถึงได้เฉพาะ service role (Edge Function) · หน้า POS อ่านผ่านฟังก์ชันที่ตรวจสิทธิ์พนักงานเท่านั้น (ยังไม่สร้าง)
create table if not exists public.manee_transfers (
  id uuid primary key,                 -- id ของงานส่งต่อ (กันรับซ้ำ)
  amount numeric(12,2) not null check (amount > 0),
  received_at timestamptz not null,
  app text not null default '',
  text text not null default '',
  created_at timestamptz not null default now()
);
alter table public.manee_transfers enable row level security;
-- ไม่สร้าง policy: anon/authenticated อ่านและเขียนไม่ได้
create index if not exists manee_transfers_received_idx on public.manee_transfers (received_at);
