-- Pool Team 2026 - architecture phase 1 support
-- Adds lightweight domain events and explicit risk versioning.

create table if not exists domain_events (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  competition_season_id text,
  idempotency_key text unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table betting_decisions add column if not exists risk_engine_version text;
alter table ev_picks add column if not exists risk_engine_version text;

create index if not exists idx_domain_events_type_created on domain_events(event_type, created_at desc);
create index if not exists idx_domain_events_aggregate on domain_events(aggregate_type, aggregate_id);
create index if not exists idx_domain_events_competition on domain_events(competition_season_id, created_at desc);
