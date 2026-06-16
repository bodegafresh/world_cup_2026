/**
 * EloRating.gs
 *
 * Sistema ELO dinámico por equipo para el Mundial 2026.
 *
 * El ELO se actualiza automáticamente después de cada partido FT/AET/PEN
 * desde loadWorldCupDay_() en Main.gs.
 *
 * K-factor dinámico según ronda:
 *   Grupos → 30 | Octavos → 40 | Cuartos → 45 | Semis → 50 | Final → 60
 *
 * Cuando no hay cuotas de mercado disponibles, getEloProbabilities_() reemplaza
 * el fallback uniforme 0.33/0.33/0.33 en OddsModel.gs.
 */

// ─── ELO iniciales por equipo ─────────────────────────────────────────────────
// Basados en ranking FIFA + rendimiento reciente (junio 2026).
// Se actualizan progresivamente con cada partido del torneo.

const ELO_DEFAULTS = {
  // CONMEBOL
  'Argentina':      1860,
  'Brazil':         1800,
  'Uruguay':        1690,
  'Colombia':       1670,
  'Ecuador':        1530,
  'Venezuela':      1490,
  'Paraguay':       1460,
  'Peru':           1440,
  'Bolivia':        1390,
  'Chile':          1410,
  // UEFA
  'France':         1840,
  'England':        1810,
  'Spain':          1790,
  'Portugal':       1775,
  'Netherlands':    1760,
  'Germany':        1750,
  'Belgium':        1720,
  'Italy':          1710,
  'Croatia':        1700,
  'Switzerland':    1650,
  'Denmark':        1640,
  'Austria':        1600,
  'Serbia':         1610,
  'Hungary':        1560,
  'Poland':         1550,
  'Ukraine':        1580,
  'Czechia':        1555,
  'Slovakia':       1520,
  'Scotland':       1510,
  'Turkey':         1530,
  'Romania':        1490,
  'Albania':        1460,
  'Georgia':        1440,
  'Slovenia':       1430,
  // CONCACAF
  'Mexico':         1620,
  'USA':            1600,
  'Canada':         1560,
  'Panama':         1490,
  'Honduras':       1430,
  'Costa Rica':     1440,
  'Jamaica':        1410,
  'Haiti':          1380,
  // AFC
  'Japan':          1590,
  'South Korea':    1570,
  'Iran':           1540,
  'Australia':      1520,
  'Saudi Arabia':   1480,
  'Qatar':          1430,
  'Iraq':           1440,
  'Jordan':         1410,
  'UAE':            1390,
  'Uzbekistan':     1400,
  'Oman':           1370,
  // CAF
  'Morocco':        1660,
  'Senegal':        1630,
  'Nigeria':        1590,
  'Egypt':          1570,
  'Cameroon':       1540,
  "Cote d'Ivoire":  1530,
  'Ghana':          1510,
  'Algeria':        1500,
  'Tunisia':        1490,
  'South Africa':   1470,
  'Mali':           1450,
  'Burkina Faso':   1440,
  'Zambia':         1400,
  'Angola':         1390,
  // OFC
  'New Zealand':    1380
};

const ELO_HEADERS = [
  'equipo', 'elo_actual', 'elo_anterior', 'partidos',
  'victorias', 'empates', 'derrotas', 'updated_at'
];

// ─── Consulta de ELO ──────────────────────────────────────────────────────────

/**
 * Retorna el ELO actual de un equipo.
 * Primero busca en la hoja EloRatings (datos del torneo),
 * luego cae a ELO_DEFAULTS (valores iniciales).
 */
function getTeamElo_(teamName) {
  try {
    const rows = readAll_(CONFIG.SHEETS.ELO_RATINGS);
    const row  = rows.find(r => teamNameMatches_(r.equipo, teamName));
    if (row && row.elo_actual) return Number(row.elo_actual);
  } catch (e) { /* hoja no existe aún */ }

  const key = Object.keys(ELO_DEFAULTS).find(k => teamNameMatches_(k, teamName));
  return key ? ELO_DEFAULTS[key] : 1500;
}

// ─── Fórmulas ELO ─────────────────────────────────────────────────────────────

/**
 * Probabilidad esperada de A ganarle a B según ELO.
 * @returns {number} [0, 1]
 */
function eloExpected_(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * K-factor dinámico según la ronda del torneo.
 * Mayor K = cambio de ELO más grande tras cada resultado.
 */
function getKFactor_(round) {
  const r = String(round || '').toLowerCase();
  if (r.includes('final') && !r.includes('quarter') && !r.includes('semi')) return 60;
  if (r.includes('semi'))    return 50;
  if (r.includes('quarter')) return 45;
  if (r.includes('16') || r.includes('round of')) return 40;
  return 30; // fase de grupos
}

// ─── Actualización post-partido ───────────────────────────────────────────────

/**
 * Actualiza el ELO de ambos equipos después de un partido terminado.
 * Llamar desde loadWorldCupDay_() en Main.gs solo si status = FT/AET/PEN.
 */
function updateEloAfterMatch_(fixture) {
  const status = String((fixture.fixture.status && fixture.fixture.status.short) || '');
  if (!['FT', 'AET', 'PEN'].includes(status)) return;

  const home      = fixture.teams.home.name;
  const away      = fixture.teams.away.name;
  const goalsHome = Number(fixture.goals && fixture.goals.home != null ? fixture.goals.home : -1);
  const goalsAway = Number(fixture.goals && fixture.goals.away != null ? fixture.goals.away : -1);

  if (goalsHome < 0 || goalsAway < 0) return; // resultado incompleto

  const eloHome = getTeamElo_(home);
  const eloAway = getTeamElo_(away);

  // resultado: 1 = victoria local, 0.5 = empate, 0 = derrota local
  const resultHome = goalsHome > goalsAway ? 1 : goalsHome === goalsAway ? 0.5 : 0;
  const resultAway = 1 - resultHome;

  const expHome = eloExpected_(eloHome, eloAway);
  const expAway = 1 - expHome;

  const K = getKFactor_(fixture.league && fixture.league.round);

  const newEloHome = Math.round(eloHome + K * (resultHome - expHome));
  const newEloAway = Math.round(eloAway + K * (resultAway - expAway));

  upsertElo_(home, newEloHome, eloHome, resultHome);
  upsertElo_(away, newEloAway, eloAway, resultAway);

  Logger.log(`ELO: ${home} ${eloHome}→${newEloHome} | ${away} ${eloAway}→${newEloAway}`);
}

/**
 * Upsert de ELO en la hoja. Si existe la fila para ese equipo, actualiza;
 * si no, agrega. Nunca duplica.
 */
function upsertElo_(equipo, eloNuevo, eloAnterior, resultado) {
  getOrCreateSheet_(CONFIG.SHEETS.ELO_RATINGS, ELO_HEADERS);

  const ss     = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet  = ss.getSheetByName(CONFIG.SHEETS.ELO_RATINGS);
  const vals   = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [ELO_HEADERS];
  const headers = vals[0];
  const eqIdx   = headers.indexOf('equipo');

  const rowIdx = vals.slice(1).findIndex(r => teamNameMatches_(String(r[eqIdx] || ''), equipo));

  if (rowIdx !== -1) {
    const r        = vals[rowIdx + 1];
    const sheetRow = rowIdx + 2;
    const idx      = f => headers.indexOf(f);

    const victorias = Number(r[idx('victorias')]) + (resultado === 1   ? 1 : 0);
    const empates   = Number(r[idx('empates')])   + (resultado === 0.5 ? 1 : 0);
    const derrotas  = Number(r[idx('derrotas')])  + (resultado === 0   ? 1 : 0);
    const partidos  = Number(r[idx('partidos')])  + 1;

    sheet.getRange(sheetRow, idx('elo_actual')   + 1).setValue(eloNuevo);
    sheet.getRange(sheetRow, idx('elo_anterior') + 1).setValue(eloAnterior);
    sheet.getRange(sheetRow, idx('partidos')     + 1).setValue(partidos);
    sheet.getRange(sheetRow, idx('victorias')    + 1).setValue(victorias);
    sheet.getRange(sheetRow, idx('empates')      + 1).setValue(empates);
    sheet.getRange(sheetRow, idx('derrotas')     + 1).setValue(derrotas);
    sheet.getRange(sheetRow, idx('updated_at')   + 1).setValue(nowChile_());
  } else {
    appendRows_(CONFIG.SHEETS.ELO_RATINGS, [[
      equipo, eloNuevo, eloAnterior, 1,
      resultado === 1   ? 1 : 0,
      resultado === 0.5 ? 1 : 0,
      resultado === 0   ? 1 : 0,
      nowChile_()
    ]]);
  }
}

// ─── Probabilidades ELO ───────────────────────────────────────────────────────

/**
 * Calcula probabilidades 1X2 usando el modelo ELO.
 * Reemplaza el fallback uniforme 0.33/0.33/0.33 en OddsModel.gs.
 *
 * La probabilidad de empate se estima como función de la diferencia ELO:
 * a mayor diferencia, menos probable el empate.
 *
 * @returns {{ home_win, draw, away_win, elo_home, elo_away, source }}
 */
function getEloProbabilities_(homeTeam, awayTeam) {
  const eloHome = getTeamElo_(homeTeam);
  const eloAway = getTeamElo_(awayTeam);

  const expHome = eloExpected_(eloHome, eloAway);
  const expAway = 1 - expHome;

  // Probabilidad de empate: mayor cuando fuerzas similares (expHome ≈ 0.5)
  const diff     = Math.abs(expHome - 0.5);
  const drawProb = Math.max(0.18, 0.32 - 0.28 * diff * 2);
  const remaining = 1 - drawProb;

  const total    = expHome + expAway;
  const homeProb = total > 0 ? (expHome / total) * remaining : remaining / 2;
  const awayProb = remaining - homeProb;

  return {
    home_win: Math.round(homeProb * 1000) / 1000,
    draw:     Math.round(drawProb * 1000) / 1000,
    away_win: Math.round(awayProb * 1000) / 1000,
    elo_home: eloHome,
    elo_away: eloAway,
    source:   'ELO'
  };
}

// ─── Texto para Telegram ──────────────────────────────────────────────────────

/**
 * Ranking ELO de todos los equipos del torneo para el comando /elo.
 */
function buildEloRankingText_() {
  let rows = [];

  try {
    rows = readAll_(CONFIG.SHEETS.ELO_RATINGS)
      .sort((a, b) => Number(b.elo_actual) - Number(a.elo_actual));
  } catch (e) { /* hoja vacía, usar defaults */ }

  // Si la hoja está vacía o tiene pocos datos, mostrar defaults
  if (rows.length < 5) {
    const defaults = Object.entries(ELO_DEFAULTS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([equipo, elo]) => ({ equipo, elo_actual: elo, partidos: 0, elo_anterior: elo }));
    rows = defaults;
  }

  let msg = `🏆 <b>Ranking ELO — Mundial 2026</b>\n`;
  msg += `<i>Basado en ELO actualizado tras cada partido</i>\n\n`;

  rows.slice(0, 20).forEach((r, i) => {
    const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    const elo    = Number(r.elo_actual);
    const prev   = Number(r.elo_anterior || elo);
    const diff   = elo - prev;
    const arrow  = diff > 0 ? ` <code>↑${diff}</code>` : diff < 0 ? ` <code>↓${Math.abs(diff)}</code>` : '';
    const pj     = Number(r.partidos || 0);
    const pjStr  = pj > 0 ? ` (${pj}pj)` : '';

    msg += `${medal} ${r.equipo} — <b>${elo}</b>${arrow}${pjStr}\n`;
  });

  return msg.trim();
}

/**
 * Inicializa la hoja EloRatings con los valores por defecto para los 48 equipos.
 * Llamar manualmente UNA VEZ al inicio del torneo. No sobreescribe filas existentes.
 */
function initializeEloRatings() {
  getOrCreateSheet_(CONFIG.SHEETS.ELO_RATINGS, ELO_HEADERS);

  let existingRows = [];
  try { existingRows = readAll_(CONFIG.SHEETS.ELO_RATINGS); } catch (e) { /* vacía */ }

  const existingTeams = new Set(existingRows.map(r => String(r.equipo || '').toLowerCase()));
  const toInsert = [];

  Object.entries(ELO_DEFAULTS).forEach(([equipo, elo]) => {
    if (!existingTeams.has(equipo.toLowerCase())) {
      toInsert.push([equipo, elo, elo, 0, 0, 0, 0, nowChile_()]);
    }
  });

  if (toInsert.length) {
    appendRows_(CONFIG.SHEETS.ELO_RATINGS, toInsert);
    Logger.log(`ELO inicializado: ${toInsert.length} equipos insertados.`);
  } else {
    Logger.log('ELO ya inicializado — sin nuevas inserciones.');
  }
}
