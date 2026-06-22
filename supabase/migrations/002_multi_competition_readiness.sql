-- Pool Team 2026 - multi-competition readiness and traceability schema
-- Apply after 001_initial_schema.sql.

create table if not exists competitions (
  competition_id text primary key,
  display_name text not null,
  country text,
  region text,
  competition_type text not null,
  tier integer,
  is_international boolean not null default false,
  is_domestic boolean not null default false,
  is_cup boolean not null default false,
  is_league boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competition_seasons (
  competition_season_id text primary key,
  competition_id text not null references competitions(competition_id),
  season integer not null,
  display_name text not null,
  calendar_start date,
  calendar_end date,
  format text,
  home_advantage_policy text,
  source_primary text,
  odds_sport_key text,
  api_football_league_id text,
  football_data_code text,
  strength_coefficient numeric not null default 1.0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competition_status (
  competition_season_id text primary key references competition_seasons(competition_season_id),
  status text not null check (status in ('OBSERVATION','PAPER_TRADING','BETTABLE','DISABLED')),
  status_reason text,
  readiness_score numeric,
  min_data_date date,
  approved_at timestamptz,
  approved_by text,
  updated_at timestamptz not null default now()
);

create table if not exists competition_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  competition_season_id text not null references competition_seasons(competition_season_id),
  check_name text not null,
  status text not null check (status in ('PASS','WARN','FAIL','NOT_APPLICABLE')),
  score numeric,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  unique (competition_season_id, check_name)
);

create table if not exists team_aliases (
  alias_key text primary key,
  team_key text not null references teams(team_key),
  alias text not null,
  normalized_alias text not null,
  language text,
  source text,
  confidence numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_alias, source)
);

create table if not exists competition_team_mapping (
  competition_season_id text not null references competition_seasons(competition_season_id),
  team_key text not null references teams(team_key),
  group_code text,
  status text not null default 'ACTIVE',
  seed_rating numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (competition_season_id, team_key)
);

create table if not exists source_team_mapping (
  source text not null,
  source_team_id text not null,
  team_key text not null references teams(team_key),
  competition_season_id text references competition_seasons(competition_season_id),
  source_team_name text,
  confidence numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, source_team_id)
);

create table if not exists model_runs (
  model_run_id uuid primary key default gen_random_uuid(),
  model_name text not null,
  model_version text not null,
  competition_season_id text references competition_seasons(competition_season_id),
  market text,
  training_window_start date,
  training_window_end date,
  feature_set_version text,
  calibration_method text,
  git_sha text,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists model_predictions (
  prediction_id uuid primary key default gen_random_uuid(),
  model_run_id uuid references model_runs(model_run_id),
  competition_season_id text not null references competition_seasons(competition_season_id),
  match_id text not null,
  match_type text,
  market text not null,
  selection text not null,
  raw_probability numeric check (raw_probability >= 0 and raw_probability <= 1),
  calibrated_probability numeric check (calibrated_probability >= 0 and calibrated_probability <= 1),
  fair_odds numeric,
  as_of timestamptz not null,
  flags text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists calibration_runs (
  calibration_run_id uuid primary key default gen_random_uuid(),
  competition_season_id text not null references competition_seasons(competition_season_id),
  market text not null,
  season integer,
  match_type text not null,
  model_name text not null,
  model_version text,
  method text not null,
  sample_size integer,
  brier_score numeric,
  log_loss numeric,
  ece numeric,
  sharpness numeric,
  clv numeric,
  simulated_roi numeric,
  window_start date,
  window_end date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists calibration_bins (
  calibration_run_id uuid not null references calibration_runs(calibration_run_id) on delete cascade,
  bin_start numeric not null,
  bin_end numeric not null,
  predicted_avg numeric,
  observed_rate numeric,
  n integer,
  ci_low numeric,
  ci_high numeric,
  primary key (calibration_run_id, bin_start, bin_end)
);

create table if not exists betting_decisions (
  betting_decision_id uuid primary key default gen_random_uuid(),
  competition_season_id text not null references competition_seasons(competition_season_id),
  prediction_id uuid references model_predictions(prediction_id),
  odds_snapshot_key text,
  match_id text not null,
  market text not null,
  selection text not null,
  model_probability numeric,
  decimal_odds numeric,
  edge numeric,
  ev numeric,
  kelly_fraction numeric,
  decision text not null,
  block_reason text,
  payload jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now()
);

create table if not exists market_closing_odds (
  competition_season_id text not null references competition_seasons(competition_season_id),
  match_id text not null,
  bookmaker text not null,
  market text not null,
  selection text not null,
  line numeric,
  closing_decimal_odds numeric,
  captured_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (match_id, bookmaker, market, selection, captured_at)
);

create table if not exists model_metrics (
  metric_id uuid primary key default gen_random_uuid(),
  competition_season_id text not null references competition_seasons(competition_season_id),
  market text not null,
  season integer,
  match_type text not null,
  model_name text not null,
  model_version text,
  sample_size integer,
  brier_score numeric,
  log_loss numeric,
  ece numeric,
  sharpness numeric,
  clv numeric,
  roi numeric,
  drawdown numeric,
  calculated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists data_quality_events (
  event_id uuid primary key default gen_random_uuid(),
  competition_season_id text references competition_seasons(competition_season_id),
  entity_type text not null,
  entity_id text,
  severity text not null,
  check_type text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists feature_definitions (
  feature_name text primary key,
  feature_set_version text not null,
  valid_contexts text[] not null default '{}',
  requires_home_advantage boolean not null default false,
  requires_league_strength boolean not null default false,
  description text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feature_snapshots (
  feature_snapshot_id uuid primary key default gen_random_uuid(),
  competition_season_id text not null references competition_seasons(competition_season_id),
  match_id text not null,
  feature_set_version text not null,
  as_of timestamptz not null,
  features jsonb not null,
  created_at timestamptz not null default now(),
  unique (competition_season_id, match_id, feature_set_version, as_of)
);

create table if not exists rating_snapshots (
  rating_snapshot_id uuid primary key default gen_random_uuid(),
  competition_season_id text references competition_seasons(competition_season_id),
  team_key text not null references teams(team_key),
  rating_type text not null,
  rating_value numeric not null,
  as_of timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  unique (competition_season_id, team_key, rating_type, as_of)
);

create table if not exists league_strength_coefficients (
  competition_season_id text primary key references competition_seasons(competition_season_id),
  coefficient numeric not null,
  method text,
  sample_size integer,
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists competition_market_profiles (
  competition_season_id text not null references competition_seasons(competition_season_id),
  market text not null,
  bookmaker_count integer,
  market_quality_score numeric,
  liquidity_tier text check (liquidity_tier in ('HIGH','MEDIUM','LOW','UNUSABLE')),
  odds_volatility numeric,
  closing_efficiency numeric,
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (competition_season_id, market)
);

create table if not exists cross_league_calibration (
  id uuid primary key default gen_random_uuid(),
  source_competition_season_id text not null references competition_seasons(competition_season_id),
  target_competition_season_id text not null references competition_seasons(competition_season_id),
  market text not null,
  method text not null,
  coefficient numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_competition_season_id, target_competition_season_id, market, method)
);

create table if not exists model_registry (
  model_name text not null,
  model_version text not null,
  status text not null default 'CHALLENGER',
  promoted_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  primary key (model_name, model_version)
);

create table if not exists drift_reports (
  drift_report_id uuid primary key default gen_random_uuid(),
  competition_season_id text not null references competition_seasons(competition_season_id),
  model_name text,
  feature_set_version text,
  drift_score numeric,
  status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists bankroll_snapshots (
  bankroll_snapshot_id uuid primary key default gen_random_uuid(),
  strategy text not null,
  bankroll numeric not null,
  exposure numeric,
  drawdown numeric,
  snapshot_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists experiment_tracking (
  experiment_id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null,
  hypothesis text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table matches add column if not exists competition_season_id text;
alter table matches add column if not exists match_type text;
alter table odds_snapshots add column if not exists competition_season_id text;
alter table odds_snapshots add column if not exists bookmaker_count integer;
alter table odds_snapshots add column if not exists market_quality_score numeric;
alter table odds_snapshots add column if not exists liquidity_tier text;
alter table odds_snapshots add column if not exists odds_volatility numeric;
alter table ev_picks add column if not exists competition_season_id text;
alter table ev_picks add column if not exists betting_decision text;
alter table ev_picks add column if not exists block_reason text;
alter table model_outputs add column if not exists competition_season_id text;
alter table model_outputs add column if not exists match_type text;
alter table model_calibration add column if not exists competition_season_id text;
alter table model_calibration add column if not exists market text;
alter table model_calibration add column if not exists season integer;
alter table model_calibration add column if not exists match_type text;
alter table model_calibration add column if not exists log_loss numeric;
alter table model_calibration add column if not exists ece numeric;
alter table model_calibration add column if not exists sharpness numeric;
alter table model_calibration add column if not exists clv numeric;
alter table model_calibration add column if not exists simulated_roi numeric;

create index if not exists idx_competition_status_status on competition_status(status);
create index if not exists idx_readiness_competition on competition_readiness_checks(competition_season_id, check_name);
create index if not exists idx_matches_competition_season on matches(competition_season_id, date);
create index if not exists idx_predictions_context on model_predictions(competition_season_id, market, match_type, as_of);
create index if not exists idx_betting_decisions_context on betting_decisions(competition_season_id, decision, decided_at);
create index if not exists idx_calibration_context on calibration_runs(competition_season_id, market, season, match_type);

insert into competitions (competition_id, display_name, country, region, competition_type, tier, is_international, is_domestic, is_cup, is_league, payload)
values
  ('FIFA_WORLD_CUP', 'Mundial FIFA', 'World', 'Global', 'international_cup', 1, true, false, true, false, '{"priority":1}'::jsonb),
  ('UEFA_CHAMPIONS_LEAGUE', 'UEFA Champions League', 'Europe', 'Europe', 'continental_club', 1, true, false, true, false, '{"priority":2}'::jsonb),
  ('PREMIER_LEAGUE', 'Premier League', 'England', 'Europe', 'domestic_league', 1, false, true, false, true, '{"priority":3}'::jsonb),
  ('COPA_LIBERTADORES', 'Copa Libertadores', 'South America', 'South America', 'continental_club', 1, true, false, true, false, '{"priority":4}'::jsonb),
  ('BRASILEIRAO', 'Brasileirão Série A', 'Brazil', 'South America', 'domestic_league', 1, false, true, false, true, '{"priority":5}'::jsonb),
  ('ARGENTINA_PRIMERA', 'Argentina Primera División', 'Argentina', 'South America', 'domestic_league', 1, false, true, false, true, '{"priority":6}'::jsonb),
  ('CHILE_PRIMERA', 'Chile Primera División', 'Chile', 'South America', 'domestic_league', 1, false, true, false, true, '{"priority":7}'::jsonb)
on conflict (competition_id) do update set
  display_name = excluded.display_name,
  country = excluded.country,
  region = excluded.region,
  competition_type = excluded.competition_type,
  tier = excluded.tier,
  is_international = excluded.is_international,
  is_domestic = excluded.is_domestic,
  is_cup = excluded.is_cup,
  is_league = excluded.is_league,
  payload = excluded.payload,
  updated_at = now();

insert into competition_seasons (
  competition_season_id, competition_id, season, display_name, format, home_advantage_policy,
  source_primary, odds_sport_key, api_football_league_id, strength_coefficient, payload
)
values
  ('WC2026', 'FIFA_WORLD_CUP', 2026, 'Mundial FIFA 2026', 'group_and_knockout', 'neutral_with_hosts', 'espn', 'soccer_fifa_world_cup', '1', 1.00, '{"target_status":"BETTABLE"}'::jsonb),
  ('UCL_2025', 'UEFA_CHAMPIONS_LEAGUE', 2025, 'UEFA Champions League 2025', 'league_phase_and_knockout', 'club_home_away', 'api_football', 'soccer_uefa_champs_league', '2', 1.10, '{"target_status":"PAPER_TRADING"}'::jsonb),
  ('EPL_2025', 'PREMIER_LEAGUE', 2025, 'Premier League 2025', 'double_round_robin', 'club_home_away', 'api_football', 'soccer_epl', '39', 1.15, '{"target_status":"PAPER_TRADING"}'::jsonb),
  ('LIBERTADORES_2025', 'COPA_LIBERTADORES', 2025, 'Copa Libertadores 2025', 'group_and_knockout', 'club_home_away', 'api_football', 'soccer_conmebol_copa_lib', '13', 1.05, '{"target_status":"OBSERVATION"}'::jsonb),
  ('BRASILEIRAO_2025', 'BRASILEIRAO', 2025, 'Brasileirão Série A 2025', 'double_round_robin', 'club_home_away', 'api_football', 'soccer_brazil_campeonato', '71', 1.00, '{"target_status":"OBSERVATION"}'::jsonb),
  ('ARG_PRIMERA_2025', 'ARGENTINA_PRIMERA', 2025, 'Argentina Primera División 2025', 'domestic_league', 'club_home_away', 'api_football', 'soccer_argentina_primera_division', '128', 0.95, '{"target_status":"OBSERVATION"}'::jsonb),
  ('CHI_PRIMERA_2025', 'CHILE_PRIMERA', 2025, 'Chile Primera División 2025', 'domestic_league', 'club_home_away', 'api_football', 'soccer_chile_campeonato', '265', 0.80, '{"target_status":"OBSERVATION","liquidity_default":"LOW"}'::jsonb)
on conflict (competition_season_id) do update set
  competition_id = excluded.competition_id,
  season = excluded.season,
  display_name = excluded.display_name,
  format = excluded.format,
  home_advantage_policy = excluded.home_advantage_policy,
  source_primary = excluded.source_primary,
  odds_sport_key = excluded.odds_sport_key,
  api_football_league_id = excluded.api_football_league_id,
  strength_coefficient = excluded.strength_coefficient,
  payload = excluded.payload,
  updated_at = now();

insert into competition_status (competition_season_id, status, status_reason, readiness_score, updated_at)
select
  competition_season_id,
  case when competition_season_id = 'WC2026' then 'PAPER_TRADING' else 'OBSERVATION' end,
  case
    when competition_season_id = 'WC2026' then 'Mundial 2026 starts in paper trading until readiness validates BETTABLE.'
    else 'Default onboarding state: betting disabled until readiness passes.'
  end,
  0,
  now()
from competition_seasons
where competition_season_id in ('WC2026','UCL_2025','EPL_2025','LIBERTADORES_2025','BRASILEIRAO_2025','ARG_PRIMERA_2025','CHI_PRIMERA_2025')
on conflict (competition_season_id) do nothing;

insert into competition_readiness_checks (competition_season_id, check_name, status, score, details)
select cs.competition_season_id, check_name, 'FAIL', 0, '{"required_for_bettable":true}'::jsonb
from competition_seasons cs
cross join (
  values
    ('fixtures_reliable'),
    ('results_reliable'),
    ('odds_sufficient'),
    ('aliases_normalized'),
    ('minimum_history'),
    ('separate_calibration'),
    ('liquidity_tier_defined'),
    ('closing_odds_available'),
    ('data_quality_clean'),
    ('backtest_available'),
    ('market_benchmark_available')
) as checks(check_name)
where cs.competition_season_id in ('WC2026','UCL_2025','EPL_2025','LIBERTADORES_2025','BRASILEIRAO_2025','ARG_PRIMERA_2025','CHI_PRIMERA_2025')
on conflict (competition_season_id, check_name) do nothing;
