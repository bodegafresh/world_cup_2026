# Mundial 2026 — Bot de Telegram con Inteligencia Deportiva

Sistema completo de seguimiento del FIFA World Cup 2026 construido sobre **Google Apps Script** (sin servidores). Recolecta datos de múltiples fuentes, enriquece cada partido con contexto inteligente (clima, cuotas, suspensiones, lesiones, H2H, forma) y entrega análisis a través de un **bot de Telegram** accesible para cualquier persona.

> **No se necesita saber programar para usar el bot.** Este README explica desde cero qué es cada cosa.

---

## ¿Qué hace este sistema?

- Carga automáticamente el calendario completo del Mundial (104 partidos)
- Sigue cada partido en tiempo real: marcador, minuto, estadísticas
- Envía alertas por Telegram cuando hay goles, tarjetas rojas o VAR
- Genera análisis con IA antes de cada partido
- Calcula probabilidades de clasificación por grupo
- Detecta apuestas con valor positivo (EV+) comparando cuotas vs modelo propio

---

## Arquitectura general

```
ESPN API ───────────┐
API-Football ───────┤
football-data.org ──┼──► Google Sheets (29 hojas) ◄──► Bot Telegram
Open-Meteo ─────────┤         ▲                         (multi-usuario)
Google News RSS ────┤         │
The Odds API ───────┘    Google Drive
                         (caché JSON)
                              ▲
                         OpenAI GPT-4.1
                      (análisis por partido)
```

Todo corre en **Google Apps Script** — sin servidores, sin costo fijo de infraestructura.

---

## Flujos automáticos (crons)

### `cronDailyLoadTodayStats` — 1:00 AM
Carga los resultados del día anterior:
- Obtiene partidos desde API-Football
- Guarda estadísticas avanzadas, eventos (goles, tarjetas), alineaciones
- Actualiza tabla de posiciones

### `cronTomorrowPreview` — 7:30 AM
Prepara el contexto del día siguiente **sin gastar cuota de IA**:
- Clima del estadio (Open-Meteo, gratis)
- Noticias de cada equipo (Google News RSS, gratis)
- Cuotas de casas de apuestas (The Odds API, con caché de 6h)
- Historial de enfrentamientos anteriores
- Alertas: jugadores con riesgo de suspensión, condiciones extremas, movimiento de cuotas

### `cronMatchDayAnalysis` — Cada 2 horas
Para partidos en las próximas 4 horas, genera análisis completo con OpenAI:
- Estado del grupo y qué se juega cada equipo
- Jugadores en riesgo de suspensión (≥2 amarillas)
- Lesiones detectadas en noticias
- Forma reciente (últimos 5 partidos)
- Historial H2H

### `cronMorningTelegramReport` — 10:00 AM
Envía a **todos los suscriptores** del bot:
- Partidos del día con hora Chile, estadio y clima
- Análisis IA resumido por partido
- Imágenes de probabilidades

### `cronLiveEventsMonitor` — Cada 5 minutos
Monitorea partidos en curso:
- Detecta goles, tarjetas rojas, penales y VAR nuevos
- Envía alerta instantánea por Telegram con el marcador actualizado

---

## Bot de Telegram — Comandos

Cualquier persona que escriba al bot queda registrada automáticamente y recibe los reportes masivos.

| Comando | Qué hace | Ejemplo |
|---------|----------|---------|
| `/hoy` | Partidos de hoy: resultados, en vivo y próximos con hora Chile | `/hoy` |
| `/ayer` | Resultados de ayer con marcador final | `/ayer` |
| `/proximos` | Partidos de los próximos 3 días | `/proximos` |
| `/seleccion` | Todos los partidos de un equipo | `/seleccion argentina` |
| `/tabla` | Tabla de posiciones por grupo (A–L) | `/tabla` |
| `/en_vivo` | Partidos en curso: marcador, minuto, clima, stats y alineación | `/en_vivo` |
| `/stats` | Estadísticas del torneo de un equipo | `/stats brasil` |
| `/jugadores` | Alineación en vivo + plantel completo de un equipo | `/jugadores noruega` |
| `/jugador` | Goles, asistencias y tarjetas de un jugador | `/jugador haaland` |
| `/clima` | Clima del estadio de una ciudad | `/clima miami` |
| `/h2h` | Historial cara a cara entre dos equipos | `/h2h españa vs francia` |
| `/prediccion` | Análisis IA + cuotas del próximo partido | `/prediccion argentina` |
| `/noticias` | Últimas noticias de un equipo | `/noticias brasil` |
| `/grupos` | Simulación Monte Carlo de clasificación por grupo | `/grupos A` |
| `/upsets` | Partidos donde ELO y cuotas favorecen equipos distintos | `/upsets` |
| `/ev` | Apuestas con valor esperado positivo detectadas hoy | `/ev` |
| `/portafolio` | P&L de apuestas registradas | `/portafolio` |
| `/elo` | Ranking ELO propio del modelo | `/elo` |
| `/historial` | Historial de apuestas con ROI | `/historial` |
| `/arbitros` | Árbitros asignados a partidos próximos | `/arbitros` |
| `/paises` | Lista de países del torneo | `/paises` |
| `/ayuda` | Lista completa de comandos | `/ayuda` |

> Los nombres de países y jugadores son **insensibles a mayúsculas, tildes e idioma** (puedes escribir "brasil" o "brazil", "espana" o "spain").

---

## Hojas de Google Sheets (29 hojas)

| Hoja | Qué contiene |
|------|-------------|
| `Partidos` | Fixture principal: fechas, marcadores, estadio, hora Chile, status |
| `Equipos` | Catálogo de selecciones con IDs |
| `Jugadores` | Datos de jugadores individuales |
| `Planteles` | Relación jugador–equipo–torneo |
| `Alineaciones` | Titulares y suplentes por partido |
| `PlayerMatchStats` | Estadísticas avanzadas por jugador por partido |
| `EventosLive` | Goles, tarjetas, sustituciones, VAR por partido |
| `ResumenJugadorPartido` | Resumen acumulado de cada jugador en cada partido |
| `OddsApuestas` | Cuotas y probabilidades (1X2, over/under, BTTS) |
| `EstadiosClima` | Clima por partido (temperatura, lluvia, viento) |
| `Noticias` | Artículos de Google News por partido |
| `AnalisisIA` | Análisis OpenAI por partido (guardado permanente) |
| `Clasificacion` | Tabla de posiciones por grupo |
| `HistorialH2H` | Historial cara a cara de partidos |
| `EspnStats` | Estadísticas avanzadas de ESPN (posesión, pases, tackles) |
| `FormaEquipos` | Últimos 5 resultados de cada equipo |
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
| `RawLog` | Log general de operaciones |
| `Dashboard` | Vista consolidada: hoy, tabla, top scorers, estado del pipeline |

---

## APIs y servicios

| Servicio | Para qué se usa | Plan gratuito |
|----------|----------------|---------------|
| [ESPN API](https://site.api.espn.com) | Marcadores en tiempo real, alineaciones, goleadores, forma — **sin cuota** | Ilimitado, sin registro |
| [API-Football](https://api-sports.io) | Fixtures históricos, estadísticas detalladas, árbitros, jugadores | 100 req/día |
| [football-data.org](https://football-data.org) | Fuente secundaria de validación | 10 req/min |
| [Open-Meteo](https://open-meteo.com) | Clima horario por coordenadas de estadio | Ilimitado, sin API key |
| [The Odds API](https://the-odds-api.com) | Cuotas en vivo de múltiples casas de apuestas | 500 req/mes |
| [Google News RSS](https://news.google.com/rss) | Noticias de cada equipo | Ilimitado |
| [OpenAI GPT-4.1](https://openai.com) | Análisis de previas con contexto completo | Pago (~$0.01/partido) |
| [Telegram Bot API](https://core.telegram.org/bots) | Notificaciones y comandos del bot | Gratuito |
| [Pinnacle](https://pinnacle.com) | Cuotas sin margen (las más precisas del mercado) | Vía The Odds API |

> **Fuente primaria para datos en vivo: ESPN.** No consume cuota y refleja el marcador en tiempo real. API-Football se usa para backfill histórico y estadísticas detalladas post-partido.

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

## Instalación desde cero

### 1. Prerequisitos
```bash
npm install -g @google/clasp
clasp login
```

### 2. Subir código
```bash
git clone <repo>
cd world_cup_2026
clasp push
```

### 3. Configurar Script Properties
Agregar todas las propiedades listadas arriba en Apps Script → Configuración del proyecto.

### 4. Carga inicial (ejecutar en orden desde Apps Script → Editor)
```
sheetEnsureAllWithHeaders()       → Crea las 29 hojas con sus columnas
setupTelegramWebhook()            → Conecta el bot de Telegram
loadFullWorldCupCalendarFromEspn() → Carga los 104 partidos del calendario (gratis, ESPN)
recalcularTablaDesdePartidos()    → Genera tabla de posiciones desde los resultados cargados
cronTomorrowPreview()             → Recolecta clima, noticias y cuotas del día siguiente
cronTodayPreviewRefresh()         → Genera análisis IA para partidos de hoy
```

Si tienes crédito de API-Football disponible, después del paso anterior ejecuta:
```
backfillByDateRange('2026-06-11', '<fecha_actual>')  → Carga estadísticas históricas detalladas
loadWorldCupStandings()                              → Tabla de posiciones oficial (1 req)
```

Si el backfill se corta por cuota diaria:
```
backfillStatus()   → Ver qué días faltan (sin gastar cuota)
backfillResume()   → Retomar desde el primer día incompleto
```

### 5. Configurar triggers automáticos
Ir a **Triggers (ícono de reloj)** → **+ Add Trigger**:

| Función | Tipo | Horario |
|---------|------|---------|
| `cronDailyLoadTodayStats` | Day timer | 1am – 2am |
| `cronTomorrowPreview` | Day timer | 7am – 8am |
| `cronTodayPreviewRefresh` | Day timer | 9am – 10am |
| `cronMorningTelegramReport` | Day timer | 10am – 11am |
| `cronMatchDayAnalysis` | Hour timer | Every 2 hours |
| `cronLiveEventsMonitor` | Minute timer | Every 5 minutes |

### 6. Verificar que todo funciona
```
test01_Config   → Verifica que todas las Script Properties están configuradas
test02_SheetAudit → Lista estado de hojas
```

---

## Recuperación de datos sin cuota de API

Si se agotó la cuota de API-Football, estos pasos recuperan los datos usando ESPN (gratuito):

```
1. loadFullWorldCupCalendarFromEspn()
   → Carga / actualiza los 104 partidos con marcadores reales
   → Usa fecha Chile para evitar desfase horario (partidos nocturnos)

2. recalcularTablaDesdePartidos()
   → Recalcula la tabla de posiciones directamente desde la hoja Partidos
   → Incluye los 48 equipos aunque no hayan jugado aún
   → No requiere ninguna API
```

---

## Funciones de mantenimiento

| Función | Descripción |
|---------|-------------|
| `sheetAudit()` | Lista hojas válidas y desconocidas |
| `sheetCleanup()` | Elimina hojas desconocidas vacías |
| `sheetEnsureAllWithHeaders()` | Crea hojas faltantes con sus columnas |
| `backfillStatus()` | Estado del backfill sin usar cuota |
| `backfillResume()` | Retoma backfill desde el primer día incompleto |
| `loadFullWorldCupCalendarFromEspn()` | Carga calendario completo desde ESPN (gratis) |
| `recalcularTablaDesdePartidos()` | Recalcula tabla de posiciones sin API |
| `refreshDashboard()` | Refresca hoja Dashboard manualmente |
| `loadWorldCupStandings()` | Actualiza tabla desde API-Football (consume 1 req) |
| `runGroupSimulation()` | Ejecuta simulación Monte Carlo de grupos |
| `setupTelegramWebhook()` | Registra/actualiza el webhook del bot |

---

## Presupuesto de API calls

| API | Límite | Uso típico/día | Notas |
|-----|--------|---------------|-------|
| ESPN | Ilimitado | 10–50 req/día | Fuente primaria para datos en vivo |
| API-Football | 100 req/día | 25–50 req | Solo backfill y estadísticas post-partido |
| The Odds API | 500 req/mes | 1 req/día | Cache de 6h en Drive |
| Open-Meteo | Ilimitado | 3–6 req/día | Sin API key |
| Google News RSS | Ilimitado | 8–16 req/día | Sin API key |
| OpenAI | Pago por uso | 3–5 req/día | ~$0.01/día en fase de grupos |

---

## Zona horaria

Toda la lógica usa **America/Santiago** (Chile) para fechas y horas. Las fechas en Google Sheets se normalizan mediante `normalizeFecha_()` y `normalizeHora_()` para evitar el desfase que ocurre cuando Google Sheets convierte automáticamente strings a objetos Date.

---

## Glosario — Para quien no sabe de fútbol ni de tecnología

### Términos de fútbol

| Término | Qué significa |
|---------|--------------|
| **Fixture** | Un partido programado con fecha, hora y lugar |
| **FT** | Full Time — el partido terminó (90 minutos) |
| **AET** | After Extra Time — el partido terminó en tiempo extra (120 min) |
| **PEN** | El partido se definió en penales |
| **NS** | Not Started — el partido todavía no comenzó |
| **1H** | Primera mitad (45 minutos) del partido en curso |
| **HT** | Half Time — descanso entre los dos tiempos |
| **2H** | Segunda mitad del partido en curso |
| **ET** | Extra Time — prórroga (tiempo extra de 15+15 min) |
| **BT** | Break Time — descanso antes de la prórroga |
| **P** | Penales en curso |
| **H2H** | Head to Head — historial de enfrentamientos directos entre dos equipos |
| **GD** | Goal Difference — diferencia de goles (goles a favor menos en contra) |
| **PJ** | Partidos Jugados |
| **PG / PE / PP** | Partidos Ganados / Empatados / Perdidos |
| **GF / GC** | Goles a Favor / Goles en Contra |
| **1X2** | Mercado de apuesta: 1 = gana local, X = empate, 2 = gana visitante |
| **BTTS** | Both Teams To Score — apuesta a que ambos equipos marcan |
| **Over/Under 2.5** | Apuesta sobre si el partido tendrá más o menos de 2.5 goles en total |
| **VAR** | Video Assistant Referee — árbitro de video que revisa jugadas polémicas |
| **Posesión** | Porcentaje del tiempo que un equipo tuvo el balón |
| **Autogol** | Gol en propia puerta — el jugador mete el balón en su propio arco |
| **Corner** | Tiro de esquina cuando el balón sale por la línea de fondo tras tocar a un defensa |
| **Falta** | Infracción que detiene el juego y entrega el balón al equipo contrario |
| **Titular** | Jugador que empieza el partido desde el inicio |
| **Suplente** | Jugador en el banco, disponible para entrar como cambio |

### Términos de estadísticas y probabilidades

| Término | Qué significa |
|---------|--------------|
| **ELO** | Sistema de puntos para medir el nivel de un equipo basado en resultados históricos. Sube al ganar y baja al perder, proporcional a la dificultad del rival |
| **EV (Expected Value)** | Valor Esperado — indica si una apuesta tiene ganancia esperada positiva. EV > 0% significa que la cuota paga más de lo que la probabilidad real sugiere |
| **Kelly** | Fórmula matemática que calcula el porcentaje óptimo del dinero a apostar según el EV y la probabilidad |
| **Vig / Margen** | Comisión que cobra la casa de apuestas. Una cuota de 2.00 con 5% de vig equivale a una probabilidad real de ~52% |
| **Pinnacle** | Casa de apuestas con el margen más bajo del mundo (~2%), usada como referencia para probabilidades de mercado |
| **Monte Carlo** | Método que simula miles de posibles resultados para estimar probabilidades (ej: "¿qué % de veces clasifica Argentina si simulamos 10.000 torneos?") |
| **Brier Score** | Métrica de precisión probabilística. 0 = perfecto, 1 = pésimo. Mide qué tan bien calibradas están las predicciones del modelo |
| **Upset** | Cuando el equipo menos favorecido gana. El sistema detecta cuando ELO y cuotas favorecen equipos diferentes |
| **P&L** | Profit & Loss — ganancias y pérdidas acumuladas en las apuestas |
| **ROI** | Return on Investment — rentabilidad porcentual de las apuestas |

### Términos técnicos

| Término | Qué significa |
|---------|--------------|
| **Google Apps Script** | Plataforma de Google que permite programar y automatizar tareas directamente en Google Sheets, sin servidores propios |
| **Cron / Trigger** | Tarea programada que se ejecuta automáticamente en horarios definidos (ej: todos los días a la 1am) |
| **API** | Interfaz que permite a dos sistemas intercambiar datos. Ej: la API de ESPN entrega el marcador en tiempo real cuando el sistema lo solicita |
| **Webhook** | URL que recibe mensajes automáticamente. Telegram envía cada mensaje del bot a esta URL para que el sistema lo procese |
| **Upsert** | Operación que actualiza un registro si ya existe o lo crea si no existe (combinación de Update + Insert) |
| **Backfill** | Cargar datos históricos del pasado que no estaban en el sistema |
| **Match Key** | Identificador único de un partido en formato `yyyy-MM-dd_localNorm_visitanteNorm` |
| **Script Properties** | Variables privadas almacenadas en Apps Script (como contraseñas/claves de API) que no se suben al código |
| **Cache / Caché** | Datos guardados temporalmente para no volver a descargarlos. Ej: el clima se guarda 4 horas para no llamar a Open-Meteo en cada consulta |
| **Golden Dataset** | Conjunto de datos considerado la versión definitiva y correcta, construido combinando múltiples fuentes y resolviendo conflictos |
| **clasp** | Herramienta de línea de comandos de Google para sincronizar código de Apps Script con un repositorio Git |

---

## Archivos del proyecto (48 archivos .gs)

| Archivo | Responsabilidad |
|---------|----------------|
| `Config.gs` | Constantes globales: URLs, IDs de hojas, timezone |
| `Utils.gs` | Funciones de utilidad: fechas, normalización de nombres, diccionario ES↔EN de países |
| `Main.gs` | Orquestador de todos los crons |
| `BotCommands.gs` | Lógica de cada comando del bot (`/hoy`, `/tabla`, `/en_vivo`, etc.) |
| `Telegram.gs` | Envío de mensajes y fotos, gestión de suscriptores |
| `EspnApi.gs` | Integración ESPN: scoreboard, summary, alineaciones, goleadores, forma |
| `EspnStats.gs` | Guardado de estadísticas ESPN en hoja `EspnStats` y `FormaEquipos` |
| `ApiFootball.gs` | Integración API-Football: fixtures, eventos, estadísticas, jugadores |
| `LiveEvents.gs` | Monitor de eventos en vivo, alertas de goles/rojas, comando `/en_vivo` |
| `Standings.gs` | Tabla de posiciones: carga desde API o recalcula desde hoja Partidos |
| `BackfillRunner.gs` | Carga masiva de datos históricos por rango de fechas |
| `Wather.gs` | Integración Open-Meteo: clima horario por coordenadas de estadio |
| `VenueCatalog.gs` | Coordenadas y timezone de los 16 estadios del Mundial |
| `OddsApi.gs` | Cuotas de The Odds API + extracción de odds Pinnacle |
| `EloRating.gs` | Modelo ELO de equipos: cálculo y actualización post-partido |
| `EvModel.gs` | Modelo de valor esperado (EV): detecta apuestas con EV+ |
| `GroupSimulator.gs` | Simulación Monte Carlo de clasificación por grupo |
| `BettingHistory.gs` | Registro, liquidación y reporte de apuestas |
| `AiAnalysis.gs` | Integración OpenAI: construcción de prompt y guardado de análisis |
| `MatchPreview.gs` | Construcción del contexto enriquecido para la IA |
| `News.gs` | Google News RSS: búsqueda de noticias por equipo/partido |
| `HeadToHead.gs` | Historial H2H entre pares de equipos |
| `Lineups.gs` | Alineaciones: carga desde API-Football o desde hoja Alineaciones |
| `ImageGenerator.gs` | URLs de gráficos de probabilidades via QuickChart.io |
| `SheetManager.gs` | Definición de todas las hojas y sus headers |
| `SheetsRepository.gs` | CRUD sobre Google Sheets: readAll, appendRows, upsert |
| `SourceMatcher.gs` | Matching de partidos entre diferentes fuentes por `match_key` |
| `GoldenDataset.gs` | Construcción del dataset definitivo combinando fuentes |
| `Dashboard.gs` | Actualización de la hoja Dashboard |
| `SmartAlerts.gs` | Alertas inteligentes: suspensiones, clima extremo, movimiento de cuotas |
| `UpsetDetector.gs` | Detección de divergencias ELO vs mercado |
| `ClassificationAlert.gs` | Alertas de partidos decisivos para clasificación |
| `PipelineHealth.gs` | Monitoreo de salud del pipeline de datos |

---

## Zona horaria

Todo el sistema usa **America/Santiago** (Chile). Las fechas en Google Sheets se normalizan automáticamente para evitar el desfase que ocurre cuando Google detecta que "2026-06-14" es una fecha y la convierte a un objeto Date interno.

Partidos que juegan tarde en Chile (22:00+) corresponden al día siguiente en UTC. El calendario ESPN se ajusta usando la hora Chile del kickoff, no la fecha UTC del query.
