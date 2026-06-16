# Mundial 2026 — Bot y Sistema de Estadísticas

Sistema completo de seguimiento del FIFA World Cup 2026 construido sobre Google Apps Script. Recolecta estadísticas de múltiples APIs, enriquece cada partido con contexto inteligente (clima, cuotas, suspensiones, lesiones, H2H, forma) y entrega análisis de IA a través de un bot de Telegram multi-usuario.

---

## Arquitectura general

```
API-Football ──┐
football-data  ├──► Google Sheets (22 hojas) ◄──► Bot Telegram
Open-Meteo ────┤         ▲                          (multi-usuario)
Google News ───┤         │
The Odds API ──┘    Google Drive
                    (JSON raw cache)
                         ▲
                     OpenAI GPT-4.1-mini
                    (análisis por partido)
```

Todo corre en **Apps Script V8** — sin servidores, sin costo de infraestructura.

---

## Flujos principales

### 1. Carga diaria de estadísticas — `cronDailyLoadTodayStats` (01:00 AM)
- Obtiene fixtures del día desde API-Football
- Guarda JSON raw en Google Drive (idempotente — no re-descarga si ya existe)
- Upsert en hoja `Partidos` (dedup por `match_key`)
- Por cada fixture: eventos (goles, tarjetas, VAR), estadísticas avanzadas, stats por jugador
- Actualiza tabla de posiciones en `Clasificacion`

### 2. Preparación del día siguiente — `cronTomorrowPreview` (07:30 AM)
- Obtiene fixtures de mañana
- Recolecta **sin llamar a OpenAI**: clima (Open-Meteo), noticias (Google News RSS), cuotas (The Odds API con cache Drive 6h), historial H2H
- Cada fuente chequea su caché antes de llamar a la API
- Ejecuta alertas inteligentes: amarillas acumuladas, clima extremo, movimiento de cuotas
- Refresca hoja `Dashboard`

### 3. Análisis IA — `cronMatchDayAnalysis` (cada 2 horas)
- Detecta partidos entre 30 y 240 minutos antes del kickoff
- Si no hay análisis guardado, construye contexto completo y llama a OpenAI:
  - Estado del grupo y qué se juega cada equipo
  - Jugadores en riesgo de suspensión (≥2 amarillas)
  - Lesiones detectadas en noticias
  - Jugadores en forma (rating ≥7.0 en último partido)
  - Historial H2H (últimos 5 enfrentamientos)
- Guarda resultado en `AnalisisIA` — si ya existe, no vuelve a llamar a OpenAI

### 4. Reporte matutino — `cronMorningTelegramReport` (10:00 AM)
- Lee partidos, análisis IA, clima y cuotas de las hojas (cero API calls)
- Envía mensaje HTML a **todos los suscriptores** del bot

### 5. Monitor live — `cronLiveEventsMonitor` (cada 5 min)
- Detecta fixtures probablemente en curso (ventana de tiempo)
- Fetch de eventos nuevos por fixture
- Envía alertas Telegram para goles, rojas, VAR y penales

---

## Bot de Telegram — Comandos

El bot es multi-usuario: cualquier persona que le escriba queda registrada automáticamente en la hoja `Suscriptores` y recibe los reportes masivos.

| Comando | Descripción | Ejemplo |
|---------|-------------|---------|
| `/hoy` | Partidos de hoy con hora y estadio | `/hoy` |
| `/ayer` | Resultados de ayer | `/ayer` |
| `/proximos` | Partidos de los próximos 3 días | `/proximos` |
| `/seleccion` | Todos los partidos de un equipo | `/seleccion argentina` |
| `/tabla` | Tabla de posiciones por grupo | `/tabla` |
| `/stats` | PJ, goles, posesión de un equipo | `/stats brasil` |
| `/jugador` | Goles, asistencias y tarjetas del torneo | `/jugador messi` |
| `/clima` | Clima del estadio de una ciudad | `/clima miami` |
| `/h2h` | Historial cara a cara entre dos equipos | `/h2h españa vs francia` |
| `/prediccion` | Análisis IA + cuotas del próximo partido | `/prediccion argentina` |
| `/noticias` | Últimas noticias de un equipo | `/noticias brasil` |
| `/ayuda` | Lista de comandos | `/ayuda` |

Los nombres de países y jugadores son **insensibles a mayúsculas y tildes**.

---

## Hojas de Google Sheets (22 hojas)

| Hoja | Contenido |
|------|-----------|
| `Partidos` | Fixture principal — resultados, estadísticas, hora Chile |
| `Equipos` | Catálogo de selecciones |
| `Jugadores` | Planteles completos |
| `Planteles` | Relación jugador-equipo-torneo |
| `PlayerMatchStats` | Estadísticas avanzadas por jugador por partido |
| `EventosLive` | Goles, tarjetas, sustituciones, VAR por fixture |
| `ResumenJugadorPartido` | Resumen acumulado de jugador en cada partido |
| `OddsApuestas` | Cuotas y probabilidades (1X2, over/under, BTTS) |
| `EstadiosClima` | Clima por fixture (temperatura, lluvia, viento) |
| `Noticias` | Artículos de Google News por partido |
| `AnalisisIA` | Análisis OpenAI por fixture (cache permanente) |
| `Clasificacion` | Tabla de posiciones por grupo |
| `HistorialH2H` | Historial cara a cara de partidos |
| `Alertas` | Registro de alertas enviadas por Telegram |
| `Suscriptores` | Chat IDs registrados del bot |
| `ReportesTelegram` | Historial de reportes matutinos enviados |
| `SourceFixtures` | Datos crudos normalizados de API-Football |
| `MatchMapping` | Mapeo de IDs entre API-Football y football-data.org |
| `DataQualityLog` | Registro de calidad del golden dataset |
| `PipelineRuns` | Historial de ejecuciones de crons con estado |
| `RawLog` | Log general de operaciones |
| `Dashboard` | Vista consolidada: hoy, tabla, top scorers, pipeline |

---

## APIs y servicios

| Servicio | Uso | Plan gratuito |
|----------|-----|---------------|
| [API-Football](https://api-sports.io) | Fixtures, eventos, stats, jugadores, H2H, standings | 100 req/día |
| [football-data.org](https://football-data.org) | Fuente secundaria/validación | 10 req/min |
| [Open-Meteo](https://open-meteo.com) | Clima por coordenadas | Ilimitado, sin API key |
| [The Odds API](https://the-odds-api.com) | Cuotas 1X2, over/under, BTTS | 500 req/mes |
| [Google News RSS](https://news.google.com/rss) | Noticias por equipo | Ilimitado |
| [OpenAI GPT-4.1-mini](https://openai.com) | Análisis de previas | Pago (~$0.01/partido) |
| [Telegram Bot API](https://core.telegram.org/bots) | Notificaciones y comandos | Gratuito |

---

## Script Properties

Configurar en Apps Script → Configuración del proyecto → Propiedades de script:

| Propiedad | Descripción | Obligatorio |
|-----------|-------------|-------------|
| `SPREADSHEET_ID` | ID del Google Sheet | Sí |
| `RAW_FOLDER_ID` | ID de carpeta Drive para JSON raw | Sí |
| `API_FOOTBALL_KEY` | Key de api-sports.io | Sí |
| `FOOTBALL_DATA_KEY` | Key de football-data.org | Sí |
| `THE_ODDS_API_KEY` | Key de the-odds-api.com | Sí |
| `OPENAI_API_KEY` | Key de OpenAI | Sí |
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather | Sí |
| `URL_WEB_APP` | URL del Web App deployment | Sí |
| `TELEGRAM_CHAT_ID` | Chat ID de fallback (opcional) | No |

---

## Instalación

### 1. Prerequisitos
```bash
npm install -g @google/clasp
clasp login
```

### 2. Clonar y subir
```bash
git clone <repo>
cd world_cup_2026
clasp push
```

### 3. Configurar Script Properties
Agregar todas las propiedades listadas arriba en Apps Script → Configuración del proyecto.

### 4. Carga inicial (ejecutar en orden desde Apps Script)
```
sheetEnsureAll          → crea las 22 hojas con sus headers
setupTelegramWebhook    → registra el webhook del bot
backfillWorldCupOpeningWeek  → carga datos históricos (usa ~85 req de API-Football)
loadWorldCupStandings   → carga tabla de posiciones
cronTomorrowPreview     → recolecta datos del día siguiente
cronTodayPreviewRefresh → genera análisis IA para partidos de hoy
```

Si el backfill se corta por cuota diaria:
```
backfillStatus   → ver qué días faltan (sin gastar cuota)
backfillResume   → retomar desde el primer día incompleto
```

### 5. Configurar triggers en Apps Script
Ir a **Triggers (ícono de reloj)** → **+ Add Trigger**:

| Función | Tipo | Horario |
|---------|------|---------|
| `cronDailyLoadTodayStats` | Day timer | 1am – 2am |
| `cronTomorrowPreview` | Day timer | 7am – 8am |
| `cronTodayPreviewRefresh` | Day timer | 9am – 10am |
| `cronMorningTelegramReport` | Day timer | 10am – 11am |
| `cronMatchDayAnalysis` | Hour timer | Every 2 hours |
| `cronLiveEventsMonitor` | Minute timer | Every 5 minutes |

### 6. Registrar el webhook
Cada vez que hagas una nueva implementación del Web App, ejecutar:
```
setupTelegramWebhook
```

Para verificar:
```
getTelegramWebhookInfo
```

---

## Funciones de mantenimiento

| Función | Descripción |
|---------|-------------|
| `sheetAudit()` | Lista hojas válidas y desconocidas |
| `sheetCleanup()` | Elimina hojas desconocidas VACÍAS |
| `sheetCleanupForce()` | Elimina hojas desconocidas aunque tengan datos |
| `sheetEnsureAll()` | Crea hojas faltantes con sus headers |
| `backfillStatus()` | Estado del backfill sin usar cuota de API |
| `backfillResume()` | Retoma backfill desde el primer día incompleto |
| `refreshDashboard()` | Refresca hoja Dashboard manualmente |
| `loadWorldCupStandings()` | Actualiza tabla de posiciones |

---

## Tests manuales

`ManualTest.gs` contiene 15 funciones de prueba organizadas por riesgo (de menos a más API calls):

```
test01_Config              → verifica Script Properties
test02_SheetAudit          → lista estado de hojas
test03_SheetCleanup        → limpia hojas desconocidas vacías
test04_PreviewContextLocal → contexto enriquecido sin API calls
test05_Weather             → prueba Open-Meteo (gratis)
test06_News                → prueba Google News RSS (gratis)
test07_Standings           → tabla de posiciones (1 req)
test08_Odds                → cuotas The Odds API (1 req/mes)
test09_H2H                 → historial H2H (1 req)
test10_FullPreviewDryRun   → preview completo sin OpenAI (~3 req)
test11_FullPreviewWithAI   → preview completo con OpenAI (~3 req + 1 OpenAI)
test12_CronTodayPreview    → cron completo del día
test13_BackfillStatus      → estado del backfill
test14_BackfillResume      → retoma backfill
test15_Dashboard           → refresca Dashboard
```

---

## Presupuesto de API calls

| API | Límite | Uso típico/día | Margen |
|-----|--------|---------------|--------|
| API-Football | 100 req/día | 25–50 req | Ajustado en fase de grupos |
| The Odds API | 500 req/mes | 1 req/día (cache 6h) | Holgado |
| Open-Meteo | Ilimitado | 3–6 req/día | Sin límite |
| Google News RSS | Ilimitado | 8–16 req/día | Sin límite |
| OpenAI | Pago por uso | 3–5 req/día | ~$0.01/día |

> El backfill tiene un presupuesto interno de 85 req para no agotar el límite diario de API-Football.

---

## Zona horaria

Todos los horarios en el sistema usan `America/Santiago` (Chile). Los partidos se muestran en hora Chile en la hoja `Partidos` y en los mensajes de Telegram.
