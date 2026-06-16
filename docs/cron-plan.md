# Plan de Crons — World Cup 2026

> Zona horaria base: `America/Santiago` (Chile, UTC-4 en horario de verano).
> Configurar en Apps Script → Triggers.

---

## Jobs implementados

### `cronDailyLoadTodayStats` — Carga diaria de estadísticas
- **Horario:** 01:00 AM Chile (todos los días del torneo)
- **Función:** `Main.gs → cronDailyLoadTodayStats()`
- **Envuelto en:** `runWithHealthCheck_()` → alerta Telegram si falla
- **Qué hace:**
  1. Fetch fixtures del día desde API-Football (`/fixtures?date=...`)
  2. Guarda raw JSON en Drive (`fixtures/{fecha}/`)
  3. Guarda eventos (goles, tarjetas, sustituciones) → `EventosLive`
  4. Genera resúmenes de jugador por partido → `ResumenJugadorPartido`
  5. Fetch statistics por fixture → Drive (`statistics/{fecha}/`)
  6. Fetch estadísticas avanzadas por jugador (`/fixtures/players`) → `PlayerMatchStats`
  7. Actualiza tabla de posiciones → `Clasificacion`
- **API calls:** ~4-6 req por fixture (fixtures + events + statistics + players)
- **Presupuesto:** ~20-25 req/día en fase de grupos (3-4 partidos/día)

---

### `cronTomorrowPreview` — Vista previa del día siguiente
- **Horario:** 07:30 AM Chile (todos los días del torneo)
- **Función:** `Main.gs → cronTomorrowPreview()`
- **Envuelto en:** `runWithHealthCheck_()` → alerta Telegram si falla
- **Qué hace:**
  1. Fetch fixtures de mañana
  2. Para cada fixture:
     - Obtiene clima real con Open-Meteo → `EstadiosClima`
     - Fetch noticias Google News → `Noticias`
     - Fetch cuotas reales The Odds API → `OddsApuestas` (con cache Drive 6h)
     - Fetch historial H2H → `HistorialH2H`
     - Genera análisis IA con todo el contexto → `AnalisisIA`
  3. Ejecuta `SmartAlerts`: amarillas acumuladas, clima extremo, movimiento de cuotas → Telegram
  4. Actualiza Dashboard consolidado
- **API calls:** ~2-4 req por fixture (H2H + fixtures)
- **Open-Meteo:** Gratuito, sin límite
- **The Odds API:** 1 req total (cache 6h)
- **Presupuesto:** ~10-15 req/día (H2H + fixtures)

---

### `cronMorningTelegramReport` — Reporte matutino
- **Horario:** 10:00 AM Chile (días con partidos)
- **Función:** `Telegram.gs → cronMorningTelegramReport()` *(pendiente implementar)*
- **Qué hace:**
  1. Lee partidos del día desde `Partidos`
  2. Lee análisis IA desde `AnalisisIA`
  3. Lee cuotas desde `OddsApuestas`
  4. Compone mensaje HTML para Telegram
  5. Envía al chat configurado
- **API calls:** 0 (solo lee Sheets)
- **Estado:** Parcialmente implementado (falta función de reporte)

---

### `cronLiveEventsMonitor` — Monitor live (cada 5 min)
- **Horario:** Cada 5 minutos (Apps Script time-based trigger)
- **Activo:** Solo durante ventana de partidos (≥15 min antes de kickoff hasta +140 min)
- **Función:** `LiveEvents.gs → cronLiveEventsMonitor()`
- **Qué hace:**
  1. Identifica fixtures probablemente en vivo (ventana de tiempo)
  2. Fetch eventos desde API-Football por cada fixture
  3. Detecta eventos nuevos no alertados
  4. Envía alertas Telegram para goles, rojas, VAR
  5. Marca eventos como alertados en `Alertas`
- **API calls:** ~1-2 req por fixture en vivo
- **Presupuesto:** ~12 req/hora por partido activo (muy bajo consumo)

---

## Presupuesto total de API calls

| API | Límite free | Uso estimado/día | Margen |
|-----|-------------|-----------------|--------|
| API-Football | 100 req/día | 30-50 req | Justo en fase de grupos |
| The Odds API | 500 req/mes | 1 req/día | Holgado (cache 6h) |
| Open-Meteo | Ilimitado | 3-5 req/día | Sin límite |
| Football-Data.org | 10 req/min | 5-10 req/día | Holgado |
| Google News RSS | Ilimitado | 10-20 req/día | Sin límite |
| OpenAI | Pago | 3-5 req/día | ~$0.01/día con gpt-4.1-mini |

> ⚠️ **Riesgo:** API-Football tiene 100 req/día en free tier. En días con 4+ partidos
> (fase de grupos) más live monitor activo, se puede agotar. Solución: cache en Drive
> para fixtures ya consultados ese día.

---

## Jobs pendientes de implementar

### `cronMorningTelegramReport` — Reporte matutino completo
- **Función a crear en:** `Telegram.gs` o `Main.gs`
- **Descripción:** Consolidar análisis IA + cuotas + clima + H2H en un mensaje matutino
- **Dependencias:** `AnalisisIA`, `OddsApuestas`, `EstadiosClima`, `HistorialH2H`

### `cronWeeklyTopScorers` — Top goleadores semanal *(opcional)*
- **Horario:** Lunes 09:00 AM (durante el torneo)
- **Descripción:** Resumir top 10 goleadores del torneo, enviar a Telegram
- **Fuente:** `ResumenJugadorPartido` + API-Football `/players/topscorers`

---

## Configuración en Apps Script

Para crear un trigger en Apps Script:

```
Editar → Triggers → Agregar trigger:
- Función: cronDailyLoadTodayStats
- Fuente: Basado en tiempo
- Tipo: Día (hora específica)
- Hora: 1:00 - 2:00 AM

- Función: cronTomorrowPreview
- Hora: 7:00 - 8:00 AM

- Función: cronMorningTelegramReport
- Hora: 10:00 - 11:00 AM

- Función: cronLiveEventsMonitor
- Tipo: Minutos (cada 5 minutos)
```
