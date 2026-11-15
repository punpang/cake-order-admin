-- รอบแก้ 2026-11-15 (แจ้งเตือน push ต้องมีคีย์ลับ) · รันหลัง 20261115030000 · รันซ้ำได้ปลอดภัย
-- push-send ปฏิเสธคำขอที่ไม่มีคีย์ที่ถูกต้อง (เดิมใครรู้ recordId/chatId ก็สั่งส่งแจ้งเตือนได้)
-- ก่อนรันไฟล์นี้ต้องตั้งค่าสองที่ให้ตรงกัน (ไม่ตั้ง = ไม่มีแจ้งเตือนออก):
--   1) Edge Function secret PUSH_SEND_KEY = ค่าสุ่มยาว (เช่น openssl rand -hex 32) · ตั้งก่อน deploy push-send
--   2) Vault: select vault.create_secret('<ค่าเดียวกับ PUSH_SEND_KEY>', 'push_send_key');

create or replace function public.punpang_push_on_bell()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  if new.collection = 'bell'
     and new.data->>'audience' = 'staff'
     and new.data->>'event' in ('team_new_order', 'team_customer_paid', 'chat_inbound', 'team_due_soon') then
    begin
      select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'push_send_key' limit 1;
      perform net.http_post(
        url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', coalesce(k, '')),
        body := jsonb_build_object('recordId', new.id),
        timeout_milliseconds := 5000
      );
    exception when others then
      null; -- แจ้งเตือนไม่ออก ไม่ทำให้การเพิ่มกระดิ่งล้ม
    end;
  end if;
  return new;
end;
$$;

create or replace function public.punpang_push_on_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_new int;
  n_old int := 0;
  k text;
begin
  if new.channel = 'web' and new.customer_id is not null and jsonb_typeof(new.data->'messages') = 'array' then
    n_new := jsonb_array_length(new.data->'messages');
    if tg_op = 'UPDATE' and jsonb_typeof(old.data->'messages') = 'array' then
      n_old := jsonb_array_length(old.data->'messages');
    end if;
    -- ต้องมีข้อความเพิ่มท้ายกระทู้ และข้อความท้ายสุดนั้นเป็นของพนักงาน
    if n_new > n_old and (new.data->'messages'->(n_new - 1))->>'from' = 'staff' then
      begin
        select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'push_send_key' limit 1;
        perform net.http_post(
          url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', coalesce(k, '')),
          body := jsonb_build_object('chatId', new.id),
          timeout_milliseconds := 5000
        );
      exception when others then
        null; -- แจ้งเตือนไม่ออก ไม่ทำให้การบันทึกข้อความของพนักงานล้ม
      end;
    end if;
  end if;
  return new;
end;
$$;
