/**
 * Wather.gs
 *
 * Integración con Open-Meteo (https://open-meteo.com/).
 * 100% gratuito, sin API key, soporta pronóstico por coordenadas.
 *
 * Obtiene el clima para la hora exacta del partido usando las coordenadas
 * del estadio definidas en VenueCatalog.gs.
 */

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Obtiene el clima para un fixture dado.
 * Usa las coordenadas del estadio de VenueCatalog.
 *
 * @param {Object} fixture - Objeto fixture de API-Football
 * @returns {Object} weather con campos normalizados
 */
function fetchWeatherForFixture_(fixture) {
  // Chequear cache en EstadiosClima antes de llamar a Open-Meteo
  const fixtureId = fixture.fixture.id;
  if (fixtureId) {
    const cached = readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).find(r =>
      String(r.fixture_id) === String(fixtureId) &&
      r.temperatura_c !== '' && r.temperatura_c !== null && r.temperatura_c !== undefined
    );
    if (cached) {
      return {
        fixture_id:       fixtureId,
        stadium:          cached.estadio || cached.stadium || '',
        city:             cached.ciudad || cached.city || '',
        temperature_c:    cached.temperatura_c !== undefined ? cached.temperatura_c : cached.temperature_c,
        humidity:         cached.humedad !== undefined ? cached.humedad : cached.humidity,
        wind_kmh:         cached.viento_kmh !== undefined ? cached.viento_kmh : cached.wind_kmh,
        rain_probability: cached.prob_lluvia !== undefined ? cached.prob_lluvia : cached.rain_probability,
        condition:        cached.condicion || cached.condition || 'DESCONOCIDO',
        source:           'cache'
      };
    }
  }

  const venue = fixture.fixture.venue || {};
  const venueName = venue.name || '';
  const city = venue.city || '';

  const venueInfo = getVenueInfo_(venueName, city);

  const lat = venueInfo.lat;
  const lon = venueInfo.lon;

  if (!lat || !lon) {
    console.warn(`No se encontraron coordenadas para estadio: ${venueName} | ${city}`);
    return buildWeatherStub_(fixture, 'SIN_COORDENADAS');
  }

  const matchDateUtc = fixture.fixture.date;

  if (!matchDateUtc) {
    return buildWeatherStub_(fixture, 'SIN_FECHA');
  }

  const matchDate = matchDateUtc.substring(0, 10);

  let data;
  try {
    data = callOpenMeteo_(lat, lon, matchDate);
  } catch (e) {
    console.warn(`Open-Meteo error para ${venueName}: ${e.message}`);
    return buildWeatherStub_(fixture, 'API_ERROR');
  }

  const matchHour = getMatchHourUtc_(matchDateUtc, venueInfo.timezone_estadio);
  const weather = extractHourlyWeather_(data, matchDateUtc, matchHour);

  return {
    fixture_id: fixture.fixture.id,
    stadium: venueName,
    city,
    temperature_c: weather.temperature_c,
    humidity: weather.humidity,
    wind_kmh: weather.wind_kmh,
    rain_probability: weather.rain_probability,
    condition: classifyCondition_(weather),
    source: 'open-meteo'
  };
}

/**
 * Llama la API de Open-Meteo para obtener pronóstico horario.
 */
function callOpenMeteo_(lat, lon, date) {
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    `hourly=temperature_2m,precipitation_probability,windspeed_10m,relativehumidity_2m`,
    `start_date=${date}`,
    `end_date=${date}`,
    `timezone=UTC`
  ].join('&');

  const url = `${OPEN_METEO_BASE_URL}?${params}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();

  if (status < 200 || status >= 300) {
    throw new Error(`Open-Meteo ${status}: ${response.getContentText().substring(0, 200)}`);
  }

  return JSON.parse(response.getContentText());
}

/**
 * Extrae los valores meteorológicos para la hora del partido.
 * Open-Meteo devuelve 24 valores por día (índice 0-23 = hora UTC 0-23).
 */
function extractHourlyWeather_(data, matchDateUtc, matchHourUtc) {
  const hourly = data.hourly || {};
  const times = hourly.time || [];

  const matchPrefix = matchDateUtc.substring(0, 13);

  let idx = times.findIndex(t => String(t).startsWith(matchPrefix));

  if (idx === -1) {
    idx = matchHourUtc !== null ? matchHourUtc : 12;
  }

  idx = Math.max(0, Math.min(idx, 23));

  return {
    temperature_c: roundOne_(hourly.temperature_2m ? hourly.temperature_2m[idx] : null),
    humidity:      Math.round(hourly.relativehumidity_2m ? hourly.relativehumidity_2m[idx] : null),
    wind_kmh:      roundOne_(hourly.windspeed_10m ? hourly.windspeed_10m[idx] : null),
    rain_probability: hourly.precipitation_probability ? hourly.precipitation_probability[idx] : null
  };
}

/**
 * Clasifica la condición climática a partir de los valores numéricos.
 */
function classifyCondition_(w) {
  const rain = w.rain_probability;
  const temp = w.temperature_c;
  const wind = w.wind_kmh;

  if (rain === null && temp === null) return 'DESCONOCIDO';
  if (rain !== null && rain >= 70) return 'LLUVIA';
  if (rain !== null && rain >= 40) return 'PROBABLE_LLUVIA';
  if (wind !== null && wind >= 50) return 'VIENTO_FUERTE';
  if (temp !== null && temp >= 35) return 'CALOR_EXTREMO';
  if (temp !== null && temp <= 5) return 'FRIO_EXTREMO';
  return 'DESPEJADO';
}

function getMatchHourUtc_(matchDateUtc, timezoneEstadio) {
  try {
    const d = new Date(matchDateUtc);
    return d.getUTCHours();
  } catch (e) {
    return 12;
  }
}

function roundOne_(val) {
  return val !== null && val !== undefined ? Math.round(val * 10) / 10 : null;
}

function buildWeatherStub_(fixture, condition) {
  const venue = fixture.fixture.venue || {};
  return {
    fixture_id: fixture.fixture.id,
    stadium: venue.name || '',
    city: venue.city || '',
    temperature_c: null,
    humidity: null,
    wind_kmh: null,
    rain_probability: null,
    condition,
    source: 'unavailable'
  };
}

/**
 * Guarda el clima del fixture en la hoja EstadiosClima.
 */
function saveWeatherForFixture_(fixture, weather) {
  appendRows_(CONFIG.SHEETS.ESTADIOS_CLIMA, [[
    safe_(fixture.fixture.venue && fixture.fixture.venue.id),
    safe_(weather.stadium),
    safe_(weather.city),
    safe_(fixture.league.country),
    '',
    safe_(weather.temperature_c),
    safe_(weather.humidity),
    safe_(weather.wind_kmh),
    safe_(weather.rain_probability),
    safe_(weather.condition),
    nowChile_(),
    safe_(weather.source),
    safe_(fixture.fixture.id)
  ]]);
}
