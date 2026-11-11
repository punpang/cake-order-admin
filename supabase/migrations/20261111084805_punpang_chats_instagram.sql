-- แชท Instagram (ผ่านบัญชี IG Business/Creator ที่ผูกกับเพจ Facebook เดียวกัน) · เพิ่มค่า channel 'instagram'
-- external_id = IGSID ของผู้ใช้ IG · ค่า line/facebook คงเดิม
alter table public.punpang_chats drop constraint if exists punpang_chats_channel_check;
alter table public.punpang_chats add constraint punpang_chats_channel_check check (channel = any (array['line'::text, 'facebook'::text, 'instagram'::text]));
