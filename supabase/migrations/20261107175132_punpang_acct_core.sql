-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107175132) · เนื้อตรงกับที่รันจริง

create or replace function public.punpang_acct_can(p text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.punpang_staff s
    where s.user_id = (select auth.uid()) and s.active and s.perms && p);
$$;
revoke all on function public.punpang_acct_can(text[]) from public, anon;
grant execute on function public.punpang_acct_can(text[]) to authenticated;

create table public.punpang_acct_state (
  id int primary key default 1 check (id = 1),
  closed_through text not null default '' check (closed_through ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.punpang_acct_state (id) values (1);

create table public.punpang_acct_counters (
  kind text not null, year int not null, last int not null default 0,
  primary key (kind, year)
);

create table public.punpang_acct_entries (
  id text primary key,
  entry_date date not null,
  no text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index punpang_acct_entries_date_idx on public.punpang_acct_entries (entry_date);

create table public.punpang_acct_frozen (
  id text primary key,
  entry_date date not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index punpang_acct_frozen_date_idx on public.punpang_acct_frozen (entry_date);

create table public.punpang_acct_invoices (
  id text primary key,
  kind text not null check (kind in ('invoice', 'credit')),
  year int not null,
  seq int not null,
  no text not null unique,
  order_id text,
  doc_date date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (kind, year, seq)
);
create index punpang_acct_invoices_order_idx on public.punpang_acct_invoices (order_id);

create or replace function public.punpang_acct_next(p_kind text, p_year int)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.punpang_acct_counters as c (kind, year, last) values (p_kind, p_year, 1)
  on conflict (kind, year) do update set last = c.last + 1
  returning c.last into n;
  return n;
end $$;
revoke all on function public.punpang_acct_next(text, int) from public, anon, authenticated;

create or replace function public.punpang_acct_closed()
returns text language sql stable security definer set search_path = '' as $$
  select closed_through from public.punpang_acct_state where id = 1;
$$;
revoke all on function public.punpang_acct_closed() from public, anon, authenticated;

create or replace function public.punpang_acct_entries_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare closed text := public.punpang_acct_closed(); pfx text; yr int; seq int;
begin
  if tg_op = 'INSERT' then
    if closed <> '' and new.entry_date <= closed::date then
      raise exception 'งวดถึง % ปิดแล้ว ลงรายการในวันนั้นไม่ได้', closed using errcode = 'P0001';
    end if;
    pfx := split_part(new.no, '-', 1);
    if pfx !~ '^[A-Z]{1,4}$' then raise exception 'prefix เลขที่ไม่ถูกต้อง'; end if;
    yr := extract(year from new.entry_date)::int;
    seq := public.punpang_acct_next('E-' || pfx, yr);
    new.no := pfx || '-' || (yr + 543) || '-' || lpad(seq::text, 4, '0');
    new.data := jsonb_set(new.data, '{no}', to_jsonb(new.no));
    return new;
  elsif tg_op = 'UPDATE' then
    new.no := old.no; new.created_at := old.created_at; new.created_by := old.created_by;
    new.data := jsonb_set(new.data, '{no}', to_jsonb(old.no));
    new.updated_at := now();
    if closed <> '' and (old.entry_date <= closed::date or new.entry_date <= closed::date) then
      if new.entry_date <> old.entry_date
         or (new.data - 'reversedBy' - 'settledBy') <> (old.data - 'reversedBy' - 'settledBy') then
        raise exception 'รายการอยู่ในงวดที่ปิดแล้ว (ถึง %) แก้ไม่ได้', closed using errcode = 'P0001';
      end if;
    end if;
    return new;
  else
    if closed <> '' and old.entry_date <= closed::date then
      raise exception 'รายการอยู่ในงวดที่ปิดแล้ว (ถึง %) ลบไม่ได้', closed using errcode = 'P0001';
    end if;
    return old;
  end if;
end $$;
create trigger punpang_acct_entries_guard before insert or update or delete
  on public.punpang_acct_entries for each row execute function public.punpang_acct_entries_guard();

create or replace function public.punpang_acct_invoices_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pfx text; yr int; seq int;
begin
  if tg_op = 'INSERT' then
    pfx := case new.kind when 'invoice' then 'INV' else 'CN' end;
    yr := extract(year from new.doc_date)::int;
    new.year := yr;
    seq := public.punpang_acct_next('T-' || pfx, yr);
    new.seq := seq;
    new.no := pfx || '-' || (yr + 543) || '-' || lpad(seq::text, 5, '0');
    new.data := new.data || jsonb_build_object('no', new.no);
    return new;
  else
    if new.id <> old.id or new.kind <> old.kind or new.no <> old.no or new.year <> old.year or new.seq <> old.seq
       or new.order_id is distinct from old.order_id or new.doc_date <> old.doc_date
       or (new.data - 'voidedBy' - 'copies') <> (old.data - 'voidedBy' - 'copies') then
      raise exception 'ใบกำกับภาษี/ใบลดหนี้แก้ไขเนื้อหาไม่ได้' using errcode = 'P0001';
    end if;
    return new;
  end if;
end $$;
create trigger punpang_acct_invoices_guard before insert or update
  on public.punpang_acct_invoices for each row execute function public.punpang_acct_invoices_guard();

create or replace function public.punpang_acct_state_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.closed_through <> '' and new.closed_through::date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'ปิดงวดล่วงหน้าไม่ได้' using errcode = 'P0001';
  end if;
  new.updated_at := now(); new.updated_by := (select auth.uid());
  return new;
end $$;
create trigger punpang_acct_state_guard before update on public.punpang_acct_state
  for each row execute function public.punpang_acct_state_guard();

alter table public.punpang_acct_state enable row level security;
alter table public.punpang_acct_counters enable row level security;
alter table public.punpang_acct_entries enable row level security;
alter table public.punpang_acct_frozen enable row level security;
alter table public.punpang_acct_invoices enable row level security;

revoke all on public.punpang_acct_state, public.punpang_acct_counters, public.punpang_acct_entries,
  public.punpang_acct_frozen, public.punpang_acct_invoices from public, anon, authenticated;
grant select on public.punpang_acct_state to authenticated;
grant update (closed_through) on public.punpang_acct_state to authenticated;
grant select, insert, update, delete on public.punpang_acct_entries to authenticated;
grant select, insert, delete on public.punpang_acct_frozen to authenticated;
grant select, insert, update on public.punpang_acct_invoices to authenticated;

create policy acct_state_read on public.punpang_acct_state for select to authenticated
  using (public.punpang_acct_can(array['acctView','acctRecord','acctClose','acctReports','acctTax','acctAssets','acctSettings','taxInvoice','manage']));
create policy acct_state_close on public.punpang_acct_state for update to authenticated
  using (public.punpang_acct_can(array['acctClose'])) with check (public.punpang_acct_can(array['acctClose']));

create policy acct_entries_read on public.punpang_acct_entries for select to authenticated
  using (public.punpang_acct_can(array['acctView','acctRecord','acctClose','acctReports','acctTax','acctAssets','acctSettings']));
create policy acct_entries_ins on public.punpang_acct_entries for insert to authenticated
  with check (public.punpang_acct_can(array['acctRecord','acctAssets','acctTax']));
create policy acct_entries_upd on public.punpang_acct_entries for update to authenticated
  using (public.punpang_acct_can(array['acctRecord','acctAssets','acctTax']))
  with check (public.punpang_acct_can(array['acctRecord','acctAssets','acctTax']));
create policy acct_entries_del on public.punpang_acct_entries for delete to authenticated
  using (public.punpang_acct_can(array['acctRecord','acctAssets']));

create policy acct_frozen_read on public.punpang_acct_frozen for select to authenticated
  using (public.punpang_acct_can(array['acctView','acctRecord','acctClose','acctReports','acctTax','acctAssets','acctSettings']));
create policy acct_frozen_ins on public.punpang_acct_frozen for insert to authenticated
  with check (public.punpang_acct_can(array['acctClose']));
create policy acct_frozen_del on public.punpang_acct_frozen for delete to authenticated
  using (public.punpang_acct_can(array['acctClose']));

create policy acct_inv_read on public.punpang_acct_invoices for select to authenticated
  using (public.punpang_acct_can(array['taxInvoice','acctView','acctTax','acctReports','viewAllOrders']));
create policy acct_inv_ins on public.punpang_acct_invoices for insert to authenticated
  with check (public.punpang_acct_can(array['taxInvoice']));
create policy acct_inv_upd on public.punpang_acct_invoices for update to authenticated
  using (public.punpang_acct_can(array['taxInvoice'])) with check (public.punpang_acct_can(array['taxInvoice']));
