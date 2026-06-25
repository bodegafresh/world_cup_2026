/**
 * WeatherService.gs
 *
 * Enriquecimiento meteorologico limpio:
 * - Lee partidos + sedes canonicas desde Supabase.
 * - Usa kickoff_at como fuente de verdad en UTC.
 * - Consulta Open-Meteo por lat/lon y hora UTC.
 * - Persiste un snapshot cacheado en matches.metadata.weather.
 * - Para UI refresca si el cache vencio; para modelo debe usarse el snapshot
 *   capturado al momento del feature/model run.
 */

const PT_OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const PT_WEATHER_DEFAULT_REFRESH_LIMIT = 20;

function job_worldCup_enrichWeather() {
  return ptRunJob_('worldcup_enrich_weather', function() {
    const result = enrichWeatherForWorldCupMatches_({});
    return {
      status: result.errors ? 'WARN' : 'OK',
      records_processed: result.processed,
      records_upserted: result.updated,
      skipped: result.skipped,
      errors: result.errors
    };
  });
}

function enrichWeatherForWorldCupMatches_(options) {
  options = options || {};
  const season = ptGetWorldCupSeason_();
  if (!season) return { processed: 0, updated: 0, skipped: 0, errors: 1, reason: 'season_not_found' };

  const limit = Math.max(1, Math.min(200, Number(options.limit || 104)));
  let query = 'select=match_id,competition_season_id,venue_id,kickoff_at,status,metadata' +
    '&competition_season_id=eq.' + season.competition_season_id +
    '&venue_id=not.is.null' +
    '&order=kickoff_at.asc' +
    '&limit=' + limit;
  if (options.date_from) query += '&kickoff_at=gte.' + encodeURIComponent(String(options.date_from).substring(0, 10) + 'T00:00:00.000Z');
  if (options.date_to) query += '&kickoff_at=lt.' + encodeURIComponent(ptAddDays_(String(options.date_to).substring(0, 10), 1) + 'T00:00:00.000Z');

  const matches = ptSelect_('matches', query);
  const venueIds = uniqueStrings_(matches.map(function(match) { return match.venue_id; }));
  const venues = venueIds.length
    ? ptSelect_('venues', 'select=*&venue_id=in.(' + venueIds.join(',') + ')')
    : [];
  const venuesById = venues.reduce(function(acc, venue) {
    acc[venue.venue_id] = venue;
    return acc;
  }, {});

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  matches.forEach(function(match) {
    processed++;
    const venue = venuesById[match.venue_id];
    if (!venue || !venue.latitude || !venue.longitude || !match.kickoff_at) {
      skipped++;
      return;
    }
    try {
      const refreshed = refreshWeatherCacheForMatch_(match, venue, options);
      if (!refreshed.updated) {
        skipped++;
        return;
      }
      const metadata = Object.assign({}, match.metadata || {}, { weather: refreshed.weather });
      supabaseRequest_('patch', 'matches', { metadata: metadata }, {
        query: 'match_id=eq.' + encodeURIComponent(match.match_id),
        prefer: 'return=minimal'
      });
      updated++;
    } catch (e) {
      errors++;
      try {
        ptLogQuality_('ENRICHMENT', 'WARN', 'WEATHER_ENRICHMENT_ERROR', 'Weather enrichment failed', {
          match_id: match.match_id,
          venue_id: match.venue_id,
          error: e.message
        });
      } catch (ignored_) {}
    }
  });

  return { processed: processed, updated: updated, skipped: skipped, errors: errors };
}

function refreshWeatherCacheForMatches_(matches, context, options) {
  options = options || {};
  if (!matches || !matches.length || !context || !context.venues) return { processed: 0, updated: 0, skipped: 0, errors: 0 };

  const limit = Math.max(0, Math.min(100, Number(options.refresh_limit || options.limit || PT_WEATHER_DEFAULT_REFRESH_LIMIT)));
  if (!limit) return { processed: 0, updated: 0, skipped: matches.length, errors: 0 };

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  for (let i = 0; i < matches.length; i++) {
    if (processed >= limit) break;
    const match = matches[i];
    const venue = context.venues[match.venue_id];
    if (!venue || !venue.latitude || !venue.longitude || !match.kickoff_at) {
      skipped++;
      continue;
    }
    const existing = ((match.metadata || {}).weather) || null;
    if (!shouldRefreshWeatherCache_(match, existing, options)) {
      skipped++;
      continue;
    }
    processed++;
    try {
      const refreshed = refreshWeatherCacheForMatch_(match, venue, options);
      if (!refreshed.updated) {
        skipped++;
        continue;
      }
      match.metadata = Object.assign({}, match.metadata || {}, { weather: refreshed.weather });
      supabaseRequest_('patch', 'matches', { metadata: match.metadata }, {
        query: 'match_id=eq.' + encodeURIComponent(match.match_id),
        prefer: 'return=minimal'
      });
      updated++;
    } catch (e) {
      errors++;
      try {
        ptLogQuality_('ENRICHMENT', 'WARN', 'WEATHER_CACHE_REFRESH_ERROR', 'Weather cache refresh failed', {
          match_id: match.match_id,
          venue_id: match.venue_id,
          error: e.message
        });
      } catch (ignored_) {}
    }
  }
  return { processed: processed, updated: updated, skipped: skipped, errors: errors };
}

function refreshWeatherCacheForMatch_(match, venue, options) {
  options = options || {};
  const existing = ((match.metadata || {}).weather) || null;
  if (!shouldRefreshWeatherCache_(match, existing, options)) {
    return { updated: false, weather: existing };
  }
  return { updated: true, weather: fetchWeatherForCanonicalMatch_(match, venue, options) };
}

function shouldRefreshWeatherCache_(match, existing, options) {
  options = options || {};
  if (options.force || options.force_refresh) return true;
  if (String(options.cache || '').toLowerCase() === 'off') return true;
  if (isWeatherTerminal_(match, existing)) return false;
  if (!existing || !existing.expires_at) return true;
  return new Date(String(existing.expires_at)).getTime() <= new Date().getTime();
}

function isWeatherTerminal_(match, existing) {
  if (!existing || !existing.captured_at) return false;
  const status = String(match.status || '').toUpperCase();
  if (['FINISHED', 'FT', 'CANCELLED', 'POSTPONED'].indexOf(status) === -1) return false;
  const kickoffMs = new Date(match.kickoff_at).getTime();
  const capturedMs = new Date(existing.captured_at).getTime();
  if (!kickoffMs || !capturedMs) return false;
  return capturedMs >= kickoffMs;
}

function fetchWeatherForCanonicalMatch_(match, venue, options) {
  options = options || {};
  const target = weatherTargetForMatch_(match, options);
  const date = String(target.forecast_for).substring(0, 10);
  const data = callOpenMeteoForVenue_(venue.latitude, venue.longitude, date);
  const hourly = extractOpenMeteoHour_(data, target.forecast_for);
  const ttl = weatherTtlMinutesForMatch_(match, target.mode, options);
  const capturedAt = ptNowIso_();
  return {
    source: 'OPEN_METEO',
    provider: 'open-meteo',
    mode: target.mode,
    captured_at: capturedAt,
    expires_at: new Date(new Date(capturedAt).getTime() + ttl * 60 * 1000).toISOString(),
    ttl_minutes: ttl,
    forecast_for: target.forecast_for,
    match_kickoff_at: match.kickoff_at,
    venue_id: venue.venue_id,
    venue_name: venue.display_name,
    city: venue.city,
    latitude: Number(venue.latitude),
    longitude: Number(venue.longitude),
    timezone: 'UTC',
    temperature_c: hourly.temperature_c,
    humidity_pct: hourly.humidity_pct,
    wind_kph: hourly.wind_kph,
    rain_probability_pct: hourly.rain_probability_pct,
    condition: classifyCanonicalWeather_(hourly),
    payload: hourly.payload
  };
}

function weatherTargetForMatch_(match, options) {
  options = options || {};
  if (options.forecast_for) {
    return { mode: 'MANUAL', forecast_for: ptToUtcIso_(options.forecast_for) || match.kickoff_at };
  }
  const now = new Date();
  const kickoff = new Date(match.kickoff_at);
  const deltaHours = (kickoff.getTime() - now.getTime()) / 3600000;
  const status = String(match.status || '').toUpperCase();
  if (['LIVE', 'IN_PLAY', 'HT', '1H', '2H'].indexOf(status) !== -1 || Math.abs(deltaHours) <= 3) {
    return { mode: 'LIVE_CACHE', forecast_for: now.toISOString() };
  }
  return { mode: 'KICKOFF_FORECAST', forecast_for: match.kickoff_at };
}

function weatherTtlMinutesForMatch_(match, mode, options) {
  if (options.ttl_minutes) return Math.max(5, Math.min(360, Number(options.ttl_minutes)));
  if (mode === 'LIVE_CACHE') return 15;
  const kickoff = new Date(match.kickoff_at);
  const deltaHours = (kickoff.getTime() - new Date().getTime()) / 3600000;
  if (deltaHours >= 0 && deltaHours <= 48) return 120;
  return 360;
}

function callOpenMeteoForVenue_(lat, lon, date) {
  const params = [
    'latitude=' + encodeURIComponent(lat),
    'longitude=' + encodeURIComponent(lon),
    'hourly=temperature_2m,precipitation_probability,windspeed_10m,relativehumidity_2m',
    'start_date=' + encodeURIComponent(date),
    'end_date=' + encodeURIComponent(date),
    'timezone=UTC'
  ].join('&');
  const response = ptHttpGetJson_(PT_OPEN_METEO_BASE_URL + '?' + params, {}, { retries: 2 });
  if (!response || !response.ok) {
    throw new Error('Open-Meteo HTTP ' + (response && response.status));
  }
  return response.json || {};
}

function extractOpenMeteoHour_(data, kickoffAt) {
  const hourly = data.hourly || {};
  const times = hourly.time || [];
  const prefix = String(kickoffAt || '').substring(0, 13);
  let idx = times.findIndex(function(time) { return String(time).substring(0, 13) === prefix; });
  if (idx === -1) {
    const fallbackHour = new Date(kickoffAt).getUTCHours();
    idx = Math.max(0, Math.min(23, Number(fallbackHour || 12)));
  }
  return {
    temperature_c: roundWeatherOne_(arrayValue_(hourly.temperature_2m, idx)),
    humidity_pct: roundWeatherZero_(arrayValue_(hourly.relativehumidity_2m, idx)),
    wind_kph: roundWeatherOne_(arrayValue_(hourly.windspeed_10m, idx)),
    rain_probability_pct: roundWeatherZero_(arrayValue_(hourly.precipitation_probability, idx)),
    payload: {
      time: times[idx] || null,
      units: data.hourly_units || {}
    }
  };
}

function classifyCanonicalWeather_(weather) {
  const rain = weather.rain_probability_pct;
  const temp = weather.temperature_c;
  const wind = weather.wind_kph;
  if (rain === null && temp === null) return 'UNKNOWN';
  if (rain !== null && rain >= 70) return 'RAIN';
  if (rain !== null && rain >= 40) return 'POSSIBLE_RAIN';
  if (wind !== null && wind >= 50) return 'STRONG_WIND';
  if (temp !== null && temp >= 35) return 'EXTREME_HEAT';
  if (temp !== null && temp <= 5) return 'EXTREME_COLD';
  return 'CLEAR';
}

function arrayValue_(values, index) {
  return values && values.length > index ? values[index] : null;
}

function roundWeatherOne_(value) {
  if (value === null || value === undefined || value === '') return null;
  return Math.round(Number(value) * 10) / 10;
}

function roundWeatherZero_(value) {
  if (value === null || value === undefined || value === '') return null;
  return Math.round(Number(value));
}

function uniqueStrings_(values) {
  const seen = {};
  const out = [];
  values.forEach(function(value) {
    if (!value || seen[value]) return;
    seen[value] = true;
    out.push(value);
  });
  return out;
}
