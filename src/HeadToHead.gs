/**
 * HeadToHead.gs
 *
 * Obtiene y persiste el historial cara a cara entre dos equipos.
 * Fuente: API-Football /fixtures/headtohead
 *
 * Se llama durante cronTomorrowPreview() para enriquecer el análisis
 * de cada partido del día siguiente.
 */

const H2H_LAST_N = 5;

/**
 * Carga el historial H2H para un fixture del día siguiente.
 * Requiere que los team IDs de API-Football estén disponibles en el fixture.
 *
 * @param {Object} fixture - Objeto fixture de API-Football
 */
function loadHeadToHeadForFixture_(fixture) {
  const homeId = fixture.teams && fixture.teams.home ? fixture.teams.home.id : null;
  const awayId = fixture.teams && fixture.teams.away ? fixture.teams.away.id : null;

  if (!homeId || !awayId) {
    console.warn('H2H: IDs de equipos no disponibles para fixture', fixture.fixture.id);
    return;
  }

  const data = fetchH2H_(homeId, awayId);
  const matches = (data.response || []).slice(0, H2H_LAST_N);

  if (!matches.length) {
    console.log(`H2H: Sin historial para ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
    return;
  }

  saveH2HMatches_(fixture, matches);
  console.log(`H2H guardado: ${matches.length} partidos para fixture ${fixture.fixture.id}`);
}

/**
 * Llama API-Football /fixtures/headtohead.
 */
function fetchH2H_(homeId, awayId) {
  return apiFootballGet_('/fixtures/headtohead', {
    h2h: `${homeId}-${awayId}`,
    last: H2H_LAST_N
  });
}

/**
 * Persiste los matches H2H en la hoja HistorialH2H.
 * Evita duplicados por (fixture_ref_id, h2h_fixture_id).
 */
function saveH2HMatches_(refFixture, h2hMatches) {
  const sheetName = 'HistorialH2H';
  const sheet = ensureH2HSheet_(sheetName);

  const existing = getExistingH2HPairs_(sheet, refFixture.fixture.id);

  const rows = [];

  h2hMatches.forEach(m => {
    const h2hFixtureId = m.fixture ? m.fixture.id : '';

    if (existing[String(h2hFixtureId)]) return;

    const homeScore = m.score && m.score.fulltime ? m.score.fulltime.home : null;
    const awayScore = m.score && m.score.fulltime ? m.score.fulltime.away : null;

    let resultado = 'N/A';
    if (homeScore !== null && awayScore !== null) {
      if (homeScore > awayScore) resultado = m.teams.home.name;
      else if (awayScore > homeScore) resultado = m.teams.away.name;
      else resultado = 'Empate';
    }

    rows.push([
      refFixture.fixture.id,
      refFixture.teams.home.name,
      refFixture.teams.away.name,
      h2hFixtureId,
      m.fixture ? m.fixture.date : '',
      m.league ? m.league.name : '',
      m.league ? m.league.country : '',
      m.teams && m.teams.home ? m.teams.home.name : '',
      m.teams && m.teams.away ? m.teams.away.name : '',
      homeScore,
      awayScore,
      resultado,
      m.fixture ? m.fixture.status.short : '',
      nowChile_()
    ]);
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function getExistingH2HPairs_(sheet, refFixtureId) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  const headers = values[0];
  const refIdx = headers.indexOf('fixture_ref_id');
  const h2hIdx = headers.indexOf('h2h_fixture_id');

  const map = {};
  values.slice(1).forEach(row => {
    if (String(row[refIdx]) === String(refFixtureId)) {
      map[String(row[h2hIdx])] = true;
    }
  });

  return map;
}

/**
 * Crea la hoja HistorialH2H con headers si no existe.
 */
function ensureH2HSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = [
      'fixture_ref_id', 'equipo_local_ref', 'equipo_visitante_ref',
      'h2h_fixture_id', 'fecha', 'torneo', 'pais',
      'local', 'visitante', 'goles_local', 'goles_visitante',
      'resultado', 'estado', 'loaded_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Devuelve un resumen de H2H formateado para Telegram.
 * Busca en HistorialH2H los partidos del fixture indicado.
 */
function buildH2HSummaryText_(fixtureId, homeTeam, awayTeam) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = ss.getSheetByName('HistorialH2H');

  if (!sheet || sheet.getLastRow() <= 1) {
    return `Sin historial H2H para ${homeTeam} vs ${awayTeam}.`;
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const refIdx = headers.indexOf('fixture_ref_id');

  const rows = values.slice(1).filter(r => String(r[refIdx]) === String(fixtureId));

  if (!rows.length) {
    return `Sin historial H2H registrado para este partido.`;
  }

  let msg = `📋 <b>Historial ${homeTeam} vs ${awayTeam}</b>\n`;

  const fechaIdx = headers.indexOf('fecha');
  const localIdx = headers.indexOf('local');
  const visitanteIdx = headers.indexOf('visitante');
  const glIdx = headers.indexOf('goles_local');
  const gvIdx = headers.indexOf('goles_visitante');
  const torneoIdx = headers.indexOf('torneo');

  rows.slice(0, H2H_LAST_N).forEach(r => {
    const fecha = String(r[fechaIdx] || '').substring(0, 10);
    msg += `\n${fecha} — ${r[localIdx]} ${r[glIdx]} - ${r[gvIdx]} ${r[visitanteIdx]} (${r[torneoIdx]})`;
  });

  return msg;
}
