function fetchWeatherForFixture_(fixture) {
  const venue = fixture.fixture.venue || {};

  return {
    fixture_id: fixture.fixture.id,
    stadium: venue.name || '',
    city: venue.city || '',
    temperature_c: null,
    humidity: null,
    wind_kmh: null,
    rain_probability: null,
    condition: 'PENDIENTE_API_CLIMA',
    source: 'pending'
  };
}

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