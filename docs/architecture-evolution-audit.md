# Pool Team 2026 - auditoria tecnica y evolucion arquitectonica

Fecha: 2026-06-20  
Alcance: Google Apps Script, Google Sheets, frontend estatico y archivos XLSX/PDF recientes del proyecto.  
Decision de contexto: se mantiene Google Sheets como fuente operativa de corto plazo, pero se disena una salida gradual a Supabase/PostgreSQL para cuando el proyecto lo necesite.

## 1. Diagnostico ejecutivo

Pool Team 2026 ya dejo de ser una app experimental de picks. Hoy opera como un sistema cuantitativo deportivo con ingesta, normalizacion parcial, modelos, EV, bankroll, historicos, alertas y front web.

El salto mas importante reciente fue introducir una capa de validacion antes de publicar salidas del modelo. Eso cambio la arquitectura de:

```text
calculo -> publicacion
```

a:

```text
calculo -> validacion -> saneamiento -> clasificacion -> publicacion
```

Ese es el camino correcto. El principal riesgo ya no es "falta una feature"; el riesgo real es publicar informacion derivada desde datos o modelos inconsistentes. Por eso la prioridad tecnica debe ser robustez historica, trazabilidad y contratos de datos.

Estado por area:

| Area | Estado | Riesgo principal |
| --- | --- | --- |
| UI/UX | Alta madurez | Algunas vistas todavia dependen de datos ambiguos |
| GAS backend | Funcional, pero muy acoplado | Archivos grandes, helpers duplicados, legacy activo |
| Data quality | Mejorando | IDs, fechas y equipos aun pueden divergir por fuente |
| Modelos | Utiles, pero fragiles | Fallbacks simetricos, lambdas extremas, baja muestra |
| EV+ | Conceptualmente mejorado | Debe separar oportunidad real, mercado sobrepreciado y bloqueos |
| Historial/ROI | Base buena | Falta separar pick publicado, pick tomado y pick resuelto |
| Observabilidad | Inicial | PipelineRuns y DataQuality deben volverse la cabina de control |
| Escalabilidad | Aceptable para Sheets | Necesita migracion gradual si crece el historico |

## 2. Arquitectura actual

La arquitectura real hoy puede verse asi:

```text
APIs gratuitas / fuentes web
  - ESPN
  - API-Football
  - Football-Data
  - The Odds API
  - Betfair
  - OpenAI / IA
  - RSS / noticias
        |
        v
Google Apps Script
  - ingesta diaria
  - backfills
  - normalizadores
  - modelos
  - EV/Kelly
  - Telegram
        |
        v
Google Sheets
  - Partidos
  - Clasificacion
  - PlayerMatchStats
  - PoissonOdds
  - AnalisisIA
  - EvOpportunities
  - EvHistorico
  - PipelineRuns
  - DataQualityLog
        |
        v
WebApp + frontend estatico
  - Hoy / En vivo
  - Equipos
  - Eliminatorias
  - Jugadores
  - EV+
  - Modelo
```

La separacion por dominios existe de forma implicita, pero no esta completamente materializada en carpetas o contratos. El sistema ya tiene buenas piezas: `SheetsRepository.gs`, `SheetManager.gs`, normalizadores, `BettingMath.gs`, `EvModel.gs`, `BettingHistory.gs`, `GroupSimulator.gs`, `WebApp.gs`. El problema es que varias responsabilidades se repiten o se mezclan entre modulos.

## 3. Auditoria de codigo

Hallazgos principales del repo:

- Hay alrededor de 29.500 lineas entre GAS y frontend.
- Archivos grandes concentran demasiada responsabilidad:
  - `src/WebApp.gs`: mas de 2.300 lineas.
  - `../world_cup_2026_web/js/app.js`: cerca de 2.000 lineas.
  - `../world_cup_2026_web/css/styles.css`: mas de 1.500 lineas.
  - `src/BotCommands.gs`, `src/ManualTest.gs`, `src/BackfillRunner.gs`, `src/BetfairApi.gs`, `src/EvModel.gs`, `src/LiveEvents.gs` superan o rondan 900-1.400 lineas.
- Se detectaron nombres de funciones duplicados:
  - `buildMatchKey_` en `SourceMatcher.gs` y `BackfillRunner.gs`.
  - `fetchPlayerStatsByFixture_` en `ApiFootball.gs` y `PlayerMatchStats.gs`.
  - `isFinishedStatus_` en `GroupSimulator.gs` y `PipelineHealth.gs`.
- Todavia existen referencias legacy a `fixture_id_af`, aunque el contrato visible ya usa `fixture_id_api_football`. Hay alias, pero el objetivo debe ser eliminar la dependencia legacy.
- Hay multiples normalizadores de nombres de equipos: variantes de `normalizeTeamName`, `normalizeTeamNameStrong`, `teamNameToSpanish`, helpers locales `norm_`, `normT`, etc.
- Existen funciones legacy en `Main.gs` que lanzan errores de deprecacion. Eso esta bien como bloqueo, pero deberian moverse a una zona `deprecated/ops` o documentarse como compatibilidad temporal.
- Hay codigo operativo, test manual y backfill mezclado en el mismo namespace global de GAS. En GAS esto es peligroso porque todas las funciones globales comparten espacio.

Refactor recomendado:

```text
src/
  core/
    Dates.gs
    Teams.gs
    MatchKeys.gs
    SheetContracts.gs
    SourceTrust.gs
  repositories/
    SheetsRepository.gs
    MatchRepository.gs
    PlayerStatsRepository.gs
    OddsRepository.gs
  ingestion/
    EspnIngestion.gs
    ApiFootballIngestion.gs
    FootballDataIngestion.gs
    OddsIngestion.gs
  normalization/
    SourceNormalizer.gs
    DataQualityRules.gs
    RepairTools.gs
  models/
    PoissonModel.gs
    EloModel.gs
    GroupSimulator.gs
    ModelValidators.gs
  betting/
    BettingMath.gs
    EvModel.gs
    BettingHistory.gs
    BankrollModel.gs
  web/
    WebApi.gs
    WebMappers.gs
  ops/
    Crons.gs
    BackfillRunner.gs
    ManualTools.gs
```

En GAS no hace falta replicar carpetas fisicas si el editor no lo facilita, pero si conviene usar prefijos y documentar ownership por modulo.

## 4. Normalizacion de datos

El sistema necesita entidades canonicas. Sheets puede seguir siendo almacenamiento, pero cada hoja debe representar una entidad clara.

Entidades recomendadas:

| Entidad | Hoja actual o futura | Clave unica recomendada |
| --- | --- | --- |
| competitions | `Competitions` | `competition_id` |
| teams | `Equipos` | `team_id_canonical` |
| team_aliases | `TeamAliases` | `source + source_team_id` |
| players | `Jugadores` | `player_id_canonical` |
| player_aliases | `PlayerAliases` | `source + source_player_id` |
| matches | `Partidos` | `match_id` |
| match_source_ids | `MatchMapping` | `source + source_match_id` |
| raw_fixtures | `SourceFixtures` | `source_fixture_key` |
| match_stats | `EspnStats` / futura `MatchStats` | `match_id + source` |
| player_match_stats | `PlayerMatchStats` | `match_id + player_id + source` |
| standings | `Clasificacion` | `competition_id + group + team_id` |
| odds | `OddsApuestas` | `match_id + bookmaker + market + selection + captured_at` |
| model_outputs | `PoissonOdds`, `AnalisisIA` | `match_id + model_name + model_version + run_at` |
| ev_opportunities | `EvOpportunities` | `match_id + market + selection + odds_snapshot_id` |
| ev_history | `EvHistorico` | `published_pick_id` o snapshot key |
| bankroll_snapshots | `BankrollSnapshots` | `snapshot_at + strategy` |

Reglas duras:

- Todo partido debe tener `match_id` canonico interno aunque no tenga `fixture_id_api_football`.
- `fixture_id_api_football`, `espn_event_id`, `football_data_match_id` son IDs de fuente, no claves primarias de negocio.
- Las fechas se guardan en UTC y se expone `hora_chile` como derivado.
- Toda fila derivada debe tener `source`, `source_updated_at`, `normalized_at`, `sync_status`.
- No se borra historia util: se archiva o se marca con estado.
- Los duplicados accidentales se eliminan solo con una clave deterministica.
- Las fuentes contradictorias no se pisan en silencio: se registran en `DataQualityLog`.

Estados de sincronizacion sugeridos:

```text
PENDING
FETCHED_RAW
NORMALIZED
ENRICHED
PUBLISHED
LOCKED_FINAL
CONFLICT
INVALID
ARCHIVED
```

## 5. Estrategia ETL

El pipeline debe separarse en cuatro capas.

### RAW

Datos tal como llegan desde APIs.

Objetivo:

- Preservar payload o campos fuente.
- No calcular.
- No traducir nombres.
- No corregir fechas.
- Deduplicar solo por `source_fixture_key`.

Hojas actuales relacionadas:

- `SourceFixtures`
- `RawLog`
- futuras hojas `RawOdds`, `RawPlayerStats`, `RawEvents`

### NORMALIZED

Datos limpios, con nombres canonicos e IDs internos.

Objetivo:

- Resolver equipos y jugadores.
- Asignar `match_id`.
- Normalizar estados (`NS`, `LIVE`, `FT`, `AET`, `PEN`).
- Normalizar timezone.

Hojas:

- `Partidos`
- `Equipos`
- `Jugadores`
- `MatchMapping`
- `TeamAliases`

### ENRICHED

Datos derivados por reglas o modelos.

Objetivo:

- ELO.
- Poisson.
- Probabilidades implicitas.
- Overround.
- Edge.
- EV.
- Kelly.
- Flags de modelo.

Hojas:

- `EloRatings`
- `PoissonOdds`
- `AnalisisIA`
- `SimulacionGrupos`
- `EvOpportunities`

### ANALYTICS

Datos para aprender y medir.

Objetivo:

- ROI.
- Yield.
- CLV.
- Calibracion.
- Bankroll.
- Performance por rango EV.
- Precision del modelo.

Hojas:

- `EvHistorico`
- `BettingHistory`
- `ModelCalibration`
- `BankrollSnapshots`
- futura `ModelRunMetrics`

## 6. Validacion del modelo

El modelo no debe publicar picks si cae en patrones matematicos sospechosos. Los flags actuales son una buena base; hay que formalizarlos como contrato.

Flags recomendados:

| Flag | Condicion | Accion |
| --- | --- | --- |
| `INVALID_MODEL` | Probabilidades nulas, NaN, suma invalida o distribucion imposible | No publicar EV |
| `LOW_CONFIDENCE` | Pocos datos, fixture incompleto o fuente secundaria | Mostrar analisis, bloquear pick |
| `SATURATED_MODEL` | Patron extremo repetido, por ejemplo 92/4/4 | Bloquear pick |
| `EXTREME_LAMBDA` | Lambdas fuera de rango dinamico | Bloquear pick |
| `LOW_SAMPLE_SIZE` | Equipo con menos de N partidos confiables | Reducir confianza |
| `OUTLIER_MARKET` | Cuota o probabilidad de mercado fuera de rango razonable | Separar de EV+ |
| `SYMMETRIC_FALLBACK` | 34/30/34 o similar sin soporte real | Mostrar como baja confianza |
| `SOURCE_CONFLICT` | Fuentes difieren en fecha, marcador o equipos | Bloquear derivadas |

Regla de oro:

```text
EV+ solo puede usar la probabilidad final oficial del panel del modelo.
Si EV y panel difieren para el mismo match/seleccion, el pick queda bloqueado.
```

Score de confiabilidad sugerido:

```text
model_reliability =
  0.30 * data_completeness
+ 0.20 * source_trust
+ 0.20 * calibration_score
+ 0.15 * market_consistency
+ 0.15 * model_stability
```

Publicacion:

```text
reliability >= 0.75 -> publicable
0.55 - 0.74        -> mostrar analisis, no pick automatico
< 0.55             -> bloqueado
```

## 7. EV+, mercado y picks

La separacion conceptual debe ser estricta:

```text
EV > 0  -> EV_PLUS
EV <= 0 -> MARKET_OVERPRICED
modelo invalido -> PICK_BLOCKED
cuota anomala -> OUTLIER_MARKET
partido cerrado/live -> CLOSED_OR_LIVE
```

Formula:

```text
implied_market = 1 / decimal_odds
fair_odds = 1 / model_probability
edge = model_probability - implied_market
ev = (model_probability * decimal_odds) - 1
kelly_raw = ((decimal_odds - 1) * model_probability - (1 - model_probability)) / (decimal_odds - 1)
kelly_fractional = clamp(kelly_raw / divisor, 0, max_fraction)
```

Reglas de publicacion:

- No mostrar como EV+ ningun registro con `ev <= 0`.
- No mostrar partidos finalizados en EV activo.
- No borrar historia: mover snapshot a `EvHistorico` y resolver resultado.
- No usar odds antiguas para partidos con estado `FT`, `AET`, `PEN`, `LIVE`.
- Separar visualmente oportunidades reales de mercado sobrepreciado.

## 8. ROI y bankroll

La arquitectura historica debe distinguir tres conceptos que hoy tienden a mezclarse:

| Concepto | Significado |
| --- | --- |
| pick publicado | El sistema detecto y mostro oportunidad |
| pick tomado | El usuario decidio apostar o simular bankroll |
| pick resuelto | El resultado ya esta cerrado |

Tablas/hojas recomendadas:

```text
EvHistorico
  published_pick_id
  match_id
  market
  selection
  model_prob
  market_prob
  odds_open
  odds_published
  odds_close
  ev
  edge
  kelly
  model_flags
  published_at
  status
  result

BettingHistory
  bet_id
  published_pick_id
  stake
  strategy
  odds_taken
  taken_at
  result
  profit
  roi

BankrollSnapshots
  snapshot_at
  strategy
  bankroll
  exposure
  drawdown
  max_drawdown
```

Metricas clave:

- ROI por rango EV.
- Yield.
- CLV.
- Win rate por mercado.
- Brier score.
- Log loss.
- Calibration curve.
- Drawdown.
- Profit factor.
- Muestra minima por bucket.

Nunca se debe usar una muestra `n=1`, `n=3` o `n=10` para validar estadisticamente el modelo. Se puede mostrar, pero con advertencia de baja muestra.

## 9. APIs gratuitas y cuotas

Principio: cada API debe tener un rol claro.

| Fuente | Rol recomendado | Cuidado |
| --- | --- | --- |
| ESPN | Live, resultados, estadisticas complementarias | Nombres y IDs no siempre canonicos |
| API-Football | Fixture IDs, player stats, lineups, eventos oficiales | Cuota y ventana historica limitada |
| Football-Data | Fixtures/standings auxiliares | Menor detalle |
| The Odds API | Cuotas prepartido | Costosa en cuota si se consulta sin cache |
| Betfair | Referencia mercado alternativo | Normalizacion de mercados |
| Open-Meteo | Clima por estadio/hora | Cache por estadio+fecha+hora |
| RSS/noticias | Contexto IA | Dedupe y baja confianza |

Politica de cuotas:

- Nunca consultar una API si la hoja tiene dato fresco y confiable.
- Priorizar partidos de hoy, ayer y manana.
- Obtener `fixture_id_api_football` por fecha diaria, no por temporada, cuando el plan gratuito no permite temporada 2026.
- Guardar raw response o al menos hash+metadata.
- Backfill historico solo si esta dentro de ventana gratis.
- ESPN puede complementar, pero no debe sobrescribir campos oficiales sin conflicto registrado.

## 10. Observabilidad

`PipelineRuns` debe convertirse en la bitacora central.

Campos recomendados:

```text
run_id
cron_name
started_at
finished_at
duration_ms
status
mode
api_calls_total
api_calls_by_source
rows_read
rows_written
rows_updated
rows_skipped
warnings_count
errors_count
quota_remaining
data_quality_score
message
```

`DataQualityLog` debe registrar:

- partido duplicado.
- match_id faltante.
- fixture_id faltante.
- equipo no resuelto.
- jugador no resuelto.
- fecha discordante entre fuentes.
- marcador discordante.
- estadisticas con PJ mayor que partidos reales.
- EV activo para partido cerrado.
- modelo invalido publicado.

Alertas recomendadas:

- `cronDailySetup` falla.
- `cronPostMatch` no carga estadisticas de partidos terminados.
- `EvOpportunities` contiene partido cerrado.
- `PlayerMatchStats` tiene jugador con PJ mayor a partidos del equipo.
- `PoissonOdds` genera mas de X patrones repetidos.
- `ModelCalibration` no se actualiza en 24h.

## 11. Migracion a Supabase/PostgreSQL

No conviene migrar de golpe. El camino sano es dual-write.

### Fase 1 - Sheets como fuente de verdad

- Congelar contratos de headers.
- Crear data dictionary.
- Agregar IDs canonicos.
- Arreglar duplicados y aliases.
- Registrar snapshots historicos.

### Fase 2 - Dual write

- GAS escribe en Sheets y Supabase.
- Supabase recibe solo entidades normalizadas.
- Comparar conteos y checksums por dia.
- No cambiar el frontend aun.

### Fase 3 - Supabase principal

- Front lee desde Supabase.
- Sheets queda como consola operativa/manual.
- Crons pueden seguir en GAS temporalmente.

### Fase 4 - Desacople

- ETL migra a edge functions, workers o jobs externos.
- Sheets queda como export/reporte.

Schema base sugerido:

```sql
create table teams (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  display_name text not null,
  country_code text,
  group_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_name)
);

create table team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  source text not null,
  source_team_id text,
  alias text not null,
  confidence numeric not null default 1,
  unique (source, coalesce(source_team_id, ''), alias)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null,
  match_key text not null unique,
  home_team_id uuid not null references teams(id),
  away_team_id uuid not null references teams(id),
  kickoff_utc timestamptz not null,
  kickoff_chile timestamptz,
  status text not null,
  home_score int,
  away_score int,
  venue_name text,
  venue_city text,
  round_name text,
  group_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table match_source_ids (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  source text not null,
  source_match_id text not null,
  confidence numeric not null default 1,
  unique (source, source_match_id)
);

create table model_outputs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  model_name text not null,
  model_version text not null,
  run_at timestamptz not null,
  prob_home numeric,
  prob_draw numeric,
  prob_away numeric,
  lambda_home numeric,
  lambda_away numeric,
  reliability numeric,
  flags text[] not null default '{}',
  is_valid boolean not null default true,
  unique (match_id, model_name, model_version, run_at)
);

create table odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  bookmaker text not null,
  market text not null,
  selection text not null,
  decimal_odds numeric not null,
  implied_probability numeric not null,
  captured_at timestamptz not null,
  unique (match_id, bookmaker, market, selection, captured_at)
);

create table ev_picks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  model_output_id uuid references model_outputs(id),
  odds_snapshot_id uuid references odds_snapshots(id),
  market text not null,
  selection text not null,
  model_probability numeric not null,
  market_probability numeric not null,
  fair_odds numeric not null,
  decimal_odds numeric not null,
  edge numeric not null,
  ev numeric not null,
  kelly_fraction numeric not null,
  category text not null,
  status text not null,
  result text,
  profit_units numeric,
  published_at timestamptz not null default now()
);
```

Indices:

```sql
create index idx_matches_kickoff on matches(kickoff_utc);
create index idx_matches_status on matches(status);
create index idx_model_outputs_match on model_outputs(match_id);
create index idx_odds_snapshots_match_market on odds_snapshots(match_id, market);
create index idx_ev_picks_status on ev_picks(status);
create index idx_ev_picks_category on ev_picks(category);
```

Vistas utiles:

```sql
create view active_ev_plus as
select *
from ev_picks
where category = 'EV_PLUS'
  and status = 'PUBLISHED'
  and ev > 0;

create view model_calibration_daily as
select
  date_trunc('day', published_at) as day,
  count(*) as n,
  avg(ev) as avg_ev,
  avg(case when result = 'WON' then 1 else 0 end) as hit_rate,
  sum(coalesce(profit_units, 0)) as profit_units
from ev_picks
where status = 'RESOLVED'
group by 1;
```

## 12. IA futura

La IA no debe reemplazar el motor probabilistico sin trazabilidad. Debe usar datasets historicos limpios.

Guardar para entrenamiento:

- snapshot prepartido del match.
- ELO prepartido.
- forma ultimos N partidos.
- lesionados/suspendidos.
- cuotas iniciales, publicadas y cierre.
- prediccion Poisson.
- prediccion IA.
- flags de calidad.
- resultado final.
- eventos relevantes.
- estadisticas postpartido.

Usos futuros:

- calibracion de probabilidades.
- deteccion de modelos invalidos.
- ranking de mercados.
- prediccion de confianza.
- explicaciones naturales.
- deteccion de outliers de mercado.

La IA debe poder responder "por que este pick fue bloqueado" antes de recomendar "apostar".

## 13. Roadmap tecnico

### Fase 0 - Blindaje inmediato

- Mantener la separacion `EV_PLUS` vs `MARKET_OVERPRICED`.
- Limpiar `EvOpportunities` cerradas, pero conservar `EvHistorico`.
- Resolver `EvHistorico` pendiente desde `Partidos`.
- Bloquear EV si `match_id` no se puede asociar a `Partidos`.
- Agregar auditoria diaria de `PlayerMatchStats` vs partidos reales del equipo.
- Asegurar que `calculateModelCalibration_()` corra desde cron post-match/semanal o wrapper publico.

### Fase 1 - Contratos canonicos

- Unificar `fixture_id_api_football` y retirar `fixture_id_af` de la logica nueva.
- Centralizar `isFinishedStatus_`.
- Centralizar `buildMatchKey_`.
- Centralizar normalizacion de equipos.
- Crear `docs/data-dictionary.md`.
- Agregar hoja `TeamAliases`.

### Fase 2 - Data quality operacional

- Expandir `PipelineRuns`.
- Convertir `DataQualityLog` en semaforo operativo.
- Agregar `runDailyDataQualityAudit()`.
- Reportar:
  - partidos sin ID fuente reciente.
  - stats de jugadores incompletas.
  - EV activo cerrado.
  - modelo invalido publicado.
  - duplicados por clave.

### Fase 3 - Modelo y EV

- Versionar cada corrida de modelo.
- Guardar `model_version`.
- Agregar `model_reliability`.
- Calibrar con Brier/log loss.
- Separar pick publicado de pick tomado.
- Agregar CLV.

### Fase 4 - Supabase dual-write

- Crear schema minimo: teams, matches, source ids, odds, model outputs, ev picks.
- Cargar historico limpio.
- Validar conteos contra Sheets.
- Mantener frontend en Sheets hasta que dual-write sea estable.

### Fase 5 - Plataforma cuantitativa

- Front lee analytics desde Supabase.
- Jobs de ingesta pueden seguir en GAS o migrar gradualmente.
- IA usa datasets historicos normalizados.
- Dashboards de calibracion y bankroll por estrategia.

## 14. Convenciones

Nombres:

- IDs internos: `match_id`, `team_id`, `player_id`.
- IDs de fuente: `api_football_fixture_id`, `espn_event_id`, `football_data_match_id`.
- Fechas: `kickoff_utc`, `kickoff_chile`, `captured_at`, `published_at`, `resolved_at`.
- Estados: mayusculas controladas (`NS`, `LIVE`, `FT`, `AET`, `PEN`, `POSTPONED`, `CANCELLED`).

Reglas de codigo:

- Toda funcion publica de GAS debe ser wrapper operacional.
- Toda funcion privada termina en `_`.
- No duplicar helpers de match/team/status.
- No llamar APIs desde normalizadores offline.
- No recalcular historia sin snapshot previo.
- No escribir filas con claves incompletas.

## 15. Checklist profesional

Antes de publicar un pick:

- El partido existe en `Partidos`.
- El partido no esta cerrado ni live.
- `match_id` es canonico.
- La cuota tiene timestamp.
- La probabilidad usada por EV coincide con el panel del modelo.
- El modelo no tiene flags bloqueantes.
- `ev > 0`.
- Kelly no excede limite.
- La muestra y confiabilidad son visibles.

Antes de cerrar el dia:

- Todos los partidos terminados tienen status final.
- Resultados actualizados.
- Clasificacion recalculada.
- Simulacion recalculada.
- Player stats cargadas o registradas como pendientes.
- EV activo cerrado movido a historico.
- Historico resuelto.
- Calibracion recalculada.
- PipelineRuns sin errores criticos.

Antes de confiar en ROI:

- Hay muestra suficiente.
- Picks resueltos tienen resultado.
- No hay partidos duplicados.
- No hay picks cerrados en tabla activa.
- No se mezclan picks publicados con apuestas tomadas.
- Los buckets EV muestran `n`.

## 16. Prioridades recomendadas

Orden sugerido para las proximas iteraciones:

1. Crear `runDailyDataQualityAudit()` con salida en `DataQualityLog` y resumen en Telegram.
2. Centralizar helpers duplicados: match key, status final, team normalization.
3. Crear `data-dictionary.md` y alinear headers reales con contratos.
4. Agregar `model_version` y `model_reliability`.
5. Separar `EvHistorico` de `BettingHistory` conceptualmente: publicado vs tomado.
6. Agregar CLV y cierre de cuotas.
7. Preparar schema Supabase minimo sin migrar produccion.
8. Hacer dual-write solo para `matches`, `teams`, `model_outputs`, `ev_picks`.

## 17. Conclusiones

El proyecto va en una direccion muy buena. La decision correcta ahora es no agregar mas predicciones hasta blindar los datos que alimentan las predicciones.

La arquitectura objetivo no debe ser una migracion brusca a base de datos ni un rediseño grande. Debe ser una evolucion por capas:

```text
Sheets estable -> contratos canonicos -> historico confiable -> observabilidad -> dual-write -> Supabase primario
```

El sistema debe seguir siendo barato, operable y simple, pero con reglas estrictas: ningun dato derivado sin fuente, ningun pick sin validacion, ningun historico destruido y ningun modelo publicado sin confiabilidad.
