-- Reset parcial de migracion temprana Sheets -> Supabase para WC2026.
--
-- Uso:
-- 1. Ejecutar primero los SELECT de preview.
-- 2. Si los conteos corresponden a la carga temprana incorrecta, ejecutar el bloque BEGIN/COMMIT.
--
-- Objetivo:
-- Limpiar Partidos/Equipos migrados demasiado pronto para rehacer el flujo correcto:
-- competitions -> teams/aliases/mappings -> competition_team_mapping -> matches.
--
-- No borra competitions ni competition_seasons.

-- ---------------------------------------------------------------------------
-- PREVIEW
-- ---------------------------------------------------------------------------

select 'matches_wc2026' as table_name, count(*) as rows
from matches
where competition_season_id = 'WC2026'
   or competition_id in ('WC2026', 'FIFA_WORLD_CUP');

select 'match_source_ids_for_wc2026_matches' as table_name, count(*) as rows
from match_source_ids msi
where exists (
  select 1
  from matches m
  where m.match_id = msi.match_id
    and (m.competition_season_id = 'WC2026' or m.competition_id in ('WC2026', 'FIFA_WORLD_CUP'))
);

select 'competition_team_mapping_wc2026' as table_name, count(*) as rows
from competition_team_mapping
where competition_season_id = 'WC2026';

select 'source_team_mapping_wc2026' as table_name, count(*) as rows
from source_team_mapping
where competition_season_id = 'WC2026';

select 'team_aliases_pointing_to_wc2026_teams' as table_name, count(*) as rows
from team_aliases ta
where exists (
  select 1
  from competition_team_mapping ctm
  where ctm.team_key = ta.team_key
    and ctm.competition_season_id = 'WC2026'
);

select 'teams_only_wc2026_or_unreferenced' as table_name, count(*) as rows
from teams t
where exists (
  select 1
  from competition_team_mapping ctm
  where ctm.team_key = t.team_key
    and ctm.competition_season_id = 'WC2026'
)
and not exists (
  select 1
  from competition_team_mapping ctm
  where ctm.team_key = t.team_key
    and ctm.competition_season_id <> 'WC2026'
);

-- ---------------------------------------------------------------------------
-- RESET
-- ---------------------------------------------------------------------------

begin;

create temporary table _reset_wc2026_matches as
select match_id
from matches
where competition_season_id = 'WC2026'
   or competition_id in ('WC2026', 'FIFA_WORLD_CUP');

create temporary table _reset_wc2026_teams as
select distinct team_key
from competition_team_mapping
where competition_season_id = 'WC2026';

-- Dependencias de partidos.
delete from betting_decisions
where match_id in (select match_id from _reset_wc2026_matches);

delete from market_closing_odds
where match_id in (select match_id from _reset_wc2026_matches);

delete from odds_snapshots
where match_id in (select match_id from _reset_wc2026_matches);

delete from model_predictions
where match_id in (select match_id from _reset_wc2026_matches);

delete from model_outputs
where match_id in (select match_id from _reset_wc2026_matches);

delete from ev_picks
where match_id in (select match_id from _reset_wc2026_matches);

delete from bets
where match_id in (select match_id from _reset_wc2026_matches);

delete from player_match_stats
where match_id in (select match_id from _reset_wc2026_matches);

delete from player_match_summary
where match_id in (select match_id from _reset_wc2026_matches);

delete from match_lineups
where match_id in (select match_id from _reset_wc2026_matches);

delete from match_events
where match_id in (select match_id from _reset_wc2026_matches);

delete from match_officials
where match_id in (select match_id from _reset_wc2026_matches);

delete from match_source_ids
where match_id in (select match_id from _reset_wc2026_matches);

delete from feature_snapshots
where match_id in (select match_id from _reset_wc2026_matches);

delete from matches
where match_id in (select match_id from _reset_wc2026_matches);

-- Dependencias de equipos WC2026.
delete from competition_rosters
where competition_season_id = 'WC2026';

delete from competition_team_mapping
where competition_season_id = 'WC2026';

delete from source_team_mapping
where competition_season_id = 'WC2026';

delete from team_aliases
where team_key in (select team_key from _reset_wc2026_teams)
and not exists (
  select 1
  from competition_team_mapping ctm
  where ctm.team_key = team_aliases.team_key
);

delete from teams t
where t.team_key in (select team_key from _reset_wc2026_teams)
and not exists (
  select 1 from competition_team_mapping ctm where ctm.team_key = t.team_key
)
and not exists (
  select 1 from matches m where m.home_team_key = t.team_key or m.away_team_key = t.team_key
)
and not exists (
  select 1 from players p where p.team_key = t.team_key
)
and not exists (
  select 1 from team_memberships tm where tm.team_key = t.team_key
);

commit;

-- Recomendado despues:
-- 1. Ejecutar seedCompetitionCatalogToSupabase().
-- 2. Ejecutar supabaseMigrateCompetitionMappingsApply().
-- 3. Migrar/normalizar Partidos.
