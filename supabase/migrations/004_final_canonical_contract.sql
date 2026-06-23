-- Pool Team 2026 - final canonical contract
-- Apply after 001, 002, 003.
--
-- This migration is intentionally additive/non-destructive. It establishes the
-- final data model contract while keeping legacy columns/tables alive until
-- published views and mappers fully replace Sheets-era behavior.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------

alter table teams add column if not exists team_type text;
alter table teams add column if not exists gender text;

alter table teams drop constraint if exists teams_team_type_check;
alter table teams add constraint teams_team_type_check
  check (team_type is null or team_type in ('CLUB','NATIONAL_TEAM','OTHER'));

comment on column teams.group_code is
  'LEGACY CACHE: group membership belongs in competition_team_mapping, not global teams.';

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

alter table players add column if not exists birth_date date;
alter table players add column if not exists nationality_country_code text;
alter table players add column if not exists primary_position text;

comment on column players.team_key is
  'LEGACY CACHE: do not use as canonical membership. Use team_memberships / competition_rosters / match_lineups.';
comment on column players.team_name is
  'LEGACY CACHE: do not use as canonical membership. Use team_memberships / competition_rosters / match_lineups.';

create table if not exists player_aliases (
  alias_key text primary key,
  player_key text not null references players(player_key),
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

create table if not exists source_player_mapping (
  source text not null,
  source_player_id text not null,
  player_key text not null references players(player_key),
  source_player_name text,
  confidence numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, source_player_id)
);

create table if not exists team_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  player_key text not null references players(player_key),
  team_key text not null references teams(team_key),
  membership_type text not null check (membership_type in ('CLUB','NATIONAL_TEAM','LOAN','OTHER')),
  valid_from date,
  valid_to date,
  source text,
  confidence numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_team_memberships_player_dates
  on team_memberships(player_key, valid_from, valid_to);
create index if not exists idx_team_memberships_team_dates
  on team_memberships(team_key, valid_from, valid_to);

create table if not exists competition_rosters (
  competition_season_id text not null references competition_seasons(competition_season_id),
  team_key text not null references teams(team_key),
  player_key text not null references players(player_key),
  shirt_number integer,
  position text,
  roster_status text not null default 'UNKNOWN'
    check (roster_status in ('CALLED_UP','ACTIVE','INJURED','CUT','UNKNOWN')),
  source text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (competition_season_id, team_key, player_key)
);

create table if not exists match_lineups (
  match_id text not null references matches(match_id),
  team_key text not null references teams(team_key),
  player_key text not null references players(player_key),
  source text not null default 'unknown',
  lineup_role text not null default 'UNKNOWN'
    check (lineup_role in ('STARTER','SUBSTITUTE','RESERVE','UNKNOWN')),
  position text,
  shirt_number integer,
  is_captain boolean,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, team_key, player_key, source)
);

-- ---------------------------------------------------------------------------
-- Match domain
-- ---------------------------------------------------------------------------

alter table matches alter column competition_id drop default;
alter table matches add column if not exists kickoff_utc timestamptz;

comment on column matches.competition_id is
  'LEGACY/COMPATIBILITY: use competition_season_id as operational competition key.';
comment on column matches.api_football_fixture_id is
  'LEGACY CACHE: source IDs belong in match_source_ids.';
comment on column matches.football_data_match_id is
  'LEGACY CACHE: source IDs belong in match_source_ids.';
comment on column matches.espn_event_id is
  'LEGACY CACHE: source IDs belong in match_source_ids.';
comment on column matches.home_team_name is
  'DENORMALIZED READ CACHE: canonical relation is home_team_key.';
comment on column matches.away_team_name is
  'DENORMALIZED READ CACHE: canonical relation is away_team_key.';

alter table matches drop constraint if exists matches_competition_season_fk;
alter table matches add constraint matches_competition_season_fk
  foreign key (competition_season_id) references competition_seasons(competition_season_id)
  not valid;

alter table matches drop constraint if exists matches_home_team_fk;
alter table matches add constraint matches_home_team_fk
  foreign key (home_team_key) references teams(team_key)
  not valid;

alter table matches drop constraint if exists matches_away_team_fk;
alter table matches add constraint matches_away_team_fk
  foreign key (away_team_key) references teams(team_key)
  not valid;

create table if not exists venues (
  venue_id text primary key,
  display_name text not null,
  city text,
  country_code text,
  lat numeric,
  lon numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists match_events (
  match_event_id text primary key,
  match_id text not null references matches(match_id),
  source text not null,
  source_event_id text,
  minute integer,
  stoppage_minute integer,
  team_key text references teams(team_key),
  player_key text references players(player_key),
  related_player_key text references players(player_key),
  event_type text not null,
  event_detail text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  loaded_at timestamptz not null default now(),
  unique (source, source_event_id)
);

create table if not exists referees (
  referee_key text primary key,
  display_name text not null,
  normalized_name text,
  country_code text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists match_officials (
  match_id text not null references matches(match_id),
  referee_key text not null references referees(referee_key),
  role text not null default 'REFEREE',
  source text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (match_id, referee_key, role)
);

-- ---------------------------------------------------------------------------
-- Odds domain
-- ---------------------------------------------------------------------------

alter table odds_snapshots add column if not exists odds_snapshot_id uuid default gen_random_uuid();
alter table odds_snapshots add column if not exists line numeric;
alter table odds_snapshots add column if not exists is_closing boolean not null default false;

create unique index if not exists ux_odds_snapshots_id
  on odds_snapshots(odds_snapshot_id);

comment on column odds_snapshots.model_probability is
  'LEGACY CONTAMINATION: model probability belongs in model_predictions, not market odds.';

alter table odds_snapshots drop constraint if exists odds_snapshots_competition_fk;
alter table odds_snapshots add constraint odds_snapshots_competition_fk
  foreign key (competition_season_id) references competition_seasons(competition_season_id)
  not valid;

-- ---------------------------------------------------------------------------
-- Prediction/calibration domain
-- ---------------------------------------------------------------------------

alter table model_predictions add column if not exists feature_snapshot_id uuid;
alter table model_predictions add column if not exists calibration_run_id uuid;

alter table model_predictions drop constraint if exists model_predictions_unique_context;
alter table model_predictions add constraint model_predictions_unique_context
  unique (model_run_id, match_id, market, selection, as_of);

alter table model_predictions drop constraint if exists model_predictions_feature_snapshot_fk;
alter table model_predictions add constraint model_predictions_feature_snapshot_fk
  foreign key (feature_snapshot_id) references feature_snapshots(feature_snapshot_id)
  not valid;

alter table model_predictions drop constraint if exists model_predictions_calibration_run_fk;
alter table model_predictions add constraint model_predictions_calibration_run_fk
  foreign key (calibration_run_id) references calibration_runs(calibration_run_id)
  not valid;

comment on table model_outputs is
  'LEGACY: replaced by model_runs + model_predictions. Keep only for compatibility until published views replace consumers.';
comment on table model_calibration is
  'LEGACY: replaced by calibration_runs + calibration_bins.';
comment on table elo_ratings is
  'LEGACY/latest cache: canonical rating history is rating_snapshots.';

-- ---------------------------------------------------------------------------
-- Risk/betting domain
-- ---------------------------------------------------------------------------

alter table betting_decisions add column if not exists odds_snapshot_id uuid;
alter table betting_decisions add column if not exists calibrated_probability_used numeric
  check (calibrated_probability_used is null or (calibrated_probability_used >= 0 and calibrated_probability_used <= 1));

alter table betting_decisions drop constraint if exists betting_decisions_odds_snapshot_fk;
alter table betting_decisions add constraint betting_decisions_odds_snapshot_fk
  foreign key (odds_snapshot_id) references odds_snapshots(odds_snapshot_id)
  not valid;

alter table betting_decisions drop constraint if exists betting_decisions_block_reason_check;
alter table betting_decisions add constraint betting_decisions_block_reason_check
  check (decision = 'BETTABLE' or nullif(block_reason, '') is not null)
  not valid;

comment on column betting_decisions.model_probability is
  'LEGACY/COMPATIBILITY: use calibrated_probability_used or model_predictions.calibrated_probability.';
comment on column betting_decisions.odds_snapshot_key is
  'LEGACY/COMPATIBILITY: use odds_snapshot_id when available.';

alter table bets add column if not exists betting_decision_id uuid;
alter table bets add column if not exists bet_mode text;
alter table bets add column if not exists decimal_odds_taken numeric;
alter table bets add column if not exists placed_at timestamptz;
alter table bets add column if not exists settled_at timestamptz;

alter table bets drop constraint if exists bets_betting_decision_fk;
alter table bets add constraint bets_betting_decision_fk
  foreign key (betting_decision_id) references betting_decisions(betting_decision_id)
  not valid;

alter table bets drop constraint if exists bets_bet_mode_check;
alter table bets add constraint bets_bet_mode_check
  check (bet_mode is null or bet_mode in ('REAL','PAPER'));

comment on table ev_picks is
  'LEGACY: replaced by betting_decisions and published EV views.';
comment on table player_match_summary is
  'LEGACY/DERIVED: prefer player_match_stats + match_events or a published view.';
comment on table data_quality_log is
  'LEGACY: replaced by data_quality_events.';

-- ---------------------------------------------------------------------------
-- Published compatibility views
-- ---------------------------------------------------------------------------

create or replace view vw_sheet_partidos as
select
  match_id,
  competition_season_id,
  match_key,
  date as fecha,
  kickoff_chile as hora_chile,
  stage as fase,
  group_code as grupo,
  home_team_name as local,
  away_team_name as visitante,
  home_score as goles_local,
  away_score as goles_visitante,
  status,
  venue_name as estadio,
  venue_city as ciudad,
  venue_country as pais_estadio,
  winner,
  updated_at
from matches;

create or replace view vw_sheet_odds_apuestas as
select
  match_id as fixture_id,
  competition_season_id,
  captured_at as timestamp,
  bookmaker as fuente,
  market as mercado,
  selection as seleccion,
  decimal_odds as cuota,
  implied_probability as probabilidad_mercado,
  bookmaker_count,
  market_quality_score,
  liquidity_tier,
  is_closing
from odds_snapshots;

create or replace view vw_sheet_poisson_odds as
select
  p.match_id as fixture_id,
  p.competition_season_id,
  p.as_of as updated_at,
  p.market as mercado,
  p.selection as seleccion,
  p.raw_probability,
  p.calibrated_probability as prob_modelo,
  p.fair_odds,
  r.model_name,
  r.model_version
from model_predictions p
left join model_runs r on r.model_run_id = p.model_run_id
where r.model_name ilike '%poisson%';

create or replace view vw_sheet_ev_opportunities as
select
  bd.betting_decision_id as pick_key,
  bd.match_id as fixture_id,
  bd.competition_season_id,
  bd.decided_at as timestamp,
  m.date as fecha,
  m.home_team_name as local,
  m.away_team_name as visitante,
  bd.market as mercado,
  bd.selection as seleccion,
  bd.decimal_odds as cuota,
  case when bd.calibrated_probability_used is not null and bd.calibrated_probability_used > 0
    then 1 / bd.calibrated_probability_used
    else null
  end as cuota_justa,
  coalesce(bd.calibrated_probability_used, bd.model_probability) as prob_modelo,
  bd.ev,
  bd.edge,
  bd.kelly_fraction as kelly,
  (bd.decision = 'BETTABLE') as ev_positivo,
  bd.decision as betting_decision,
  bd.block_reason,
  bd.risk_engine_version
from betting_decisions bd
left join matches m on m.match_id = bd.match_id;

create or replace view vw_current_elo_ratings as
select distinct on (team_key, competition_season_id, rating_type)
  competition_season_id,
  team_key,
  rating_type,
  rating_value,
  as_of,
  payload
from rating_snapshots
order by team_key, competition_season_id, rating_type, as_of desc;

create or replace view published_competition_health as
select
  cs.competition_season_id,
  c.display_name as competition_name,
  cs.season,
  st.status,
  st.readiness_score,
  count(rc.id) filter (where rc.status = 'PASS') as readiness_pass,
  count(rc.id) filter (where rc.status = 'WARN') as readiness_warn,
  count(rc.id) filter (where rc.status = 'FAIL') as readiness_fail,
  st.updated_at
from competition_seasons cs
join competitions c on c.competition_id = cs.competition_id
left join competition_status st on st.competition_season_id = cs.competition_season_id
left join competition_readiness_checks rc on rc.competition_season_id = cs.competition_season_id
group by cs.competition_season_id, c.display_name, cs.season, st.status, st.readiness_score, st.updated_at;

create or replace view published_match_predictions as
select
  p.prediction_id,
  p.competition_season_id,
  p.match_id,
  m.date,
  m.home_team_name,
  m.away_team_name,
  p.market,
  p.selection,
  p.raw_probability,
  p.calibrated_probability,
  p.fair_odds,
  p.as_of,
  r.model_name,
  r.model_version
from model_predictions p
left join model_runs r on r.model_run_id = p.model_run_id
left join matches m on m.match_id = p.match_id;

create or replace view published_ev_opportunities as
select *
from vw_sheet_ev_opportunities
where betting_decision = 'BETTABLE';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_player_aliases_player on player_aliases(player_key);
create index if not exists idx_source_player_mapping_player on source_player_mapping(player_key);
create index if not exists idx_competition_rosters_player on competition_rosters(player_key);
create index if not exists idx_match_lineups_player on match_lineups(player_key);
create index if not exists idx_match_events_match on match_events(match_id);
create index if not exists idx_odds_snapshots_match_market_time on odds_snapshots(match_id, market, captured_at desc);
create index if not exists idx_betting_decisions_prediction on betting_decisions(prediction_id);
create index if not exists idx_betting_decisions_odds_snapshot on betting_decisions(odds_snapshot_id);
