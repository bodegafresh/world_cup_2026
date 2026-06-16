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
  row = writeEvOpportunitiesSection_(sheet, row);
  row++;
  row = writeEloRankingsSection_(sheet, row);
  row++;
  row = writeModelCalibrationSection_(sheet, row);
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
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => normalizeFecha_(r.fecha) === date);

  let row = writeDashboardSection_(sheet, startRow, '📅 Partidos de hoy — ' + date, null);

  if (!partidos.length) {
    sheet.getRange(row, 1).setValue('Sin partidos hoy');
    return row + 1;
  }

  const headers = ['Hora (Chile)', 'Local', 'Goles', '', 'Visitante', 'Estadio', 'Estado', 'Prob L/E/V', 'EV+'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  row++;

  const weatherMap  = buildWeatherMapForDashboard_();
  const probMap     = buildAiProbMapForDashboard_();
  const evMap       = buildEvMapForDashboard_();

  partidos.forEach(p => {
    const goles = (p.goles_local !== '' && p.goles_local !== null)
      ? `${p.goles_local} - ${p.goles_visitante}`
      : 'vs';

    const fid = String(p.fixture_id_af || p.match_id || '');
    const w   = weatherMap[fid];
    const climaStr = w && w.temperatura_c !== null
      ? `${w.temperatura_c}°C ${w.condicion || ''}` : '';

    const probs = probMap[fid];
    const probStr = probs
      ? `${Math.round(probs.h * 100)}/${Math.round(probs.d * 100)}/${Math.round(probs.a * 100)}`
      : '';

    const evFlag = evMap[fid] ? '🔥' : '';

    sheet.getRange(row, 1, 1, 9).setValues([[
      p.hora_chile || '',
      p.local || '',
      goles,
      '',
      p.visitante || '',
      `${p.estadio || ''} ${climaStr}`.trim(),
      p.estado || '',
      probStr,
      evFlag
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

// ─── Secciones Fase 1 (EV / ELO / Calibración) ────────────────────────────────

function writeEvOpportunitiesSection_(sheet, startRow) {
  let row = writeDashboardSection_(sheet, startRow, '🎯 Oportunidades EV+', null);

  try {
    const rows = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES)
      .filter(r => String(r.es_positivo || '').toUpperCase() === 'SI' || r.ev > 0)
      .sort((a, b) => Number(b.ev || 0) - Number(a.ev || 0))
      .slice(0, 8);

    if (!rows.length) {
      sheet.getRange(row, 1).setValue('Sin oportunidades EV+ activas');
      return row + 1;
    }

    const headers = ['Fixture', 'Mercado', 'Selección', 'Cuota', 'EV%', 'Kelly%', 'Confianza'];
    sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    row++;

    rows.forEach(r => {
      const ev    = Number(r.ev    || 0);
      const kelly = Number(r.kelly || 0);
      sheet.getRange(row, 1, 1, 7).setValues([[
        String(r.fixture_id || '').substring(0, 20),
        r.mercado    || '',
        r.seleccion  || '',
        Number(r.cuota || 0).toFixed(2),
        `${(ev * 100).toFixed(1)}%`,
        `${(kelly * 100).toFixed(1)}%`,
        r.confianza  || ''
      ]]);
      row++;
    });
  } catch (e) {
    sheet.getRange(row, 1).setValue(`Error: ${e.message}`);
    row++;
  }

  return row;
}

function writeEloRankingsSection_(sheet, startRow) {
  let row = writeDashboardSection_(sheet, startRow, '⚡ Ranking ELO — Top 16', null);

  try {
    const rows = readAll_(CONFIG.SHEETS.ELO_RATINGS)
      .sort((a, b) => Number(b.elo_actual || 0) - Number(a.elo_actual || 0))
      .slice(0, 16);

    if (!rows.length) {
      sheet.getRange(row, 1).setValue('Sin datos ELO. Ejecuta initializeEloRatings().');
      return row + 1;
    }

    const headers = ['Pos', 'Equipo', 'ELO', 'Δ ELO', 'PJ', 'V', 'E', 'D'];
    sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    row++;

    rows.forEach((r, i) => {
      const delta = Number(r.elo_actual || 0) - Number(r.elo_anterior || r.elo_actual || 0);
      sheet.getRange(row, 1, 1, 8).setValues([[
        i + 1,
        r.equipo      || '',
        Number(r.elo_actual || 0).toFixed(0),
        delta >= 0 ? `+${delta.toFixed(0)}` : delta.toFixed(0),
        Number(r.partidos_jugados || 0),
        Number(r.victorias  || 0),
        Number(r.empates    || 0),
        Number(r.derrotas   || 0)
      ]]);
      row++;
    });
  } catch (e) {
    sheet.getRange(row, 1).setValue(`Error: ${e.message}`);
    row++;
  }

  return row;
}

function writeModelCalibrationSection_(sheet, startRow) {
  let row = writeDashboardSection_(sheet, startRow, '🎯 Calibración del Modelo', null);

  try {
    const rows = readAll_(CONFIG.SHEETS.MODEL_CALIBRATION);
    if (!rows.length) {
      sheet.getRange(row, 1).setValue('Sin datos. Ejecuta calculateModelCalibration().');
      return row + 1;
    }

    const latest = rows[rows.length - 1];
    const bs     = Number(latest.brier_score || 0);
    const acc    = Number(latest.accuracy    || 0);
    const n      = Number(latest.partidos_evaluados || latest.n || 0);

    const headers = ['Partidos evaluados', 'Accuracy', 'Brier Score', 'Baseline (random)', 'Interpretación', 'Calculado'];
    sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    row++;

    const interp = bs < 0.15 ? 'Excelente' : bs < 0.20 ? 'Bueno' : bs < 0.222 ? 'Sobre baseline' : 'Bajo baseline';
    sheet.getRange(row, 1, 1, 6).setValues([[
      n,
      `${(acc * 100).toFixed(1)}%`,
      bs.toFixed(4),
      '0.2222',
      interp,
      String(latest.calculado_at || latest.fecha || '').substring(0, 16)
    ]]);
    row++;
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

function buildAiProbMapForDashboard_() {
  const map = {};
  try {
    readAll_(CONFIG.SHEETS.AI_ANALYSIS).forEach(r => {
      const fid = String(r.fixture_id || r.match_id || '');
      if (!fid) return;
      if (r.prob_local && r.prob_empate && r.prob_visitante) {
        map[fid] = { h: Number(r.prob_local), d: Number(r.prob_empate), a: Number(r.prob_visitante) };
      }
    });
  } catch (e) {}
  return map;
}

function buildEvMapForDashboard_() {
  const map = {};
  try {
    readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES)
      .filter(r => String(r.es_positivo || '').toUpperCase() === 'SI')
      .forEach(r => { if (r.fixture_id) map[String(r.fixture_id)] = true; });
  } catch (e) {}
  return map;
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
