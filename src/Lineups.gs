/**
 * Lineups.gs
 *
 * Carga, guarda y consulta alineaciones por fixture.
 * Fuente: API-Football /fixtures/lineups
 * Hoja: Alineaciones (fixture_id, equipo, rol, numero, jugador, posicion, grid, updated_at)
 *
 * También se usa en el comando /jugadores para mostrar titulares y suplentes
 * cuando hay un partido en curso o reciente.
 */

const LINEUP_HEADERS = [
  'fixture_id', 'equipo', 'equipo_id', 'rol',
  'numero', 'jugador', 'jugador_id', 'posicion', 'grid', 'updated_at'
];

// ─── Carga y guardado ─────────────────────────────────────────────────────────

/**
 * Obtiene la alineación de un fixture desde la hoja o la API.
 * Llama a la API solo si no hay datos guardados.
 * @returns {{ home: {titulares, suplentes, formacion}, away: {titulares, suplentes, formacion} } | null}
 */
function getOrFetchLineup_(fixture) {
  const fixtureId = String(fixture.fixture.id);

  const cached = readLineupFromSheet_(fixtureId);
  if (cached) return cached;

  // Solo llamar a la API si el partido ya comenzó o terminó
  const status = fixture.fixture.status && fixture.fixture.status.short;
  const liveStatuses = ['1H','HT','2H','ET','BT','P','LIVE','INT','FT','AET','PEN'];
  if (!liveStatuses.includes(status)) return null;

  try {
    const data = fetchLineupsByFixture_(fixtureId);
    const lineups = data.response || [];
    if (!lineups.length) return null;

    saveLineups_(fixtureId, lineups);
    return parseLineupsResponse_(lineups);
  } catch (e) {
    console.warn(`Lineups fetch error fixture ${fixtureId}: ${e.message}`);
    return null;
  }
}

function readLineupFromSheet_(fixtureId) {
  try {
    const rows = readAll_(CONFIG.SHEETS.ALINEACIONES).filter(
      r => String(r.fixture_id) === String(fixtureId)
    );
    if (!rows.length) return null;
    return groupLineupRows_(rows);
  } catch (e) {
    return null;
  }
}

function saveLineups_(fixtureId, lineupsResponse) {
  const sheet = getOrCreateSheet_(CONFIG.SHEETS.ALINEACIONES, LINEUP_HEADERS);

  // Borrar filas previas del mismo fixture
  const values = sheet.getDataRange().getValues();
  const fidIdx = values[0].indexOf('fixture_id');
  if (fidIdx !== -1) {
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][fidIdx]) === String(fixtureId)) sheet.deleteRow(i + 1);
    }
  }

  const rows = [];
  lineupsResponse.forEach(teamData => {
    const equipo   = teamData.team && teamData.team.name || '';
    const equipoId = teamData.team && teamData.team.id   || '';
    const formacion = teamData.formation || '';

    (teamData.startXI || []).forEach(entry => {
      const p = entry.player || {};
      rows.push([
        fixtureId, equipo, equipoId, 'titular',
        p.number || '', p.name || '', p.id || '', p.pos || '', p.grid || '',
        nowChile_()
      ]);
    });

    (teamData.substitutes || []).forEach(entry => {
      const p = entry.player || {};
      rows.push([
        fixtureId, equipo, equipoId, 'suplente',
        p.number || '', p.name || '', p.id || '', p.pos || '', '',
        nowChile_()
      ]);
    });
  });

  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function parseLineupsResponse_(lineupsResponse) {
  const result = {};
  lineupsResponse.forEach(teamData => {
    const equipo   = teamData.team && teamData.team.name || '';
    const formacion = teamData.formation || '';

    const titulares = (teamData.startXI || []).map(e => ({
      numero:   e.player && e.player.number || '',
      jugador:  e.player && e.player.name   || '',
      posicion: e.player && e.player.pos    || '',
      grid:     e.player && e.player.grid   || ''
    }));

    const suplentes = (teamData.substitutes || []).map(e => ({
      numero:   e.player && e.player.number || '',
      jugador:  e.player && e.player.name   || '',
      posicion: e.player && e.player.pos    || ''
    }));

    result[equipo] = { formacion, titulares, suplentes };
  });
  return result;
}

function groupLineupRows_(rows) {
  const result = {};
  rows.forEach(r => {
    const equipo = r.equipo || '';
    if (!result[equipo]) result[equipo] = { formacion: '', titulares: [], suplentes: [] };
    const entry = {
      numero:   r.numero   || '',
      jugador:  r.jugador  || '',
      posicion: r.posicion || '',
      grid:     r.grid     || ''
    };
    if (r.rol === 'titular')  result[equipo].titulares.push(entry);
    if (r.rol === 'suplente') result[equipo].suplentes.push(entry);
  });
  return result;
}

// ─── Texto para Telegram ──────────────────────────────────────────────────────

/**
 * Construye el bloque de alineación para un equipo.
 */
function buildLineupText_(equipoName, lineupData) {
  if (!lineupData) return '';

  const titulares = lineupData.titulares || [];
  const suplentes = lineupData.suplentes || [];
  const formacion = lineupData.formacion || '';

  let msg = `\n📋 <b>${equipoName}${formacion ? ' (' + formacion + ')' : ''}</b>\n`;

  if (titulares.length) {
    msg += '<b>Titulares:</b>\n';
    titulares.forEach(p => {
      msg += `  ${p.numero ? p.numero + '. ' : ''}${p.jugador}${p.posicion ? ' <i>(' + p.posicion + ')</i>' : ''}\n`;
    });
  }

  if (suplentes.length) {
    msg += '<b>Suplentes:</b>\n';
    suplentes.forEach(p => {
      msg += `  ${p.numero ? p.numero + '. ' : ''}${p.jugador}${p.posicion ? ' <i>(' + p.posicion + ')</i>' : ''}\n`;
    });
  }

  return msg;
}

// ─── Integración con cronDailyLoadTodayStats ──────────────────────────────────

/**
 * Carga y guarda la alineación de un fixture terminado o en curso.
 * Llamar desde loadWorldCupDay_ después de los eventos.
 */
function loadLineupsForFixture_(fixture) {
  const fixtureId = fixture.fixture.id;
  const cached = readLineupFromSheet_(String(fixtureId));
  if (cached && Object.keys(cached).length) return; // ya tenemos datos

  try {
    const data = fetchLineupsByFixture_(fixtureId);
    const lineups = data.response || [];
    if (lineups.length) saveLineups_(fixtureId, lineups);
  } catch (e) {
    console.warn(`loadLineupsForFixture_ ${fixtureId}: ${e.message}`);
  }
}
