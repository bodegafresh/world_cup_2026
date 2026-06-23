-- Pool Team 2026 - tournament structure model
-- Apply after 004_final_canonical_contract.sql.
--
-- This migration separates global team identity from competition-specific
-- structure: stages, groups, participants, qualification rules and bracket
-- slots. It is additive and keeps legacy columns alive as read caches.

create extension if not exists pgcrypto;

comment on column teams.group_code is
  'DEPRECATED LEGACY CACHE: never use as canonical group membership. Use competition_group_memberships.';

comment on column competition_team_mapping.group_code is
  'LEGACY CACHE: canonical group membership belongs in competition_group_memberships.';

comment on column matches.group_code is
  'LEGACY CACHE: canonical group relation belongs in match_groups or stage/group context.';

create table if not exists competition_stages (
  stage_id text primary key,
  competition_season_id text not null references competition_seasons(competition_season_id),
  stage_code text not null,
  stage_name text not null,
  stage_order integer not null,
  stage_type text not null check (stage_type in (
    'GROUP_STAGE',
    'LEAGUE_PHASE',
    'KNOCKOUT',
    'PLAYOFF',
    'QUALIFIER',
    'FINAL',
    'THIRD_PLACE',
    'OTHER'
  )),
  starts_on date,
  ends_on date,
  rules jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_season_id, stage_code)
);

create table if not exists competition_groups (
  group_id text primary key,
  competition_season_id text not null references competition_seasons(competition_season_id),
  stage_id text not null references competition_stages(stage_id),
  group_code text not null,
  group_name text not null,
  group_order integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_season_id, stage_id, group_code)
);

create table if not exists competition_participants (
  competition_season_id text not null references competition_seasons(competition_season_id),
  team_key text not null references teams(team_key),
  participant_type text not null default 'TEAM' check (participant_type in ('TEAM','CLUB','NATIONAL_TEAM')),
  participant_status text not null default 'ACTIVE' check (participant_status in (
    'ACTIVE',
    'QUALIFIED',
    'INVITED',
    'ELIMINATED',
    'WITHDRAWN',
    'UNKNOWN'
  )),
  seed_rating numeric,
  source text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (competition_season_id, team_key)
);

create table if not exists competition_group_memberships (
  group_id text not null references competition_groups(group_id),
  team_key text not null references teams(team_key),
  competition_season_id text not null references competition_seasons(competition_season_id),
  membership_status text not null default 'ACTIVE' check (membership_status in (
    'ACTIVE',
    'QUALIFIED',
    'ELIMINATED',
    'UNKNOWN'
  )),
  seed_position integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, team_key)
);

create table if not exists qualification_rules (
  qualification_rule_id text primary key,
  competition_season_id text not null references competition_seasons(competition_season_id),
  from_stage_id text references competition_stages(stage_id),
  to_stage_id text references competition_stages(stage_id),
  rule_code text not null,
  rule_name text not null,
  ranking_scope text not null check (ranking_scope in (
    'GROUP',
    'CROSS_GROUP',
    'LEAGUE_TABLE',
    'BRACKET_MATCH',
    'MANUAL',
    'OTHER'
  )),
  rank_from integer,
  rank_to integer,
  slots_awarded integer,
  tie_breakers jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_season_id, rule_code)
);

create table if not exists tournament_slots (
  slot_id text primary key,
  competition_season_id text not null references competition_seasons(competition_season_id),
  stage_id text not null references competition_stages(stage_id),
  slot_code text not null,
  slot_label text not null,
  slot_type text not null check (slot_type in (
    'GROUP_RANK',
    'BEST_THIRD',
    'MATCH_WINNER',
    'MATCH_LOSER',
    'SEEDED_TEAM',
    'MANUAL',
    'UNKNOWN'
  )),
  source_stage_id text references competition_stages(stage_id),
  source_group_id text references competition_groups(group_id),
  source_match_id text references matches(match_id),
  source_rank integer,
  resolved_team_key text references teams(team_key),
  status text not null default 'UNRESOLVED' check (status in ('UNRESOLVED','RESOLVED','VOID')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_season_id, slot_code)
);

create table if not exists match_team_slots (
  match_id text not null references matches(match_id),
  side text not null check (side in ('HOME','AWAY')),
  competition_season_id text not null references competition_seasons(competition_season_id),
  stage_id text references competition_stages(stage_id),
  slot_id text references tournament_slots(slot_id),
  team_key text references teams(team_key),
  raw_label text,
  resolved_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, side)
);

create index if not exists idx_competition_stages_season_order
  on competition_stages(competition_season_id, stage_order);

create index if not exists idx_competition_groups_stage
  on competition_groups(stage_id, group_order);

create index if not exists idx_competition_participants_team
  on competition_participants(team_key, competition_season_id);

create index if not exists idx_group_memberships_team
  on competition_group_memberships(team_key, competition_season_id);

create index if not exists idx_tournament_slots_status
  on tournament_slots(competition_season_id, status, stage_id);

create index if not exists idx_match_team_slots_slot
  on match_team_slots(slot_id);

create or replace view published_competition_participants as
select
  cp.competition_season_id,
  cp.team_key,
  t.display_name,
  cp.participant_status,
  cgm.group_id,
  cg.group_code,
  cg.group_name,
  cs.stage_code,
  cs.stage_name,
  cp.seed_rating,
  cp.updated_at
from competition_participants cp
join teams t on t.team_key = cp.team_key
left join competition_group_memberships cgm
  on cgm.competition_season_id = cp.competition_season_id
 and cgm.team_key = cp.team_key
left join competition_groups cg on cg.group_id = cgm.group_id
left join competition_stages cs on cs.stage_id = cg.stage_id;
