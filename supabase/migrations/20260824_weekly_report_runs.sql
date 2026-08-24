-- Weekly report send ledger. Used for Last Sent and scheduled duplicate protection.
-- Run this in the Supabase SQL editor if the table does not exist yet.

create table if not exists public.weekly_report_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('scheduled', 'manual')),
  status text not null check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  report_start timestamptz,
  report_end timestamptz,
  scheduled_for timestamptz not null,
  started_at timestamptz,
  sent_at timestamptz,
  recipient_count integer,
  resend_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists weekly_report_runs_scheduled_unique
  on public.weekly_report_runs (scheduled_for)
  where source = 'scheduled';

create index if not exists weekly_report_runs_created_at_idx
  on public.weekly_report_runs (created_at desc);

create index if not exists weekly_report_runs_sent_at_idx
  on public.weekly_report_runs (sent_at desc);

alter table public.weekly_report_runs enable row level security;

revoke all on table public.weekly_report_runs from public, anon, authenticated;
grant select, insert, update on table public.weekly_report_runs to service_role;

comment on table public.weekly_report_runs is
  'Scheduled and manual weekly report send history. Unique scheduled_for prevents duplicate automatic sends.';
