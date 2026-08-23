-- Weekly report automation settings (one active row).
-- Run this in the Supabase SQL editor if the table does not exist yet.
-- Do not store API keys or other secrets here.

create table if not exists public.weekly_report_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  send_day text not null default 'Saturday'
    check (send_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  send_time text not null default '09:00'
    check (send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'America/Chicago',
  range_type text not null default 'week_to_send'
    check (range_type in ('week_to_send', 'last_7_days', 'custom_weekly')),
  range_start_day text not null default 'Monday'
    check (range_start_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  recipient_emails text[] not null default '{}',
  reply_to_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_weekly_report_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists weekly_report_settings_updated_at on public.weekly_report_settings;
create trigger weekly_report_settings_updated_at
before update on public.weekly_report_settings
for each row
execute function public.touch_weekly_report_settings_updated_at();

insert into public.weekly_report_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.weekly_report_settings enable row level security;

revoke all on table public.weekly_report_settings from public, anon, authenticated;
grant select, insert, update on table public.weekly_report_settings to service_role;

comment on table public.weekly_report_settings is
  'Admin-managed weekly report preferences. Secrets stay in Vercel env vars.';
