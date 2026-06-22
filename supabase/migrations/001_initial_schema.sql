-- Pool Team 2026 - Supabase initial schema
-- Ejecutar en Supabase SQL Editor antes de supabaseMigrationApply().

create extension if not exists pgcrypto;

create table if not exists teams (
  team_key text primary key,
  display_name text not null,
  normalized_name text,
  group_code text,
  api_football_team_id text,
  football_data_team_id text,
  country_code text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists players (
  player_key text primary key,
  display_name text not null,
  normalized_name text,
  team_key text,
  team_name text,
  position text,
  api_football_player_id text,
  football_data_player_id text,
  photo_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists matches (
  match_id text primary key,
  competition_id text not null default 'WC2026',
  season integer,
  match_key text unique,
  date date,
  kickoff_chile text,
  stage text,
  group_code text,
  home_team_key text,
  home_team_name text,
  away_team_key text,
  away_team_name text,
  venue_name text,
  venue_city text,
  venue_country text,
  venue_id text,
  lat numeric,
  lon numeric,
  home_score integer,
  away_score integer,
  status text not null default 'NS',
  winner text,
  source text,
  api_football_fixture_id text,
  football_data_match_id text,
  espn_event_id text,
  sources_used text,
  confidence_score numeric,
  has_conflict boolean,
  conflict_detail text,
  data_quality_notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists match_source_ids (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  source text not null,
  source_match_id text not null,
  confidence numeric,
  mapping_method text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_match_id)
);

create table if not exists source_fixtures (
  source_fixture_key text primary key,
  source text,
  source_match_id text,
  competition_id text,
  competition_name text,
  season integer,
  stage text,
  group_name text,
  matchday text,
  date_utc timestamptz,
  date_chile text,
  status text,
  home_team_id text,
  home_team_name text,
  away_team_id text,
  away_team_name text,
  home_score integer,
  away_score integer,
  winner text,
  venue_name text,
  venue_city text,
  raw_file_url text,
  loaded_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists standings (
  competition_id text not null,
  group_code text not null,
  team_key text not null,
  team_name text,
  position integer,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals_for integer,
  goals_against integer,
  goal_diff integer,
  points integer,
  form text,
  description text,
  updated_at timestamptz,
  primary key (competition_id, group_code, team_key)
);

create table if not exists player_match_stats (
  match_id text not null,
  player_key text not null,
  player_name text,
  team_key text,
  team_name text,
  source text not null default 'api_football',
  position text,
  minutes_played numeric,
  rating numeric,
  goals_scored numeric,
  assists numeric,
  yellow_cards numeric,
  red_cards numeric,
  payload jsonb not null default '{}'::jsonb,
  loaded_at timestamptz,
  primary key (match_id, player_key, source)
);

create table if not exists player_match_summary (
  match_id text not null,
  player_key text not null,
  player_name text,
  team_key text,
  team_name text,
  goals numeric,
  assists numeric,
  yellow_cards numeric,
  red_cards numeric,
  minutes numeric,
  updated_at timestamptz,
  primary key (match_id, player_key)
);

create table if not exists odds_snapshots (
  match_id text not null,
  bookmaker text not null,
  market text not null,
  selection text not null,
  decimal_odds numeric,
  implied_probability numeric,
  model_probability numeric,
  captured_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (match_id, bookmaker, market, selection, captured_at)
);

create table if not exists model_outputs (
  match_id text not null,
  model_name text not null,
  model_version text not null default 'v1',
  market text not null default '1X2',
  run_at timestamptz not null,
  home_team_name text,
  away_team_name text,
  prob_home numeric,
  prob_draw numeric,
  prob_away numeric,
  prob_over25 numeric,
  prob_btts numeric,
  lambda_home numeric,
  lambda_away numeric,
  confidence text,
  reliability numeric,
  flags text[] not null default '{}',
  is_valid boolean not null default true,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  primary key (match_id, model_name, market, run_at)
);

create table if not exists ev_picks (
  pick_key text primary key,
  match_id text not null,
  match_date date,
  home_team_name text,
  away_team_name text,
  market text not null,
  selection text not null,
  decimal_odds numeric,
  fair_odds numeric,
  model_probability numeric,
  edge numeric,
  ev numeric,
  kelly_fraction numeric,
  category text not null,
  status text not null,
  confidence text,
  model_source text,
  is_suspicious boolean,
  is_outlier boolean,
  result text,
  profit_units numeric,
  published_at timestamptz,
  resolved_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists bets (
  bet_id text primary key,
  pick_key text,
  match_id text,
  market text,
  selection text,
  decimal_odds numeric,
  model_probability numeric,
  ev numeric,
  kelly_fraction numeric,
  stake numeric,
  result text,
  profit_loss numeric,
  roi_accumulated numeric,
  notes text,
  taken_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists model_calibration (
  calibration_key text primary key,
  date date,
  evaluated_matches integer,
  accuracy numeric,
  brier_score numeric,
  interpretation text,
  updated_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists group_simulations (
  simulation_key text primary key,
  group_code text,
  team_key text,
  team_name text,
  qualify_probability numeric,
  remaining_matches integer,
  updated_at timestamptz
);

create table if not exists elo_ratings (
  team_key text primary key,
  team_name text,
  elo_current numeric,
  elo_previous numeric,
  matches integer,
  wins integer,
  draws integer,
  losses integer,
  updated_at timestamptz
);

create table if not exists pipeline_runs (
  run_id text primary key,
  started_at timestamptz,
  finished_at timestamptz,
  mode text,
  date_from date,
  date_to date,
  step text,
  status text,
  api_football_count integer,
  football_data_count integer,
  golden_count integer,
  enriched_count integer,
  teams_count integer,
  players_count integer,
  errors text,
  notes text,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists data_quality_log (
  quality_id text primary key,
  match_key text,
  check_type text,
  field_name text,
  api_football_value text,
  football_data_value text,
  selected_value text,
  severity text,
  confidence numeric,
  resolution text,
  created_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists weather_snapshots (
  weather_key text primary key,
  match_id text,
  venue_id text,
  venue_name text,
  city text,
  country text,
  lat_lon text,
  temperature_c numeric,
  humidity numeric,
  wind_kmh numeric,
  rain_probability numeric,
  condition text,
  source text,
  updated_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists news_items (
  id_hash text primary key,
  published_at timestamptz,
  updated_at timestamptz,
  source_match_id text,
  query text,
  title text,
  type text,
  status text,
  url text,
  source text,
  match_id text,
  home_team_name text,
  away_team_name text,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists sheet_raw_rows (
  sheet_name text not null,
  row_key text not null,
  source_row_number integer,
  payload jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (sheet_name, row_key)
);

create index if not exists idx_matches_date on matches(date);
create index if not exists idx_matches_status on matches(status);
create index if not exists idx_matches_api_football on matches(api_football_fixture_id);
create index if not exists idx_matches_espn on matches(espn_event_id);
create index if not exists idx_player_match_stats_match on player_match_stats(match_id);
create index if not exists idx_model_outputs_match on model_outputs(match_id);
create index if not exists idx_ev_picks_status on ev_picks(status);
create index if not exists idx_ev_picks_category on ev_picks(category);
create index if not exists idx_ev_picks_match on ev_picks(match_id);

create or replace view active_ev_plus as
select *
from ev_picks
where category = 'EV_PLUS'
  and status in ('PUBLISHED', 'ACTIVE')
  and coalesce(ev, 0) > 0;

create or replace view model_calibration_daily as
select
  date_trunc('day', published_at) as day,
  count(*) as picks,
  avg(ev) as avg_ev,
  sum(coalesce(profit_units, 0)) as profit_units
from ev_picks
where status in ('RESOLVED', 'HISTORICAL')
group by 1;
