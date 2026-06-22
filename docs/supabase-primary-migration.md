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
SUPABASE_MIGRATION_BATCH_SIZE=200     opcional
```

Importante: `SUPABASE_SERVICE_ROLE_KEY` nunca debe ir al frontend ni al repositorio. Solo se usa en GAS backend.

## Crear la base

1. Abrir Supabase SQL Editor.
2. Ejecutar completo:

```text
supabase/migrations/001_initial_schema.sql
```

3. Confirmar que existen estas tablas principales:

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
