-- Expand Email Automation settings for daily / weekly / monthly / manual reports.
-- Additive only: existing weekly_report_settings row and weekly_report_runs history are preserved.
-- Default frequency is weekly so current schedules keep sending.

alter table public.weekly_report_settings
  add column if not exists frequency text not null default 'weekly';

alter table public.weekly_report_settings
  add column if not exists subject_template text not null default 'Dealer Note Report — {startDate} to {endDate}';

alter table public.weekly_report_settings
  add column if not exists send_day_of_month integer not null default 1;

alter table public.weekly_report_settings
  drop constraint if exists weekly_report_settings_frequency_check;

alter table public.weekly_report_settings
  add constraint weekly_report_settings_frequency_check
  check (frequency in ('manual', 'daily', 'weekly', 'monthly'));

alter table public.weekly_report_settings
  drop constraint if exists weekly_report_settings_subject_template_check;

alter table public.weekly_report_settings
  add constraint weekly_report_settings_subject_template_check
  check (char_length(btrim(subject_template)) between 1 and 180);

alter table public.weekly_report_settings
  drop constraint if exists weekly_report_settings_send_day_of_month_check;

alter table public.weekly_report_settings
  add constraint weekly_report_settings_send_day_of_month_check
  check (send_day_of_month between 1 and 31);

do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  join pg_namespace n on t.relnamespace = n.oid
  where n.nspname = 'public'
    and t.relname = 'weekly_report_settings'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%range_type%'
    and c.conname <> 'weekly_report_settings_range_type_check_v2'
  limit 1;
  if conname is not null then
    execute format('alter table public.weekly_report_settings drop constraint %I', conname);
  end if;
end $$;

alter table public.weekly_report_settings
  drop constraint if exists weekly_report_settings_range_type_check;

alter table public.weekly_report_settings
  drop constraint if exists weekly_report_settings_range_type_check_v2;

alter table public.weekly_report_settings
  add constraint weekly_report_settings_range_type_check_v2
  check (range_type in (
    'today_to_send',
    'previous_day',
    'last_24_hours',
    'week_to_send',
    'last_7_days',
    'custom_weekly',
    'previous_month',
    'month_to_date',
    'last_30_days'
  ));

comment on column public.weekly_report_settings.frequency is
  'manual = no auto send; daily/weekly/monthly use send_time and timezone.';
comment on column public.weekly_report_settings.subject_template is
  'Email subject with optional {startDate} {endDate} {reportDate} {frequency} placeholders.';
comment on column public.weekly_report_settings.send_day_of_month is
  '1-31. If the month is shorter, the last day of that month is used.';

alter table public.weekly_report_runs
  add column if not exists frequency text;

alter table public.weekly_report_runs
  add column if not exists range_type text;

alter table public.weekly_report_runs
  add column if not exists subject text;

comment on table public.weekly_report_runs is
  'Scheduled and manual report send history. Unique scheduled_for still prevents duplicate automatic sends.';
