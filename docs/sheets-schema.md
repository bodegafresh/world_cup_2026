# Google Sheets — Schema Completo

> Todas las hojas comparten la misma hoja de cálculo (`SPREADSHEET_ID`).
> Las columnas siguen el orden en que se insertan con `appendRows_()`.

---

## Partidos
Tabla principal de fixtures del Mundial. Upsert por `match_key`.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| match_key | string | PK: `{fecha}_{local}_{visitante}` |
| fixture_id_af | number | ID API-Football |
| fixture_id_fd | string | ID football-data.org |
| fecha | date | `yyyy-MM-dd` (hora Chile) |
| hora_utc | datetime | ISO 8601 |
| hora_chile | string | `HH:mm` hora Chile |
| local | string | Nombre equipo local |
| visitante | string | Nombre equipo visitante |
| goles_local | number | Goles al finalizar (null si no jugado) |
| goles_visitante | number | Goles al finalizar |
| estado | string | `NS`, `1H`, `HT`, `2H`, `FT`, `AET`, `PEN` |
| estadio | string | Nombre del estadio |
| ciudad | string | Ciudad del estadio |
| pais_estadio | string | País del estadio |
| grupo | string | Grupo A-F (fase de grupos) |
| ronda | string | `Group Stage`, `Round of 16`, `Quarter-finals`, etc. |
| posesion_local | number | % posesión local |
| posesion_visitante | number | % posesión visitante |
| tiros_local | number | Total tiros local |
| tiros_visitante | number | Total tiros visitante |
| xg_local | number | Expected Goals local |
| xg_visitante | number | Expected Goals visitante |
| corners_local | number | Córners local |
| corners_visitante | number | Córners visitante |
| faltas_local | number | Faltas local |
| faltas_visitante | number | Faltas visitante |
| amarillas_local | number | Tarjetas amarillas local |
| amarillas_visitante | number | Tarjetas amarillas visitante |
| rojas_local | number | Tarjetas rojas local |
| rojas_visitante | number | Tarjetas rojas visitante |
| source_confidence | number | 0.0-1.0 confianza dual-source |
| data_quality_notes | string | JSON con notas de calidad |
| updated_at | datetime | Última actualización |

---

## Equipos
Master de equipos. Upsert por `team_id_af`.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| team_id_af | number | PK: ID API-Football |
| team_id_fd | number | ID football-data.org |
| nombre | string | Nombre oficial |
| pais | string | País |
| ranking_fifa | number | Ranking FIFA (si disponible) |
| entrenador | string | Nombre del entrenador |
| logo_url | string | URL del escudo |
| updated_at | datetime | |

---

## Jugadores
Master de jugadores del torneo. Upsert por `player_id`.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| player_id | number | PK: ID API-Football |
| nombre | string | Nombre completo |
| posicion | string | GK, DEF, MID, ATT |
| edad | number | Edad en años |
| nacionalidad | string | |
| altura_cm | number | |
| peso_kg | number | |
| foto_url | string | URL de la foto |
| team_id | number | FK → Equipos.team_id_af |
| updated_at | datetime | |

---

## Planteles
Jugadores convocados por torneo/equipo.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| squad_id | string | `{team_id}_{player_id}` |
| player_id | number | FK → Jugadores.player_id |
| team_id | number | FK → Equipos.team_id_af |
| team_name | string | |
| posicion | string | |
| numero | number | Dorsal |
| rol | string | Titular/Suplente/Reserva |
| temporada | number | 2026 |
| raw_url | string | URL del JSON raw en Drive |

---

## ResumenJugadorPartido
Resumen de performance de un jugador por partido (de eventos live).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | FK → Partidos.fixture_id_af |
| player_id | number | FK → Jugadores.player_id |
| player_name | string | |
| team_id | number | |
| team_name | string | |
| goals | number | |
| assists | number | |
| yellow_cards | number | |
| red_cards | number | |
| minutes_played | number | Minuto de salida o 90 |
| entry_minute | number | Minuto de entrada (sustituto) |
| impact_score | number | `goals*3 + assists*2 - red*3 - yellow*1` |
| impact_level | string | `MUY_ALTO`, `ALTO`, `MEDIO`, `BAJO`, `NEGATIVO` |

---

## PlayerMatchStats
Estadísticas avanzadas por jugador por partido (de /fixtures/players).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | |
| player_id | number | |
| player_name | string | |
| team_id | number | |
| rating | number | WhoScored rating (0-10) |
| minutes | number | |
| shots_total | number | |
| shots_on | number | |
| passes_total | number | |
| passes_accuracy | number | % |
| tackles_total | number | |
| interceptions | number | |
| duels_total | number | |
| duels_won | number | |
| dribbles_attempts | number | |
| dribbles_success | number | |

---

## EventosLive
Eventos de partido (goles, tarjetas, sustituciones).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | |
| event_id | string | Hash deduplicación |
| minuto | number | |
| equipo | string | |
| jugador | string | |
| tipo | string | `Goal`, `Card`, `subst`, `Var` |
| detalle | string | Sub-tipo del evento |
| impacto | string | `ALTO`, `MEDIO`, `BAJO` |
| raw_url | string | URL JSON en Drive |
| home_team_id | number | |
| away_team_id | number | |
| loaded_at | datetime | |

---

## OddsApuestas
Cuotas y probabilidades por fixture y mercado.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | |
| fuente | string | `THE_ODDS_API` o `MODELO_INTERNO` |
| mercado | string | `1X2`, `Over/Under 2.5`, `Ambos anotan` |
| seleccion | string | Nombre de la selección |
| cuota_real | number | Cuota decimal promedio de bookmakers |
| probabilidad_modelo | number | Prob. sin vig (0.0-1.0) |
| probabilidad_mercado | number | Prob. implícita cruda |
| timestamp | datetime | |
| confianza | string | `ALTA`, `MEDIA`, `BAJA` |
| razon | string | Explicación |

---

## EstadiosClima
Clima por fixture y estadio.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| venue_id | number | ID API-Football |
| estadio | string | |
| ciudad | string | |
| pais | string | |
| timezone | string | |
| temperatura_c | number | |
| humedad | number | % |
| viento_kmh | number | |
| prob_lluvia | number | % |
| condicion | string | `DESPEJADO`, `LLUVIA`, `PROBABLE_LLUVIA`, `VIENTO_FUERTE`, `CALOR_EXTREMO`, `FRIO_EXTREMO` |
| loaded_at | datetime | |
| fuente | string | `open-meteo` o `unavailable` |
| fixture_id | number | |

---

## Noticias
Artículos de Google News por equipo/fixture.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | |
| query | string | Término de búsqueda |
| titulo | string | |
| link | string | URL del artículo |
| fuente | string | Nombre del medio |
| fecha | date | Fecha de publicación |
| hash | string | Deduplicación título+link |
| loaded_at | datetime | |

---

## AnalisisIA
Análisis generado por OpenAI por fixture.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | |
| local | string | |
| visitante | string | |
| fecha | date | |
| prob_local | number | |
| prob_empate | number | |
| prob_visitante | number | |
| over25 | number | |
| btts | number | |
| factores_clave | string | JSON array de factores |
| alertas | string | JSON array de alertas |
| resumen_telegram | string | Texto listo para enviar |
| modelo | string | `gpt-4.1-mini` |
| tokens_usados | number | |
| loaded_at | datetime | |

---

## Clasificacion *(nuevo)*
Tabla de posiciones del torneo. Snapshot completo, se reescribe cada día post-partido.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| grupo | string | `Group A`, `Group B`, etc. |
| posicion | number | 1-4 dentro del grupo |
| equipo_id | number | FK → Equipos.team_id_af |
| equipo | string | |
| pj | number | Partidos jugados |
| pg | number | Ganados |
| pe | number | Empatados |
| pp | number | Perdidos |
| gf | number | Goles a favor |
| gc | number | Goles en contra |
| gd | number | Diferencia de goles |
| puntos | number | |
| forma | string | Últimos 5 resultados (ej. `WDWWL`) |
| descripcion | string | `Advance to Round of 16`, `Eliminated`, etc. |
| updated_at | datetime | |

---

## HistorialH2H *(nuevo)*
Historial cara a cara entre equipos. Acumulativo por fixture de referencia.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_ref_id | number | Fixture del Mundial al que aplica |
| equipo_local_ref | string | Equipo local del partido referencia |
| equipo_visitante_ref | string | Equipo visitante del partido referencia |
| h2h_fixture_id | number | ID del partido histórico |
| fecha | datetime | Fecha del partido histórico |
| torneo | string | Nombre del torneo histórico |
| pais | string | |
| local | string | Local del partido histórico |
| visitante | string | Visitante del partido histórico |
| goles_local | number | |
| goles_visitante | number | |
| resultado | string | Nombre del ganador o `Empate` |
| estado | string | Estado del partido (`FT`, `AET`, etc.) |
| loaded_at | datetime | |

---

## Alertas
Registro de eventos live ya notificados (deduplicación Telegram).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| fixture_id | number | |
| event_hash | string | Hash único del evento |
| tipo | string | Tipo de evento |
| minuto | number | |
| mensaje | string | Texto enviado a Telegram |
| alerted_at | datetime | |

---

## PipelineRuns
Auditoría de ejecuciones del pipeline.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| run_id | string | UUID de la ejecución |
| job_name | string | Nombre de la función cron |
| started_at | datetime | |
| finished_at | datetime | |
| status | string | `OK`, `ERROR`, `PARTIAL` |
| records_processed | number | |
| error_count | number | |
| notes | string | Mensajes de advertencia |
