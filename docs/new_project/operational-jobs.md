# Operational Jobs - Clean Supabase Architecture

## Objetivo

Esta capa ingesta datos desde APIs, normaliza a entidades canonicas y publica lecturas derivadas en Supabase.

No modifica `supabase/new_project/001_clean_schema.sql`.

## Estructura

```text
src/config/PoolTeamEnv.gs
src/core/PoolTeamCore.gs
src/repositories/PoolTeamRepositories.gs
src/domain/WorldCupDomainRepositories.gs
src/ingestion/PoolTeamApiClients.gs
src/normalization/WorldCupNormalizers.gs
src/jobs/WorldCupOperationalJobs.gs
src/published/PublishedReadService.gs
src/tests/WorldCupSmokeTests.gs
```

## Script Properties

Obligatorias:

```text
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key
```

Opcionales:

```text
FOOTBALL_DATA_KEY=...
POOLTEAM_DRY_RUN=false
WC2026_SYNC_FROM=2026-06-11
WC2026_SYNC_TO=2026-07-19
```

## Funciones Publicas GAS

```javascript
setupWorldCup2026InitialData()
runWorldCupDailyRefresh()
runWorldCupLiveRefresh()
runWorldCupFixturesBackfill()
runWorldCupResultsBackfill()
validateWorldCupDataHealth()
printWorldCupSyncSummary()
```

## Orden Recomendado

1. `setupWorldCup2026InitialData`
2. `runWorldCupFixturesBackfill`
3. `runWorldCupResultsBackfill`
4. `validateWorldCupDataHealth`
5. `printWorldCupSyncSummary`

Para operacion diaria:

```javascript
runWorldCupDailyRefresh()
```

Para refresco live cada 5, 10 o 15 minutos:

```javascript
runWorldCupLiveRefresh()
```

## Triggers

En Apps Script:

- Daily refresh: trigger diario para `runWorldCupDailyRefresh`.
- Live refresh: trigger time-driven cada 5, 10 o 15 minutos para `runWorldCupLiveRefresh`.
- Healthcheck de Supabase: seguir usando `cronSupabaseHealthcheck`.

## Dry Run

Configurar:

```text
POOLTEAM_DRY_RUN=true
```

Ejecutar:

```javascript
smokeTestWorldCupCleanJobsDryRun()
```

Luego volver a:

```text
POOLTEAM_DRY_RUN=false
```

## Validacion

Revisar:

```javascript
validateWorldCupDataHealth()
printWorldCupSyncSummary()
```

Tablas esperadas con datos:

- `competitions`
- `competition_seasons`
- `competition_status`
- `competition_stages`
- `competition_groups`
- `competition_readiness_checks`
- `markets`
- `market_selections`
- `raw_source_payloads`
- `raw_api_calls`
- `teams`
- `team_aliases`
- `competition_team_entries`
- `venues`
- `matches`
- `match_participants`
- `entity_external_refs`
- `pipeline_runs`
- `data_quality_events`

Vistas para lectura:

- `published_match_schedule`
- `published_competition_health`
- `published_data_quality_health`

## Errores

Revisar:

- `data_quality_events`
- `entity_resolution_queue`
- `pipeline_runs`

## Siguiente Fase

Despues de fixtures/resultados:

1. Ingesta real de The Odds API.
2. Feature snapshots.
3. Model runs Poisson/ELO.
4. Calibration runs.
5. EV paper-only.
6. Decision engine con readiness por competencia.
