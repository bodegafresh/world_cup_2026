/**
 * WebApp.gs
 *
 * API JSON para la página web del dashboard (GitHub Pages).
 * Extiende doGet() definido en BotCommands.gs — ver routeWebRequest_().
 *
 * Endpoint: GET /exec?tab=NOMBRE
 * Tabs disponibles: dashboard, standings, ev, elo, simulation, performance, predictions
 *
 * CORS: Apps Script añade Access-Control-Allow-Origin:* automáticamente
 * para Web Apps publicadas como "Cualquier persona".
 *
 * Configuración: en BotCommands.gs, doGet() delega aquí cuando hay ?tab=
 */

// ─── Router principal ────────────────────────────────────────────────────────

/**
 * Maneja las peticiones de la página web.
 * Llamado desde doGet() en BotCommands.gs.
 * @param {Object} e - evento doGet de Apps Script
 * @returns {TextOutput} JSON con CORS
 */
function routeWebRequest_(e) {
  const tab  = (e.parameter && e.parameter.tab) ? e.parameter.tab.toLowerCase() : 'dashboard';
  const cors = { 'Access-Control-Allow-Origin': '*' };

  try {
    let data;
    switch (tab) {
      case 'dashboard':   data = getWebDashboard_();    break;
      case 'standings':   data = getWebStandings_();    break;
      case 'ev':          data = getWebEvOpps_();       break;
      case 'elo':         data = getWebElo_();          break;
      case 'simulation':  data = getWebSimulation_();   break;
      case 'performance': data = getWebPerformance_();  break;
      case 'predictions': data = getWebPredictions_();  break;
      default:            data = { error: 'tab desconocido: ' + tab };
    }
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, tab, data, ts: nowChile_() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, tab, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Tab: dashboard ──────────────────────────────────────────────────────────

function getWebDashboard_() {
  const today    = todayChile_();
  const tomorrow = tomorrowChile_();
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  const hoy     = partidos.filter(r => normalizeFecha_(r.fecha) === today);
  const mañana  = partidos.filter(r => normalizeFecha_(r.fecha) === tomorrow);
  const enVivo  = hoy.filter(r => ['1H','2H','HT','ET','BT','P'].includes(String(r.status || '').toUpperCase()));
  const proximos = hoy.filter(r => !['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()));

  const mapPartido = r => ({
    match_key:    r.match_key   || '',
    fecha:        normalizeFecha_(r.fecha),
    hora:         r.hora_chile  || r.hora || '',
    local:        teamNameToSpanish_(r.local     || ''),
    visitante:    teamNameToSpanish_(r.visitante || ''),
    goles_local:  r.goles_local   ?? null,
    goles_visitante: r.goles_visitante ?? null,
    status:       r.status || '',
    estadio:      r.estadio || '',
    grupo:        r.grupo   || '',
    ronda:        r.ronda   || '',
    espn_id:      r.espn_id || r.espn_event_id || ''
  });

  return {
    en_vivo:  enVivo.map(mapPartido),
    hoy:      proximos.map(mapPartido),
    mañana:   mañana.map(mapPartido),
    resumen: {
      partidos_hoy:    hoy.length,
      partidos_jugados: hoy.filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase())).length,
      en_vivo: enVivo.length
    }
  };
}

// ─── Tab: standings ──────────────────────────────────────────────────────────

function getWebStandings_() {
  const rows = readAll_(CONFIG.SHEETS.CLASIFICACION);
  const grupos = {};

  rows.forEach(r => {
    const g = r.grupo || r.group || 'Desconocido';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push({
      pos:      Number(r.pos || r.position || 0),
      equipo:   teamNameToSpanish_(r.equipo || r.team || ''),
      pj:       Number(r.pj || r.played  || 0),
      pg:       Number(r.pg || r.won     || 0),
      pe:       Number(r.pe || r.drawn   || 0),
      pp:       Number(r.pp || r.lost    || 0),
      gf:       Number(r.gf || r.goals_for  || 0),
      gc:       Number(r.gc || r.goals_against || 0),
      gd:       Number(r.gd || r.goal_diff    || 0),
      pts:      Number(r.pts || r.points || 0)
    });
  });

  // Ordenar cada grupo por pts desc, GD desc, GF desc
  Object.keys(grupos).forEach(g => {
    grupos[g].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    grupos[g].forEach((t, i) => { t.pos = i + 1; });
  });

  return grupos;
}

// ─── Tab: ev ─────────────────────────────────────────────────────────────────

function getWebEvOpps_() {
  const rows = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES);
  const today = todayChile_();

  return rows
    .filter(r => {
      const f = normalizeFecha_(r.fecha || r.date || '');
      return f >= today;
    })
    .map(r => ({
      fecha:       normalizeFecha_(r.fecha || r.date || ''),
      local:       teamNameToSpanish_(r.local || r.home_team || ''),
      visitante:   teamNameToSpanish_(r.visitante || r.away_team || ''),
      mercado:     r.mercado    || r.market    || '',
      seleccion:   r.seleccion  || r.selection || '',
      prob_modelo: Number(r.prob_modelo || r.model_prob || 0),
      cuota:       Number(r.cuota || r.odds || 0),
      ev:          Number(r.ev || r.expected_value || 0),
      kelly:       Number(r.kelly || 0),
      confianza:   r.confianza || r.confidence || '',
      fuente:      r.fuente_modelo || ''
    }))
    .filter(r => r.ev > 0)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 20);
}

// ─── Tab: elo ────────────────────────────────────────────────────────────────

function getWebElo_() {
  const rows = readAll_(CONFIG.SHEETS.ELO_RATINGS);
  const leagueId = getActiveLeague_().id;

  const byTeam = {};
  rows.forEach(r => {
    const lid = Number(r.league_id || 0);
    if (lid && lid !== leagueId) return;
    const name = teamNameToSpanish_(r.team || r.equipo || '');
    if (!name) return;
    const elo = Number(r.elo || r.rating || 0);
    if (!byTeam[name] || elo > byTeam[name]) byTeam[name] = elo;
  });

  return Object.entries(byTeam)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 32)
    .map(([equipo, elo], i) => ({ pos: i + 1, equipo, elo }));
}

// ─── Tab: simulation ─────────────────────────────────────────────────────────

function getWebSimulation_() {
  const rows = readAll_(CONFIG.SHEETS.SIM_GRUPOS);
  const grupos = {};

  rows.forEach(r => {
    const g = r.grupo || r.group || 'X';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push({
      equipo:           teamNameToSpanish_(r.equipo || r.team || ''),
      prob_clasificar:  Number(r.prob_clasificar || r.prob_qualify || 0),
      partidos_restantes: Number(r.partidos_restantes || 0),
      updated_at:       r.updated_at || ''
    });
  });

  Object.keys(grupos).forEach(g => {
    grupos[g].sort((a, b) => b.prob_clasificar - a.prob_clasificar);
  });

  return grupos;
}

// ─── Tab: performance ────────────────────────────────────────────────────────

function getWebPerformance_() {
  // Calibración del modelo
  let calibration = null;
  try {
    const calRows = readAll_(CONFIG.SHEETS.MODEL_CALIBRATION);
    if (calRows.length) {
      const last = calRows[calRows.length - 1];
      calibration = {
        brier_score:  Number(last.brier_score  || last.brier || 0),
        accuracy:     Number(last.accuracy     || 0),
        total_bets:   Number(last.total_bets   || 0),
        updated_at:   last.updated_at || ''
      };
    }
  } catch (e_) {}

  // Historial de apuestas: ROI, win rate
  let bettingStats = null;
  try {
    const bets = readAll_(CONFIG.SHEETS.BETTING_HISTORY);
    const settled = bets.filter(b => ['GANADA','PERDIDA'].includes(String(b.resultado || b.result || '').toUpperCase()));
    if (settled.length) {
      const ganadas = settled.filter(b => String(b.resultado || b.result || '').toUpperCase() === 'GANADA');
      const totalStake  = settled.reduce((s, b) => s + Number(b.stake || 0), 0);
      const totalReturn = ganadas.reduce((s, b) => s + Number(b.ganancia || b.profit || 0) + Number(b.stake || 0), 0);
      const roi = totalStake > 0 ? ((totalReturn - totalStake) / totalStake * 100) : 0;
      bettingStats = {
        total:    settled.length,
        ganadas:  ganadas.length,
        win_rate: settled.length > 0 ? (ganadas.length / settled.length * 100) : 0,
        roi,
        total_stake:  totalStake,
        total_return: totalReturn
      };
    }
  } catch (e_) {}

  return { calibration, bettingStats };
}

// ─── Tab: predictions ────────────────────────────────────────────────────────

function getWebPredictions_() {
  const today    = todayChile_();
  const tomorrow = tomorrowChile_();
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  const proximos = partidos
    .filter(r => {
      const f = normalizeFecha_(r.fecha);
      return (f === today || f === tomorrow) &&
             !['FT','AET','PEN'].includes(String(r.status || '').toUpperCase());
    })
    .slice(0, 8);

  return proximos.map(r => {
    const home = r.local     || '';
    const away = r.visitante || '';
    let poisson = null;
    try { poisson = getPoissonOdds_(home, away, r.match_key || ''); } catch (e_) {}
    let elo = null;
    try { elo = getEloProbabilities_(home, away); } catch (e_) {}

    const mkts = poisson ? poisson.markets : null;
    return {
      match_key:  r.match_key || '',
      fecha:      normalizeFecha_(r.fecha),
      hora:       r.hora_chile || r.hora || '',
      local:      teamNameToSpanish_(home),
      visitante:  teamNameToSpanish_(away),
      grupo:      r.grupo  || '',
      ronda:      r.ronda  || '',
      estadio:    r.estadio || '',
      poisson: mkts ? {
        prob_home:  Number((mkts['1'] || 0) * 100).toFixed(1),
        prob_draw:  Number((mkts['X'] || 0) * 100).toFixed(1),
        prob_away:  Number((mkts['2'] || 0) * 100).toFixed(1),
        lambda_h:   Number(poisson.lambdaH || 0).toFixed(2),
        lambda_a:   Number(poisson.lambdaA || 0).toFixed(2),
        over25:     Number((mkts['over_2.5'] || 0) * 100).toFixed(1),
        btts:       Number((mkts['btts_yes'] || 0) * 100).toFixed(1)
      } : null,
      elo: elo ? {
        prob_home: Number(elo.home * 100).toFixed(1),
        prob_draw: Number(elo.draw * 100).toFixed(1),
        prob_away: Number(elo.away * 100).toFixed(1),
        elo_home:  Number(elo.elo_home || 0),
        elo_away:  Number(elo.elo_away || 0)
      } : null
    };
  });
}
