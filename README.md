# Mundial 2026 Apps Script Bot

Proyecto para recolectar datos del Mundial 2026 usando Google Apps Script, Google Sheets, Google Drive, APIs externas, IA y Telegram.

## Objetivos

- Cargar partidos y estadísticas del día.
- Guardar JSON crudo en Google Drive.
- Normalizar información en Google Sheets.
- Analizar partidos del día siguiente.
- Obtener clima, noticias y probabilidades básicas.
- Generar resumen diario a las 10:00 AM hora Chile.
- Enviar alertas live por Telegram: goles, tarjetas rojas, penales, VAR, lesiones y eventos importantes.
- Preparar comandos para consultar partidos, resultados, selección, fecha y eventos.

## Arquitectura

Apps Script corre en la nube de Google mediante triggers programados.

Flujos principales:

1. Carga diaria de partidos terminados.
2. Previa de partidos del día siguiente.
3. Resumen IA + Telegram.
4. Monitor live de eventos importantes.
5. Comandos Telegram bajo demanda.

## Requisitos

- Google Sheet central del Mundial 2026.
- Carpeta Google Drive para JSON raw.
- API Key de API-Football.
- API Key de clima.
- API Key de OpenAI u otro proveedor IA.
- Bot de Telegram.

## Script Properties necesarias

Configurar en Apps Script > Project Settings > Script Properties:

```text
SPREADSHEET_ID=
RAW_FOLDER_ID=
API_FOOTBALL_KEY=
WEATHER_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TIMEZONE=America/Santiago
````

## Instalación con clasp

```bash
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "Mundial2026 Bot"
clasp push
```

## Triggers recomendados

* `cronDailyLoadTodayStats`: todos los días 01:00.
* `cronTomorrowPreview`: todos los días 07:30.
* `cronMorningTelegramReport`: todos los días 10:00.
* `cronLiveEventsMonitor`: cada 5 minutos durante ventanas de partidos.
