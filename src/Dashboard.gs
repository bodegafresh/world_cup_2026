/**
 * Dashboard.gs
 *
 * Construye y actualiza la hoja "Dashboard" con una vista consolidada:
 * - Partidos del día (con resultado live si disponible)
 * - Top 10 goleadores del torneo
 * - Tabla de posiciones compacta
 * - Últimas alertas enviadas
 * - Estado del pipeline (última ejecución por job)
 *
 * Llamar manualmente o desde cronMorningTelegramReport().
 */

function refreshDashboard() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = ensureDashboardSheet_(ss);

  sheet.clearContents();

  let row = 1;

  row = writeDashboardSection_(sheet, row, '🏆 MUNDIAL 2026 — Dashboard', null);
  row = writeDashboardSection_(sheet, row, `Actualizado: ${nowChile_()}`, null);
  row++;

  row = writeTodayMatchesSection_(sheet, row);
  row++;
  row = writeStandingsSection_(sheet, row);
  row++;
  row = writeTopScorersSection_(sheet, row);
  row++;
  row = writeLatestAlertsSection_(sheet, row);
  row++;
  row = writePipelineStatusSection_(sheet, row);

  formatDashboard_(sheet);

  console.log('Dashboard actualizado correctamente.');
}

// ─── Secciones ─────────────────────────────────────────────────────────────────

function writeTodayMatchesSection_(sheet, startRow) {
  const date = todayChile_();
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => String(r.fecha) === date);

  let row = writeDashboardSection_(sheet, startRow, '📅 Partidos de hoy — ' + date, null);

  if (!partidos.length) {
    sheet.getRange(row, 1).setValue('Sin partidos hoy');
    return row + 1;
  }

  const headers = ['Hora (Chile)', 'Local', 'Goles', '', 'Visitante', 'Estadio', 'Estado'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  row++;

  const weatherMap = buildWeatherMapForDashboard_();

  partidos.forEach(p => {
    const goles = (p.goles_local !== '' && p.goles_local !== null)
      ? `${p.goles_local} - ${p.goles_visitante}`
      : 'vs';

    const w = weatherMap[String(p.fixture_id_af || '')];
    const climaStr = w && w.temperatura_c !== null
      ? `${w.temperatura_c}°C ${w.condicion || ''}` : '';

    sheet.getRange(row, 1, 1, 7).setValues([[
      p.hora_chile || '',
      p.local || '',
      goles,
      '',
      p.visitante || '',
      `${p.estadio || ''} ${climaStr}`.trim(),
      p.estado || ''
    ]]);
    row++;
  });

  return row;
}

function writeStandingsSection_(sheet, startRow) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const standingsSheet = ss.getSheetByName('Clasificacion');

  let row = writeDashboardSection_(sheet, startRow, '🗂 Tabla de Posiciones', null);

  if (!standingsSheet || standingsSheet.getLastRow() <= 1) {
    sheet.getRange(row, 1).setValue('Pendiente (fase de grupos no iniciada)');
    return row + 1;
  }

  const rows = readAll_('Clasificacion');
  const byGroup = {};

  rows.forEach(r => {
    const g = r.grupo || 'Sin grupo';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(r);
  });

  Object.keys(byGroup).sort().forEach(grupo => {
    sheet.getRange(row, 1).setValue(grupo).setFontWeight('bold');
    row++;

    const subHeaders = ['Pos', 'Equipo', 'PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'GD', 'Pts', 'Forma'];
    sheet.getRange(row, 1, 1, subHeaders.length).setValues([subHeaders]).setFontStyle('italic');
    row++;

    byGroup[grupo].forEach(r => {
      sheet.getRange(row, 1, 1, 11).setValues([[
        r.posicion, r.equipo, r.pj, r.pg, r.pe, r.pp,
        r.gf, r.gc, r.gd, r.puntos, r.forma || ''
      ]]);
      row++;
    });
    row++;
  });

  return row;
}

function writeTopScorersSection_(sheet, startRow) {
  let row = writeDashboardSection_(sheet, startRow, '⚽ Top Goleadores', null);

  const headers = ['Jugador', 'Equipo', 'Goles', 'Asistencias', 'Partidos', 'Impact Score'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  row++;

  try {
    const playerRows = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

    const byPlayer = {};
    playerRows.forEach(r => {
      const key = String(r.player_id || r.player_name || '');
      if (!key) return;
      if (!byPlayer[key]) {
        byPlayer[key] = {
          nombre: r.player_name || r.jugador || key,
          equipo: r.team_name || r.equipo || '',
          goles: 0,
          asistencias: 0,
          partidos: 0,
          impacto: 0
        };
      }
      byPlayer[key].goles += Number(r.goals || r.goles || 0);
      byPlayer[key].asistencias += Number(r.assists || r.asistencias || 0);
      byPlayer[key].partidos++;
      byPlayer[key].impacto += Number(r.impact_score || 0);
    });

    const sorted = Object.values(byPlayer)
      .sort((a, b) => b.goles - a.goles || b.asistencias - a.asistencias)
      .slice(0, 10);

    sorted.forEach((p, i) => {
      sheet.getRange(row, 1, 1, 6).setValues([[
        `${i + 1}. ${p.nombre}`, p.equipo, p.goles, p.asistencias, p.partidos, p.impacto
      ]]);
      row++;
    });

    if (!sorted.length) {
      sheet.getRange(row, 1).setValue('Sin datos de goleadores aún');
      row++;
    }
  } catch (e) {
    sheet.getRange(row, 1).setValue(`Error: ${e.message}`);
    row++;
  }

  return row;
}

function writeLatestAlertsSection_(sheet, startRow) {
  let row = writeDashboardSection_(sheet, startRow, '🔔 Últimas Alertas', null);

  try {
    const alerts = readAll_(CONFIG.SHEETS.ALERTAS);
    const latest = alerts.slice(-10).reverse();

    if (!latest.length) {
      sheet.getRange(row, 1).setValue('Sin alertas recientes');
      return row + 1;
    }

    const headers = ['Hora', 'Fixture', 'Tipo', 'Minuto', 'Mensaje'];
    sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    row++;

    latest.forEach(a => {
      sheet.getRange(row, 1, 1, 5).setValues([[
        String(a.alerted_at || '').substring(0, 16),
        a.fixture_id || '',
        a.tipo || '',
        a.minuto || '',
        String(a.mensaje || '').substring(0, 80)
      ]]);
      row++;
    });
  } catch (e) {
    sheet.getRange(row, 1).setValue(`Error: ${e.message}`);
    row++;
  }

  return row;
}

function writePipelineStatusSection_(sheet, startRow) {
  let row = writeDashboardSection_(sheet, startRow, '⚙️ Estado del Pipeline', null);

  try {
    const runs = readAll_(CONFIG.SHEETS.PIPELINE_RUNS);

    const lastByJob = {};
    runs.forEach(r => {
      const job = r.job_name || '';
      if (!lastByJob[job] || r.started_at > lastByJob[job].started_at) {
        lastByJob[job] = r;
      }
    });

    if (!Object.keys(lastByJob).length) {
      sheet.getRange(row, 1).setValue('Sin ejecuciones registradas');
      return row + 1;
    }

    const headers = ['Job', 'Última ejecución', 'Estado', 'Registros', 'Errores'];
    sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    row++;

    Object.values(lastByJob).forEach(r => {
      sheet.getRange(row, 1, 1, 5).setValues([[
        r.job_name || '',
        String(r.started_at || '').substring(0, 16),
        r.status || '',
        r.records_processed || 0,
        r.error_count || 0
      ]]);
      row++;
    });
  } catch (e) {
    sheet.getRange(row, 1).setValue(`Error: ${e.message}`);
    row++;
  }

  return row;
}

// ─── Utilidades ────────────────────────────────────────────────────────────────

function writeDashboardSection_(sheet, row, title, _unused) {
  sheet.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(11);
  return row + 1;
}

function ensureDashboardSheet_(ss) {
  let sheet = ss.getSheetByName('Dashboard');
  if (!sheet) {
    sheet = ss.insertSheet('Dashboard', 0);
  }
  return sheet;
}

function formatDashboard_(sheet) {
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 200);
}

function buildWeatherMapForDashboard_() {
  const map = {};
  try {
    readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).forEach(r => {
      if (r.fixture_id) map[String(r.fixture_id)] = r;
    });
  } catch (e) {}
  return map;
}
