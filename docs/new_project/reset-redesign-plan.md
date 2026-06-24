# Reset total y rediseño limpio de base de datos

Este paquete trata el nuevo Supabase como un proyecto distinto al sistema Google Sheets/GAS. No busca compatibilidad con legacy ni replica hojas como tablas. La regla es: `DROP TODO`, `CREATE CLEAN`, `BUILD RIGHT`.

## Diagnóstico

El modelo anterior mezclaba responsabilidades: datos de Sheets, entidades canónicas, cuotas, outputs de modelo y decisiones EV convivían demasiado cerca. También se filtraban conceptos de torneo dentro de `teams`, como grupos del Mundial, cuando grupos/fases pertenecen a una competencia y temporada. Eso rompe el diseño multi-liga: un equipo puede jugar varias competencias, con formatos distintos, sin que su identidad cambie.

El nuevo diseño separa las capas RAW, STAGING, CANONICAL, ANALYTICS y PUBLISHED, usa UUID internos como verdad del sistema, guarda IDs externos solo en referencias, y usa `timestamptz` UTC para toda fecha/hora.

## Ajuste fino final

- El reset definitivo es `000_drop_all.sql`; permite recrear la base con `\i 000_drop_all.sql` y `\i 001_clean_schema.sql`.
- `match_participants.side` solo permite `HOME` y `AWAY`; una sede neutral se representa con `matches.is_neutral`.
- `match_source_refs` fue eliminado del esquema limpio. Las referencias externas de partidos usan `entity_external_refs` con `entity_type = 'MATCH'`.
- `entity_external_refs` tiene validación por trigger para compensar la falta de FK polimórfica nativa.
- `market` y `selection` dejaron de ser texto libre en analytics. Ahora se usan `markets.market_id` y `market_selections.selection_id`.
- `betting_decisions` contiene constraints de integridad para bloqueos, EV positivo en `BETTABLE` y settlement coherente.
- Se agregaron vistas de salud publicables para monitorear calidad de datos, modelos y decisiones bloqueadas.

## Archivos entregados

- `supabase/new_project/000_drop_all.sql`: reset destructivo completo para ejecutar antes del esquema limpio.
- `supabase/new_project/000_drop_current_migrations.sql`: reset destructivo de objetos creados por las migraciones 001 a 007.
- `supabase/new_project/001_clean_schema.sql`: esquema limpio desde cero para la plataforma cuantitativa multi-competencia.

## Capas

RAW conserva evidencia de origen: archivos, llamadas API y payloads sin convertirlos en verdad del negocio.

STAGING contiene datos parseados pero todavía no confiables: equipos, jugadores, partidos, odds, rosters, alineaciones y eventos. Aquí se validan aliases, duplicados y payloads incompletos.

CANONICAL es la verdad del dominio: competencias, temporadas, fases, grupos, equipos, jugadores, sedes, árbitros, partidos, participantes, planteles, eventos y standings.

ANALYTICS contiene el sistema cuantitativo: snapshots de cuotas, closing odds, features, ratings, modelos, predicciones, calibración, métricas, drift, decisiones EV, bets, bankroll y backtesting.

PUBLISHED expone vistas limpias para frontend/API/Telegram. El frontend no debería leer RAW/STAGING/CANONICAL directamente.

## ERD textual

`competitions` -> `competition_seasons` -> `competition_stages` -> `competition_groups`.

`teams` es identidad global. La participación vive en `competition_team_entries`; si la competencia tiene grupos, la relación va en `competition_group_memberships`.

`players` es identidad de persona. Su relación temporal con equipos vive en `team_memberships`; la convocatoria por competencia vive en `competition_rosters`; la alineación vive en `match_lineups`.

`entity_resolution_queue` contiene casos ambiguos de aliases o referencias externas. Nada ambiguo debe promoverse silenciosamente a CANONICAL.

`matches` pertenece a una `competition_season` y opcionalmente a `stage_id`/`group_id`. Los equipos local/visita/neutro viven en `match_participants`.

`odds_snapshots` captura mercado puro. `model_predictions` captura probabilidad pura. `betting_decisions` une predicción calibrada + cuota + readiness + riesgo + settlement lógico de la decisión. `bets` representa ejecución real o paper.

`markets` y `market_selections` normalizan mercado/selección. Las tablas analíticas no aceptan variantes libres como `home`, `Local` o `1`; esas variantes se resuelven antes en STAGING.

## Orden de creación

1. Extensiones, enums y función `set_updated_at`.
2. RAW.
3. STAGING.
4. CANONICAL base: competencias, temporadas, estados, readiness.
5. Estructura competitiva: fases, grupos, entries, slots y brackets.
6. Identidad: teams, players, venues, referees, aliases, memberships, media y referencias externas.
7. Partidos: matches, participants, refs, lineups, events, stats, standings.
8. Mercado: bookmakers, odds, closing odds, market quality.
9. ML/analytics: features, ratings, model registry, runs, predictions, calibration, metrics, drift.
10. EV/riesgo: decisions, bets, bankroll, backtests.
11. Observabilidad: pipeline runs, data quality events, heartbeats.
12. Índices, triggers, RPC healthcheck y vistas published.

## Constraints importantes

- Todas las entidades principales usan UUID internos.
- `teams` no tiene `group_code`, IDs externos ni columnas de APIs.
- Los IDs externos se guardan en `entity_external_refs` o tablas específicas de source refs.
- `entity_external_refs` es la única tabla canónica para referencias externas. `match_source_refs` queda eliminado para evitar duplicidad.
- `entity_external_refs` se valida con trigger porque PostgreSQL no soporta FK polimórfica nativa.
- `kickoff_at`, `captured_at`, `as_of`, `created_at`, `updated_at` son `timestamptz`.
- `odds_snapshots` no se sobrescribe: cada captura es un snapshot.
- `odds_snapshots`, `model_predictions`, `calibration_runs`, `model_metrics` y `backtest_runs` usan `market_id`; las selecciones usan `selection_id` cuando aplica.
- EV se calcula desde `calibrated_probability`, no desde probabilidad raw.
- Si la competencia no está en `BETTABLE`, la decisión apostable debe quedar bloqueada.
- La ejecución (`bets`) está separada de la decisión (`betting_decisions`), pero la decisión tiene settlement propio para medir la calidad del pick aunque nunca se haya apostado.
- `knockout_bracket_edges` usa FK reales hacia `matches` y constraints para evitar edges duplicados.
- `odds_snapshots` tiene unicidad por captura y, cuando exista, por `source_snapshot_id`.
- `model_predictions` tiene unicidad por contexto de modelo y por feature snapshot cuando está disponible.

## Índices

El esquema incluye índices por:

- resolución de aliases normalizados,
- temporada/fecha de competencia,
- partidos por competencia y kickoff,
- cuotas por match/market/captured_at,
- predicciones por competencia/match/market/as_of,
- decisiones por competencia/status/decided_at,
- features y ratings temporales.

Las unicidades con valores opcionales se implementan con índices únicos expresivos, no como constraints inline, porque PostgreSQL no permite expresiones dentro de `unique (...)` en `create table`.

## RLS recomendada

Para MVP, evitar RLS compleja en tablas internas y exponer datos solo vía API/worker con service role. Cuando exista frontend público:

- `anon`/cliente: solo lectura sobre vistas `published_*`.
- `authenticated`: lectura limitada si hay panel privado.
- `service_role`: escritura en RAW/STAGING/CANONICAL/ANALYTICS.
- nunca exponer RAW ni tablas de apuestas reales directamente al cliente.

## Vistas publicadas

El esquema crea:

- `published_match_schedule`
- `published_match_predictions`
- `published_ev_opportunities`
- `published_market_value_comparison`
- `published_model_calibration`
- `published_bankroll_summary`
- `published_competition_health`
- `published_data_quality_health`
- `published_model_diagnostics`
- `published_blocked_decisions`

## Plan de migración limpio

1. Crear proyecto nuevo de Supabase o base nueva vacía.
2. Ejecutar `000_drop_current_migrations.sql` solo si ya hubo intentos previos en esa base.
3. Ejecutar `001_clean_schema.sql`.
4. Seed mínimo: competencias, temporadas, estados y readiness checks.
5. Ingestar fuente actual como RAW/STAGING si se necesita auditoría.
6. Promover solo datos útiles a CANONICAL: equipos reales, competencia, fases, grupos, partidos, jugadores y venues.
7. Cargar odds como snapshots, no como estado mutable.
8. Cargar predicciones/model runs/calibración.
9. Publicar solo desde vistas `published_*`.

## Checklist de validación

- No quedan tablas con forma de hoja de cálculo.
- No hay `team_key`/`match_key` como PK canónica.
- No hay `api_football_*` ni `espn_*` como columnas en entidades canónicas.
- `teams` no contiene grupo, fase ni metadata de torneo.
- Aliases ambiguos quedan en `entity_resolution_queue`, no en `teams`/`players`.
- Mundial 2026 puede modelar grupos A-L y knockout sin afectar otras ligas.
- Una liga sin grupos usa `competition_stages` y omite `competition_groups`.
- Todo timestamp operativo es `timestamptz`.
- EV no aparece en `odds_snapshots`.
- Odds iniciales y closing odds están separados.
- `match_participants.side` solo permite `HOME` y `AWAY`; neutralidad vive en `matches.is_neutral`.
- `published_data_quality_health` no devuelve issues críticos antes de habilitar EV real.
- Published views son suficientes para el frontend.

## No implementar todavía

- Deep learning.
- Orquestadores pesados tipo Airflow si el volumen aún no lo exige.
- Feature store externa.
- Apuestas reales automáticas.
- RLS granular por tenant hasta tener claro el modelo SaaS.
- Normalización inter-liga avanzada antes de tener histórico y CLV suficientes.

## Riesgos de sobreingeniería

Crear demasiados procesos antes de estabilizar la ingesta puede bloquear el avance. El MVP debe probar primero identidad, fixtures, odds snapshots, predicción, calibración, EV bloqueado por readiness y published views.

`entity_external_refs` es potente, pero no debe volverse un basurero: cada source debe guardar `confidence`, `is_primary` y payload mínimo auditable.

## MVP recomendado

Para partir simple: `competitions`, `competition_seasons`, `competition_status`, `competition_readiness_checks`, `competition_stages`, `competition_groups`, `teams`, `team_aliases`, `entity_resolution_queue`, `competition_team_entries`, `competition_group_memberships`, `matches`, `match_participants`, `odds_snapshots`, `model_runs`, `model_predictions`, `calibration_runs`, `calibration_bins`, `betting_decisions`, `pipeline_runs`, `data_quality_events` y las vistas `published_*`.

Eso ya permite cargar Mundial 2026 correctamente y deja el camino abierto para Champions, Premier, Libertadores, Brasileirao, Argentina Primera y Chile Primera sin deformar el modelo.
