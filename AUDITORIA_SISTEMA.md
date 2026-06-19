# Auditoría Completa — Sistema Mundial 2026
**Fecha:** 2026-06-19 | **Versión analizada:** Excel v33 + GAS commit actual

---

## 1. Resumen Ejecutivo

El sistema procesa datos de 3 fuentes externas (API-Football, football-data.org, ESPN) + cuotas (The Odds API, Betfair) + IA (OpenAI) para producir predicciones, alertas Telegram y una webapp de estadísticas. La arquitectura es sólida pero presenta **6 inconsistencias de datos activas** que afectan la integridad de posiciones, estadísticas de jugadores y simulación de grupos.

| Severidad | Cantidad | Estado |
|-----------|----------|--------|
| 🔴 Crítico | 3 | Ghana/Panamá ausentes · match_key bug · PlayerMatchStats columnas desplazadas |
| 🟡 Alto | 3 | fixture_id_af nulo en 96% · SourceFixtures sin upsert · Equipos sin grupo |
| 🟢 Medio | 3 | Türkiye duplicado · PipelineRuns mode incorrecto · DataQualityLog parado |

---

## 2. Inventario de Hojas

### 2.1 Hojas Activas (con datos y lectura/escritura desde código)

| Hoja | Filas | Módulo Principal | Descripción |
|------|-------|-----------------|-------------|
| **Partidos** | 107 | Main.gs, Standings.gs, WebApp.gs | Fixture master — 27 FT + 76 NS + 4 con match_key corrupto |
| **Clasificacion** | 48 | Standings.gs, WebApp.gs, GroupSimulator.gs | Tabla de posiciones — 4 grupos con inconsistencia PJ |
| **SimulacionGrupos** | 48 | GroupSimulator.gs | Monte Carlo 2000 runs — corregido 2026-06-19 |
| **EloRatings** | 79 | EloRating.gs | Ratings ELO de 48 equipos (79 por variantes de nombre) |
| **EvOpportunities** | 37 | EvModel.gs, WebApp.gs | Oportunidades EV+ activas — alimenta webapp y Telegram |
| **EvHistorico** | 25 | BettingHistory.gs, EvModel.gs | Snapshot histórico de EV para calibración |
| **AnalisisIA** | 7 | AiAnalysis.gs | Probabilidades OpenAI — fuente primaria para EV si disponible |
| **PoissonOdds** | 85 | PoissonModel.gs | Predicciones Poisson para 85 partidos |
| **CardsOdds** | 85 | CardsModel.gs | Modelo de tarjetas por árbitro |
| **CornersOdds** | 85 | CornersModel.gs | Modelo de córners |
| **Alineaciones** | 1857 | Lineups.gs | Titulares y suplentes desde API-Football |
| **Arbitros** | 39 | Arbitros.gs | 39 árbitros con fixture_id y estadísticas |
| **FormaEquipos** | 48 | DataIngestion.gs | Últimos 5 resultados por equipo |
| **PlayerMatchStats** | 4067 | PlayerMatchStats.gs | ⚠️ Columnas desplazadas — datos incorrectos (ver §4.3) |
| **ResumenJugadorPartido** | 351 | PlayerMatchStats.gs | Goles/asistencias por partido por jugador |
| **EspnStats** | 36 | Main.gs | Posesión, tiros, corners por partido desde ESPN |
| **EventosLive** | 272 | LiveEvents.gs | Eventos en vivo (goles, tarjetas) — usado por cronLiveEventsMonitor |
| **Alertas** | 5 | LiveEvents.gs | Log de alertas enviadas a Telegram (dedup) |
| **Suscriptores** | 2 | Telegram.gs | Chat IDs activos |
| **EstadiosClima** | 34 | LiveEvents.gs, VenueCatalog.gs | Temperatura, humedad, lluvia por estadio |
| **Noticias** | 495 | News.gs | Noticias scrapeadas — header corrupto (primera fila es dato) |
| **RawLog** | 493 | DriveStorage.gs | Log de archivos JSON crudos guardados en Drive |
| **DataQualityLog** | 215 | DataQuality.gs | Conflictos entre fuentes — **último registro: Jun 14** |
| **PipelineRuns** | 148 | Main.gs | Log de ejecuciones — ⚠️ campo `mode` almacena timestamp en vez de nombre |
| **Planteles** | 423 | TeamPlayerIngestion.gs | Planteles por equipo (squad) |
| **Jugadores** | 1506 | TeamPlayerIngestion.gs | Jugadores con IDs de API-Football y football-data.org |
| **Equipos** | 17 | BackfillRunner.gs | Solo 17 equipos (de 48) — columna `grupo` nula en todos |

### 2.2 Hojas Vacías (0 filas de datos)

| Hoja | Por qué está vacía |
|------|-------------------|
| **BettingHistory** | Sistema de apuestas manuales nunca usado |
| **ModelCalibration** | `calculateModelCalibration_()` requiere BettingHistory con datos |
| **OddsApuestas** | The Odds API integrado pero ningún trigger escribe aquí actualmente |
| **HistorialH2H** | `fetchHeadToHead_()` existe en HeadToHead.gs pero sin trigger activo |
| **ReportesTelegram** | `cronMorningTelegramReport` sin trigger configurado |

### 2.3 Hojas con Problemas de Schema

| Hoja | Problema |
|------|---------|
| **Noticias** | Primera fila es un dato real (hash de noticia), no header — el schema no se inicializó correctamente |
| **EstadiosClima** | Primera fila tiene `None` en columna 1 — header parcialmente corrompido |
| **SourceFixtures** | 77 filas pero solo 16 matches únicos — cada fixture insertado ~5 veces sin upsert |

---

## 3. Flujo de Datos y Módulos GAS

### 3.1 Pipeline de Ingesta (crons activos)

```
API-Football ──────────────────────────────────────────────────────┐
  fixtures, events, lineups,                                        │
  player-stats, squads                                              │
                                                                    ▼
football-data.org ──────────────────────────► BackfillRunner.gs ──► Partidos (golden dataset)
  fixtures, standings                           GoldenDataset.gs       MatchMapping.gs
                                                SourceNormalizer.gs    DataQualityLog
ESPN (site.api.espn.com) ─────────────────────►
  scoreboard, summary, boxscore                                     │
  (sin límite de cuota, tiempo real)                                ▼
                                                            Clasificacion
                                                            EspnStats
                                                            Alineaciones
                                                            Arbitros

The Odds API ─────────────────────────────────► EvModel.gs ────────► EvOpportunities
Betfair ──────────────────────────────────────► CardsModel.gs ─────► CardsOdds
                                                CornersModel.gs ───► CornersOdds
                                                PoissonModel.gs ───► PoissonOdds

OpenAI API ───────────────────────────────────► AiAnalysis.gs ─────► AnalisisIA
  (prob_local, prob_empate, prob_visitante,
   prob_over25, prob_btts)
```

### 3.2 Crons Configurados y su Estado

| Cron | Frecuencia | Estado | Escribe a |
|------|-----------|--------|-----------|
| `cronDailyLoadTodayStats` | Diario ~6am | ✅ Activo | Partidos, Alineaciones, Arbitros, FormaEquipos |
| `cronEvCalculation` | Cada 30 min | ✅ Activo | EvOpportunities, EvHistorico, SimulacionGrupos |
| `cronOddsCalc` | Cada 30 min | ✅ Activo | CardsOdds, CornersOdds, PoissonOdds |
| `cronPostMatch` | Cada 30 min | ✅ Activo pero **0 records** | EspnStats, Clasificacion, PlayerMatchStats |
| `cronLiveEventsMonitor` | Cada 5 min | ✅ Activo | Alertas, **Partidos** (fix Jun-19) |
| `cronMorningTelegramReport` | Diario 7:30am | ❌ Sin trigger | ReportesTelegram |
| `cronTomorrowPreview` | Diario | ✅ Activo | Telegram |
| `cronMatchDayAnalysis` | Diario | ✅ Activo | Telegram |

### 3.3 Mapa de Lectura/Escritura por Módulo

| Archivo GAS | Lee de | Escribe a | APIs externas |
|-------------|--------|-----------|---------------|
| Main.gs | Partidos, EvOpportunities | EspnStats, Clasificacion, PlayerMatchStats, Dashboard | ESPN, API-Football |
| Standings.gs | Partidos | Clasificacion | — |
| GroupSimulator.gs | Clasificacion, Partidos | SimulacionGrupos | — |
| EvModel.gs | OddsApuestas, AnalisisIA, Partidos, EloRatings, PoissonOdds | EvOpportunities, EvHistorico | The Odds API |
| LiveEvents.gs | Partidos, EventosLive, Alertas | EventosLive, Alertas, **Partidos** (nuevo) | ESPN, API-Football |
| WebApp.gs | Partidos, EvOpportunities, Clasificacion, SimulacionGrupos, Alineaciones, Arbitros, EstadiosClima | — (solo lectura) | ESPN (en vivo) |
| EloRating.gs | EloRatings, Partidos | EloRatings | — |
| AiAnalysis.gs | Partidos | AnalisisIA | OpenAI |
| BettingHistory.gs | BettingHistory, Partidos, EvHistorico | BettingHistory, EvHistorico | — |
| PoissonModel.gs | Partidos, EloRatings | PoissonOdds | — |
| CardsModel.gs | Partidos, Arbitros, CardsOdds | CardsOdds | Betfair |
| BackfillRunner.gs | SourceFixtures, MatchMapping | Partidos, Equipos, Jugadores, DataQualityLog, PipelineRuns | API-Football, football-data.org |
| PlayerMatchStats.gs | PlayerMatchStats | PlayerMatchStats | API-Football |
| HeadToHead.gs | HistorialH2H | HistorialH2H | API-Football |
| Arbitros.gs | Arbitros, Partidos | Arbitros | API-Football |
| Lineups.gs | Alineaciones | Alineaciones | API-Football |
| News.gs | — | Noticias | RSS feeds |
| SofaScoreApi.gs | — | — | SofaScore (**retorna 403 desde GAS — efectivamente deshabilitado**) |
| BetfairApi.gs | — | CardsOdds | Betfair |
| DriveStorage.gs | — | Drive (JSON raw), RawLog | — |

---

## 4. Inconsistencias Encontradas

### 4.1 🔴 Ghana y Panamá — PJ=0 cuando jugaron 1 partido (Jun 17)

**Hoja afectada:** Clasificacion  
**Síntoma:** Ghana PJ=0 Pts=0, Panamá PJ=0 Pts=0 en Grupo L pese a haber jugado el 17-Jun.  
**Causa raíz:** El partido Ghana vs Panamá (Jun 17, fixture_id=1489385 según EspnStats) **nunca fue escrito a la hoja Partidos**. `recalcularTablaDesdePartidos()` lee solo de Partidos → al no existir la fila con status FT, no contabiliza el partido.  
**Evidencia:** Partidos tiene 27 filas FT; no aparece ninguna con local="Ghana" o "Panama" entre los FT del Jun 17.  
**Impacto:** Clasificación del Grupo L incorrecta. GroupSimulator simula 6 partidos pendientes en vez de 5.

**Fix requerido:**
1. Agregar fila a Partidos: `Ghana 1-0 Panamá | fecha=2026-06-17 | status=FT | goles_local=1 | goles_visitante=0`
2. Ejecutar `recalcularTablaDesdePartidos()` + `runGroupSimulation()`

---

### 4.2 🔴 4 filas con `match_key = _objectobject_`

**Hoja afectada:** Partidos (filas 104-107)  
**Síntoma:** match_key = "_objectobject_" en: Uzbekistan-Colombia, Czechia-South Africa, Switzerland-Bosnia, Canada-Qatar (todos Jun 18).  
**Causa raíz:** Bug en el código que construye el match_key. Cuando `local` o `visitante` son objetos JavaScript en vez de strings (probablemente antes de castear el resultado de la API), la concatenación produce `[object Object]` que luego se normaliza a `_objectobject_`.  
**Impacto:** Cualquier lookup por match_key falla para estos 4 partidos. Módulos que usan match_key como PK (Arbitros, CardsOdds, EvOpportunities) no pueden asociar datos a estos fixtures.

**Fix requerido:**
1. En el código que crea filas de Partidos, asegurar `String(local || '')` antes de construir el key
2. Corregir manualmente los 4 match_keys en la hoja

---

### 4.3 🔴 PlayerMatchStats — Columnas desplazadas ~4 posiciones

**Hoja afectada:** PlayerMatchStats (4067 filas)  
**Headers correctos:** `fixture_id | match_key | team_id | equipo | player_id | jugador | posicion | minutos | ...`  
**Datos reales en columna 3 (team_id):** nombres de jugadores (ej: "Kristoffer Nordfeldt")  
**Datos reales en columna 4 (equipo):** IDs numéricos (ej: 2851)  
**Causa raíz:** Las columnas del sheet se desplazaron (probablemente por inserción manual de columnas en la hoja) pero el GAS writer no fue actualizado. Los 4067 registros existentes están todos con datos en la columna incorrecta.  
**Impacto:** Cualquier consulta por `equipo` o `jugador` retorna valores incorrectos. Los comandos `/jugadores` del bot y la sección de estadísticas de la webapp están leyendo datos basura.  
**Por qué Jun 18 no tiene datos:** El `cronPostMatch` activo depende de que `recienTerminados` tenga partidos. Esa lista se construye desde Partidos con `hora_chile` + ventana de 120 min post-partido. Aunque `hora_chile` existe en la hoja, el match de Jun 18 se procesó sin `fixture_id_api_football` (nulo en 96% de filas), por lo que `loadPlayerStatsForFixture_(null)` falla silenciosamente.

---

### 4.4 🟡 fixture_id_api_football nulo en 103/107 filas

**Hoja afectada:** Partidos  
**Síntoma:** Solo 4 filas tienen fixture_id de API-Football. Las 103 restantes tienen null.  
**Causa raíz:** API-Football plan gratuito tiene **ventana de 3 días**. Los backfills del Jun 11-15 (donde se pre-cargó el schedule) capturaron los IDs solo para las fechas dentro de la ventana en ese momento. Los partidos del Jun 16+ no tienen ID porque en ese momento la ventana no los cubría, y los del Jun 11-14 perdieron su ventana.  
**Impacto:**  
- `loadPlayerStatsForFixture_()` falla para todos los partidos sin ID
- `fetchLiveEvents_()` en LiveEvents.gs falla para esos partidos
- `getEloProbabilities_` y modelos Poisson funcionan igual (no requieren af_id)

**Fix para Jun 16-19:** Ejecutar `backfillByDateRange('2026-06-16','2026-06-19')` mientras estén dentro de la ventana de 3 días (antes del Jun 22). Esto popula af_id para ~12 partidos recientes.

---

### 4.5 🟡 SourceFixtures — 77 filas, 16 matches únicos (cada uno ~5 veces)

**Hoja afectada:** SourceFixtures  
**Síntoma:** Solo 9 partidos únicos del Jun 13-14, cada uno con 5-9 filas idénticas.  
**Causa raíz:** `appendRows_` sin lógica de upsert. Cada ejecución de backfill inserta filas nuevas sin verificar si ya existen.  
**Impacto:** La hoja es solo un log interno; no afecta la lógica de negocio directamente. Pero infla el tiempo de lectura y oscurece la auditoría.  

---

### 4.6 🟡 Equipos — columna `grupo` nula, solo 17 de 48 equipos

**Hoja afectada:** Equipos  
**Síntoma:** Los 17 equipos tienen `grupo = null`. Faltan 31 equipos.  
**Causa raíz:** El backfill de Equipos se ejecutó solo para los partidos ya procesados (los que tienen af_id). Solo 17 equipos tuvieron partido con af_id en la ventana del backfill.  
**Impacto:** La columna `grupo` de Equipos no se usa en ningún módulo activo (GroupSimulator usa Clasificacion). Sin impacto funcional hoy, pero rompe cualquier consulta futura por equipo+grupo.

---

### 4.7 🟢 Türkiye — entrada duplicada en Equipos

**Hoja afectada:** Equipos  
**Síntoma:** Dos filas con team_id_api_football=777: una con `nombre_normalizado='turkiye'` y otra con `'turkey'`.  
**Causa raíz:** Se insertó desde API-Football (turkiye) y luego desde football-data.org (turkey) sin dedup por team_id.

---

### 4.8 🟢 PipelineRuns — campo `mode` almacena timestamp en vez de nombre del cron

**Hoja afectada:** PipelineRuns  
**Síntoma:** Campo `mode` contiene timestamps (ej: "2026-06-17 14:21:35") en vez de valores como "DAILY" o "BACKFILL". Solo las 14 filas del backfill manual muestran mode="BACKFILL" correctamente.  
**Causa raíz:** El código que escribe PipelineRuns en `cronPostMatch` pasa el timestamp en el campo mode en vez del nombre del cron.  
**Impacto:** Solo observabilidad — no afecta lógica de negocio.

---

### 4.9 🟢 DataQualityLog — sin entradas después del Jun 14

**Hoja afectada:** DataQualityLog  
**Síntoma:** Última entrada Jun 14. Jun 15-19 sin registros.  
**Causa raíz:** DataQuality.gs solo se ejecuta durante el backfill (`backfillGoldenDataset`). Como no se corrió backfill desde Jun 14, no hay nuevos registros de calidad.

---

## 5. Análisis de Suiza (3 partidos reportados)

El reporte original indicaba Suiza con 3 partidos. En la versión actual (Excel 33):  
- **Clasificacion:** Suiza PJ=2, Pts=4 ✅ (Qatar 1-1 Jun 13 + Bosnia 4-1 Jun 18)  
- **Partidos FT:** Aparece Qatar 1-1 Switzerland (Jun 13) y Switzerland 4-1 Bosnia (Jun 18)  
- **Conclusión:** La inconsistencia fue resuelta entre el Excel 32 y 33, probablemente por la corrección de `cronLiveEventsMonitor` que escribió el status FT del segundo partido.

---

## 6. Por qué faltan estadísticas de jugadores de Jun 18

Cadena de fallos:

```
cronPostMatch (cada 30min)
  └─ lee Partidos WHERE status=FT AND hora_chile en ventana 120min
       └─ para cada partido recién terminado:
            └─ loadPlayerStatsForFixture_(fixture.fixture_id_api_football)
                 └─ fixture_id_api_football = NULL para Jun 18 ← FALLA AQUÍ
                      └─ API call con id=null → retorna 0 registros
```

Además, el cron muestra `records_processed=0` en PipelineRuns para TODAS las ejecuciones post-Jun 14. Esto confirma que el post-match enrichment lleva 5 días sin procesar ningún partido.

**Fix inmediato:** Ejecutar manualmente `backfillEspnPlayerStats()` para Jun 15-19 y `backfillByDateRange('2026-06-16','2026-06-19')` para poblar los af_ids mientras están en la ventana de 3 días.

---

## 7. Propuestas de Mejora para Consistencia y Unicidad

### P1 — Upsert en SourceFixtures (evitar inserción duplicada)
```javascript
// En BackfillRunner.gs, antes de appendRows_:
const existingKeys = new Set(readAll_(CONFIG.SHEETS.SOURCE_FIXTURES).map(r => r.source_fixture_key));
const newRows = rows.filter(r => !existingKeys.has(r.source_fixture_key));
if (newRows.length) appendRows_(CONFIG.SHEETS.SOURCE_FIXTURES, newRows);
```

### P2 — Resolver fixture_id_af automáticamente cada día
Agregar en `cronDailyLoadTodayStats` un paso que busca af_ids faltantes para los últimos 3 días:
```javascript
// Enriquecer Partidos con af_ids para la ventana actual de API-Football
enrichMissingAfIds_('2026-06-16', '2026-06-19');
```

### P3 — Fix match_key construction
```javascript
// En cualquier código que construya match_key:
const mk = `${fecha}_${String(local||'').toLowerCase().replace(/[^a-z0-9]/g,'')}_${String(visitante||'').toLowerCase().replace(/[^a-z0-9]/g,'')}`;
```

### P4 — Realinear PlayerMatchStats columns
1. Verificar el orden en SheetManager.gs vs el orden en que el writer inserta valores
2. Corregir el writer para que coincida con headers
3. Borrar las 4067 filas existentes y re-backfill

### P5 — PipelineRuns: fijar el campo mode
```javascript
// Pasar el nombre del cron, no el timestamp:
logPipelineRun_('cronPostMatch', ...)  // no nowChile_()
```

### P6 — Poblar Equipos con los 48 equipos y sus grupos
Ejecutar una función de bootstrap que lea `ALL_48` de Standings.gs y lo crucé con API-Football para poblar todos los team_ids y grupos. Esto permite consultas por grupo en módulos futuros.

### P7 — Dedup Equipos por team_id_api_football
```javascript
// En BackfillRunner.gs al insertar en Equipos:
const existing = readAll_(CONFIG.SHEETS.EQUIPOS);
const existingIds = new Set(existing.map(r => String(r.team_id_api_football)));
if (!existingIds.has(String(team.id))) appendRows_(...);
```

### P8 — Alertas por data quality en DataQualityLog
Ejecutar `runDataQualityCheck_()` al final de `cronDailyLoadTodayStats` para mantener el log actualizado diariamente, no solo durante backfills.

### P9 — Hoja Ghana-Panamá missing match (fix inmediato)
Verificar el trigger que escribe a Partidos cuando hay partidos nuevos del día. Actualmente solo el backfill manual y `cronLiveEventsMonitor` escriben. Necesita un mecanismo en `cronDailyLoadTodayStats` que detecte partidos de hoy jugados ayer y los agregue a Partidos si no existen.

---

## 8. Estado Actual de la Web App

| Sección | Fuente de datos | Estado |
|---------|----------------|--------|
| En Vivo | ESPN (tiempo real) + Partidos | ✅ Fix Jun 19: dedup por par canónico, fusión de filas |
| Posiciones | Clasificacion | ⚠️ Ghana/Panamá PJ=0 (fix pendiente manual) |
| % Clasificación | SimulacionGrupos | ✅ Fix Jun 19: filtro playedPairs + fallback por equipo |
| EV+ | EvOpportunities + AnalisisIA | ✅ Fuente unificada (IA_AJUSTADA → POISSON → ELO) |
| Resultados | Partidos FT | ✅ 27 partidos terminados |
| Calibración | EvHistorico → ModelCalibration | ⚠️ ModelCalibration vacía (requiere BettingHistory) |
| Bankroll Sim | EvHistorico | ✅ 25 registros disponibles |

---

## 9. Acciones Inmediatas Recomendadas

| Prioridad | Acción | Comando / Método |
|-----------|--------|-----------------|
| 1 | Agregar Ghana vs Panamá a Partidos (Jun 17, Ghana 1-0 Panamá) | Manual en hoja → `recalcularTablaDesdePartidos()` |
| 2 | Poblar fixture_id_af para Jun 16-19 antes que expire ventana API-Football | `backfillByDateRange('2026-06-16','2026-06-19')` |
| 3 | Cargar estadísticas de jugadores Jun 15-19 | `backfillEspnPlayerStats()` con rango de fechas |
| 4 | Realinear columnas PlayerMatchStats | Corregir writer + re-backfill |
| 5 | Corregir 4 match_keys corruptos | Manual en hoja Partidos filas 104-107 |
| 6 | Limpiar SourceFixtures (67 filas duplicadas) | Borrar filas 2-68, dejar solo 1 por match_key |

---

*Generado por auditoría automática — Sistema WC2026 Bot · mcerda · Jun 19 2026*
