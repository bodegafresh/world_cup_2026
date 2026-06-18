# Mundial 2026 — Bot de Telegram + Web Dashboard con Inteligencia Deportiva

Sistema completo de seguimiento del FIFA World Cup 2026 construido sobre **Google Apps Script** (sin servidores). Recolecta datos de múltiples fuentes, enriquece cada partido con contexto inteligente (clima, cuotas, suspensiones, lesiones, H2H, forma, ELO) y entrega análisis a través de un **bot de Telegram** y un **dashboard web**.

> **No se necesita saber programar para usar el bot.** Este README explica desde cero qué es cada cosa.

---

## ¿Qué hace este sistema?

- Sigue los 104 partidos del Mundial en tiempo real: marcador, minuto, estadísticas, alineaciones, árbitro y clima
- Envía alertas por Telegram cuando hay goles, tarjetas rojas o VAR
- Genera análisis con IA antes de cada partido
- Calcula probabilidades ELO y simulaciones Monte Carlo por grupo
- Detecta apuestas con valor positivo (EV+) comparando cuotas vs modelo propio
- Dashboard web con pestañas: Hoy, En Vivo, Posiciones, Equipos, Jugadores, Stats, Noticias, EV+, ELO, Clasificación, Árbitros, Modelo

---

## Arquitectura general

```
ESPN API ───────────┐
API-Football ───────┤
football-data.org ──┼──► Google Sheets (30 hojas) ◄──► Bot Telegram
Open-Meteo ─────────┤         ▲                         (multi-usuario)
Google News RSS ────┤         │
The Odds API ───────┘    Google Drive                ◄──► Web Dashboard
                         (caché JSON)                     (GitHub Pages)
                              ▲
                         OpenAI GPT-4.1
                      (análisis por partido)
```

Todo corre en **Google Apps Script** — sin servidores, sin costo fijo de infraestructura.

---

## Pipeline de datos (cómo fluye la información)

### Día del partido (en curso)
```
cronLiveEventsMonitor (c/5 min)
  └─ ESPN scoreboard → marcadores en tiempo real → alertas Telegram

cronPostMatch (c/hora)
  └─ Para partidos terminados hace < 90 min:
     └─ ESPN summary → EspnStats, Alineaciones, FormaEquipos, Árbitros
```

### Día siguiente (D+1 a las 6 AM)
```
cronDailySetup
  └─ loadWorldCupDay_(ayer) — 3 niveles de fallback:
     │
     ├─ [Nivel 1] API-Football /fixtures?date= 
     │    → Bloqueado en plan free para WC2026 (solo 2022–2024)
     │
     ├─ [Nivel 2] fixture_id_af desde hoja Partidos → endpoints AF por fixture
     │    → Solo funciona si se pagó plan superior de API-Football
     │
     └─ [Nivel 3] ESPN como fuente principal ← ACTIVO actualmente
          └─ fetchEspnEventsByDate_(ayer) → partidos FT del día
             └─ fetchEspnSummary_(espnId) por cada partido:
                ├─ _saveEspnStats_()         → EspnStats
                ├─ _saveEspnLineupsToSheet_() → Alineaciones
                ├─ _saveEspnForma_()          → FormaEquipos
                ├─ saveRefereeFromEspnSummary_() → Arbitros
                ├─ updateEloAfterMatch_()     → EloRatings
                └─ autoSettleBetsForFixture_() → BettingHistory
```

> **API-Football free no tiene acceso a WC2026** (plan gratuito solo cubre temporadas 2022–2024). El sistema usa ESPN como fuente principal para datos post-partido. ESPN es gratis, sin cuota y sin registro.

---

## Crons automáticos — Configuración de triggers

| Función | Tipo | Horario | Qué hace |
|---------|------|---------|----------|
| `cronDailySetup` | Day timer | **6:00–7:00 AM** | Carga datos del día anterior: eventos, stats, árbitros, lineups, ELO |
| `cronTomorrowPreview` | Day timer | **7:30–8:30 AM** | Clima, noticias, cuotas del día siguiente |
| `cronTodayPreviewRefresh` | Day timer | **9:00–10:00 AM** | Análisis IA para partidos de hoy |
| `cronMorningTelegramReport` | Day timer | **10:00–11:00 AM** | Reporte matutino con partidos del día + imágenes de probabilidades |
| `cronMatchDayAnalysis` | Hour timer | **Cada 2 horas** | Análisis IA para partidos próximos 4 horas |
| `cronPostMatch` | Hour timer | **Cada hora** | ESPN stats para partidos terminados hace < 90 min → árbitros, alineaciones, FormaEquipos |
| `cronLiveEventsMonitor` | Minute timer | **Cada 5 minutos** | Marcadores en tiempo real, alertas de goles/rojas por Telegram |
| `cronEvCalculation` | Hour timer | **Cada 2 horas** | Cálculo de apuestas con EV positivo, simulación de grupos |
| `cronWeeklyMaintenance` | Week timer | **Lunes 3:00 AM** | Limpieza de duplicados, recalibración del modelo, `cargarPlantelesDesdeEspn()` |

---

## Setup inicial — Ejecutar una sola vez

### Paso 1 — Crear hojas y conectar bot
```
sheetEnsureAllWithHeaders()    → Crea las 30 hojas con sus columnas
setupTelegramWebhook()         → Conecta el bot de Telegram
```

### Paso 2 — Cargar calendario completo (ESPN, gratis)
```
loadFullWorldCupCalendarFromEspn()
```
Carga los 104 partidos con `espn_event_id`, estadio, ciudad y hora Chile. **No requiere API-Football.**

> ⚠️ `loadFullWorldCupCalendar()` (API-Football) **no funciona** — el plan free solo cubre temporadas 2022–2024. WC2026 está bloqueado.

### Paso 3 — Cargar datos históricos (partidos ya jugados)
```
backfillEspnHistorical()
```
Itera desde 2026-06-11 hasta ayer. Para cada partido FT: stats, alineaciones, FormaEquipos, árbitro y ELO desde ESPN. **Gratis, sin cuota.**

### Paso 4 — Cargar planteles con fotos (ESPN, gratis)
```
cargarPlantelesDesdeEspn()
```
Obtiene planteles completos con fotos de jugadores desde ESPN summary de partidos ya jugados. Guarda en hojas `Jugadores` y `Planteles`.

> `cargarIdsEquiposDesdeApiFootball()` y `cargarPlanteles()` **no funcionan** — bloqueados por el mismo motivo. `cargarPlantelesDesdeEspn()` es la fuente correcta para WC2026.

### Paso 5 — Recalcular ELO e inicializar tabla
```
recalcularElo()                    → Aplica todos los FT históricos al modelo ELO desde cero
recalcularTablaDesdePartidos()     → Genera tabla de posiciones desde resultados
```

### Paso 6 — Contexto de análisis
```
cronTomorrowPreview()              → Clima, noticias y cuotas
cronTodayPreviewRefresh()          → Análisis IA para partidos de hoy
```

---

## Fuentes de datos y estrategia de uso

| Fuente | Plan gratuito | Cuándo se usa |
|--------|--------------|---------------|
| **ESPN** | Ilimitado, sin registro | **Primario para tiempo real**: scoreboard en vivo, summary post-partido (alineaciones, árbitro, clima, forma) |
| **API-Football** | 100 req/día | Día siguiente: eventos detallados, estadísticas avanzadas, lineups con grid, referee, player stats |
| **football-data.org** | 10 req/min | Validación cruzada y fuente secundaria de fixtures |
| **Open-Meteo** | Ilimitado | Clima horario por estadio (coordenadas exactas) |
| **The Odds API** | 500 req/mes | Cuotas de casas de apuestas con caché de 6h |
| **Google News RSS** | Ilimitado | Noticias por equipo |
| **OpenAI GPT-4.1** | Pago por uso ~$0.01/partido | Análisis previas, predicciones con contexto completo |

> **SofaScore**: Deshabilitado (`SOFASCORE_ENABLED = false`). HTTP 403 bloquea todas las llamadas desde Google Apps Script.

### Presupuesto de API-Football (100 req/día)

| Operación | Costo (req) |
|-----------|------------|
| `loadFullWorldCupCalendar()` | 1 |
| `loadWorldCupDay_(fecha)` por partido | 4–5 (events + stats + lineups + player stats) |
| `cargarIdsEquiposDesdeApiFootball()` | 1 |
| `cargarPlanteles()` por equipo | 1 |
| `loadWorldCupStandings()` | 1 |
| Día normal con 4 partidos | ~20–25 req |

---

## Bot de Telegram — Comandos

| Comando | Qué hace |
|---------|----------|
| `/hoy` | Partidos de hoy: resultados, en vivo y próximos con hora Chile |
| `/ayer` | Resultados de ayer con marcador final |
| `/proximos` | Partidos de los próximos 3 días |
| `/seleccion ARG` | Todos los partidos de un equipo |
| `/tabla` | Tabla de posiciones por grupo (A–L) |
| `/en_vivo` | Partidos en curso: marcador, minuto, clima, stats, árbitro y alineación |
| `/stats brasil` | Estadísticas del torneo de un equipo |
| `/jugadores noruega` | Alineación en vivo + plantel completo |
| `/jugador haaland` | Goles, asistencias y tarjetas de un jugador |
| `/clima miami` | Clima del estadio de una ciudad |
| `/h2h españa vs francia` | Historial cara a cara entre dos equipos |
| `/prediccion argentina` | Análisis IA + cuotas del próximo partido |
| `/noticias brasil` | Últimas noticias de un equipo |
| `/grupos A` | Simulación Monte Carlo de clasificación por grupo |
| `/upsets` | Partidos donde ELO y cuotas favorecen equipos distintos |
| `/ev` | Apuestas con valor esperado positivo detectadas hoy |
| `/portafolio` | P&L de apuestas registradas |
| `/elo` | Ranking ELO propio del modelo |
| `/historial` | Historial de apuestas con ROI |
| `/arbitros` | Árbitros asignados a partidos próximos |
| `/paises` | Lista de países del torneo |
| `/ayuda` | Lista completa de comandos |

> Los nombres de países y jugadores son **insensibles a mayúsculas, tildes e idioma** (puedes escribir "brasil" o "brazil", "espana" o "spain").

---

## Hojas de Google Sheets (30 hojas)

| Hoja | Qué contiene |
|------|-------------|
| `Partidos` | Fixture principal: fechas, marcadores, estadio, hora Chile, status, fixture_id_af |
| `Equipos` | Catálogo de selecciones con IDs de API-Football y football-data.org |
| `Jugadores` | Datos de jugadores: nombre, posición, foto URL, equipo |
| `Planteles` | Relación jugador–equipo–torneo (número de camiseta, posición) |
| `Alineaciones` | Titulares y suplentes por partido, con grid de posición en cancha |
| `PlayerMatchStats` | Estadísticas avanzadas por jugador por partido |
| `EventosLive` | Goles, tarjetas, sustituciones, VAR por partido |
| `ResumenJugadorPartido` | Resumen acumulado de cada jugador en cada partido |
| `OddsApuestas` | Cuotas y probabilidades (1X2, over/under, BTTS) |
| `EstadiosClima` | Clima por partido (temperatura, lluvia, viento) |
| `Noticias` | Artículos de Google News por partido |
| `AnalisisIA` | Análisis OpenAI por partido (guardado permanente) |
| `Clasificacion` | Tabla de posiciones por grupo con forma y stats |
| `HistorialH2H` | Historial cara a cara de partidos |
| `EspnStats` | Estadísticas avanzadas de ESPN: posesión, pases, tackles, corners |
| `FormaEquipos` | Últimos 5 resultados de cada equipo (W/D/L) |
| `Arbitros` | Árbitros asignados: partido, tarjetas, tendencia (ESTRICTO/NORMAL/PERMISIVO) |
| `EloRatings` | Ranking ELO por equipo con historial de cambios |
| `SimulacionGrupos` | Probabilidades de clasificación por Monte Carlo |
| `EvOpportunities` | Apuestas con valor esperado positivo detectadas |
| `BettingHistory` | Registro de apuestas con resultado y P&L |
| `ModelCalibration` | Métricas de precisión del modelo propio (Brier Score) |
| `Alertas` | Registro de alertas enviadas por Telegram |
| `Suscriptores` | Chat IDs registrados del bot |
| `MorningReports` | Historial de reportes matutinos enviados |
| `SourceFixtures` | Datos crudos normalizados de API-Football |
| `MatchMapping` | Mapeo de IDs entre API-Football y football-data.org |
| `DataQualityLog` | Registro de calidad del dataset principal |
| `PipelineRuns` | Historial de ejecuciones de crons con estado |
| `Dashboard` | Vista consolidada: hoy, tabla, top scorers, estado del pipeline |

---

## Script Properties

Configurar en Apps Script → **Configuración del proyecto** → **Propiedades de script**:

| Propiedad | Descripción | Obligatorio |
|-----------|-------------|-------------|
| `SPREADSHEET_ID` | ID del Google Sheet (aparece en la URL) | Sí |
| `RAW_FOLDER_ID` | ID de carpeta en Drive para guardar JSON raw | Sí |
| `API_FOOTBALL_KEY` | Key de api-sports.io | Sí |
| `FOOTBALL_DATA_KEY` | Key de football-data.org | Sí |
| `THE_ODDS_API_KEY` | Key de the-odds-api.com | Sí |
| `OPENAI_API_KEY` | Key de OpenAI | Sí |
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather | Sí |
| `URL_WEB_APP` | URL del Web App deployment de Apps Script | Sí |
| `TELEGRAM_CHAT_ID` | Chat ID de fallback si Suscriptores está vacío | No |
| `AUTO_BET_EV_THRESHOLD` | EV mínimo para registro automático de apuestas (default: 0.08) | No |
| `AUTO_BET_BASE_STAKE` | Unidad base de apuesta para registro automático | No |

---

## Web Dashboard

Dashboard web estático en `/world_cup_2026_web/`. Se publica en **GitHub Pages** (repositorio público).

```
world_cup_2026_web/
├── index.html          — Página principal
├── js/
│   ├── config.js       — GAS_URL y SPREADSHEET_ID (editar antes de publicar)
│   └── app.js          — Toda la lógica de UI
└── css/
    └── styles.css      — Estilos dark mode
```

### Pestañas del dashboard

| Pestaña | Contenido |
|---------|-----------|
| **Hoy** | Partidos del día con resultados, estado y horario Chile |
| **En Vivo** | Partido(s) en curso con marcador en tiempo real, árbitro, clima, alineación en cancha y estadísticas |
| **Posiciones** | Tabla de grupos A-L con forma y diferencia de goles |
| **Equipos** | Las 48 selecciones con plantel completo, fotos de jugadores y forma |
| **Jugadores** | Buscador de jugadores con stats del torneo |
| **Stats** | Estadísticas avanzadas por partido (posesión, tiros, pases) |
| **Noticias** | Últimas noticias por partido |
| **EV+** | Oportunidades de apuesta con valor esperado positivo |
| **ELO** | Ranking ELO con evolución durante el torneo |
| **Clasificación** | Tabla con probabilidades de clasificación (Monte Carlo) |
| **Árbitros** | Lista de árbitros con tendencia (tarjetas/partido) |
| **Modelo** | Calibración del modelo predictivo (Brier Score, accuracy) |

### En Vivo — comportamiento
- Auto-refresca cada 30 segundos
- El refresh es silencioso (fade suave) y **preserva el estado abierto de las alineaciones**
- El árbitro y clima provienen del ESPN summary en tiempo real (no requieren que el cron ya haya guardado el dato)
- La formación en el campo SVG usa las posiciones ESPN (GK, CB, CM, ST, etc.) para dibujar correctamente 3-4-3, 4-3-3, etc.

### Configurar y publicar
```bash
# 1. Editar world_cup_2026_web/js/config.js con tu GAS_URL
# 2. Publicar en GitHub Pages (Settings → Pages → main branch / root)
```

---

## Instalación desde cero

### Prerequisitos
```bash
npm install -g @google/clasp
clasp login
```

### Subir código
```bash
git clone <repo>
cd world_cup_2026
clasp push
```

### Setup en Apps Script (en orden)

```
1. sheetEnsureAllWithHeaders()           → Crea las 30 hojas
2. setupTelegramWebhook()                → Conecta el bot
3. loadFullWorldCupCalendar()            → 104 partidos con fixture_id_af (1 req API-Football)
4. loadFullWorldCupCalendarFromEspn()    → Complementa con ESPN IDs y estadios
5. backfillEspnHistorical()              → Historial completo desde ESPN (árbitros, alineaciones, forma)
6. cargarIdsEquiposDesdeApiFootball()    → IDs de los 48 equipos (1 req API-Football)
7. cargarEquipos()                       → Metadatos de equipos
8. cargarPlanteles()                     → Planteles con fotos (1 req por equipo = 48 req)
9. recalcularElo()                       → ELO desde cero con todos los FT históricos
10. recalcularTablaDesdePartidos()       → Tabla de posiciones
11. cronTomorrowPreview()                → Clima, noticias, cuotas
```

> **Nota sobre cuota**: Los pasos 3, 6, 8 consumen API-Football. El paso 8 consume 48 req (uno por equipo). Si la cuota se agota, los equipos restantes se cargarán automáticamente en las siguientes ejecuciones diarias de `cronWeeklyMaintenance` → `cargarIdsEquiposDesdeApiFootball()`.

### Configurar triggers
Ir a **Triggers (ícono de reloj)** → **+ Add Trigger**:

| Función | Tipo | Horario |
|---------|------|---------|
| `cronDailySetup` | Day timer | 6am – 7am |
| `cronTomorrowPreview` | Day timer | 7am – 8am |
| `cronTodayPreviewRefresh` | Day timer | 9am – 10am |
| `cronMorningTelegramReport` | Day timer | 10am – 11am |
| `cronMatchDayAnalysis` | Hour timer | Every 2 hours |
| `cronPostMatch` | Hour timer | Every hour |
| `cronLiveEventsMonitor` | Minute timer | Every 5 minutes |
| `cronEvCalculation` | Hour timer | Every 2 hours |
| `cronWeeklyMaintenance` | Week timer | Monday 3am – 4am |

### Verificar
```
test01_Config      → Verifica Script Properties configuradas
test02_SheetAudit  → Lista estado de hojas
backfillStatus()   → Ver qué días faltan de backfill (sin gastar cuota)
```

---

## Funciones de administración manual

### Backfill y carga de datos
| Función | Descripción |
|---------|-------------|
| `loadFullWorldCupCalendar()` | Carga 104 partidos desde API-Football con fixture_id_af (1 req) |
| `loadFullWorldCupCalendarFromEspn()` | Carga/actualiza calendario desde ESPN (gratis, sin cuota) |
| `backfillEspnHistorical()` | Carga historial completo de partidos FT usando ESPN (alineaciones, árbitros, forma) |
| `backfillByDateRange(desde, hasta)` | Backfill de estadísticas detalladas por rango de fechas (consume cuota) |
| `backfillStatus()` | Estado del backfill sin usar cuota |
| `backfillResume()` | Retoma backfill desde el primer día incompleto |

### Equipos y planteles
| Función | Descripción |
|---------|-------------|
| `cargarIdsEquiposDesdeApiFootball()` | Asocia team_id_api_football a los 48 equipos desde fixtures (1 req) |
| `cargarEquipos()` | Carga metadatos de equipos (escudos, país, confederation) |
| `cargarPlanteles()` | Carga planteles completos con fotos para equipos con ID (1 req/equipo) |
| `cargarPlantelesDesdeEspn()` | Fallback: planteles básicos desde ESPN para equipos sin ID API-Football |

### ELO y tabla
| Función | Descripción |
|---------|-------------|
| `recalcularElo()` | Resetea y recalcula ELO desde los valores iniciales aplicando todos los FT |
| `recalcularTablaDesdePartidos()` | Recalcula tabla de posiciones desde hoja Partidos (sin API) |
| `loadWorldCupStandings()` | Tabla oficial desde API-Football (consume 1 req) |
| `runGroupSimulation()` | Ejecuta simulación Monte Carlo de grupos |

### Mantenimiento de hojas
| Función | Descripción |
|---------|-------------|
| `sheetAudit()` | Lista hojas válidas y desconocidas |
| `sheetEnsureAllWithHeaders()` | Crea hojas faltantes con sus columnas |
| `sheetCleanup()` | Elimina hojas desconocidas vacías |
| `limpiarDuplicadosPartidos()` | Elimina filas duplicadas en Partidos |
| `refreshDashboard()` | Refresca hoja Dashboard manualmente |

---

## Archivos del proyecto

### Backend (Google Apps Script — `src/`)
| Archivo | Responsabilidad |
|---------|----------------|
| `Config.gs` | Constantes globales: URLs, IDs de hojas, timezone |
| `Utils.gs` | Fechas, normalización de nombres, diccionario ES↔EN de países |
| `Main.gs` | Orquestador de crons: `cronDailySetup`, `cronPostMatch`, `cronWeeklyMaintenance`, etc. |
| `BotCommands.gs` | Lógica de cada comando del bot |
| `Telegram.gs` | Envío de mensajes y fotos, gestión de suscriptores |
| `EspnApi.gs` | ESPN: scoreboard, summary, alineaciones, goleadores, forma, clima en vivo |
| `EspnStats.gs` | Guardado de ESPN stats + árbitro post-partido en hojas |
| `ApiFootball.gs` | API-Football: fixtures, eventos, estadísticas, jugadores, árbitros |
| `LiveEvents.gs` | Monitor de eventos en vivo, alertas de goles/rojas |
| `Standings.gs` | Tabla de posiciones: carga desde API o recalcula desde hoja |
| `BackfillRunner.gs` | Carga masiva histórica: `loadFullWorldCupCalendar`, `backfillEspnHistorical` |
| `TeamPlayerIngestion.gs` | `cargarEquipos`, `cargarPlanteles`, `cargarIdsEquiposDesdeApiFootball` |
| `Arbitros.gs` | Gestión de árbitros: extracción desde API-Football y ESPN summary |
| `EloRating.gs` | Modelo ELO: cálculo, actualización y `recalcularElo()` |
| `EvModel.gs` | Modelo de valor esperado (EV+) |
| `GroupSimulator.gs` | Simulación Monte Carlo de clasificación por grupo |
| `BettingHistory.gs` | Registro, liquidación automática y reporte de apuestas |
| `AiAnalysis.gs` | Integración OpenAI: prompt construction y guardado |
| `MatchPreview.gs` | Contexto enriquecido para IA (forma, H2H, clima, cuotas, ELO, árbitro) |
| `Wather.gs` | Open-Meteo: clima horario por coordenadas de estadio |
| `VenueCatalog.gs` | Coordenadas y timezone de los 16 estadios |
| `OddsApi.gs` | Cuotas The Odds API + Pinnacle |
| `GoldenDataset.gs` | Dataset definitivo combinando API-Football + football-data.org |
| `SourceMatcher.gs` | Matching de partidos entre fuentes por `match_key` |
| `WebApp.gs` | Endpoints del Web Dashboard (getWebLive_, getWebHoy_, etc.) |
| `ImageGenerator.gs` | URLs de gráficos de probabilidades via QuickChart.io |
| `SmartAlerts.gs` | Alertas: suspensiones, clima extremo, movimiento de cuotas |
| `UpsetDetector.gs` | Divergencias ELO vs mercado |
| `ClassificationAlert.gs` | Alertas de partidos decisivos para clasificación |
| `SofaScoreApi.gs` | DESHABILITADO (`SOFASCORE_ENABLED=false`) — HTTP 403 bloquea GAS |
| `SheetManager.gs` | Definición de hojas y headers |
| `SheetsRepository.gs` | CRUD sobre Google Sheets: readAll, appendRows, upsert |
| `PipelineHealth.gs` | Monitoreo de salud del pipeline |
| `Dashboard.gs` | Actualización de la hoja Dashboard |

### Frontend (`world_cup_2026_web/`)
| Archivo | Responsabilidad |
|---------|----------------|
| `index.html` | Estructura HTML del dashboard |
| `js/config.js` | `GAS_URL` y `SPREADSHEET_ID` — **editar antes de publicar** |
| `js/app.js` | Toda la lógica: render de pestañas, campo SVG de alineaciones, En Vivo |
| `css/styles.css` | Estilos dark mode con variables CSS |

---

## Zona horaria

Toda la lógica usa **America/Santiago** (Chile, UTC-4 verano / UTC-3 invierno). Las fechas en Google Sheets se normalizan mediante `normalizeFecha_()` y `normalizeHora_()` para evitar el desfase que ocurre cuando Google Sheets convierte strings a objetos Date internos. Partidos que juegan tarde en Chile (22:00+) pueden corresponder al día siguiente en UTC — el calendario ESPN se ajusta usando la hora Chile del kickoff.

---

## Glosario

### Fútbol

| Término | Significado |
|---------|-------------|
| **Fixture** | Partido programado con fecha, hora y lugar |
| **FT / AET / PEN** | Full Time / After Extra Time / Penales |
| **NS / 1H / HT / 2H** | No Started / Primera mitad / Descanso / Segunda mitad |
| **H2H** | Head to Head — historial de enfrentamientos directos |
| **1X2** | Mercado: 1=local, X=empate, 2=visitante |
| **BTTS** | Both Teams To Score — ambos equipos marcan |
| **Over/Under 2.5** | Más o menos de 2.5 goles totales |
| **VAR** | Video Assistant Referee |

### Estadísticas y modelo

| Término | Significado |
|---------|-------------|
| **ELO** | Sistema de puntos que mide el nivel de un equipo según resultados históricos |
| **EV (Expected Value)** | Valor Esperado — EV > 0% significa que la cuota paga más de lo que la probabilidad sugiere |
| **Kelly** | Fórmula para calcular el porcentaje óptimo a apostar según EV y probabilidad |
| **Monte Carlo** | Simula miles de torneos para estimar probabilidades de clasificación |
| **Brier Score** | Precisión probabilística: 0=perfecto, 1=pésimo |
| **Upset** | El favorito pierde; el sistema detecta cuando ELO y cuotas favorecen equipos distintos |
| **P&L / ROI** | Profit & Loss / Return on Investment — rentabilidad de apuestas |

### Técnico

| Término | Significado |
|---------|-------------|
| **Google Apps Script** | Plataforma de Google para automatizar tareas sobre Sheets sin servidores |
| **Cron / Trigger** | Tarea programada que corre automáticamente en horarios definidos |
| **Webhook** | URL que recibe mensajes de Telegram automáticamente |
| **Upsert** | Actualiza si existe, crea si no existe |
| **Backfill** | Cargar datos históricos del pasado que no estaban en el sistema |
| **Match Key** | ID único de partido: `yyyy-MM-dd_localNorm_visitanteNorm` |
| **fixture_id_af** | ID numérico de API-Football — necesario para llamar endpoints por fixture |
| **Golden Dataset** | Dataset definitivo combinando múltiples fuentes resolviendo conflictos |
| **clasp** | CLI de Google para sincronizar código Apps Script con Git |
