# Pool Team 2026 - migracion a Supabase como base principal

Fecha: 2026-06-20  
Rama: `feature/refactor-cross`

## Objetivo

Migrar el proyecto desde Google Sheets como almacenamiento principal hacia Supabase/PostgreSQL, manteniendo una etapa paralela donde Google Sheets sigue funcionando tal cual mientras se valida que Supabase contiene la misma informacion y puede alimentar el sistema.

La estrategia implementada es:

```text
Fase 1: Sheets primario + Supabase apagado
Fase 2: Sheets primario + migracion historica a Supabase
Fase 3: Sheets primario + dual-write a Supabase
Fase 4: Supabase primary-read + Sheets como fallback/espejo
Fase 5: Supabase primario definitivo
```

## Archivos agregados

- `src/SupabaseClient.gs`: cliente REST seguro, mappers y feature flags.
- `src/SupabaseMigration.gs`: funciones publicas de dry-run, migracion, validacion y activacion.
- `supabase/migrations/001_initial_schema.sql`: schema inicial PostgreSQL.

## Script Properties requeridas

Configurar en Apps Script:

```text
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...                 opcional
SUPABASE_DUAL_WRITE=false             inicio seguro
SUPABASE_PRIMARY_READ=false           inicio seguro
SUPABASE_PRIMARY_WRITE=false          inicio seguro
SUPABASE_MIGRATION_BATCH_SIZE=200     opcional
```

Importante: `SUPABASE_SERVICE_ROLE_KEY` nunca debe ir al frontend ni al repositorio. Solo se usa en GAS backend.

Valores recomendados ahora que las migraciones ya fueron ejecutadas:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-secret>
SUPABASE_ANON_KEY=<anon-public-key>              opcional, solo si algun frontend futuro lo necesita
SUPABASE_DUAL_WRITE=false                        antes de migrar historico
SUPABASE_PRIMARY_READ=false                      mantener false hasta validar conteos
SUPABASE_PRIMARY_WRITE=false                     mantener false hasta el cutover
SUPABASE_MIGRATION_BATCH_SIZE=200                100 si ves timeouts; 500 si la migracion va estable
```

Despues de `supabaseMigrateMvp30Apply()`, el propio script deja:

```text
SUPABASE_DUAL_WRITE=true
SUPABASE_PRIMARY_READ=false
SUPABASE_PRIMARY_WRITE=false
```

No activar `SUPABASE_PRIMARY_READ=true` hasta revisar `supabaseValidateAgainstSheets()` y probar dashboard/bot con dual-write.

## Crear la base

1. Abrir Supabase SQL Editor.
2. Ejecutar completo:

```text
supabase/migrations/001_initial_schema.sql
```

3. Ejecutar luego:

```text
supabase/migrations/002_multi_competition_readiness.sql
```

4. Confirmar que existen estas tablas principales:

- `teams`
- `players`
- `matches`
- `standings`
- `player_match_stats`
- `player_match_summary`
- `odds_snapshots`
- `model_outputs`
- `ev_picks`
- `bets`
- `model_calibration`
- `group_simulations`
- `elo_ratings`
- `pipeline_runs`
- `data_quality_log`
- `sheet_raw_rows`
- `competitions`
- `competition_seasons`
- `competition_status`
- `competition_readiness_checks`
- `team_aliases`
- `competition_team_mapping`
- `source_team_mapping`
- `model_runs`
- `model_predictions`
- `calibration_runs`
- `calibration_bins`
- `betting_decisions`
- `market_closing_odds`
- `model_metrics`
- `data_quality_events`

## Runbook actual: MVP 30 dias

Con ambas migraciones aplicadas, ejecutar en este orden desde Apps Script:

```javascript
supabaseStatus()
supabaseMigrationDryRun()
supabaseMigrateMvp30Apply()
supabaseMvp30Status()
```

`supabaseMigrateMvp30Apply()` hace todo el arranque del MVP:

- seed de catalogo multi-competencia,
- seed de status/readiness,
- migracion core de Sheets a Supabase,
- migracion de aliases y mappings de equipos,
- validacion contra Sheets,
- activacion de dual-write,
- mantiene primary-read apagado.
- mantiene primary-write apagado.

El resultado esperado es:

```text
SUPABASE_DUAL_WRITE=true
SUPABASE_PRIMARY_READ=false
SUPABASE_PRIMARY_WRITE=false
WC2026=PAPER_TRADING salvo que se promueva manualmente luego de readiness
Nuevas ligas=OBSERVATION
```

## Cutover: Supabase como fuente unica

Despues de migrar y validar conteos, ejecutar:

```javascript
supabaseCutoverToPrimaryApply()
```

Esto deja el runtime asi:

```text
SUPABASE_PRIMARY_READ=true
SUPABASE_PRIMARY_WRITE=true
SUPABASE_DUAL_WRITE=false
```

Desde ese momento:

- `readAll_()` lee desde Supabase para hojas soportadas.
- `appendRows_()`, `appendRow_()` y `upsertRowsByKey_()` escriben directo en Supabase.
- Hojas no soportadas quedan bloqueadas como escritura primaria para evitar crear una segunda fuente de verdad accidental.
- `updateRow_()` por indice queda bloqueado porque no es seguro en Supabase; debe refactorizarse a upsert por clave canonica.

Rollback operativo:

```javascript
supabaseRollbackToSheetsApply()
```

Ese rollback deja:

```text
SUPABASE_PRIMARY_READ=false
SUPABASE_PRIMARY_WRITE=false
SUPABASE_DUAL_WRITE=false
```

## Cutover por API v1

```bash
curl -sS "$POOL_API_URL/api/v1/health" \
  -H "Authorization: Bearer $WEB_KEY"

curl -sS -X POST "$POOL_API_URL/api/v1/admin/supabase/bootstrap-mvp30" \
  -H "Authorization: Bearer $WEB_KEY"

curl -sS "$POOL_API_URL/api/v1/admin/supabase/validate" \
  -H "Authorization: Bearer $WEB_KEY"

curl -sS -X POST "$POOL_API_URL/api/v1/admin/supabase/cutover-primary" \
  -H "Authorization: Bearer $WEB_KEY"

curl -sS -X POST "$POOL_API_URL/api/v1/admin/supabase/rollback-sheets" \
  -H "Authorization: Bearer $WEB_KEY"
```

Para operar readiness:

```javascript
markCompetitionCheckPass('WC2026', 'fixtures_reliable', { notes: 'fixture completo validado' })
markCompetitionCheckPass('WC2026', 'results_reliable', { notes: 'resultados resueltos' })
markCompetitionCheckFail('WC2026', 'separate_calibration', { notes: 'muestra insuficiente' })
evaluateCompetitionReadiness_('WC2026')
```

Transiciones:

```javascript
setCompetitionObservation('EPL_2025')
setCompetitionPaperTrading('EPL_2025')
setCompetitionBettable('WC2026', 'Readiness completo y CLV validado', 'operator')
disableCompetition('CHI_PRIMERA_2025', 'Liquidez insuficiente')
```

Regla de seguridad: `setCompetitionBettable()` falla si cualquier readiness check obligatorio sigue en `FAIL`.

## Runbook expansion 60 dias

Cuando el MVP ya este migrado y dual-write este estable:

```javascript
supabasePrepareExpansion60Apply()
```

Esto prepara:

- `competition_market_profiles` para 1X2 por competencia,
- `feature_definitions` versionadas,
- `league_strength_coefficients` iniciales,
- catalogo multi-competencia resembrado sin degradar estados existentes.

Las competencias siguen sin ser apostables salvo que `competition_status.status = BETTABLE`.

## Runbook plataforma 90 dias

Para dejar lista la capa champion/challenger:

```javascript
supabasePreparePlatform90Apply()
```

Esto ejecuta el scaffold 60d y agrega entradas iniciales en `model_registry`:

- `POISSON_DC v1` como baseline champion,
- `ELO_CONTEXTUAL v1` como challenger,
- `LIGHTGBM_TABULAR planned_v1` como modelo planificado.

## Funciones GAS publicas

### 1. Estado

```javascript
supabaseStatus()
```

Debe mostrar:

```text
configured: true
dual_write: false
primary_read: false
```

### 2. Dry-run de migracion

```javascript
supabaseMigrationDryRun()
```

No escribe en Supabase. Cuenta filas por hoja y valida que el mapeo este listo.

### 3. Migracion historica completa

```javascript
supabaseMigrationApply()
```

Migra las hojas soportadas hacia tablas limpias. Las hojas no soportadas quedan disponibles para migracion raw si se agregan en el futuro.

### 4. Migracion solo core

```javascript
supabaseMigrateCoreApply()
```

Migra solo las entidades principales:

- partidos
- equipos
- jugadores
- clasificacion
- stats de jugadores
- odds/modelos
- EV/historico
- calibracion
- ELO

### 5. Validacion contra Sheets

```javascript
supabaseValidateAgainstSheets()
```

Compara conteos por hoja/tabla. No activa nada si hay diferencias.

### 6. Activar dual-write

```javascript
supabaseSetDualWrite(true)
```

Desde ese momento, los helpers actuales (`appendRows_`, `appendRow_`, `upsertRowsByKey_`) siguen escribiendo en Sheets y ademas espejan a Supabase.

### 7. Activar lectura primaria

```javascript
supabaseEnableAfterValidation()
```

Ejecuta validacion y solo activa:

```text
SUPABASE_DUAL_WRITE=true
SUPABASE_PRIMARY_READ=true
```

si no hay blockers.

### 8. Rollback runtime

```javascript
supabaseDisableRuntime()
```

Apaga:

```text
SUPABASE_DUAL_WRITE=false
SUPABASE_PRIMARY_READ=false
```

El sistema vuelve a leer/escribir solo Sheets.

## Como funciona el puente

`readAll_(sheetName)` ahora intenta leer desde Supabase solo si:

```text
SUPABASE_PRIMARY_READ=true
```

y la hoja esta soportada por `SUPABASE_SHEET_TABLES`.

Si Supabase falla, hace fallback automatico a Sheets y registra en Logger.

Las escrituras siguen escribiendo primero a Sheets. Si:

```text
SUPABASE_DUAL_WRITE=true
```

tambien se espejan a Supabase.

Esto permite que los crons actuales sigan funcionando mientras se prueba Supabase.

## Hojas soportadas en migracion limpia

- `Partidos` -> `matches`
- `Equipos` -> `teams`
- `Jugadores` -> `players`
- `Clasificacion` -> `standings`
- `PlayerMatchStats` -> `player_match_stats`
- `ResumenJugadorPartido` -> `player_match_summary`
- `OddsApuestas` -> `odds_snapshots`
- `PoissonOdds` -> `model_outputs`
- `AnalisisIA` -> `model_outputs`
- `EvOpportunities` -> `ev_picks`
- `EvHistorico` -> `ev_picks`
- `BettingHistory` -> `bets`
- `ModelCalibration` -> `model_calibration`
- `SimulacionGrupos` -> `group_simulations`
- `EloRatings` -> `elo_ratings`
- `PipelineRuns` -> `pipeline_runs`
- `DataQualityLog` -> `data_quality_log`
- `SourceFixtures` -> `source_fixtures`
- `MatchMapping` -> `match_source_ids`
- `EstadiosClima` -> `weather_snapshots`
- `Noticias` -> `news_items`

## Validaciones antes de activar Supabase primario

Checklist minimo:

- `supabaseStatus().configured === true`
- `supabaseMigrationDryRun()` sin errores.
- `supabaseMigrationApply()` con errores en cero o conocidos.
- `supabaseValidateAgainstSheets()` sin `MISSING_ROWS`.
- WebApp carga correctamente con `SUPABASE_PRIMARY_READ=false`.
- Activar `SUPABASE_DUAL_WRITE=true`.
- Ejecutar un cron no destructivo y validar que nuevas filas llegan a Supabase.
- Solo despues activar `supabaseEnableAfterValidation()`.

## Rollback

Si cualquier endpoint web o cron se comporta raro:

```javascript
supabaseDisableRuntime()
```

No se pierde informacion: Sheets sigue siendo escrito primero en esta fase.

## Proximas mejoras

- Mover consultas pesadas del frontend a vistas SQL.
- Agregar RLS de solo lectura para frontend publico.
- Crear Edge Function o endpoint Supabase para la web y dejar GAS solo para jobs.
- Separar `EvOpportunities` de `EvHistorico` definitivamente en modelo `ev_picks`.
- Agregar tabla `api_quota_usage`.
- Agregar tabla `model_run_metrics`.
- Agregar `closing_odds` y CLV.
