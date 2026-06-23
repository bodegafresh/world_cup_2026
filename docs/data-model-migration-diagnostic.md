# Data model migration diagnostic

Fecha: 2026-06-23

Alcance: migracion desde Google Sheets / GAS hacia Supabase/PostgreSQL para plataforma multi-competencia.

Nota de insumo: el archivo `Mundial2026 - Modelo de Datos y Estadísticas (16).xlsx` contiene los nombres de hojas, pero en la copia local inspeccionada las hojas no tienen celdas pobladas. Este diagnostico se basa en el inventario de hojas, `docs/sheets-schema.md`, `src/Config.gs` y migraciones `001`, `002`, `003`.

## Decision central

No se debe migrar cada hoja como tabla final. Sheets mezcla captura, cache, UI, reportes, modelos, logs y resultados. La base final debe separar:

- RAW: datos tal como llegan.
- STAGING: datos parseados, aun no confiables.
- CANONICAL: entidades limpias.
- ANALYTICS: modelos, predicciones, calibracion, EV, bankroll.
- PUBLISHED: vistas de lectura para frontend, Telegram y API.

`sheet_raw_rows` debe conservar respaldo historico de hojas legacy, pero no debe convertirse en modelo de dominio.

## Clasificacion de hojas

| Hoja | Categoria | Destino recomendado |
|---|---|---|
| Dashboard | DASHBOARD_UI | No tabla final. Reemplazar por views published/API. |
| NormalizationAudit | AUDIT_LOG | `data_quality_events` o `sheet_raw_rows` historico. |
| EvHistorico | LEGACY_TEMPORAL | Migrar a `betting_decisions`/`bets` si tiene decisiones reales; deprecar `ev_picks`. |
| CardsOdds | DERIVED_ANALYTICS | Futuro `model_predictions` market=cards o `market_model_outputs`; no tabla final propia. |
| CornersOdds | DERIVED_ANALYTICS | Futuro `model_predictions` market=corners; no tabla final propia. |
| PoissonOdds | DERIVED_ANALYTICS | Migrar a `model_runs` + `model_predictions`; `model_outputs` legacy. |
| Clasificacion | DERIVED_ANALYTICS | `standings`, pero con `competition_season_id`, no `competition_id` ambiguo. |
| SimulacionGrupos | DERIVED_ANALYTICS | `group_simulations` o futura `simulation_runs` + `simulation_outputs`. |
| EspnStats | RAW_SOURCE | `source_match_stats` o `sheet_raw_rows`; alimentar `player_match_stats`/match stats. |
| FormaEquipos | DERIVED_ANALYTICS | `feature_snapshots`/`rating_snapshots`; no tabla final propia. |
| Alineaciones | STAGING | `match_lineups`; raw en `sheet_raw_rows`. |
| Arbitros | CANONICAL_ENTITY | Crear `referees`, `match_officials`; mientras, `sheet_raw_rows`. |
| EloRatings | DERIVED_ANALYTICS | `rating_snapshots`; `elo_ratings` legacy/latest snapshot. |
| EvOpportunities | LEGACY_TEMPORAL | Migrar a `betting_decisions`; no tabla final. |
| BettingHistory | DERIVED_ANALYTICS | `bets` si son apuestas/paper bets; no mezclar con picks. |
| ModelCalibration | DERIVED_ANALYTICS | `calibration_runs` + `calibration_bins`; `model_calibration` legacy. |
| HistorialH2H | DERIVED_ANALYTICS | Feature derivada; `feature_snapshots` o raw/staging si viene de fuente externa. |
| Suscriptores | OPERATIONAL_LOG | `telegram_subscribers`/`notification_subscriptions`; no mezclar con dominio deportivo. |
| README | DASHBOARD_UI | No tabla final. |
| Partidos | CANONICAL_ENTITY | `matches` + `match_source_ids`; raw en `source_fixtures`. |
| Equipos | CANONICAL_ENTITY | `teams`, `team_aliases`, `source_team_mapping`, `competition_team_mapping`. |
| Jugadores | CANONICAL_ENTITY | `players`, `player_aliases`, `source_player_mapping`; quitar relacion permanente a team. |
| EventosLive | RAW_SOURCE | `match_events` canonical/staging segun calidad; raw en `sheet_raw_rows`. |
| OddsApuestas | STAGING | `odds_snapshots`; no guardar probabilidades de modelo. |
| EstadiosClima | RAW_SOURCE | `weather_snapshots`; opcional `venues`. |
| Noticias | RAW_SOURCE | `news_items`; sentiment/features aparte. |
| ResumenJugadorPartido | DERIVED_ANALYTICS | `player_match_summary` o vista derivada desde eventos/stats. |
| RawLog | OPERATIONAL_LOG | `sheet_raw_rows`/object storage; no tabla de dominio. |
| AnalisisIA | DERIVED_ANALYTICS | `model_predictions` o `model_annotations`; `model_outputs` legacy. |
| Alertas | OPERATIONAL_LOG | `alerts`/`notification_events`; no dominio canónico. |
| ReportesTelegram | DASHBOARD_UI | Published/reporting log; no tabla final core. |
| SourceFixtures | RAW_SOURCE | `source_fixtures`; mantener. |
| MatchMapping | STAGING | `match_source_ids`; mantener. |
| DataQualityLog | AUDIT_LOG | `data_quality_events`; `data_quality_log` legacy. |
| Planteles | CANONICAL_ENTITY | `competition_rosters`; no usar como raw final. |
| PlayerMatchStats | DERIVED_ANALYTICS | `player_match_stats`, con fuente y match_id canonico. |
| PipelineRuns | OPERATIONAL_LOG | `pipeline_runs`; mantener. |

## Hojas que no deben ser tablas finales

No deben transformarse en tablas finales: `Dashboard`, `README`, `ReportesTelegram`, `EvOpportunities`, `EvHistorico`, `PoissonOdds`, `CardsOdds`, `CornersOdds`, `FormaEquipos`, `HistorialH2H`, `AnalisisIA`, `ModelCalibration`, `NormalizationAudit`, `RawLog`, `Alertas`.

Algunas pueden alimentar tablas canonicas o analytics, pero no deben sobrevivir como entidades finales con el mismo nombre.

## Hojas que deben quedar solo como respaldo en sheet_raw_rows

Solo respaldo bruto o transitorio:

- `README`
- `Dashboard`
- `RawLog`
- `ReportesTelegram`
- copias historicas de `EvOpportunities`, `EvHistorico`, `PoissonOdds`, `CardsOdds`, `CornersOdds`, `AnalisisIA`
- snapshots antiguos de `NormalizationAudit`

RAW con tabla especifica adicional:

- `SourceFixtures` -> `source_fixtures`
- `Noticias` -> `news_items`
- `EstadiosClima` -> `weather_snapshots`
- `EspnStats` -> futura `source_match_stats`
- `EventosLive` -> futura `match_events`

## Hojas que alimentan entidades canonicas

- `Partidos` alimenta `matches` y `match_source_ids`.
- `Equipos` alimenta `teams`, `team_aliases`, `source_team_mapping`, `competition_team_mapping`.
- `Jugadores` alimenta `players`, `player_aliases`, `source_player_mapping`.
- `Planteles` alimenta `competition_rosters`.
- `Alineaciones` alimenta `match_lineups`.
- `Clasificacion` alimenta `standings`.
- `OddsApuestas` alimenta `odds_snapshots`.
- `BettingHistory` alimenta `bets`.
- `PlayerMatchStats` alimenta `player_match_stats`.

## Diagnostico de migraciones actuales

### Tablas correctas a mantener

- `competitions`
- `competition_seasons`
- `competition_status`
- `competition_readiness_checks`
- `team_aliases`
- `competition_team_mapping`
- `source_team_mapping`
- `match_source_ids`
- `source_fixtures`
- `model_runs`
- `model_predictions`
- `calibration_runs`
- `calibration_bins`
- `betting_decisions`
- `market_closing_odds`
- `model_metrics`
- `feature_definitions`
- `feature_snapshots`
- `rating_snapshots`
- `competition_market_profiles`
- `domain_events`

### Tablas legacy o a deprecar

- `model_outputs`: reemplazar por `model_runs` + `model_predictions`.
- `ev_picks`: reemplazar por `betting_decisions`; exponer como view si el frontend lo necesita.
- `model_calibration`: reemplazar por `calibration_runs` + `calibration_bins`.
- `elo_ratings`: reemplazar por `rating_snapshots`; opcional view `current_elo_ratings`.
- `data_quality_log`: reemplazar por `data_quality_events`.
- `group_simulations`: mantener solo si se normaliza con `simulation_runs`; si no, tratar como analytics legacy.

### Problemas concretos

- `matches.competition_id default 'WC2026'` es deuda fuerte. En multi-liga `competition_season_id` debe ser obligatorio y sin default Mundial.
- `matches` guarda source IDs (`api_football_fixture_id`, `football_data_match_id`, `espn_event_id`) que deben vivir en `match_source_ids`.
- `matches` guarda nombres de equipos. Aceptable solo como cache denormalizado; las relaciones reales deben ser `home_team_key`, `away_team_key`.
- `standings` usa `competition_id`, pero deberia usar `competition_season_id`.
- `players` tiene `team_key` y `team_name`. Eso es incorrecto como relacion permanente.
- `teams` mezcla campos de competencia (`group_code`) con entidad global de equipo.
- `odds_snapshots` tiene `model_probability`. Eso mezcla mercado con modelo y debe eliminarse/deprecarse.
- `betting_decisions` tiene `model_probability`, pero debe llamarse o derivarse desde `calibrated_probability` via `prediction_id`.
- `bets` no distingue claramente real vs paper. Debe tener `bet_mode`.
- `model_predictions` no fuerza unicidad por contexto. Debe tener unique por `(model_run_id, match_id, market, selection, as_of)` o similar.
- `odds_snapshot_key` en `betting_decisions` es texto libre. Debe referenciar una clave real de odds snapshot.

## Modelo de jugadores recomendado

Un jugador es una persona. Su equipo actual no debe estar embebido como FK permanente en `players`.

Tablas:

- `players`
  - `player_key` PK
  - `display_name`
  - `normalized_name`
  - `birth_date`
  - `nationality_country_code`
  - `primary_position`
  - `photo_url`
  - `payload`

- `player_aliases`
  - `alias_key` PK
  - `player_key` FK
  - `alias`
  - `normalized_alias`
  - `source`
  - `confidence`

- `source_player_mapping`
  - `source`
  - `source_player_id`
  - `player_key`
  - `source_player_name`
  - `confidence`
  - PK `(source, source_player_id)`

- `team_memberships`
  - `membership_id` UUID PK
  - `player_key`
  - `team_key`
  - `membership_type` (`CLUB`, `NATIONAL_TEAM`)
  - `valid_from`
  - `valid_to`
  - `source`
  - `confidence`

- `competition_rosters`
  - `competition_season_id`
  - `team_key`
  - `player_key`
  - `shirt_number`
  - `position`
  - `roster_status`
  - PK `(competition_season_id, team_key, player_key)`

- `match_lineups`
  - `match_id`
  - `team_key`
  - `player_key`
  - `lineup_role` (`STARTER`, `SUBSTITUTE`, `RESERVE`)
  - `position`
  - `shirt_number`
  - `source`
  - PK `(match_id, team_key, player_key, source)`

- `player_match_stats`
  - mantener, pero referenciar `match_id`, `player_key`, `team_key`, `source`.

Accion: deprecar `players.team_key` y `players.team_name` como columnas de relacion. Pueden quedar temporalmente como cache, no como verdad.

## Modelo de equipos recomendado

`teams` debe representar clubes y selecciones.

Campos recomendados:

- `team_key` PK
- `display_name`
- `normalized_name`
- `team_type` (`NATIONAL_TEAM`, `CLUB`)
- `country_code`
- `gender`
- `payload`

Relaciones:

- `team_aliases`: aliases por fuente/idioma.
- `source_team_mapping`: IDs por proveedor. El PK actual `(source, source_team_id)` esta bien.
- `competition_team_mapping`: participacion de un equipo en una temporada/competencia. Aqui si viven `group_code`, `seed_rating`, `status`.

Accion: mover `teams.group_code` fuera del significado canónico; queda en `competition_team_mapping`.

## Modelo de partidos recomendado

Reglas:

- `match_id` canonico estable.
- `competition_season_id` obligatorio.
- Sin default `WC2026`.
- Source IDs solo en `match_source_ids`.
- `home_team_key` y `away_team_key` obligatorios cuando el partido esta normalizado.
- `home_team_name` y `away_team_name` solo cache de lectura.

Acciones:

- Alterar `matches.competition_season_id set not null` cuando la data este completa.
- Remover/deprecar `matches.competition_id default 'WC2026'`.
- Migrar `api_football_fixture_id`, `football_data_match_id`, `espn_event_id` a `match_source_ids`.
- Agregar FK opcionales a `teams(team_key)` para home/away.

## Modelo de cuotas recomendado

`odds_snapshots` debe ser mercado puro:

- `odds_snapshot_id` UUID o clave compuesta.
- `competition_season_id`
- `match_id`
- `bookmaker`
- `market`
- `selection`
- `line`
- `decimal_odds`
- `implied_probability`
- `captured_at`
- `is_closing`
- `bookmaker_count`
- `market_quality_score`
- `liquidity_tier`
- `payload`

No debe incluir:

- `model_probability`
- `ev`
- `kelly`
- `fair_odds`

CLV:

- Mantener `market_closing_odds`, o agregar `is_closing=true` en snapshots. Para auditabilidad, prefiero mantener closing separado y tambien permitir snapshots marcados como closing.

## Modelo de predicciones recomendado

Canónico:

- `model_runs`: version, parametros, feature_set, git_sha, training window.
- `model_predictions`: un row por match/market/selection/as_of/model_run.

Reglas:

- `raw_probability` y `calibrated_probability` separadas.
- `as_of` obligatorio.
- `prediction_id` debe ser la referencia para EV.
- No usar odds futuras en features. Si se usan odds pre-match, guardar `feature_snapshot.as_of` y asegurar que `odds_snapshots.captured_at <= prediction.as_of`.

Deprecar:

- `model_outputs` como tabla final. Crear view de compatibilidad si frontend aun espera probabilidades 1X2 planas.

## Modelo EV/betting recomendado

Canónico:

- `betting_decisions`: decision del motor de riesgo sobre una oportunidad concreta.
- `bets`: ejecuciones reales o paper.

Reglas:

- `betting_decisions.prediction_id` obligatorio cuando venga de modelo.
- `betting_decisions.odds_snapshot_id` o clave FK obligatoria.
- La probabilidad usada debe ser `calibrated_probability`, no raw.
- Toda decision no apostable debe tener `block_reason`.
- `bets` debe tener `bet_mode` (`REAL`, `PAPER`), `stake`, `placed_at`, `settled_at`, `result`, `profit_loss`.
- `ev_picks` debe quedar como legacy/view published, no como fuente.

## Arquitectura por capas

### RAW

- `sheet_raw_rows`
- `source_fixtures`
- `news_items`
- `weather_snapshots`
- futura `source_match_stats`
- futura `source_odds_events`

### STAGING

- staging views desde raw:
  - `stg_matches`
  - `stg_teams`
  - `stg_players`
  - `stg_odds`
  - `stg_lineups`
  - `stg_rosters`

### CANONICAL

- `competitions`
- `competition_seasons`
- `teams`
- `team_aliases`
- `source_team_mapping`
- `competition_team_mapping`
- `players`
- `player_aliases`
- `source_player_mapping`
- `team_memberships`
- `competition_rosters`
- `matches`
- `match_source_ids`
- `match_lineups`
- `player_match_stats`
- `standings`

### ANALYTICS

- `feature_definitions`
- `feature_snapshots`
- `rating_snapshots`
- `model_registry`
- `model_runs`
- `model_predictions`
- `calibration_runs`
- `calibration_bins`
- `model_metrics`
- `betting_decisions`
- `bets`
- `market_closing_odds`
- `bankroll_snapshots`
- `drift_reports`
- `experiment_tracking`

### PUBLISHED

Views/API para frontend:

- `published_dashboard_today`
- `published_match_predictions`
- `published_ev_opportunities`
- `published_competition_health`
- `published_model_calibration`
- `published_bankroll_summary`

## Tablas nuevas necesarias

Prioridad alta:

- `player_aliases`
- `source_player_mapping`
- `team_memberships`
- `competition_rosters`
- `match_lineups`
- `match_events`
- `venues`
- `referees`
- `match_officials`

Prioridad media:

- `simulation_runs`
- `simulation_outputs`
- `source_match_stats`
- `notification_subscriptions`
- `notification_events`

## Alteraciones necesarias

1. `matches`
   - Hacer `competition_season_id not null`.
   - Quitar default Mundial.
   - Deprecar source IDs embebidos.
   - Agregar FKs de equipos cuando la data este limpia.

2. `players`
   - Agregar `birth_date`, `nationality_country_code`, `primary_position`.
   - Deprecar `team_key`, `team_name`.

3. `teams`
   - Agregar `team_type`.
   - Deprecar `group_code`.

4. `odds_snapshots`
   - Deprecar `model_probability`.
   - Agregar surrogate `odds_snapshot_id` si se quiere FK simple desde `betting_decisions`.

5. `betting_decisions`
   - Agregar FK real a odds snapshot.
   - Renombrar/semantizar `model_probability` como `calibrated_probability_used` o derivarlo via `prediction_id`.

6. `standings`
   - Cambiar `competition_id` por `competition_season_id`.

## Orden de migracion seguro

### FASE 0 - Congelar produccion actual

- Pausar crons que escriben en Sheets.
- Exportar snapshot completo de Sheets.
- Mantener `SUPABASE_PRIMARY_READ=false`.
- Mantener `SUPABASE_PRIMARY_WRITE=false`.

### FASE 1 - Importar Sheets a RAW

- Cargar todas las hojas a `sheet_raw_rows`.
- No transformar todavia.
- Guardar `sheet_name`, `row_number`, `row_hash`, `payload`, `synced_at`.

### FASE 2 - Crear staging

- Crear staging views/tables por dominio.
- Normalizar fechas, ids fuente, nombres, mercados.
- Detectar duplicados y aliases ambiguos.

### FASE 3 - Poblar canonicas

Orden:

1. `competitions`, `competition_seasons`
2. `teams`, `team_aliases`, `source_team_mapping`
3. `players`, `player_aliases`, `source_player_mapping`
4. `competition_team_mapping`, `competition_rosters`, `team_memberships`
5. `matches`, `match_source_ids`
6. `odds_snapshots`
7. `model_runs`, `model_predictions`
8. `calibration_runs`, `calibration_bins`
9. `betting_decisions`, `bets`

### FASE 4 - Validacion

- Conteos por hoja vs staging.
- Conteos por entidad canonica esperada.
- Hash de filas raw.
- Duplicados por clave natural.
- FKs nulas.
- Partidos sin equipos mapeados.
- Jugadores sin source mapping.
- Odds sin match canonico.
- Predicciones sin `as_of`.
- Betting decisions sin `block_reason` cuando bloqueadas.

### FASE 5 - Views de compatibilidad

Crear views que imiten hojas actuales para frontend/GAS:

- `vw_sheet_partidos`
- `vw_sheet_odds_apuestas`
- `vw_sheet_poisson_odds`
- `vw_sheet_ev_opportunities`
- `vw_dashboard`

### FASE 6 - Reemplazar lecturas gradualmente

- Cambiar frontend y Telegram a PUBLISHED views.
- Cambiar modelos a CANONICAL/ANALYTICS.
- Mantener Sheets solo como export temporal.
- Activar `SUPABASE_PRIMARY_READ=true`.
- Activar `SUPABASE_PRIMARY_WRITE=true` solo cuando no queden escrituras directas a `SpreadsheetApp` en rutas productivas.

## Critica dura

El mayor riesgo actual no es Supabase: es copiar la semantica accidental de Sheets a Postgres. Si se sigue migrando hoja=tabla, la base va a quedar mas rapida pero igual de ambigua. La prioridad debe ser:

1. Raw completo y auditable.
2. Canonical pequeno y estricto.
3. Analytics versionado.
4. Published views para no romper frontend.

La regla de oro: ninguna tabla canonica debe tener defaults silenciosos a `WC2026`, ni relaciones permanentes que en realidad son temporales, como `players.team_key`.
