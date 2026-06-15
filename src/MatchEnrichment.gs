/**
 * MatchEnrichment.gs
 *
 * Responsabilidad:
 * - Enriquecer la hoja Partidos después de construir el Golden Dataset.
 * - Usar API-Football statistics para métricas de partido.
 * - Usar API-Football events para tarjetas.
 * - Guardar raw JSON en Drive.
 *
 * Este archivo NO decide qué partidos existen.
 * Solo completa columnas faltantes de partidos ya presentes en Partidos.
 */

function enrichGoldenMatchesByDate_(dateChile) {
  const matches = getGoldenMatchesByChileDate_(dateChile);

  Logger.log(`Partidos a enriquecer para fecha_chile=${dateChile}: ${matches.length}`);

  matches.forEach(match => {
    try {
      enrichGoldenMatch_(match);
      Utilities.sleep(900);
    } catch (e) {
      Logger.log(`Error enriqueciendo fixture ${match.fixture_id_api_football || match.match_id}: ${e.message}`);
    }
  });

  return {
    fecha_chile: dateChile,
    matches: matches.length,
    status: 'OK'
  };
}

function enrichGoldenMatch_(match) {
  const fixtureId = match.fixture_id_api_football || match.match_id;

  if (!fixtureId) {
    throw new Error('Partido sin fixture_id_api_football ni match_id');
  }

  const statisticsData = fetchStatisticsByFixture_(fixtureId);
  const statisticsRawUrl = saveRawJson_(
    `raw/api-football/statistics/${fixtureId}`,
    `api-football-statistics-${fixtureId}.json`,
    statisticsData
  );

  const eventsData = fetchEventsByFixture_(fixtureId);
  const eventsRawUrl = saveRawJson_(
    `raw/api-football/events/${fixtureId}`,
    `api-football-events-${fixtureId}.json`,
    eventsData
  );

  const stats = extractMatchStatsForPartidos_(statisticsData.response || []);
  const cards = extractCardsFromEvents_(eventsData.response || [], match.local, match.visitante);

  updatePartidosEnrichment_(match.match_key, {
    posesion_local: stats.home.possession,
    posesion_visitante: stats.away.possession,

    tiros_local: stats.home.totalShots,
    tiros_visitante: stats.away.totalShots,

    xg_local: stats.home.expectedGoals,
    xg_visitante: stats.away.expectedGoals,

    corners_local: stats.home.cornerKicks,
    corners_visitante: stats.away.cornerKicks,

    faltas_local: stats.home.fouls,
    faltas_visitante: stats.away.fouls,

    amarillas_local: cards.home.yellow,
    amarillas_visitante: cards.away.yellow,

    rojas_local: cards.home.red,
    rojas_visitante: cards.away.red,

    data_quality_notes: appendNote_(
      match.data_quality_notes,
      `Enriquecido con statistics/events API-Football. Stats raw: ${statisticsRawUrl}. Events raw: ${eventsRawUrl}`
    )
  });
}

function getGoldenMatchesByChileDate_(dateChile) {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);
  const targetDate = normalizeSheetDateToYyyyMmDd_(dateChile);

  Logger.log(`Buscando partidos con fecha_chile normalizada=${targetDate}`);
  Logger.log(`Total filas Partidos=${rows.length}`);

  const matches = rows.filter(row => {
    const rowDate = normalizeSheetDateToYyyyMmDd_(row.fecha_chile);

    Logger.log(`match_key=${row.match_key} | fecha_chile_raw=${row.fecha_chile} | fecha_chile_norm=${rowDate}`);

    return rowDate === targetDate;
  });

  return matches;
}

function normalizeSheetDateToYyyyMmDd_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  const text = String(value).trim();

  // Caso "2026-06-13"
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  // Caso "2026-06-13 15:00:00"
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.substring(0, 10);
  }

  // Caso número interno de Google Sheets
  if (!isNaN(Number(text))) {
    const serial = Number(text);
    const millis = Math.round((serial - 25569) * 86400 * 1000);
    const date = new Date(millis);
    return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  try {
    const date = new Date(text);
    if (!isNaN(date.getTime())) {
      return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
  } catch (e) {
    // ignore
  }

  return text;
}


function extractMatchStatsForPartidos_(statisticsResponse) {
  const result = {
    home: emptyStatsObject_(),
    away: emptyStatsObject_()
  };

  if (!statisticsResponse || statisticsResponse.length === 0) {
    return result;
  }

  const homeTeamStats = statisticsResponse[0];
  const awayTeamStats = statisticsResponse[1];

  if (homeTeamStats) {
    result.home = parseApiFootballStats_(homeTeamStats.statistics || []);
  }

  if (awayTeamStats) {
    result.away = parseApiFootballStats_(awayTeamStats.statistics || []);
  }

  return result;
}

function emptyStatsObject_() {
  return {
    possession: '',
    totalShots: '',
    expectedGoals: '',
    cornerKicks: '',
    fouls: ''
  };
}

function parseApiFootballStats_(statistics) {
  const output = emptyStatsObject_();

  statistics.forEach(stat => {
    const type = String(stat.type || '').toLowerCase();
    const value = normalizeStatValue_(stat.value);

    if (type === 'ball possession') {
      output.possession = value;
    }

    if (type === 'total shots') {
      output.totalShots = value;
    }

    if (type === 'expected goals' || type === 'xg') {
      output.expectedGoals = value;
    }

    if (type === 'corner kicks') {
      output.cornerKicks = value;
    }

    if (type === 'fouls') {
      output.fouls = value;
    }
  });

  return output;
}

function normalizeStatValue_(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return value.replace('%', '').trim();
  }

  return value;
}

function extractCardsFromEvents_(events, homeName, awayName) {
  const result = {
    home: {
      yellow: 0,
      red: 0
    },
    away: {
      yellow: 0,
      red: 0
    }
  };

  events.forEach(event => {
    if (event.type !== 'Card') return;

    const teamName = event.team ? event.team.name : '';
    const side = detectSideByTeamName_(teamName, homeName, awayName);

    if (!side) return;

    if (event.detail === 'Yellow Card') {
      result[side].yellow += 1;
    }

    if (event.detail === 'Red Card') {
      result[side].red += 1;
    }
  });

  return result;
}

function detectSideByTeamName_(teamName, homeName, awayName) {
  const t = normalizeTeamNameStrong_(teamName);
  const h = normalizeTeamNameStrong_(homeName);
  const a = normalizeTeamNameStrong_(awayName);

  if (t === h) return 'home';
  if (t === a) return 'away';

  return '';
}

function updatePartidosEnrichment_(matchKey, fieldsToUpdate) {
  const sheet = getSheet_(CONFIG.SHEETS.PARTIDOS);
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    throw new Error('Partidos no tiene datos');
  }

  const headers = values[0];
  const matchKeyIndex = headers.indexOf('match_key');

  if (matchKeyIndex === -1) {
    throw new Error('Partidos no tiene columna match_key');
  }

  let targetRow = null;

  values.slice(1).forEach((row, index) => {
    if (String(row[matchKeyIndex]) === String(matchKey)) {
      targetRow = index + 2;
    }
  });

  if (!targetRow) {
    throw new Error(`No se encontró match_key en Partidos: ${matchKey}`);
  }

  Object.keys(fieldsToUpdate).forEach(fieldName => {
    const colIndex = headers.indexOf(fieldName);

    if (colIndex === -1) {
      Logger.log(`Columna no encontrada en Partidos: ${fieldName}`);
      return;
    }

    sheet.getRange(targetRow, colIndex + 1).setValue(fieldsToUpdate[fieldName]);
  });
}

function appendNote_(currentNote, newNote) {
  if (!currentNote) return newNote;
  return `${currentNote} | ${newNote}`;
}