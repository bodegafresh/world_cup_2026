# Carga inicial Google Sheets -> Supabase limpio

Este ETL no replica hojas como tablas. Lee datos históricos del Google Sheet y los promueve al modelo normalizado de `001_clean_schema.sql`.

## Orden de ejecución

```javascript
bootstrapInitialLoad_step1_raw();
bootstrapInitialLoad_step2_competitions();
bootstrapInitialLoad_step3_teams();
bootstrapInitialLoad_step4_players();
bootstrapInitialLoad_step5_matches();
bootstrapInitialLoad_step6_rosters_lineups();
bootstrapInitialLoad_step7_stats_events();
bootstrapInitialLoad_step8_odds_predictions_ev();
bootstrapInitialLoad_step9_calibration_ratings();
bootstrapInitialLoad_step10_quality_validation();
```

También se puede ejecutar por lotes con:

```javascript
bootstrapInitialLoadRunner();
```

Cada llamada procesa un lote y guarda cursor en `PropertiesService`.

## Script Properties necesarias

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` con la service role key real. No usar anon key para bootstrap.
- `BOOTSTRAP_SPREADSHEET_ID`
- `BOOTSTRAP_BATCH_SIZE`, opcional
- `BOOTSTRAP_DRY_RUN`, opcional

El bootstrap usa la RPC `app_transaction_batch` definida en `001_clean_schema.sql`.
Si aparece un error RLS sobre `raw_source_payloads` o `pipeline_runs`, normalmente significa una de estas dos cosas:

- se configuró `SUPABASE_SERVICE_ROLE_KEY` con la anon key;
- no se ejecutó la versión actualizada de `001_clean_schema.sql` que crea las funciones transaccionales `SECURITY DEFINER`.

## Mapeo principal

- Todas las hojas operativas -> `raw_source_payloads` primero.
- `Equipos`, `Clasificacion`, `Partidos`, `SourceFixtures`, `Planteles` -> `teams`, `team_aliases`, `competition_team_entries`, `competition_group_memberships`, `entity_external_refs`.
- `Jugadores`, `Planteles`, `Alineaciones`, `PlayerMatchStats`, `EventosLive`, `ResumenJugadorPartido` -> `players`, `player_aliases`, `team_memberships`, `competition_rosters`, `entity_external_refs`.
- `Partidos`, `SourceFixtures`, `MatchMapping` -> `matches`, `match_participants`, `venues`, `entity_external_refs`.
- `Planteles`, `Alineaciones` -> `competition_rosters`, `match_lineups`.
- `PlayerMatchStats`, `ResumenJugadorPartido`, `EventosLive` -> `player_match_stats`, `match_events`.
- `OddsApuestas` -> `bookmaker_profiles`, `odds_snapshots`.
- `PoissonOdds` -> `model_registry`, `model_runs`, `model_predictions`.
- `EvOpportunities`, `EvHistorico`, `BettingHistory` -> `betting_decisions`, `bets`.
- `ModelCalibration`, `EloRatings` -> `calibration_runs`, `rating_snapshots`.

## Reglas importantes

- Fechas operativas se escriben como ISO UTC para columnas `timestamptz`.
- `fecha_chile` y `hora_chile` solo son fallback de conversión, nunca se guardan como verdad canónica.
- IDs externos van a `entity_external_refs`.
- Si una entidad no se puede resolver, se registra en `entity_resolution_queue` o `data_quality_events`.
- `odds_snapshots` guarda solo mercado: no guarda EV, Kelly ni probabilidad de modelo.
- `PoissonOdds` 1X2 se transforma en tres predicciones: `HOME`, `DRAW`, `AWAY`.

## Validación final

Ejecutar:

```javascript
validateBootstrapCounts();
```

Debe revisar conteos y la vista `published_data_quality_health`, incluyendo:

- matches sin HOME/AWAY,
- aliases ambiguos,
- external refs duplicadas,
- odds después del kickoff,
- predicciones sin odds comparables,
- decisiones bloqueadas sin razón,
- EV apostable en competencia no `BETTABLE`.
