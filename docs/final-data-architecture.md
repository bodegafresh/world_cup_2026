# Final data architecture and implementation contract

Fecha: 2026-06-23

Estado: definicion final de implementacion. Este documento reemplaza brainstorming previo y fija contratos para migrar desde Google Sheets/GAS hacia Supabase/PostgreSQL sin copiar la semantica accidental de Sheets.

## Principio rector

No existe `hoja = tabla final`.

La plataforma queda separada en:

```text
RAW -> STAGING -> CANONICAL -> ANALYTICS -> PUBLISHED
```

La regla de oro: las tablas canonicas representan entidades del dominio; las tablas analytics representan resultados versionados; las views published representan compatibilidad/frontend. Ninguna tabla canonica debe tener defaults silenciosos a `WC2026`.

## 1. Modelo final canonico

### Mantener

| Tabla | Capa | Decision |
|---|---|---|
| `competitions` | CANONICAL | Mantener. Entidad global de competencia. |
| `competition_seasons` | CANONICAL | Mantener. Unidad operativa principal. |
| `competition_status` | CANONICAL/OPS | Mantener. Gate oficial de readiness y bettable. |
| `competition_readiness_checks` | CANONICAL/OPS | Mantener. Checklist obligatorio. |
| `teams` | CANONICAL | Mantener, modificando columnas. |
| `team_aliases` | CANONICAL | Mantener. |
| `source_team_mapping` | CANONICAL | Mantener. |
| `competition_team_mapping` | CANONICAL | Mantener. |
| `players` | CANONICAL | Mantener, modificando relacion a equipos. |
| `matches` | CANONICAL | Mantener, modificando constraints y source IDs. |
| `match_source_ids` | CANONICAL | Mantener. |
| `odds_snapshots` | ANALYTICS/RAW_MARKET | Mantener, limpiando contaminacion de modelo. |
| `market_closing_odds` | ANALYTICS | Mantener. |
| `model_runs` | ANALYTICS | Mantener. |
| `model_predictions` | ANALYTICS | Mantener. |
| `calibration_runs` | ANALYTICS | Mantener. |
| `calibration_bins` | ANALYTICS | Mantener. |
| `betting_decisions` | ANALYTICS/RISK | Mantener como tabla canonica de EV/riesgo. |
| `bets` | ANALYTICS/RISK | Mantener, modificando modo real/paper. |
| `feature_definitions` | ANALYTICS | Mantener, liviano. |
| `feature_snapshots` | ANALYTICS | Mantener. |
| `rating_snapshots` | ANALYTICS | Mantener. |
| `model_metrics` | ANALYTICS | Mantener. |
| `pipeline_runs` | OBSERVABILITY | Mantener. |
| `data_quality_events` | OBSERVABILITY | Mantener. |
| `domain_events` | OBSERVABILITY | Mantener. |
| `sheet_raw_rows` | RAW | Mantener como respaldo/auditoria. |

### Modificar

| Tabla | Cambio obligatorio |
|---|---|
| `teams` | Agregar `team_type`; deprecar `group_code` como dato global. |
| `players` | Deprecar `team_key`, `team_name` como relacion permanente. |
| `matches` | `competition_season_id` obligatorio; eliminar default `WC2026`; source IDs salen a `match_source_ids`. |
| `standings` | Cambiar semantica de `competition_id` a `competition_season_id`. |
| `odds_snapshots` | Eliminar/deprecar `model_probability`; agregar surrogate key si se necesita FK simple. |
| `betting_decisions` | Usar `prediction_id` + odds snapshot real; probabilidad usada debe ser calibrada. |
| `bets` | Agregar `bet_mode`, `decision_id`, `placed_at`, `settled_at`. |

### Deprecar

| Tabla | Reemplazo |
|---|---|
| `model_outputs` | `model_runs` + `model_predictions`. |
| `ev_picks` | `betting_decisions` + published view. |
| `model_calibration` | `calibration_runs` + `calibration_bins`. |
| `elo_ratings` | `rating_snapshots` + view de latest rating. |
| `data_quality_log` | `data_quality_events`. |
| `player_match_summary` | View/analytics derivada desde `player_match_stats` y `match_events`. |

### Reemplazar con tablas nuevas

| Necesidad | Tabla final |
|---|---|
| Alias de jugadores | `player_aliases` |
| IDs externos de jugadores | `source_player_mapping` |
| Club/seleccion temporal de jugador | `team_memberships` |
| Convocatorias/planteles por competencia | `competition_rosters` |
| Alineaciones por partido | `match_lineups` |
| Eventos live normalizados | `match_events` |
| Estadios/sedes | `venues` |
| Arbitros/oficiales | `referees`, `match_officials` |

### Convertir en view

| View | Proposito |
|---|---|
| `vw_sheet_partidos` | Compatibilidad con frontend/GAS legacy. |
| `vw_sheet_odds_apuestas` | Compatibilidad de cuotas. |
| `vw_sheet_poisson_odds` | Compatibilidad para salida Poisson. |
| `vw_sheet_ev_opportunities` | Reemplazo de `EvOpportunities`. |
| `vw_current_elo_ratings` | Reemplazo de `EloRatings`. |
| `vw_model_calibration_latest` | Reemplazo de `ModelCalibration`. |
| `published_dashboard_today` | Frontend/dashboard. |
| `published_competition_health` | Estado multi-competencia. |

### Solo RAW/STAGING

`Dashboard`, `README`, `RawLog`, `ReportesTelegram`, snapshots historicos de `PoissonOdds`, `CardsOdds`, `CornersOdds`, `AnalisisIA`, `EvHistorico`, `EvOpportunities`.

## 2. Jugadores: definicion final

### `players`

Entidad persona. No representa su equipo actual.

Columnas finales:

- `player_key` PK.
- `display_name` not null.
- `normalized_name`.
- `birth_date`.
- `nationality_country_code`.
- `primary_position`.
- `photo_url`.
- `payload`.
- `created_at`, `updated_at`.

Columnas legacy:

- `team_key`: deprecar. Cache temporal maximo 30/60 dias.
- `team_name`: deprecar. Cache temporal maximo 30/60 dias.
- source IDs embebidos: deprecar cuando exista `source_player_mapping`.

### `player_aliases`

PK `alias_key`. FK `player_key -> players`.

Un alias pertenece a una persona, con fuente/confianza. Unique recomendado: `(normalized_alias, source)`.

### `source_player_mapping`

PK `(source, source_player_id)`.

FK `player_key -> players`.

Responsabilidad: resolver IDs API-Football, ESPN, Football-Data u otros. Nunca guardar estos IDs como relacion primaria en `players`.

### `team_memberships`

Relacion temporal jugador-equipo.

Columnas:

- `membership_id` UUID PK.
- `player_key` FK.
- `team_key` FK.
- `membership_type` check `CLUB`, `NATIONAL_TEAM`, `LOAN`, `OTHER`.
- `valid_from`.
- `valid_to`.
- `source`.
- `confidence`.
- `payload`.

Uso: clubes, selecciones, prestamos, historia laboral/deportiva.

### `competition_rosters`

Convocatoria por competencia/temporada.

PK `(competition_season_id, team_key, player_key)`.

Columnas:

- `competition_season_id`.
- `team_key`.
- `player_key`.
- `shirt_number`.
- `position`.
- `roster_status` check `CALLED_UP`, `ACTIVE`, `INJURED`, `CUT`, `UNKNOWN`.
- `source`.
- `payload`.

### `match_lineups`

Alineacion o convocatoria de partido.

PK `(match_id, team_key, player_key, source)`.

Columnas:

- `lineup_role` check `STARTER`, `SUBSTITUTE`, `RESERVE`, `UNKNOWN`.
- `position`.
- `shirt_number`.
- `is_captain`.
- `payload`.

### `player_match_stats`

Mantener. Debe depender de `match_id`, `player_key`, `team_key`, `source`.

No debe crear jugadores implícitos sin resolver mapping; si falta mapping, la fila entra a staging/error.

## 3. Equipos: definicion final

### `teams`

Entidad global. Un club y una seleccion son tipos distintos.

Columnas finales:

- `team_key` PK.
- `display_name`.
- `normalized_name`.
- `team_type` check `CLUB`, `NATIONAL_TEAM`, `OTHER`.
- `country_code`.
- `gender`.
- `payload`.

No pertenece a `teams`:

- grupo mundialista.
- seed/ranking dentro de competencia.
- liga/temporada.
- source-specific IDs como relacion principal.

### `team_aliases`

Mantener. Alias por fuente, idioma y confianza.

### `source_team_mapping`

Mantener. IDs externos por fuente.

PK `(source, source_team_id)`.

`competition_season_id` puede existir como contexto auxiliar para resolver ambiguedades, pero el mapping principal es fuente+id.

### `competition_team_mapping`

Participacion temporal de un equipo en una temporada/competencia.

PK `(competition_season_id, team_key)`.

Aqui viven:

- `group_code`.
- `status`.
- `seed_rating`.
- metadata especifica de torneo.

## 4. Partidos: definicion final

### `matches`

Estructura final:

- `match_id` PK canonico.
- `competition_season_id` not null FK.
- `season`.
- `match_type`.
- `date`.
- `kickoff_utc`.
- `kickoff_chile` cache.
- `stage`.
- `group_code`.
- `home_team_key` FK.
- `away_team_key` FK.
- `home_team_name` cache.
- `away_team_name` cache.
- `venue_id` FK futura.
- `home_score`, `away_score`.
- `status`.
- `winner`.
- `payload`.

Eliminar/deprecar:

- `competition_id default 'WC2026'`.
- `api_football_fixture_id`.
- `football_data_match_id`.
- `espn_event_id`.

Los source IDs viven en `match_source_ids`.

Regla: un partido normalizado no puede estar sin `competition_season_id`. Si no se puede resolver, queda en `source_fixtures`/staging, no en `matches`.

## 5. Odds: definicion final

### `odds_snapshots`

Mercado puro. No contiene modelo, EV ni Kelly.

Columnas finales:

- `odds_snapshot_id` UUID PK.
- `competition_season_id` FK.
- `match_id` FK.
- `bookmaker`.
- `market`.
- `selection`.
- `line`.
- `decimal_odds`.
- `implied_probability`.
- `captured_at`.
- `bookmaker_count`.
- `market_quality_score`.
- `liquidity_tier`.
- `odds_volatility`.
- `is_closing` boolean default false.
- `payload`.

Unique recomendado:

`(match_id, bookmaker, market, selection, coalesce(line, 0), captured_at)`.

Deprecar:

- `model_probability`.

### `market_closing_odds`

Mantener para cierre oficial por mercado/bookmaker.

Uso CLV:

- `betting_decisions` referencia odds tomada.
- closing se busca por `(match_id, market, selection, bookmaker)` o perfil de mercado.
- CLV se calcula post cierre y se guarda en analytics/metrics, no en snapshot crudo.

## 6. Predicciones: definicion final

### `model_runs`

Un run identifica version, parametros y lineage.

Columnas obligatorias:

- `model_run_id`.
- `model_name`.
- `model_version`.
- `competition_season_id`.
- `market`.
- `feature_set_version`.
- `training_window_start`, `training_window_end`.
- `calibration_method`.
- `git_sha`.
- `params`.
- `created_at`.

### `model_predictions`

Una prediccion por run/match/market/selection/as_of.

Columnas obligatorias:

- `prediction_id`.
- `model_run_id`.
- `competition_season_id`.
- `match_id`.
- `match_type`.
- `market`.
- `selection`.
- `raw_probability`.
- `calibrated_probability`.
- `fair_odds`.
- `as_of`.
- `feature_snapshot_id` futura FK recomendada.
- `calibration_run_id` futura FK recomendada.
- `flags`.
- `payload`.

Unique recomendado:

`(model_run_id, match_id, market, selection, as_of)`.

Regla anti-leakage:

Toda feature o cuota usada debe tener `as_of <= model_predictions.as_of`.

`model_outputs` queda legacy.

## 7. EV / Betting: definicion final

### `betting_decisions`

Tabla canonica de decisiones. No es apuesta; es decision del motor.

Debe contener:

- `betting_decision_id`.
- `competition_season_id`.
- `prediction_id` FK.
- `odds_snapshot_id` FK o clave compuesta transitoria.
- `match_id`.
- `market`.
- `selection`.
- `calibrated_probability_used`.
- `decimal_odds`.
- `edge`.
- `ev`.
- `kelly_fraction`.
- `decision` check `BETTABLE`, `BLOCKED_COMPETITION_NOT_BETTABLE`, `BLOCKED_NO_CALIBRATION`, `BLOCKED_LOW_LIQUIDITY`, `BLOCKED_RISK`, `BLOCKED_DATA_QUALITY`, `PAPER_ONLY`.
- `block_reason`.
- `risk_engine_version`.
- `decided_at`.
- `payload`.

Reglas:

- Si `decision != BETTABLE`, `block_reason` not null.
- Si la competencia no es `BETTABLE`, decision obligatoria `BLOCKED_COMPETITION_NOT_BETTABLE`.
- Debe usar probabilidad calibrada.

### `bets`

Representa ejecucion real o paper.

Columnas finales:

- `bet_id`.
- `betting_decision_id`.
- `bet_mode` check `REAL`, `PAPER`.
- `stake`.
- `decimal_odds_taken`.
- `placed_at`.
- `settled_at`.
- `result`.
- `profit_loss`.
- `notes`.

`ev_picks` queda view/legacy.

## 8. Arquitectura final por capas

### RAW

Ownership: ingestion.

Escritura: solo ingestores y migraciones.

Lectura: staging, auditoria, debugging.

Tablas: `sheet_raw_rows`, `source_fixtures`, `news_items`, `weather_snapshots`, futura `source_match_stats`, futura `source_odds_events`.

Reglas:

- Nunca corregir datos raw in-place.
- Idempotencia por source + source id + fetched_at/hash.
- Mantener payload completo.

### STAGING

Ownership: normalization.

Escritura: jobs de normalizacion.

Lectura: resolvers canonicos.

Tablas/views: `stg_matches`, `stg_teams`, `stg_players`, `stg_odds`, `stg_rosters`, `stg_lineups`.

Reglas:

- Puede contener errores y duplicados marcados.
- No alimentar frontend.
- Debe exponer `quality_status`.

### CANONICAL

Ownership: domain resolvers.

Escritura: solo resolvers canonicos.

Lectura: analytics, features, published.

Reglas:

- FKs reales.
- Sin defaults a Mundial.
- Temporalidad explicita.
- Cache denormalizado permitido solo si la relacion canonica existe.

### ANALYTICS

Ownership: quant/model/risk.

Escritura: jobs versionados.

Lectura: risk, metrics, published.

Reglas:

- Todo output debe tener version/as_of.
- No mutar historia salvo correccion auditada.
- Modelos, features y calibraciones deben ser reproducibles.

### PUBLISHED

Ownership: API/frontend.

Escritura: preferentemente views/materialized views.

Lectura: frontend, Telegram, API publica.

Reglas:

- Sin logica de dominio compleja.
- Backwards compatibility vive aqui, no en canonical.

## 9. Bounded contexts

| Contexto | Owns | Puede depender de |
|---|---|---|
| competition-domain | `competitions`, `competition_seasons`, status/readiness | observability |
| team-domain | `teams`, aliases, source mappings, competition mapping | competition-domain |
| player-domain | `players`, memberships, rosters, lineups | team-domain, competition-domain |
| match-domain | `matches`, source ids, events, venues | competition/team/player |
| odds-domain | `odds_snapshots`, closing odds, market profiles | match/competition |
| prediction-domain | `model_runs`, `model_predictions`, features | match/team/player/odds only by as_of |
| calibration-domain | calibration runs/bins/metrics | prediction/results |
| risk-domain | betting decisions, bets, bankroll | prediction/odds/calibration/competition |
| analytics-domain | dashboards, metrics, published aggregates | all read-only |
| observability-domain | pipeline runs, data quality, domain events | all contexts append-only |

Eventos principales:

- `RAW_INGESTED`
- `MATCH_NORMALIZED`
- `TEAM_RESOLVED`
- `PLAYER_RESOLVED`
- `ODDS_SNAPSHOT_CAPTURED`
- `FEATURE_SNAPSHOT_CREATED`
- `MODEL_RUN_COMPLETED`
- `PREDICTION_CREATED`
- `CALIBRATION_COMPLETED`
- `BETTING_DECISION_CREATED`
- `BET_SETTLED`
- `DATA_QUALITY_EVENT_RAISED`

## 10. Pipeline final

```text
RAW INGESTION
-> STAGING NORMALIZATION
-> CANONICAL RESOLUTION
-> FEATURE SNAPSHOTS
-> MODEL RUNS
-> CALIBRATION
-> EV/RISK
-> SETTLEMENT
-> ANALYTICS
-> PUBLISHED
```

Reglas operativas:

- Reintentos: por step, con idempotency key.
- Deduplicacion: raw hash + source id; canonical natural keys; analytics run ids.
- Reprocessing: permitido desde RAW/STAGING creando nuevas versiones/as_of.
- Rollback: desactivar published/materialized views o volver a version anterior; no borrar historia.
- Errores: van a `data_quality_events` y `pipeline_runs`.

## 11. Control de complejidad

### Implementar ahora

- `competition_season_id` obligatorio en todo nuevo dato.
- `sheet_raw_rows` completo.
- `players` sin relacion permanente a equipos.
- `player_aliases`, `source_player_mapping`.
- `competition_rosters`.
- `matches` sin default `WC2026`.
- `odds_snapshots` sin `model_probability`.
- `betting_decisions` como fuente canonica de EV.
- Views published para frontend.

### Postergar

- `cross_league_calibration` avanzado.
- `league_strength_coefficients` aprendido automaticamente.
- `drift_reports` sofisticados.
- `experiment_tracking` completo.
- `simulation_runs` formal si el volumen es bajo.

### Experimental

- sentiment analysis de noticias.
- features de lesiones automatizadas.
- transfer normalization inter-liga.
- liquidity scoring aprendido.

### No implementar todavia

- Deep learning.
- Feature store compleja externa.
- Microservicios por bounded context.
- Orquestador pesado tipo Airflow si GAS/cron todavia alcanza.
- Materialized views prematuras para todo.

Critica dura: la mayor amenaza es sobre-normalizar antes de tener volumen y disciplina operativa. La segunda amenaza es mantener defaults y caches legacy que parecen inocentes pero contaminan el modelo multi-liga.

## 12. Roadmap final

### MVP 30d obligatorio

- Raw backup completo de Sheets.
- Migracion canonica minima: competitions, teams, players, matches, odds, predictions, betting decisions.
- Agregar tablas de jugadores faltantes.
- Deprecar `players.team_key` a nivel semantico.
- Bloquear EV si competencia no `BETTABLE`.
- Published views para dashboard actual.
- Validacion por conteos, duplicados y FKs.

### MVP 30d recomendado

- `match_lineups`.
- `competition_rosters`.
- `odds_snapshot_id`.
- `calibrated_probability_used` en `betting_decisions`.

### Expansion 60d obligatorio

- Onboarding de Champions/Premier/Libertadores/Brasileirao en observation.
- Readiness diario.
- Features versionadas por competencia.
- Rating snapshots.
- Calibration runs por competencia/mercado/temporada/tipo de partido.

### Expansion 60d recomendado

- `venues`, `referees`, `match_officials`.
- `match_events`.
- Published competition health dashboard.

### Plataforma 90d obligatorio

- Champion/challenger por competencia/mercado.
- Backtesting temporal.
- CLV real con closing odds.
- Drift reports basicos.
- Bankroll snapshots.
- Paso controlado a `BETTABLE` solo con readiness.

### Plataforma 90d experimental

- LightGBM/XGBoost.
- cross-league calibration.
- sentiment/news features.
- dynamic league strength.

## 13. Orden exacto de implementacion

1. Crear migracion `004_final_canonical_contract.sql`.
2. Agregar tablas: `player_aliases`, `source_player_mapping`, `team_memberships`, `competition_rosters`, `match_lineups`, `match_events`, `venues`, `referees`, `match_officials`.
3. Alterar `teams`: agregar `team_type`, `gender`; marcar `group_code` legacy.
4. Alterar `players`: agregar campos persona; mantener `team_key/team_name` solo cache legacy.
5. Alterar `matches`: asegurar `competition_season_id`, quitar default `WC2026`, preparar FKs.
6. Alterar `odds_snapshots`: agregar `odds_snapshot_id`, `line`, `is_closing`; deprecar `model_probability`.
7. Alterar `betting_decisions`: agregar `calibrated_probability_used`, `odds_snapshot_id`, checks de block reason.
8. Alterar `bets`: agregar `betting_decision_id`, `bet_mode`, timestamps de ejecucion/liquidacion.
9. Crear published views de compatibilidad.
10. Importar Sheets solo a RAW (`sheet_raw_rows`), sin asumir hoja = tabla.
11. Crear resolvers STAGING -> CANONICAL para equipos, jugadores, partidos, odds y predicciones.
12. Poblar canonical desde resolvers, no desde mappers hoja-tabla.
13. Validar FKs, conteos y duplicados.
14. Cambiar frontend/API a PUBLISHED.
15. Desactivar lecturas directas de Sheets.

## 14. Fases implementadas para carga final

Sheets se usa solo como input temporal. Los loaders finales no guardan raw payload en tablas canonicas/analytics; escriben `payload = {}` y solo columnas utiles para el proyecto final.

### Fase A - Bootstrap final

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/bootstrap" \
  -H "Authorization: Bearer $WEB_KEY"
```

Responsabilidad:

- crear/actualizar catalogo multi-competencia,
- preparar readiness/status,
- no migrar hojas.

### Fase B - Equipos y participacion

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-teams" \
  -H "Authorization: Bearer $WEB_KEY"
```

Escribe:

- `teams`
- `team_aliases`
- `source_team_mapping`
- `competition_team_mapping`

Input temporal:

- `Equipos`
- `Clasificacion`

Regla:

- `Equipos` no tiene que tener 48 filas. La participacion WC2026 se resuelve cruzando fuentes y queda en `competition_team_mapping`.

### Fase C - Jugadores

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-players" \
  -H "Authorization: Bearer $WEB_KEY"
```

Escribe:

- `players`
- `player_aliases`
- `source_player_mapping`
- `team_memberships`
- `competition_rosters`

Input temporal:

- `Jugadores`
- `Planteles`

Regla:

- `players.team_key` no se usa como verdad canonica.

### Fase D - Partidos

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-matches" \
  -H "Authorization: Bearer $WEB_KEY"
```

Escribe:

- `matches`
- `match_source_ids`

Input temporal:

- `Partidos`

Regla:

- ejecutar despues de `load-teams`,
- `competition_season_id` obligatorio,
- source IDs van a `match_source_ids`.

### Fase E - Odds

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-odds" \
  -H "Authorization: Bearer $WEB_KEY"
```

Escribe:

- `odds_snapshots`

Input temporal:

- `OddsApuestas`

Regla:

- no escribir `model_probability`,
- no escribir EV,
- no escribir Kelly.

### Fase F - Predicciones

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-predictions" \
  -H "Authorization: Bearer $WEB_KEY"
```

Escribe:

- `model_runs`
- `model_predictions`

Input temporal:

- `PoissonOdds`

Regla:

- `model_outputs` queda legacy y no se puebla como destino final.

### Fase G - Bets historicos

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-bets" \
  -H "Authorization: Bearer $WEB_KEY"
```

Escribe:

- `bets`

Input temporal:

- `BettingHistory`

Regla:

- bets representa ejecucion/paper bet, no pick.

### Fase completa MVP

Endpoint:

```bash
curl -sS -X POST "$POOL_API_URL/api/v1/admin/final/load-all-mvp" \
  -H "Authorization: Bearer $WEB_KEY"
```

Usar solo si el dataset es pequeno. Para evitar timeouts, preferir fases separadas.

## Decisiones no negociables

- `competition_season_id` es la unidad operativa.
- `players.team_key` no es verdad canonica.
- Odds no contienen probabilidades de modelo.
- EV no vive en odds ni en predictions; vive en risk/betting decisions.
- `model_outputs`, `ev_picks`, `model_calibration`, `elo_ratings` son legacy.
- Published views absorben compatibilidad; canonical no se contamina para sostener UI vieja.
