-- ลบระบบ LINE OA ออกจากฐานข้อมูล (รันบน production แล้วด้วย SQL Editor · ไฟล์นี้บันทึกให้ประวัติ migration ตรงกับฐานข้อมูล)
-- ทุกคำสั่งรันซ้ำได้ และไม่ล้มเมื่อยังไม่มีข้อมูล

-- 1) ค้นออร์เดอร์: ไม่ค้นด้วยรหัส LINE ของลูกค้าแล้ว
create or replace function public.punpang_order_search(q text)
 returns table(id text, code text, customer_id text, status text, fulfillment text, channel text, data jsonb)
 language sql
 stable
 set search_path to 'public'
as $function$
  select o.id, o.code, o.customer_id, o.status, o.fulfillment, o.channel, o.data
  from punpang_orders o
  left join punpang_customers c on c.id = o.customer_id
  where length(trim(coalesce(q, ''))) > 0
    and (
      position(lower(trim(q)) in lower(coalesce(o.code, ''))) > 0
      or position(lower(trim(q)) in lower(coalesce(c.name, ''))) > 0
      or position(lower(trim(q)) in lower(coalesce(c.phone, ''))) > 0
      or position(lower(trim(q)) in lower(o.data::text)) > 0
    )
  order by o.code, o.id;
$function$;

-- 2) ข้อความแจ้งเตือน แชท และข้อจำกัดของช่องแชท
delete from punpang_records where collection = 'bell' and data::text ~ '\mLINE\M';
delete from punpang_chat_presence where chat_id in (select id from punpang_chats where channel = 'line');
delete from punpang_chats where channel = 'line';
alter table punpang_chats drop constraint if exists punpang_chats_channel_check;
alter table punpang_chats add constraint punpang_chats_channel_check check (channel = any (array['facebook'::text, 'instagram'::text, 'web'::text]));

-- 3) รหัส LINE ของลูกค้า
update punpang_customers set data = data - 'lineUserId' where data ? 'lineUserId';

-- 4) ค่าตั้งค่า LINE (กติกาแจ้งเตือน บอท ร้านออนไลน์ การเชื่อมต่อ ลิงก์ที่อนุญาต)
update punpang_kv set data = jsonb_set(data, '{v}', (select coalesce(jsonb_agg((case when jsonb_typeof(x.r) = 'object' and jsonb_typeof(x.r->'channels') = 'array' then jsonb_set(x.r, '{channels}', coalesce((select jsonb_agg(t.c order by t.ord2) from jsonb_array_elements_text(x.r->'channels') with ordinality as t(c, ord2) where t.c <> 'line'), '[]'::jsonb)) else x.r end) #- '{channelTemplates,line}' order by x.ord), '[]'::jsonb) from jsonb_array_elements(data->'v') with ordinality as x(r, ord))) where id = 'notifyRules' and jsonb_typeof(data->'v') = 'array';
update punpang_kv set data = jsonb_set(data, '{v}', (data->'v') - 'line') where id = 'integrations' and jsonb_typeof(data->'v') = 'object';
update punpang_kv set data = jsonb_set(data, '{v,channels}', (data->'v'->'channels') - 'line') where id = 'bot' and jsonb_typeof(data->'v'->'channels') = 'object';
update punpang_kv set data = jsonb_set(data, '{v}', (data->'v') - 'lineUrl') where id = 'storefront' and jsonb_typeof(data->'v') = 'object';
update punpang_kv set data = jsonb_set(data, '{v,linkAllowlist}', coalesce((select jsonb_agg(t.x order by t.ord) from jsonb_array_elements_text(data->'v'->'linkAllowlist') with ordinality as t(x, ord) where t.x not in ('lin.ee', 'line.me')), '[]'::jsonb)) where id = 'shop' and jsonb_typeof(data->'v'->'linkAllowlist') = 'array';

-- 5) คอลัมน์ line ของลูกค้า (ไม่มีการใช้งานแล้ว)
alter table punpang_customers drop column if exists line;
