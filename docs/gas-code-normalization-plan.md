# Pool Team 2026 — plan de normalizacion sin base de datos

Este plan asume que Google Sheets sigue siendo la fuente operativa y que las cuotas gratuitas de APIs son una restriccion dura. La prioridad es corregir contratos, deduplicar datos y evitar llamadas innecesarias antes de ampliar modelos.

## Principios

- No hacer llamadas externas para reparar datos historicos si la informacion ya existe en Sheets.
- Separar calculos deterministas de ingesta: EV, Kelly, flags, match ids y dedupe deben poder recalcularse offline.
- Mantener `dry-run` antes de cualquier escritura masiva.
- Usar headers canonicos por hoja; `readAll_()` depende totalmente de fila 1.
- Preservar snapshots de cuotas y picks; deduplicar solo hojas donde el duplicado es accidental.

## Funciones GAS agregadas

Archivo: `src/SourceDataNormalization.gs`.

| Funcion | Modifica datos | Uso |
|---|---:|---|
| `normalizeSourceDryRun()` | No | Audita headers, match ids, EV flags, duplicados y PipelineRuns. Escribe reporte en `NormalizationAudit`. |
| `normalizeSourceApply()` | Si | Aplica reparaciones seguras detectadas por el dry-run. |
| `normalizeEvOpportunitiesApply()` | Si | Solo recalcula columnas derivadas de `EvOpportunities`. |

Las funciones no usan `UrlFetchApp`; solo leen/escriben el spreadsheet actual.

## Reparaciones incluidas

1. `Noticias`: inserta headers canonicos si la fila 1 contiene datos.
2. `EstadiosClima`: inserta headers canonicos si la fila 1 contiene datos.
3. `Partidos`: completa `match_id` faltante como `match_yyyy_mm_dd_local_visitante`.
4. `EvOpportunities`: recalcula `cuota_justa`, `ev`, `edge`, Kelly 25%, `ev_positivo`, `sospechoso` y `outlier`.
5. Deduplicacion allowlist:
   - `SourceFixtures` por `source_fixture_key`.
   - `MatchMapping` por `match_key`, preservando mayor `confidence` y luego ultima fila.
   - `PlayerMatchStats` por `fixture_id + player_id`.
   - `Alineaciones` por `fixture_id + jugador_id + rol`.
   - `EventosLive` por `evento_id`.
   - `EvHistorico` por `fecha + local + visitante + mercado + seleccion`.
6. `PipelineRuns`: solo reporte; no se repara automaticamente porque hay corrimiento de contrato del writer.

## Orden recomendado

1. Ejecutar `normalizeSourceDryRun()`.
2. Revisar la hoja `NormalizationAudit`.
3. Hacer copia del Google Sheet.
4. Ejecutar `normalizeSourceApply()`.
5. Ejecutar `sheetHeaderAudit()`.
6. Ejecutar `refreshDashboard()` y validar visualmente EV+, predicciones y ROI.

## Plan de normalizacion de codigo

### Fase 1 — Contratos y helpers

- Implementado: `BettingMath.gs` queda como fuente unica de formulas EV/Kelly.
- Implementado: `SheetManager.SHEET_HEADERS` queda alineado con el Excel real en hojas criticas.
- Implementado: `SheetsRepository.gs` agrega `appendRow_`, `updateRow_`, `upsertRowsByKey_`.
- Implementado: `readAll_()` agrega aliases legacy (`fixture_id_af`, `fixture_id_fd`, `ronda`) para no romper modulos existentes mientras se normalizan nombres.

### Fase 2 — Reducir duplicacion EV

- Implementado: `CornersModel.gs`, `CardsModel.gs`, `BetfairApi.gs`, `BettingHistory.gs` y `EvModel.gs` usan `bettingMetrics_()` para EV/edge/Kelly.
- Implementado: umbrales operativos de betting viven en `CONFIG.BETTING`.
- Decision GAS-only: el Excel actual no tiene `model_version`; se conserva `fuente_modelo` como contrato visible hasta una ampliacion controlada de schema.

### Fase 3 — Cuotas y APIs gratis

- Implementado: `fetchOddsForMatch_()` revisa `Partidos`; no consulta odds para partidos `FT/AET/PEN/FINAL` ni partidos fuera de ventana de 7 dias.
- Implementado: usa cache de hoja fresco por `match_key` antes de llamar a The Odds API; TTL 1h en dia de partido y 6h en ventana normal.
- API-Football: fallback, no fuente principal para live si ESPN tiene `espn_event_id`.
- ESPN: fuente primaria para fixtures/resultados/post-match por no tener cuota.
- Open-Meteo: cache por estadio+fecha+hora; no reconsultar si ya existe condicion para el kickoff.
- Google News: cache por fixture y fecha; maximo 3-5 noticias por equipo; dedupe por `id_hash`.

### Fase 4 — Reparar writers

- Implementado: `PipelineRuns` queda alineado entre `SheetManager` y `PipelineRuns.gs`.
- Implementado: `normalizeSourceApply()` repara headers de `Noticias` y `EstadiosClima` preservando datos.
- Implementado: `SourceFixtures` y `MatchMapping` usan `upsertRowsByKey_()` en lugar de append.
- Implementado: `PlayerMatchStats` usa `upsertRowsByKey_()` por `fixture_id + player_id`.

## Checklist post-normalizacion

- `NormalizationAudit` sin P1 pendiente.
- `Partidos.match_id` completo.
- `Noticias` y `EstadiosClima` con headers correctos.
- `EvOpportunities.ev_positivo` con `SI/NO`.
- `EvOpportunities` outliers marcados.
- `PlayerMatchStats` sin duplicados por `fixture_id + player_id`.
- `SourceFixtures` sin duplicados por `source_fixture_key`.
- `MatchMapping` sin duplicados por `match_key`.
- ROI calculado solo con picks resueltos.
