-- Pool Team 2026 - generic entity metadata, external references and media
-- Apply after 005_tournament_structure_model.sql.
--
-- Principle:
-- - Every project relation uses an internal project id.
-- - External provider IDs are metadata/reference mappings, never business keys.
-- - Images/logos/flags are media assets attached to internal entities.

create extension if not exists pgcrypto;

alter table teams add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table players add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table competitions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table competition_seasons add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table matches add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column teams.api_football_team_id is
  'DEPRECATED LEGACY CACHE: provider IDs belong in entity_external_refs.';
comment on column teams.football_data_team_id is
  'DEPRECATED LEGACY CACHE: provider IDs belong in entity_external_refs.';
comment on column players.api_football_player_id is
  'DEPRECATED LEGACY CACHE: provider IDs belong in entity_external_refs.';
comment on column players.football_data_player_id is
  'DEPRECATED LEGACY CACHE: provider IDs belong in entity_external_refs.';
comment on column players.photo_url is
  'DEPRECATED LEGACY CACHE: media belongs in entity_media_assets.';

create table if not exists entity_external_refs (
  entity_external_ref_id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'TEAM',
    'PLAYER',
    'COMPETITION',
    'COMPETITION_SEASON',
    'MATCH',
    'VENUE',
    'REFEREE',
    'BOOKMAKER',
    'MODEL',
    'OTHER'
  )),
  entity_id text not null,
  source text not null,
  source_entity_type text,
  source_id text not null,
  source_name text,
  source_url text,
  confidence numeric not null default 1,
  is_primary boolean not null default false,
  valid_from timestamptz,
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, source, source_id)
);

create table if not exists entity_media_assets (
  media_asset_id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'TEAM',
    'PLAYER',
    'COMPETITION',
    'COMPETITION_SEASON',
    'MATCH',
    'VENUE',
    'REFEREE',
    'BOOKMAKER',
    'MODEL',
    'OTHER'
  )),
  entity_id text not null,
  media_type text not null check (media_type in (
    'FLAG',
    'LOGO',
    'CREST',
    'PHOTO',
    'ICON',
    'VENUE_IMAGE',
    'OTHER'
  )),
  source text not null,
  url text not null,
  width integer,
  height integer,
  mime_type text,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, media_type, source)
);

create index if not exists idx_entity_external_refs_entity
  on entity_external_refs(entity_type, entity_id);

create index if not exists idx_entity_external_refs_source
  on entity_external_refs(source, source_id);

create index if not exists idx_entity_media_assets_entity
  on entity_media_assets(entity_type, entity_id);

create or replace view published_team_identity as
select
  t.team_key,
  t.display_name,
  t.normalized_name,
  t.team_type,
  t.country_code,
  t.metadata,
  coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'source', r.source,
      'source_id', r.source_id,
      'source_name', r.source_name,
      'is_primary', r.is_primary
    )) filter (where r.entity_external_ref_id is not null),
    '[]'::jsonb
  ) as external_refs,
  coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'media_type', m.media_type,
      'source', m.source,
      'url', m.url,
      'is_primary', m.is_primary
    )) filter (where m.media_asset_id is not null),
    '[]'::jsonb
  ) as media_assets
from teams t
left join entity_external_refs r
  on r.entity_type = 'TEAM'
 and r.entity_id = t.team_key
left join entity_media_assets m
  on m.entity_type = 'TEAM'
 and m.entity_id = t.team_key
group by
  t.team_key,
  t.display_name,
  t.normalized_name,
  t.team_type,
  t.country_code,
  t.metadata;
