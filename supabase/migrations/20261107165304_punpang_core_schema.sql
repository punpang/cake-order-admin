-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107165304) · เนื้อตรงกับที่รันจริง

create table public.punpang_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('admin','sales','baker','driver')),
  perms text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.punpang_staff enable row level security;

create or replace function public.punpang_has_perm(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.punpang_staff s
    where s.user_id = (select auth.uid()) and s.active and p = any (s.perms)
  );
$$;
revoke all on function public.punpang_has_perm(text) from public, anon;
grant execute on function public.punpang_has_perm(text) to authenticated;

create policy staff_self_read on public.punpang_staff for select to authenticated
  using (user_id = (select auth.uid()) or public.punpang_has_perm('manage'));
create policy staff_manage_ins on public.punpang_staff for insert to authenticated
  with check (public.punpang_has_perm('manage'));
create policy staff_manage_upd on public.punpang_staff for update to authenticated
  using (public.punpang_has_perm('manage')) with check (public.punpang_has_perm('manage'));
create policy staff_manage_del on public.punpang_staff for delete to authenticated
  using (public.punpang_has_perm('manage'));

create table public.punpang_customers (
  id text primary key,
  name text not null,
  phone text,
  line text,
  note text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.punpang_customers (phone);
alter table public.punpang_customers enable row level security;
create policy cust_read on public.punpang_customers for select to authenticated
  using (public.punpang_has_perm('createOrder') or public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('chat') or public.punpang_has_perm('pos'));
create policy cust_ins on public.punpang_customers for insert to authenticated
  with check (public.punpang_has_perm('createOrder'));
create policy cust_upd on public.punpang_customers for update to authenticated
  using (public.punpang_has_perm('createOrder') or public.punpang_has_perm('adjustPoints'))
  with check (public.punpang_has_perm('createOrder') or public.punpang_has_perm('adjustPoints'));

create table public.punpang_orders (
  id text primary key,
  code text not null unique,
  customer_id text references public.punpang_customers(id),
  status text not null,
  fulfillment text not null check (fulfillment in ('pickup','delivery')),
  channel text,
  pickup_at timestamptz,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.punpang_orders (status);
create index on public.punpang_orders (pickup_at);
create index on public.punpang_orders (customer_id);
alter table public.punpang_orders enable row level security;
create policy ord_read on public.punpang_orders for select to authenticated using (
  public.punpang_has_perm('viewAllOrders')
  or (public.punpang_has_perm('viewPrepOrders') and status in ('payment_confirmed','order_confirmed','preparing','prepared'))
  or (public.punpang_has_perm('viewDeliveryOrders') and fulfillment = 'delivery'
      and status in ('preparing','prepared','ready_to_ship','shipping','delivered'))
);
create policy ord_ins on public.punpang_orders for insert to authenticated
  with check (
    (public.punpang_has_perm('createOrder') and status in ('draft','awaiting_payment'))
    or (public.punpang_has_perm('pos') and channel = 'pos')
  );
create policy ord_upd on public.punpang_orders for update to authenticated
  using (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice') or public.punpang_has_perm('editPickup')
         or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('createOrder') or public.punpang_has_perm('workPhoto'))
  with check (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice') or public.punpang_has_perm('editPickup')
         or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('createOrder') or public.punpang_has_perm('workPhoto'));

create or replace function public.punpang_guard_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('punpang.rpc', true), '') <> 'on' then
    raise exception 'status change must go through punpang_set_status' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger punpang_orders_guard before update on public.punpang_orders
  for each row execute function public.punpang_guard_status();

create or replace function public.punpang_set_status(p_order text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.punpang_orders; need text;
begin
  select * into o from public.punpang_orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  need := case
    when p_status = 'cancelled' then 'cancel'
    when p_status = 'preparing' then 'startPreparing'
    when p_status = 'prepared' then 'markPrepared'
    when p_status in ('ready_to_ship','shipping') then 'deliverShipping'
    when p_status = 'delivered' and o.fulfillment = 'delivery' then 'deliverShipping'
    when p_status = 'delivered' then 'deliverPickup'
    when p_status = 'payment_confirmed' then 'confirmPayment'
    when p_status = 'order_confirmed' then 'confirmUnpaid'
    when p_status = 'payment_reported' then 'reportPayment'
    when p_status = 'awaiting_payment' and o.status = 'draft' then 'sendToPayment'
    else 'revertStatus' end;
  if not public.punpang_has_perm(need) then raise exception 'no permission (%)', need using errcode = '42501'; end if;
  perform set_config('punpang.rpc', 'on', true);
  update public.punpang_orders set status = p_status where id = p_order;
end $$;
revoke all on function public.punpang_set_status(text, text) from public, anon;
grant execute on function public.punpang_set_status(text, text) to authenticated;

create table public.punpang_payments (
  id text primary key,
  order_id text not null references public.punpang_orders(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  method text,
  status text not null check (status in ('pending','confirmed','cancelled','refunded')),
  slip_path text,
  reported_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.punpang_payments (order_id);
alter table public.punpang_payments enable row level security;
create policy pay_read on public.punpang_payments for select to authenticated
  using (public.punpang_has_perm('viewAllOrders'));
create policy pay_ins on public.punpang_payments for insert to authenticated
  with check (public.punpang_has_perm('reportPayment') and status = 'pending');
create policy pay_upd on public.punpang_payments for update to authenticated
  using (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial'))
  with check (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial'));

create table public.punpang_items (
  id text primary key,
  kind text not null,
  name text not null,
  price numeric(12,2),
  active boolean not null default true,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.punpang_items enable row level security;
create policy items_public_read on public.punpang_items for select to anon, authenticated using (active);
create policy items_staff_read on public.punpang_items for select to authenticated
  using (public.punpang_has_perm('editItems') or public.punpang_has_perm('pos') or public.punpang_has_perm('createOrder'));
create policy items_ins on public.punpang_items for insert to authenticated with check (public.punpang_has_perm('editItems'));
create policy items_upd on public.punpang_items for update to authenticated
  using (public.punpang_has_perm('editItems')) with check (public.punpang_has_perm('editItems'));
create policy items_del on public.punpang_items for delete to authenticated using (public.punpang_has_perm('editItems'));

create table public.punpang_kv (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.punpang_kv enable row level security;
create policy kv_public_read on public.punpang_kv for select to anon, authenticated
  using (collection in ('storefront','legal','shop_public'));
create policy kv_staff_read on public.punpang_kv for select to authenticated
  using (public.punpang_has_perm('manage') or (collection not in ('item_costs','acct') and public.punpang_has_perm('viewAllOrders'))
         or (collection in ('item_costs') and public.punpang_has_perm('viewProfit')));
create policy kv_manage_write on public.punpang_kv for all to authenticated
  using (public.punpang_has_perm('manage')) with check (public.punpang_has_perm('manage'));

create table public.punpang_customer_auth (
  customer_id text primary key references public.punpang_customers(id) on delete cascade,
  pin_hash text,
  pin_salt text,
  failed int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.punpang_customer_auth enable row level security;

revoke all on public.punpang_staff, public.punpang_customers, public.punpang_orders, public.punpang_payments,
              public.punpang_items, public.punpang_kv, public.punpang_customer_auth from anon, authenticated;
grant select on public.punpang_items, public.punpang_kv to anon;
grant select, insert, update, delete on public.punpang_staff, public.punpang_items, public.punpang_kv to authenticated;
grant select, insert, update on public.punpang_customers, public.punpang_orders, public.punpang_payments to authenticated;

insert into storage.buckets (id, name, public) values
  ('punpang-slips', 'punpang-slips', false),
  ('punpang-work', 'punpang-work', false),
  ('punpang-public', 'punpang-public', true)
on conflict (id) do nothing;
create policy punpang_slips_rw on storage.objects for all to authenticated
  using (bucket_id = 'punpang-slips' and (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')))
  with check (bucket_id = 'punpang-slips' and public.punpang_has_perm('reportPayment'));
create policy punpang_work_rw on storage.objects for all to authenticated
  using (bucket_id = 'punpang-work' and public.punpang_has_perm('workPhoto'))
  with check (bucket_id = 'punpang-work' and public.punpang_has_perm('workPhoto'));
create policy punpang_public_write on storage.objects for insert to authenticated
  with check (bucket_id = 'punpang-public' and public.punpang_has_perm('editItems'));
create policy punpang_public_modify on storage.objects for update to authenticated
  using (bucket_id = 'punpang-public' and public.punpang_has_perm('editItems'));
create policy punpang_public_delete on storage.objects for delete to authenticated
  using (bucket_id = 'punpang-public' and public.punpang_has_perm('editItems'));
