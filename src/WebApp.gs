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
  // Validar clave secreta si está configurada en Script Properties
  const secretKey = PropertiesService.getScriptProperties().getProperty('WEB_SECRET_KEY') || '';
  if (secretKey) {
    const provided = (e.parameter && e.parameter.key) ? e.parameter.key : '';
    if (provided !== secretKey) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  const tab = (e.parameter && e.parameter.tab) ? e.parameter.tab.toLowerCase() : 'dashboard';

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
      case 'hoy':         data = getWebHoy_();           break;
      case 'live':        data = getWebLive_();         break;
      case 'teams':       data = getWebTeams_();        break;
      case 'knockout':    data = getWebKnockout_();     break;
      case 'players':     data = getWebPlayers_();      break;
      case 'match':       data = getWebMatch_(e);       break;
      case 'ayer':        data = getWebAyer_();          break;
      case 'proximos':    data = getWebProximos_();      break;
      case 'noticias':    data = getWebNoticias_();      break;
      case 'squad':       data = getWebSquad_(e);        break;
      case 'stats':       data = getWebStats_();         break;
      case 'arbitros':    data = getWebArbitros_();       break;
      case 'calibracion': data = getWebCalibrationData_(); break;
      case 'bankroll':    data = getWebBankrollSim_();      break;
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
    hora:         safeHoraChile_(r.hora_chile || r.hora),
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

  // Deduplicar por partido+mercado+selección (más reciente gana)
  const dedupMap = {};
  rows.forEach(function(r) {
    var f = normalizeFecha_(r.fecha || r.date || '');
    if (f < today) return;
    var k = (r.local||'') + '|' + (r.visitante||'') + '|' + (r.mercado||'') + '|' + (r.seleccion||'');
    if (!dedupMap[k] || String(r.timestamp||'') > String(dedupMap[k].timestamp||'')) dedupMap[k] = r;
  });

  return Object.values(dedupMap)
    .map(function(r) {
      var ev  = Number(r.ev || r.expected_value || 0);
      if (ev > 0.50) return null; // bug/cuota stale — descartar
      var outlier    = ev > 0.30 || String(r.outlier).toUpperCase() === 'TRUE' || r.outlier === true;
      var sospechoso = !outlier && (ev > 0.25 || String(r.sospechoso).toUpperCase() === 'TRUE' || r.sospechoso === true);
      var prob       = Number(r.prob_modelo || r.model_prob || 0);
      var cuota      = Number(r.cuota || r.odds || 0);
      var cuotaJusta = prob > 0 ? (1 / prob) : null;
      var edge       = prob > 0 && cuota > 0 ? prob - (1/cuota) : 0;
      var confianza  = outlier ? 'PELIGRO' : (sospechoso ? 'BAJA' : (r.confianza || r.confidence || ''));
      return {
        fecha:        normalizeFecha_(r.fecha || r.date || ''),
        local:        teamNameToSpanish_(r.local || r.home_team || ''),
        visitante:    teamNameToSpanish_(r.visitante || r.away_team || ''),
        mercado:      r.mercado    || r.market    || '',
        seleccion:    r.seleccion  || r.selection || '',
        prob_modelo:  prob,
        cuota:        cuota,
        cuota_justa:  cuotaJusta,
        edge:         edge,
        ev:           ev,
        kelly:        Number(r.kelly || 0),
        confianza:    confianza,
        fuente:       r.fuente_modelo || '',
        sospechoso:   sospechoso,
        outlier:      outlier,
        timestamp:    r.timestamp || ''
      };
    })
    .filter(function(r) { return r && r.cuota > 1; })
    .sort(function(a, b) { return b.ev - a.ev; })
    .slice(0, 20);
}

// ─── Tab: elo ────────────────────────────────────────────────────────────────

function getWebElo_() {
  // Build set of WC2026 teams from standings sheet
  const wc2026Teams = new Set();
  try {
    readAll_(CONFIG.SHEETS.CLASIFICACION).forEach(r => {
      const n = teamNameToSpanish_(r.equipo || '');
      if (n) wc2026Teams.add(n);
    });
    // Also add from Partidos (local/visitante) to catch all 48 teams
    readAll_(CONFIG.SHEETS.PARTIDOS).forEach(r => {
      const l = teamNameToSpanish_(r.local     || '');
      const v = teamNameToSpanish_(r.visitante || '');
      if (l) wc2026Teams.add(l);
      if (v) wc2026Teams.add(v);
    });
  } catch (e_) {}

  const rows = readAll_(CONFIG.SHEETS.ELO_RATINGS);
  const byTeam = {};
  rows.forEach(r => {
    const name = teamNameToSpanish_(r.equipo || r.team || '');
    if (!name) return;
    // Only filter if we have a reasonable set of WC teams (>= 20)
    if (wc2026Teams.size >= 20 && !wc2026Teams.has(name)) return;
    const elo = Number(r.elo_actual || r.elo || r.rating || 0);
    if (elo && (!byTeam[name] || elo > byTeam[name])) byTeam[name] = elo;
  });

  return Object.entries(byTeam)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 48)
    .map(([equipo, elo], i) => ({ pos: i + 1, equipo, elo }));
}

// ─── Tab: simulation ─────────────────────────────────────────────────────────

function getWebSimulation_() {
  const rows = readAll_(CONFIG.SHEETS.SIM_GRUPOS);
  const grupos = {};

  rows.forEach(r => {
    // Normalizar: devolver solo la letra "A", "B"... el frontend agrega "Grupo "
    const raw = String(r.grupo || r.group || 'X');
    const g   = raw.replace(/^grupo\s*/i, '').trim() || raw;
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

  // Calibración por buckets (requiere IA + resultados)
  let calibrationBuckets = [];
  try {
    const aiRows    = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    const matchRows = readAll_(CONFIG.SHEETS.PARTIDOS);
    const pairs = [];
    aiRows.forEach(ai => {
      if (!ai.prob_local) return;
      const match = matchRows.find(m => String(m.fixture_id_af||'') === String(ai.fixture_id));
      if (!match || !['FT','AET','PEN'].includes(String(match.status||'').toUpperCase())) return;
      const gH = Number(match.goles_local ?? -1), gA = Number(match.goles_visitante ?? -1);
      if (gH < 0 || gA < 0) return;
      pairs.push({ prob: Number(ai.prob_local    ||0), ocurrió: gH > gA  ? 1 : 0 });
      pairs.push({ prob: Number(ai.prob_empate   ||0), ocurrió: gH === gA ? 1 : 0 });
      pairs.push({ prob: Number(ai.prob_visitante||0), ocurrió: gH < gA  ? 1 : 0 });
    });
    if (pairs.length >= 9) {
      const limits = [0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.01];
      for (let i = 0; i < limits.length - 1; i++) {
        const lo = limits[i], hi = limits[i+1];
        const inB = pairs.filter(p => p.prob >= lo && p.prob < hi);
        if (!inB.length) continue;
        const real = inB.filter(p => p.ocurrió).length / inB.length;
        const mid  = (lo + hi) / 2;
        calibrationBuckets.push({
          label: Math.round(lo*100) + '–' + Math.round(hi*100) + '%',
          n:     inB.length,
          predicha: mid,
          real,
          bias: real - mid
        });
      }
    }
  } catch (e_) {}

  // Rendimiento por mercado
  let byMarket = [];
  try {
    const bets    = readAll_(CONFIG.SHEETS.BETTING_HISTORY);
    const settled = bets.filter(b => ['GANADA','PERDIDA'].includes(String(b.resultado||b.result||'').toUpperCase()));
    const mktMap  = {};
    settled.forEach(b => {
      const mkt = String(b.mercado || b.market || 'Otro');
      if (!mktMap[mkt]) mktMap[mkt] = { total:0, ganadas:0, stake:0, ret:0, evSum:0, clvSum:0, clvN:0 };
      const m = mktMap[mkt];
      const ganó = String(b.resultado||b.result||'').toUpperCase() === 'GANADA';
      m.total++;
      if (ganó) { m.ganadas++; m.ret += Number(b.ganancia||b.profit||0) + Number(b.stake||0); }
      m.stake  += Number(b.stake||0);
      m.evSum  += Number(b.ev||0);
      if (b.clv != null && b.clv !== '') { m.clvSum += Number(b.clv||0); m.clvN++; }
    });
    byMarket = Object.entries(mktMap).map(([mercado, m]) => ({
      mercado,
      total:    m.total,
      ganadas:  m.ganadas,
      win_rate: m.total > 0 ? m.ganadas / m.total : null,
      roi:      m.stake  > 0 ? (m.ret - m.stake) / m.stake : null,
      ev_avg:   m.total  > 0 ? m.evSum / m.total : null,
      clv_avg:  m.clvN   > 0 ? m.clvSum / m.clvN : null
    })).sort((a, b) => b.total - a.total);
  } catch (e_) {}

  return { calibration, bettingStats, calibrationBuckets, byMarket };
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
      hora:       safeHoraChile_(r.hora_chile || r.hora),
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
        prob_home: Number((elo.home_win || elo.home || 0) * 100).toFixed(1),
        prob_draw: Number((elo.draw     || 0)             * 100).toFixed(1),
        prob_away: Number((elo.away_win || elo.away || 0) * 100).toFixed(1),
        elo_home:  Number(elo.elo_home || 0),
        elo_away:  Number(elo.elo_away || 0)
      } : null
    };
  });
}

// Wrapper que además valida minutos: WC2026 siempre usa :00 o :30.
// Si ESPN devolvió :42/:12 (dato corrupto), trunca a :00.
function safeHoraChile_(val) {
  const h = formatHoraChile_(val);
  if (!h) return '';
  const m = parseInt(h.split(':')[1]);
  return (m === 0 || m === 30) ? h : h.split(':')[0] + ':00';
}

// Convierte un valor hora de Google Sheets (Date object o string ISO) a "HH:mm" en hora Chile.
// Sheets serializa time-only como 1899-12-30T{UTC_hora}.000Z — la hora en UTC hay que convertirla.
function formatHoraChile_(val) {
  if (!val) return '';
  const s = (val instanceof Date) ? val.toISOString() : String(val).trim();

  // Ya es "HH:mm" limpio
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;

  // "HH:mm:ss" → truncar
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) return s.substring(0, 5);

  // ISO con T: "2026-06-12T21:00:00Z" o "...T21:00:00.000Z"
  const mT = s.match(/T(\d{2}):(\d{2})/);
  if (mT) {
    const todayStr = todayChile_();
    const d = new Date(todayStr + 'T' + mT[1] + ':' + mT[2] + ':00Z');
    return Utilities.formatDate(d, CONFIG.TIMEZONE, 'HH:mm');
  }

  // "YYYY-MM-DD HH:mm:ss" (sin T) — formato que viene de Sheets datetime
  const mSpace = s.match(/\d{4}-\d{2}-\d{2}\s+(\d{2}):(\d{2})/);
  if (mSpace) {
    const todayStr = todayChile_();
    const d = new Date(todayStr + 'T' + mSpace[1] + ':' + mSpace[2] + ':00Z');
    return Utilities.formatDate(d, CONFIG.TIMEZONE, 'HH:mm');
  }

  return s.substring(0, 5);
}

// ─── Tab: hoy ────────────────────────────────────────────────────────────────

function getWebHoy_() {
  const date     = todayChile_();
  const partidos = getTodayFixturesForReport_(date);

  // Mapa fixture_id → clima desde EstadiosClima
  const climaMap = {};
  try {
    readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).forEach(r => {
      const fid = String(r.fixture_id || r.match_id || '');
      const hasVenue = String(r.estadio || r.stadium || '').trim() && String(r.ciudad || r.city || '').trim();
      if (fid && fid !== 'undefined' && hasVenue) {
        climaMap[fid] = {
          temperatura: r.temperatura_c  || r.temperatura || null,
          humedad:     r.humedad        || null,
          condicion:   r.condicion      || '',
          viento:      r.viento_kmh     || null,
          prob_lluvia: r.prob_lluvia    || null
        };
      }
    });
  } catch(e_) {}

  const FINAL_STATUS = ['FT','AET','PEN'];
  const LIVE_STATUS  = ['1H','2H','HT','ET','P','BT','INT','LIVE'];

  const normN = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z]/g,'');

  // Deduplicar por par de equipos igual que el bot
  const STATUS_PRIORITY = s => {
    if (LIVE_STATUS.includes(s)) return 3;
    if (FINAL_STATUS.includes(s)) return 2;
    return 1;
  };
  const deduped = new Map();
  partidos.forEach(p => {
    const key = normN(teamNameToSpanish_(p.local)) + '_' + normN(teamNameToSpanish_(p.visitante));
    const ex  = deduped.get(key);
    if (!ex || STATUS_PRIORITY(p.status) > STATUS_PRIORITY(ex.status)) deduped.set(key, p);
  });
  const lista = [...deduped.values()]
    .sort((a, b) => {
      if (!!a.operational_next_day !== !!b.operational_next_day) return a.operational_next_day ? 1 : -1;
      return (a.hora_chile || '').localeCompare(b.hora_chile || '');
    });

  // ESPN scoreboard — override status y scores en tiempo real
  const liveScoreMap = {};
  const ESPN_MAP = {
    'in progress':'1H', 'halftime':'HT', 'end period':'2H',
    'final':'FT', 'full time':'FT', 'final/aet':'AET', 'final/pen':'PEN'
  };
  try {
    const espnData = espnGet_('/scoreboard');
    (espnData.events || []).forEach(ev => {
      const comp  = (ev.competitions || [])[0] || {};
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === 'home') || {};
      const away  = comps.find(c => c.homeAway === 'away') || {};
      const desc  = String((ev.status && ev.status.type && ev.status.type.description) || '').toLowerCase();
      const short = String((ev.status && ev.status.type && ev.status.type.shortDetail) || '');
      const entry = {
        goles_local:     home.score !== undefined ? home.score : null,
        goles_visitante: away.score !== undefined ? away.score : null,
        status:          ESPN_MAP[desc] || null,
        minuto:          short
      };
      const hEn = (home.team || {}).displayName || '';
      const aEn = (away.team || {}).displayName || '';
      liveScoreMap[normN(hEn) + '_' + normN(aEn)] = entry;
      liveScoreMap[normN(teamNameToSpanish_(hEn)) + '_' + normN(teamNameToSpanish_(aEn))] = entry;
    });
  } catch (e_) { /* fallback a hoja */ }

  // Override y enriquecer con ESPN
  lista.forEach(p => {
    const k    = normN(teamNameToSpanish_(p.local)) + '_' + normN(teamNameToSpanish_(p.visitante));
    const espn = liveScoreMap[k];
    if (!espn) return;
    if (espn.status) p.status = espn.status;
    if (espn.goles_local     !== null) p.goles_local     = espn.goles_local;
    if (espn.goles_visitante !== null) p.goles_visitante = espn.goles_visitante;
    if (espn.minuto)                   p.minuto          = espn.minuto;
  });

  // Clasificar en tres grupos
  const terminados = lista.filter(p => FINAL_STATUS.includes(p.status));
  const enVivo     = lista.filter(p => LIVE_STATUS.includes(p.status));
  const proximos   = lista.filter(p => !FINAL_STATUS.includes(p.status) && !LIVE_STATUS.includes(p.status));

  // Normalizar nombres a español para la web
  const norm = p => {
    // Hora local en el estadio (si tiene timezone)
    let hora_local = '';
    try {
      const horaChile = formatHoraChile_(p.hora_chile);
      const tz = p.timezone_estadio || '';
      if (tz && horaChile) {
        const today = todayChile_();
        const utcMs = new Date(`${today}T${horaChile}:00`).getTime() + 4 * 3600000; // Chile UTC-4 → UTC
        hora_local = Utilities.formatDate(new Date(utcMs), tz, 'HH:mm');
      }
    } catch(e_) {}

    // Clima del partido
    const fid    = String(p.fixture_id || p.match_id || '');
    const clima  = climaMap[fid] || null;

    return {
      local:           teamNameToSpanish_(p.local),
      visitante:       teamNameToSpanish_(p.visitante),
      goles_local:     p.goles_local     !== undefined && p.goles_local     !== '' ? p.goles_local     : null,
      goles_visitante: p.goles_visitante !== undefined && p.goles_visitante !== '' ? p.goles_visitante : null,
      status:          p.status  || 'NS',
      minuto:          p.minuto  || '',
      fecha:           p.fecha || '',
      operational_next_day: !!p.operational_next_day,
      hora_chile:      safeHoraChile_(p.hora_chile),
      hora_local:      hora_local,
      grupo:           p.grupo   || '',
      ronda:           p.ronda   || '',
      estadio:         p.estadio || '',
      ciudad:          p.ciudad  || '',
      match_key:       p.match_key || '',
      clima:           clima
    };
  };

  return {
    fecha:      date,
    terminados: terminados.map(norm),
    en_vivo:    enVivo.map(norm),
    proximos:   proximos.map(norm)
  };
}

// ─── Tab: live ───────────────────────────────────────────────────────────────

function getWebLive_() {
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const liveStatuses = ['1H','2H','HT','ET','BT','P','LIVE','INT'];

  const eventos   = readAll_(CONFIG.SHEETS.EVENTOS_LIVE);
  const espnStats = readAll_(CONFIG.SHEETS.ESPN_STATS);

  // Mapa fixture_id → clima
  const climaMap = {};
  try {
    readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).forEach(r => {
      const fid = String(r.fixture_id || r.match_id || '');
      const hasVenue = String(r.estadio || r.stadium || '').trim() && String(r.ciudad || r.city || '').trim();
      if (fid && fid !== 'undefined' && hasVenue) climaMap[fid] = {
        temperatura: r.temperatura_c  || null,
        humedad:     r.humedad        || null,
        condicion:   r.condicion      || '',
        viento:      r.viento_kmh     || null
      };
    });
  } catch (e_) {}

  // ESPN real-time scoreboard override (same as getWebHoy_)
  const normN = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z]/g,'');
  const ESPN_STATUS = {
    'in progress':'1H','halftime':'HT','end period':'2H',
    'final':'FT','full time':'FT','final/aet':'AET','final/pen':'PEN'
  };
  const liveScoreMap = {};
  const espnSummaryMap = {}; // normKey → summary data (lineup, weather, venue)
  const espnLiveKeys   = new Set(); // normKeys de partidos live según ESPN
  try {
    const espnData = espnGet_('/scoreboard');
    (espnData.events || []).forEach(ev => {
      const comp  = (ev.competitions || [])[0] || {};
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === 'home') || {};
      const away  = comps.find(c => c.homeAway === 'away') || {};
      const desc  = String((ev.status && ev.status.type && ev.status.type.description) || '').toLowerCase();
      const short = String((ev.status && ev.status.type && ev.status.type.shortDetail) || '');
      const entry = {
        goles_local:     home.score !== undefined ? home.score : null,
        goles_visitante: away.score !== undefined ? away.score : null,
        status:          ESPN_STATUS[desc] || null,
        minuto:          short,
        espn_event_id:   String(ev.id || ''),
        home_en:         (home.team || {}).displayName || '',
        away_en:         (away.team || {}).displayName || ''
      };
      const hEn = entry.home_en;
      const aEn = entry.away_en;
      const k1 = normN(hEn) + '_' + normN(aEn);
      const k2 = normN(teamNameToSpanish_(hEn)) + '_' + normN(teamNameToSpanish_(aEn));
      liveScoreMap[k1] = entry;
      liveScoreMap[k2] = entry;

      // Detectar si está en curso: por status mapeado O por state==='in' de ESPN
      const espnState = String((ev.status && ev.status.type && ev.status.type.state) || '');
      const espnLiveStatuses = ['1H','2H','HT','ET','BT','P','LIVE'];
      const isInProgress = espnState === 'in' || (entry.status && espnLiveStatuses.includes(entry.status));
      if (isInProgress) {
        // Asegurarse de que status tenga un valor (puede fallar el mapeo si la desc es distinta)
        if (!entry.status) entry.status = '1H';
        espnLiveKeys.add(k1);
        espnLiveKeys.add(k2);
      }

      // Fetch ESPN summary for live matches to get lineup + weather + venue + referee
      if (isInProgress && ev.id) {
        try {
          const summary = fetchEspnSummary_(ev.id);
          const comp = ((summary.header || {}).competitions || [])[0] || {};
          // Extraer árbitro — ESPN puede poner officials en comp o en header directo
          let referee = null;
          const officialsArr = comp.officials
            || (summary.header || {}).officials
            || [];
          const refOfficial = officialsArr.find(o => {
            const pos = String((o.position || {}).displayName || o.position || '').toLowerCase();
            return pos.includes('referee') || pos.includes('central') || pos === 'r';
          }) || officialsArr[0];
          if (refOfficial) {
            // ESPN usa displayName directo o anidado en names[]
            const names = refOfficial.names || refOfficial.officials || [];
            referee = (names.length ? (names[0].displayName || names[0].shortName || '') : '')
              || refOfficial.displayName
              || refOfficial.fullName
              || refOfficial.shortName
              || '';
            if (!referee) referee = null;
          }
          // Fallback: Arbitros sheet para este fixture
          if (!referee) {
            try {
              const arbRow = readAll_(CONFIG.SHEETS.ARBITROS).find(a => {
                const teamH = teamNameToSpanish_((home.team || {}).displayName || '');
                const teamA = teamNameToSpanish_((away.team || {}).displayName || '');
                return teamH && String(a.equipo_local || '').includes(teamH.substring(0,4));
              });
              if (arbRow) referee = arbRow.nombre || null;
            } catch(_) {}
          }
          // weather puede estar en summary.weather o en gameInfo.weather
          const weather = summary.weather
            || (summary.gameInfo && summary.gameInfo.weather)
            || null;
          // Formación: intentar desde rosters (más confiable), luego competitors, luego boxscore
          const rosterHome = (summary.rosters || []).find(r => r.homeAway === 'home') || {};
          const rosterAway = (summary.rosters || []).find(r => r.homeAway === 'away') || {};
          const compHome   = (comp.competitors || []).find(c => c.homeAway === 'home') || {};
          const compAway   = (comp.competitors || []).find(c => c.homeAway === 'away') || {};
          const bsHome     = ((summary.boxscore || {}).teams || []).find(t => t.homeAway === 'home') || {};
          const bsAway     = ((summary.boxscore || {}).teams || []).find(t => t.homeAway === 'away') || {};
          // Eventos desde comp.details (goles, tarjetas, sust en tiempo real)
          const espnEvents = [];
          (comp.details || []).forEach(function(det) {
            const typeText = ((det.type || {}).text || '').toLowerCase();
            let tipo = '';
            if (typeText.includes('goal'))        tipo = 'goal';
            else if (typeText.includes('yellow') && typeText.includes('red')) tipo = 'yellowredcard';
            else if (typeText.includes('yellow')) tipo = 'yellowcard';
            else if (typeText.includes('red'))    tipo = 'redcard';
            else if (typeText.includes('subst'))  tipo = 'subst';
            else if (typeText.includes('var'))    tipo = 'var';
            if (!tipo) return;
            const clock   = det.clock || {};
            const minRaw  = clock.value != null ? clock.value : parseInt(clock.displayValue || '0');
            const minuto  = Math.floor(minRaw);
            const extra   = minRaw > minuto ? Math.round((minRaw - minuto) * 100) : 0;
            const athletes = det.athletesInvolved || [];
            const teamName = teamNameToSpanish_((det.team || {}).displayName || '');
            espnEvents.push({
              minuto:    minuto,
              extra:     extra,
              tipo:      tipo,
              equipo:    teamName,
              jugador:   athletes.length ? (athletes[0].displayName || athletes[0].shortName || '') : '',
              asistente: athletes.length > 1 ? (athletes[1].displayName || athletes[1].shortName || '') : ''
            });
          });
          const summaryData = {
            rosters:         summary.rosters || [],
            weather:         weather,
            gameInfo:        summary.gameInfo || null,
            referee:         referee,
            formacion_home:  rosterHome.formation || compHome.formation || bsHome.formation || '',
            formacion_away:  rosterAway.formation || compAway.formation || bsAway.formation || '',
            espnEvents:      espnEvents
          };
          espnSummaryMap[k1] = summaryData;
          espnSummaryMap[k2] = summaryData;
        } catch(es_) {}
      }
    });
  } catch(e_) {}

  // Partidos live: los que la hoja ya tiene status live.
  // Dedup por nombre canónico en español: Partidos puede tener 2 filas por partido
  // (fuente ESPN + fuente API-Football). Preferir la fila con más datos.
  {
    const seenLiveMap = new Map();
    partidos.filter(r => liveStatuses.includes(String(r.status || '').toUpperCase())).forEach(r => {
      const k = normN(teamNameToSpanish_(r.local||'')) + '_' + normN(teamNameToSpanish_(r.visitante||''));
      if (!seenLiveMap.has(k)) { seenLiveMap.set(k, r); return; }
      // Preferir la fila con fixture_id_af, luego con estadio, luego con goles
      const cur = seenLiveMap.get(k);
      const scoreNew = (r.fixture_id_af ? 10 : 0) + (r.estadio ? 3 : 0) + (r.arbitro ? 2 : 0) +
                       (r.goles_local !== '' && r.goles_local != null ? 1 : 0);
      const scoreOld = (cur.fixture_id_af ? 10 : 0) + (cur.estadio ? 3 : 0) + (cur.arbitro ? 2 : 0) +
                       (cur.goles_local !== '' && cur.goles_local != null ? 1 : 0);
      if (scoreNew >= scoreOld) {
        // Fusionar: tomar el campo que tenga datos del otro
        const merged = Object.assign({}, r);
        Object.keys(cur).forEach(col => {
          if ((merged[col] === '' || merged[col] == null) && cur[col] !== '' && cur[col] != null) {
            merged[col] = cur[col];
          }
        });
        seenLiveMap.set(k, merged);
      } else {
        // Fusionar sobre la fila existente
        const merged = Object.assign({}, cur);
        Object.keys(r).forEach(col => {
          if ((merged[col] === '' || merged[col] == null) && r[col] !== '' && r[col] != null) {
            merged[col] = r[col];
          }
        });
        seenLiveMap.set(k, merged);
      }
    });
    var liveFromSheet = [...seenLiveMap.values()];
  }

  // Agregar partidos que ESPN ve en vivo pero la hoja aún tiene NS/otro status
  const liveFromSheetKeys = new Set();
  liveFromSheet.forEach(m => {
    // Clave en español (nombre canónico)
    liveFromSheetKeys.add(normN(teamNameToSpanish_(m.local||'')) + '_' + normN(teamNameToSpanish_(m.visitante||'')));
    // Clave en inglés (nombre crudo desde ESPN) para evitar que espnLiveKeys duplique
    liveFromSheetKeys.add(normN(m.local||'') + '_' + normN(m.visitante||''));
  });
  const liveFromEspnOnly = [];
  espnLiveKeys.forEach(key => {
    if (liveFromSheetKeys.has(key)) return;
    // Buscar en Partidos por nombre (independiente del status en hoja)
    const sheetRow = partidos.find(r => {
      const k = normN(teamNameToSpanish_(r.local||'')) + '_' + normN(teamNameToSpanish_(r.visitante||''));
      return k === key;
    });
    if (sheetRow) {
      // Si el partido ya está en liveFromSheet (status actualizado), no duplicar
      const alreadyLive = liveFromSheet.some(m =>
        normN(teamNameToSpanish_(m.local||'')) === normN(teamNameToSpanish_(sheetRow.local||'')) &&
        normN(teamNameToSpanish_(m.visitante||'')) === normN(teamNameToSpanish_(sheetRow.visitante||''))
      );
      // Siempre marcar todas las keys ESPN de este partido para no re-procesar
      const espnEntry = liveScoreMap[key];
      if (espnEntry) {
        liveFromSheetKeys.add(normN(espnEntry.home_en) + '_' + normN(espnEntry.away_en));
        liveFromSheetKeys.add(normN(teamNameToSpanish_(espnEntry.home_en)) + '_' + normN(teamNameToSpanish_(espnEntry.away_en)));
      }
      liveFromSheetKeys.add(key);
      if (alreadyLive) return; // ya viene de la hoja con datos completos
      liveFromEspnOnly.push(sheetRow);
    } else {
      // No está en la hoja por nombre español — verificar si ya hay representación
      // via nombre inglés de ESPN en liveFromSheet antes de crear duplicado
      const entry = liveScoreMap[key];
      if (!entry) return;
      const alreadyViaEn = liveFromSheet.some(m =>
        normN(teamNameToSpanish_(m.local||''))     === normN(teamNameToSpanish_(entry.home_en||'')) &&
        normN(teamNameToSpanish_(m.visitante||'')) === normN(teamNameToSpanish_(entry.away_en||''))
      );
      liveFromSheetKeys.add(key);
      if (alreadyViaEn) return;
      liveFromEspnOnly.push({
        local:           teamNameToSpanish_(entry.home_en),
        visitante:       teamNameToSpanish_(entry.away_en),
        status:          entry.status || 'LIVE',
        goles_local:     entry.goles_local,
        goles_visitante: entry.goles_visitante,
        match_key:       '',
        fixture_id_af:   '',
        espn_id:         entry.espn_event_id,
        estadio:         '',
        ciudad:          '',
        hora_chile:      ''
      });
    }
  });

  const liveMatches = [...liveFromSheet, ...liveFromEspnOnly];

  // Alineaciones
  const alineaciones = readAll_(CONFIG.SHEETS.ALINEACIONES);

  return liveMatches.map(m => {
    const fid      = String(m.fixture_id_af || m.fixture_id || m.match_id || m.espn_id || '');
    const matchKey = m.match_key || '';

    // Override con ESPN en tiempo real
    const espnKey = normN(teamNameToSpanish_(m.local||'')) + '_' + normN(teamNameToSpanish_(m.visitante||''));
    const espnLive = liveScoreMap[espnKey] || null;
    if (espnLive) {
      if (espnLive.status) m.status = espnLive.status;
      if (espnLive.goles_local     !== null) m.goles_local     = espnLive.goles_local;
      if (espnLive.goles_visitante !== null) m.goles_visitante = espnLive.goles_visitante;
      if (espnLive.minuto)                   m.minuto          = espnLive.minuto;
    }

    const sheetEvs = eventos
      .filter(e => String(e.fixture_id || '') === fid)
      .sort((a, b) => Number(a.minuto || 0) - Number(b.minuto || 0))
      .map(e => ({
        minuto:    Number(e.minuto || 0),
        extra:     Number(e.minuto_extra || 0),
        tipo:      e.tipo     || '',
        equipo:    teamNameToSpanish_(e.equipo || ''),
        jugador:   e.jugador  || '',
        asistente: e.asistente || ''
      }));

    const statsRow = espnStats.find(s => String(s.fixture_id || '') === fid) || null;

    // Árbitro del partido
    let arbitro = null;
    try {
      const arbRows = readAll_(CONFIG.SHEETS.ARBITROS)
        .filter(r => String(r.fixture_id || r.match_key || '') === fid ||
                     String(r.match_key || '') === matchKey);
      if (arbRows.length) {
        const ar = arbRows[0];
        const stats = getRefereeStats_(ar.nombre);
        arbitro = {
          nombre:       ar.nombre       || '',
          nacionalidad: ar.nacionalidad || '',
          confederacion:ar.confederacion|| '',
          amarillas_pp: stats ? stats.amarillas_pp  : null,
          rojas_pp:     stats ? (stats.rojas / (stats.partidos || 1)).toFixed(2) : null,
          tendencia:    stats ? stats.tendencia : '',
          partidos_torneo: stats ? stats.partidos : 0
        };
      }
    } catch(e_) {}

    // ESPN summary (lineup + weather + venue + referee)
    const espnSummary = espnSummaryMap[espnKey] || null;

    // Fallback: eventos ESPN en tiempo real si hoja está vacía
    const evs = sheetEvs.length ? sheetEvs
      : (espnSummary && espnSummary.espnEvents ? espnSummary.espnEvents : []);

    // Árbitro desde ESPN summary en tiempo real (cuando aún no está en hoja)
    if (!arbitro && espnSummary && espnSummary.referee) {
      const nombre = espnSummary.referee;
      const info   = getRefereeInfo_(nombre);
      const stats  = getRefereeStats_(nombre);
      arbitro = {
        nombre:          nombre,
        nacionalidad:    info.nacionalidad,
        confederacion:   info.confederacion,
        amarillas_pp:    stats ? stats.amarillas_pp  : null,
        rojas_pp:        stats ? (stats.rojas / (stats.partidos || 1)).toFixed(2) : null,
        tendencia:       stats ? stats.tendencia : '',
        partidos_torneo: stats ? stats.partidos : 0
      };
    }

    // Alineaciones: prioridad ESPN summary en tiempo real, fallback a hoja
    let matchAlin = alineaciones
      .filter(a => String(a.fixture_id || '') === fid)
      .map(a => ({
        equipo:   teamNameToSpanish_(a.equipo   || ''),
        rol:      a.rol      || '',
        numero:   Number(a.numero || 0),
        jugador:  a.jugador  || '',
        posicion: a.posicion || '',
        grid:     a.grid     || ''
      }));

    // Formaciones desde hoja o ESPN summary
    let formacion_local    = m.formacion_local    || '';
    let formacion_visitante = m.formacion_visitante || '';

    if (!matchAlin.length && espnSummary && espnSummary.rosters.length) {
      try {
        const localEs = teamNameToSpanish_(m.local || '');
        const visitEs = teamNameToSpanish_(m.visitante || '');
        if (!formacion_local    && espnSummary.formacion_home) formacion_local    = espnSummary.formacion_home;
        if (!formacion_visitante && espnSummary.formacion_away) formacion_visitante = espnSummary.formacion_away;
        ['home','away'].forEach(side => {
          const entry = espnSummary.rosters.find(r => r.homeAway === side);
          if (!entry) return;
          const equipoEs = side === 'home' ? localEs : visitEs;
          (entry.roster || []).forEach(p => {
            const ath = p.athlete || {};
            matchAlin.push({
              equipo:   equipoEs,
              rol:      p.starter ? 'titular' : 'suplente',
              numero:   Number(ath.jersey || 0),
              jugador:  ath.shortName || ath.displayName || '',
              posicion: ((p.position || {}).abbreviation || '').toUpperCase(),
              grid:     ''
            });
          });
        });
      } catch(ea_) {}
    } else if (matchAlin.length && espnSummary) {
      // Alineaciones desde hoja pero formación puede venir de ESPN
      if (!formacion_local    && espnSummary.formacion_home) formacion_local    = espnSummary.formacion_home;
      if (!formacion_visitante && espnSummary.formacion_away) formacion_visitante = espnSummary.formacion_away;
    }

    // Clima: prioridad hoja, fallback ESPN summary weather
    let climaFinal = climaMap[fid] || null;
    if (!climaFinal && espnSummary && espnSummary.weather) {
      try {
        const w = espnSummary.weather;
        climaFinal = {
          temperatura: w.temperature != null ? Math.round((w.temperature - 32) * 5/9) : null,
          humedad:     w.humidity    || null,
          condicion:   w.displayValue || w.condition || '',
          viento:      w.windSpeed   != null ? Math.round(w.windSpeed * 1.609) : null
        };
      } catch(ew_) {}
    }

    // Timezone del estadio → frontend calcula hora actual en vivo
    let timezone_estadio = '';
    try {
      const venue = getVenueInfo_(m.estadio || '', m.ciudad || '');
      timezone_estadio = (venue && venue.timezone_estadio) || m.timezone_estadio || '';
    } catch(e_) {}

    // Poisson/ELO probabilities
    let poisson = null;
    try {
      const px = getPoissonOdds_(m.local, m.visitante, matchKey);
      if (px && px.markets) poisson = {
        prob_home: Number((px.markets['1'] || 0) * 100).toFixed(1),
        prob_draw: Number((px.markets['X'] || 0) * 100).toFixed(1),
        prob_away: Number((px.markets['2'] || 0) * 100).toFixed(1),
        over25:    Number((px.markets['over_2.5'] || 0) * 100).toFixed(1)
      };
    } catch(e_) {}

    return {
      match_key:       matchKey,
      local:           teamNameToSpanish_(m.local     || ''),
      visitante:       teamNameToSpanish_(m.visitante || ''),
      goles_local:     m.goles_local !== undefined && m.goles_local !== '' ? m.goles_local : null,
      goles_visitante: m.goles_visitante !== undefined && m.goles_visitante !== '' ? m.goles_visitante : null,
      status:          m.status  || '',
      minuto:          m.minuto  || '',
      estadio:         m.estadio || '',
      ciudad:          m.ciudad  || '',
      timezone_estadio: timezone_estadio,
      grupo:           m.grupo   || '',
      ronda:           m.ronda   || '',
      clima:              climaFinal,
      eventos:            evs,
      alineaciones:       matchAlin,
      formacion_local:    formacion_local,
      formacion_visitante: formacion_visitante,
      arbitro:         arbitro,
      poisson:         poisson,
      stats: statsRow ? {
        posesion_local:       Number(statsRow.posesion_local     || 0),
        posesion_visitante:   Number(statsRow.posesion_visitante || 0),
        tiros_local:          Number(statsRow.tiros_local        || 0),
        tiros_visitante:      Number(statsRow.tiros_visitante    || 0),
        tiros_arco_local:     Number(statsRow.tiros_arco_local   || 0),
        tiros_arco_visitante: Number(statsRow.tiros_arco_visitante || 0),
        corners_local:        Number(statsRow.corners_local      || 0),
        corners_visitante:    Number(statsRow.corners_visitante  || 0),
        amarillas_local:      Number(statsRow.amarillas_local    || 0),
        amarillas_visitante:  Number(statsRow.amarillas_visitante|| 0),
        rojas_local:          Number(statsRow.rojas_local        || 0),
        rojas_visitante:      Number(statsRow.rojas_visitante    || 0)
      } : null
    };
  }).filter(m => !['FT','AET','PEN'].includes(String(m.status||'').toUpperCase()));
}

// ─── Tab: match (detalle por match_key) ──────────────────────────────────────

function getWebMatch_(e) {
  const matchKey = (e.parameter && e.parameter.match_key) ? e.parameter.match_key : '';
  if (!matchKey) return { error: 'match_key requerido' };

  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const m = partidos.find(r => (r.match_key || '') === matchKey);
  if (!m) return { error: 'partido no encontrado: ' + matchKey };

  const fid = String(m.fixture_id_af || m.fixture_id_fd || '');

  // Eventos live
  const eventos = readAll_(CONFIG.SHEETS.EVENTOS_LIVE)
    .filter(ev => String(ev.fixture_id || '') === fid)
    .sort((a, b) => Number(a.minuto || 0) - Number(b.minuto || 0))
    .map(ev => ({
      minuto:   Number(ev.minuto || 0),
      extra:    Number(ev.minuto_extra || 0),
      tipo:     ev.tipo    || '',
      detalle:  ev.detalle || '',
      equipo:   teamNameToSpanish_(ev.equipo  || ''),
      jugador:  ev.jugador || '',
      asistente: ev.asistente || ''
    }));

  // Alineaciones
  const alineaciones = readAll_(CONFIG.SHEETS.ALINEACIONES)
    .filter(a => String(a.fixture_id || '') === fid)
    .map(a => ({
      equipo:   teamNameToSpanish_(a.equipo   || ''),
      rol:      a.rol      || '',
      numero:   Number(a.numero || 0),
      jugador:  a.jugador  || '',
      posicion: a.posicion || '',
      grid:     a.grid     || ''
    }));

  // Stats ESPN
  let stats = null;
  try {
    const espnStats = readAll_(CONFIG.SHEETS.ESPN_STATS);
    const s = espnStats.find(r => String(r.fixture_id || '') === fid);
    if (s) stats = {
      posesion_local:     Number(s.posesion_local    || 0),
      posesion_visitante: Number(s.posesion_visitante|| 0),
      tiros_local:        Number(s.tiros_local       || 0),
      tiros_visitante:    Number(s.tiros_visitante   || 0),
      tiros_arco_local:   Number(s.tiros_arco_local  || 0),
      tiros_arco_visitante: Number(s.tiros_arco_visitante || 0),
      corners_local:      Number(s.corners_local     || 0),
      corners_visitante:  Number(s.corners_visitante || 0),
      faltas_local:       Number(s.faltas_local      || 0),
      faltas_visitante:   Number(s.faltas_visitante  || 0),
      amarillas_local:    Number(s.amarillas_local   || 0),
      amarillas_visitante:Number(s.amarillas_visitante||0),
      rojas_local:        Number(s.rojas_local       || 0),
      rojas_visitante:    Number(s.rojas_visitante   || 0),
      offsides_local:     Number(s.offsides_local    || 0),
      offsides_visitante: Number(s.offsides_visitante|| 0),
      pases_local:        Number(s.pases_local       || 0),
      pases_visitante:    Number(s.pases_visitante   || 0)
    };
  } catch(e_) {}

  // H2H
  let h2h = [];
  try {
    h2h = readAll_(CONFIG.SHEETS.HISTORIAL_H2H)
      .filter(r => {
        const lNorm = (r.local     || '').toLowerCase();
        const vNorm = (r.visitante || '').toLowerCase();
        const mL    = (m.local     || '').toLowerCase();
        const mV    = (m.visitante || '').toLowerCase();
        return (lNorm.includes(mL.slice(0,4)) || vNorm.includes(mL.slice(0,4)));
      })
      .slice(0, 5)
      .map(r => ({
        fecha:    r.fecha    || '',
        local:    teamNameToSpanish_(r.local     || ''),
        visitante:teamNameToSpanish_(r.visitante || ''),
        goles_local:    Number(r.goles_local     || 0),
        goles_visitante:Number(r.goles_visitante || 0),
        torneo:   r.torneo   || ''
      }));
  } catch(e_) {}

  // Predicciones Poisson
  let poisson = null;
  try { poisson = getPoissonOdds_(m.local, m.visitante, matchKey); } catch(e_) {}

  // Análisis IA
  let ai = null;
  try {
    const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    const aiRow  = aiRows.find(r => String(r.fixture_id || '') === fid);
    if (aiRow) ai = {
      resumen:        aiRow.resumen_previa    || '',
      factores:       aiRow.factores_clave    || '',
      jugadores_forma:aiRow.jugadores_forma   || '',
      alertas:        aiRow.alertas           || '',
      confianza:      aiRow.confianza         || ''
    };
  } catch(e_) {}

  const mkts = poisson ? poisson.markets : null;

  return {
    match_key:       matchKey,
    fecha:           normalizeFecha_(m.fecha),
    hora:            safeHoraChile_(m.hora_chile || m.hora),
    local:           teamNameToSpanish_(m.local     || ''),
    visitante:       teamNameToSpanish_(m.visitante || ''),
    goles_local:     m.goles_local     ?? null,
    goles_visitante: m.goles_visitante ?? null,
    status:          m.status   || '',
    estadio:         m.estadio  || '',
    ciudad:          m.ciudad   || '',
    grupo:           m.grupo    || '',
    ronda:           m.ronda    || '',
    posesion_local:  Number(m.posesion_local  || 0),
    posesion_visitante: Number(m.posesion_visitante || 0),
    eventos, alineaciones, stats, h2h, ai,
    poisson: mkts ? {
      prob_home: Number((mkts['1']          || 0) * 100).toFixed(1),
      prob_draw: Number((mkts['X']          || 0) * 100).toFixed(1),
      prob_away: Number((mkts['2']          || 0) * 100).toFixed(1),
      over25:    Number((mkts['over_2.5']   || 0) * 100).toFixed(1),
      btts:      Number((mkts['btts_yes']   || 0) * 100).toFixed(1),
      lambda_h:  Number(poisson.lambdaH     || 0).toFixed(2),
      lambda_a:  Number(poisson.lambdaA     || 0).toFixed(2)
    } : null
  };
}

// ─── Tab: teams ──────────────────────────────────────────────────────────────

function getWebTeams_() {
  const equipos = readAll_(CONFIG.SHEETS.EQUIPOS);
  const elo     = readAll_(CONFIG.SHEETS.ELO_RATINGS);
  const forma   = readAll_(CONFIG.SHEETS.FORMA_EQUIPOS);
  const clas    = readAll_(CONFIG.SHEETS.CLASIFICACION);
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  // Normalize helper: strip accents + lowercase for fuzzy matching
  const norm = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');
  const normKey = s => norm(s)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
  const teamKey = s => {
    const k = normKey(teamNameToSpanish_(s || ''));
    if (k === 'bosniaherzegovina' || k === 'bosniaandherzegovina') return 'bosnia';
    if (k === 'usa' || k === 'eeuu' || k === 'unitedstates') return 'eeuu';
    if (k === 'qatar') return 'catar';
    if (k === 'switzerland') return 'suiza';
    if (k === 'canada') return 'canada';
    return k;
  };
  const displayTeamName = s => {
    const k = teamKey(s);
    if (k === 'bosnia') return 'Bosnia';
    if (k === 'eeuu') return 'EE.UU.';
    if (k === 'catar') return 'Catar';
    if (k === 'suiza') return 'Suiza';
    if (k === 'canada') return 'Canadá';
    return teamNameToSpanish_(s || '');
  };

  const eloMap   = {};
  elo.forEach(r => {
    const nombre = teamNameToSpanish_(r.equipo || '');
    const value = Number(r.elo_actual || r.elo || 0);
    if (!value) return;
    eloMap[teamKey(nombre)] = value;
    eloMap[teamKey(r.equipo || '')] = value; // also store raw alias
  });
  try {
    Object.keys(ELO_DEFAULTS || {}).forEach(function(name) {
      const key = teamKey(name);
      if (key && !eloMap[key]) eloMap[key] = Number(ELO_DEFAULTS[name] || 0);
    });
  } catch (e_) {}

  // Mapa de pares de equipos que se enfrentaron en el torneo (fecha >= 2026-06-11)
  const TORNEO_START = '2026-06-11';
  const wcPairs = new Set();
  partidos.forEach(r => {
    const fecha = normalizeFecha_(r.fecha);
    if (!fecha || fecha < TORNEO_START) return;
    const l = teamKey(r.local     || '');
    const v = teamKey(r.visitante || '');
    if (l && v) {
      wcPairs.add(l + '|' + v);
      wcPairs.add(v + '|' + l);
    }
  });

  // Mapa equipo → sus partidos del torneo (para el panel de detalle Y para forma_detail WC)
  const teamMatchesMap = {};
  const matchByCanonicalKey = {}; // evitar duplicados por filas repetidas en Partidos
  const statusRank_ = s => ({ 'FT': 5, 'AET': 5, 'PEN': 5, '2H': 3, 'HT': 2, '1H': 1, 'NS': 0 })[String(s || '').toUpperCase()] || 0;
  const rowQuality_ = r => {
    const st = statusRank_(r.status || r.estado || '');
    const hasScore = (r.goles_local !== '' && r.goles_local != null && r.goles_visitante !== '' && r.goles_visitante != null) ? 2 : 0;
    const hasId = (r.match_id || r.match_key || r.fixture_id_af || r.fixture_id_api_football) ? 1 : 0;
    const badKey = String(r.match_key || '') === '_objectobject_' ? -5 : 0;
    return st * 10 + hasScore + hasId + badKey;
  };
  partidos.forEach(r => {
    const fecha = normalizeFecha_(r.fecha);
    if (!fecha || fecha < TORNEO_START) return;
    const l = displayTeamName(r.local     || '');
    const v = displayTeamName(r.visitante || '');
    const lk = teamKey(l);
    const vk = teamKey(v);
    if (!lk || !vk) return;
    // Deduplicar por fecha + par canónico. En grupos cada par se enfrenta una sola vez.
    const pair = [lk, vk].sort().join('|');
    const matchKey = fecha + '|' + pair;
    const entry = {
      fecha,
      hora:    safeHoraChile_(r.hora_chile || r.hora),
      local:   l, visitante: v,
      goles_l: r.goles_local    !== '' && r.goles_local    != null ? Number(r.goles_local)    : null,
      goles_v: r.goles_visitante!== '' && r.goles_visitante!= null ? Number(r.goles_visitante): null,
      status:  String(r.status  || '').toUpperCase(),
      estadio: r.estadio || '', ciudad: r.ciudad || ''
    };
    if (!matchByCanonicalKey[matchKey] || rowQuality_(r) > matchByCanonicalKey[matchKey].quality) {
      matchByCanonicalKey[matchKey] = { entry, teams: [lk, vk], quality: rowQuality_(r) };
    }
  });
  Object.keys(matchByCanonicalKey).forEach(k => {
    const item = matchByCanonicalKey[k];
    item.teams.forEach(eq => {
      if (!eq) return;
      if (!teamMatchesMap[eq]) teamMatchesMap[eq] = [];
      teamMatchesMap[eq].push(item.entry);
    });
  });

  const formaMap = {};
  forma.forEach(r => {
    const nombre   = displayTeamName(r.equipo || '');
    const key  = teamKey(nombre);
    const results  = String(r.ultimos_5_resultados || '').split(',').filter(x => /^[WDL]$/.test(x));
    const rivales  = String(r.ultimos_5_rivales    || '').split(',');
    const marcadores = String(r.ultimos_5_marcadores || '').split(',');

    // WC results from Partidos directly (authoritative — FormaEquipos may lag updates)
    const wcEntries = (teamMatchesMap[key] || [])
      .filter(m => m.goles_l !== null && m.goles_v !== null)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
      .map(m => {
        const isHome = teamKey(m.local) === key;
        const myG  = isHome ? m.goles_l : m.goles_v;
        const oppG = isHome ? m.goles_v : m.goles_l;
        const res  = myG > oppG ? 'W' : myG < oppG ? 'L' : 'D';
        return { r: res, wc: true, rival: isHome ? m.visitante : m.local, score: `${myG}-${oppG}` };
      });

    // Exclude WC opponents from FormaEquipos history to avoid duplicates
    const wcRivalKeys = new Set(wcEntries.map(e => teamKey(e.rival)));
    const prevEntries = results.map((res, i) => {
      const rival = displayTeamName((rivales[i] || '').trim());
      return { r: res, wc: false, rival, score: (marcadores[i] || '').trim(), _rk: teamKey(rival) };
    }).filter(d => !wcRivalKeys.has(d._rk)).map(({ _rk, ...rest }) => rest);

    formaMap[key] = { raw: results.join(','), detail: [...wcEntries, ...prevEntries] };
  });

  const clasMap = {};
  clas.forEach(r => {
    const nombre = displayTeamName(r.equipo || '');
    const k = teamKey(nombre);
    clasMap[k] = { grupo: r.grupo || '', pos: Number(r.posicion || r.pos || 0), pts: Number(r.puntos || r.pts || 0) };
  });

  // Build equipo metadata map from Equipos sheet
  const equiposMeta = {};
  equipos.forEach(eq => {
    const nombre = displayTeamName(eq.nombre || eq.name || eq.equipo || '');
    if (!nombre) return;
    equiposMeta[teamKey(nombre)] = {
      confederacion: eq.confederacion || eq.confederation || '',
      entrenador:    eq.entrenador || eq.coach || '',
      espn_id:       eq.espn_id || '',
      grupo:         eq.grupo || ''
    };
  });

  // Collect ALL 48 teams from Clasificacion + Partidos (to avoid gaps)
  const allTeams = new Set();
  clas.forEach(r => { const n = displayTeamName(r.equipo || ''); if (n) allTeams.add(n); });
  partidos.forEach(r => {
    const l = displayTeamName(r.local || '');
    const v = displayTeamName(r.visitante || '');
    if (l && !isKnockoutPlaceholderTeam_(l)) allTeams.add(l);
    if (v && !isKnockoutPlaceholderTeam_(v)) allTeams.add(v);
  });
  equipos.forEach(eq => {
    const n = displayTeamName(eq.nombre || eq.name || eq.equipo || '');
    if (n) allTeams.add(n);
  });

  const seenNombres = new Set();
  return Array.from(allTeams).map(nombre => {
    const k     = teamKey(nombre);
    if (!nombre || seenNombres.has(k)) return null;
    seenNombres.add(k);
    const meta  = equiposMeta[k] || {};
    const cData = clasMap[k] || {};
    return {
      nombre,
      grupo:         meta.grupo || cData.grupo || '',
      pos:           cData.pos  || 0,
      pts:           cData.pts  || 0,
      elo:           eloMap[k] || getTeamElo_(nombre) || 0,
      forma:         (formaMap[k] && formaMap[k].raw)    || '',
      forma_detail:  (formaMap[k] && formaMap[k].detail) || [],
      confederacion: meta.confederacion || '',
      entrenador:    meta.entrenador    || '',
      espn_id:       meta.espn_id       || '',
      partidos_wc:   (teamMatchesMap[k] || []).sort((a,b) => a.fecha > b.fecha ? 1 : -1)
    };
  }).filter(Boolean).sort((a, b) => (b.elo || 0) - (a.elo || 0));
}

function isKnockoutPlaceholderTeam_(name) {
  const s = String(name || '').toLowerCase();
  return s.includes('winner') ||
    s.includes('loser') ||
    s.includes('2nd place') ||
    s.includes('third place') ||
    s.includes('round of') ||
    s.includes('quarterfinal') ||
    s.includes('semifinal') ||
    /^group [a-l]/i.test(String(name || ''));
}

function getWebKnockout_() {
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => isKnockoutPlaceholderTeam_(r.local) || isKnockoutPlaceholderTeam_(r.visitante))
    .map((r, idx) => {
      const phase = inferKnockoutPhase_(r, idx);
      return {
        id: r.match_key || r.match_id || ('ko_' + idx),
        fecha: normalizeFecha_(r.fecha),
        hora_chile: safeHoraChile_(r.hora_chile || r.hora),
        fase: phase.key,
        fase_label: phase.label,
        order: phase.order,
        local: knockoutSlotLabel_(r.local || ''),
        visitante: knockoutSlotLabel_(r.visitante || ''),
        local_raw: r.local || '',
        visitante_raw: r.visitante || '',
        estadio: r.estadio || '',
        ciudad: r.ciudad || '',
        status: String(r.status || 'NS').toUpperCase(),
        goles_local: r.goles_local !== '' && r.goles_local != null ? Number(r.goles_local) : null,
        goles_visitante: r.goles_visitante !== '' && r.goles_visitante != null ? Number(r.goles_visitante) : null,
        penales_local: r.penales_local !== '' && r.penales_local != null ? Number(r.penales_local) : null,
        penales_visitante: r.penales_visitante !== '' && r.penales_visitante != null ? Number(r.penales_visitante) : null,
        match_key: r.match_key || ''
      };
    })
    .sort((a, b) => (a.fecha + ' ' + a.hora_chile).localeCompare(b.fecha + ' ' + b.hora_chile));

  const rounds = {};
  partidos.forEach(p => {
    if (!rounds[p.fase]) rounds[p.fase] = { key: p.fase, label: p.fase_label, order: p.order, partidos: [] };
    rounds[p.fase].partidos.push(p);
  });

  return {
    rounds: Object.values(rounds).sort((a, b) => a.order - b.order),
    partidos
  };
}

function inferKnockoutPhase_(row, idx) {
  const text = [
    row.local, row.visitante, row.match_id, row.match_key, row.ronda, row.fase
  ].join(' ').toLowerCase();
  const date = normalizeFecha_(row.fecha);
  if (text.includes('semifinal') && text.includes('loser')) return { key: 'third', label: 'Tercer puesto', order: 6 };
  if (text.includes('semifinal') && text.includes('winner')) return { key: 'final', label: 'Final', order: 7 };
  if (text.includes('quarterfinal')) return { key: 'semifinal', label: 'Semifinales', order: 5 };
  if (text.includes('round of 16')) return { key: 'quarterfinal', label: 'Cuartos de final', order: 4 };
  if (text.includes('round of 32')) return { key: 'r16', label: 'Octavos de final', order: 3 };
  if (date && date >= '2026-06-28' && date <= '2026-07-03') return { key: 'r32', label: 'Dieciseisavos de final', order: 2 };
  return { key: 'qualified', label: 'Clasificados / cruces', order: 1 };
}

function knockoutSlotLabel_(raw) {
  let s = String(raw || '');
  s = s.replace(/^Group ([A-L]) Winner$/i, 'Grupo $1 · 1°');
  s = s.replace(/^Group ([A-L]) 2nd Place$/i, 'Grupo $1 · 2°');
  s = s.replace(/^Third Place Group ([A-L/]+)$/i, 'Mejor 3° · Grupos $1');
  s = s.replace(/^Round of 32 ([0-9]+) Winner$/i, 'Ganador 16avos $1');
  s = s.replace(/^Round of 16 ([0-9]+) Winner$/i, 'Ganador octavos $1');
  s = s.replace(/^Quarterfinal ([0-9]+) Winner$/i, 'Ganador cuartos $1');
  s = s.replace(/^Semifinal ([0-9]+) Winner$/i, 'Ganador semifinal $1');
  s = s.replace(/^Semifinal ([0-9]+) Loser$/i, 'Perdedor semifinal $1');
  return teamNameToSpanish_(s);
}

// ─── Tab: players ────────────────────────────────────────────────────────────

function getWebPlayers_() {
  // Mapa jugador_id + nombre_normalizado → foto + posicion desde hoja Jugadores
  const fotoByPid  = {};
  const fotoByName = {};
  const normName   = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9]/g,'');
  try {
    readAll_(CONFIG.SHEETS.JUGADORES).forEach(r => {
      const pid  = String(r.player_id_api_football || r.jugador_id || '');
      const meta = { foto: r.foto || '', posicion: r.posicion || '', edad: r.edad || '' };
      if (pid)        fotoByPid[pid]               = meta;
      const nombre = normName(r.nombre || '');
      if (nombre)     fotoByName[nombre]            = meta;
    });
  } catch(e_) {}

  const resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

  // Dedup: fixture_id + jugador_id → keep latest by timestamp_carga
  const dedupMap = {};
  resumen.forEach(r => {
    const fid = r.fixture_id || r.match_id || '';
    const pid = r.jugador_id || '';
    if (!fid || !pid) return;
    const k = `${fid}_${pid}`;
    const ts = r.timestamp_carga || r.updated_at || '';
    if (!dedupMap[k] || String(ts) > String(dedupMap[k].timestamp_carga || '')) dedupMap[k] = r;
  });
  const deduped = Object.values(dedupMap);

  const byPlayer = {};
  deduped.forEach(r => {
    const name = r.jugador || '';
    if (!name) return;
    const pid = String(r.jugador_id || '');
    if (!byPlayer[name]) {
      const meta = fotoByPid[pid] || fotoByName[normName(name)] || {};
      byPlayer[name] = {
        jugador_id:  pid,
        jugador:     name,
        equipo:      teamNameToSpanish_(r.equipo || ''),
        foto:        meta.foto     || '',
        posicion:    meta.posicion || '',
        edad:        meta.edad     || '',
        goles:       0,
        asistencias: 0,
        amarillas:   0,
        rojas:       0,
        minutos:     0,
        partidos:    0
      };
    }
    const p = byPlayer[name];
    p.goles       += Number(r.goles       || 0);
    p.asistencias += Number(r.asistencias || 0);
    p.amarillas   += Number(r.amarillas   || 0);
    p.rojas       += Number(r.rojas       || 0);
    p.minutos     += Number(r.minutos     || 0);
    p.partidos    += 1;
  });

  // Fallback: PlayerMatchStats (también enriquecido con fotoMap)
  if (!Object.keys(byPlayer).length) {
    readAll_(CONFIG.SHEETS.PLAYER_MATCH_STATS).forEach(r => {
      const name = r.player_name || '';
      if (!name) return;
      const pid = String(r.player_id || '');
      if (!byPlayer[name]) {
        const meta = fotoByPid[pid] || fotoByName[normName(name)] || {};
        byPlayer[name] = {
          jugador_id:  pid,
          jugador:     name,
          equipo:      teamNameToSpanish_(r.team_name || ''),
          foto:        meta.foto     || '',
          posicion:    meta.posicion || '',
          edad:        meta.edad     || '',
          goles:       0,
          asistencias: 0,
          amarillas:   0,
          rojas:       0,
          minutos:     0,
          partidos:    0
        };
      }
      const p = byPlayer[name];
      p.goles       += Number(r.goals_scored   || 0);
      p.asistencias += Number(r.assists        || 0);
      p.amarillas   += Number(r.yellow_cards   || 0);
      p.rojas       += Number(r.red_cards      || 0);
      p.minutos     += Number(r.minutes_played || 0);
      p.partidos    += 1;
    });
  }

  return Object.values(byPlayer)
    .sort((a, b) => b.goles - a.goles || b.asistencias - a.asistencias)
    .slice(0, 50);
}

// ─── Tab: ayer ───────────────────────────────────────────────────────────────

function getWebAyer_() {
  // Calcular fecha de ayer en Chile
  const todayStr = todayChile_(); // 'YYYY-MM-DD'
  const todayDate = new Date(todayStr + 'T12:00:00Z');
  todayDate.setUTCDate(todayDate.getUTCDate() - 1);
  const ayer = Utilities.formatDate(todayDate, 'UTC', 'yyyy-MM-dd');

  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const lista = partidos.filter(function(r) {
    return normalizeFecha_(r.fecha) === ayer || normalizeFecha_(r.fecha_chile) === ayer;
  });

  const FINAL_STATUS = ['FT', 'AET', 'PEN'];

  // Construir normN igual que getWebHoy_
  function normN(s) {
    return String(s || '').toLowerCase()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
      .replace(/[^a-z]/g,'');
  }

  // ESPN override para partidos terminados
  const ESPN_MAP = {
    'final':'FT', 'full time':'FT', 'final/aet':'AET', 'final/pen':'PEN'
  };
  const scoreMap = {};
  try {
    const espnData = espnGet_('/scoreboard');
    (espnData.events || []).forEach(function(ev) {
      var comp  = (ev.competitions || [])[0] || {};
      var comps = comp.competitors || [];
      var home  = comps.find(function(c) { return c.homeAway === 'home'; }) || {};
      var away  = comps.find(function(c) { return c.homeAway === 'away'; }) || {};
      var desc  = String((ev.status && ev.status.type && ev.status.type.description) || '').toLowerCase();
      var mappedStatus = ESPN_MAP[desc] || null;
      if (!mappedStatus) return; // solo finales
      var entry = {
        goles_local:     home.score !== undefined ? home.score : null,
        goles_visitante: away.score !== undefined ? away.score : null,
        status:          mappedStatus
      };
      var hEn = (home.team || {}).displayName || '';
      var aEn = (away.team || {}).displayName || '';
      scoreMap[normN(hEn) + '_' + normN(aEn)] = entry;
      scoreMap[normN(teamNameToSpanish_(hEn)) + '_' + normN(teamNameToSpanish_(aEn))] = entry;
    });
  } catch (e_) {}

  var partidos_out = lista.map(function(r) {
    var local     = teamNameToSpanish_(r.local     || '');
    var visitante = teamNameToSpanish_(r.visitante || '');
    var status    = r.status || '';
    var gl        = r.goles_local     !== undefined && r.goles_local     !== '' ? r.goles_local     : null;
    var gv        = r.goles_visitante !== undefined && r.goles_visitante !== '' ? r.goles_visitante : null;

    // Override ESPN solo para FT
    if (FINAL_STATUS.includes(status) || !status) {
      var k = normN(local) + '_' + normN(visitante);
      var espn = scoreMap[k];
      if (espn) {
        if (espn.status) status = espn.status;
        if (espn.goles_local     !== null) gl = espn.goles_local;
        if (espn.goles_visitante !== null) gv = espn.goles_visitante;
      }
    }

    return {
      local:           local,
      visitante:       visitante,
      goles_local:     gl,
      goles_visitante: gv,
      status:          status || 'FT',
      hora_chile:      safeHoraChile_(r.hora_chile || r.hora),
      grupo:           r.grupo   || '',
      ronda:           r.ronda   || '',
      estadio:         r.estadio || '',
      match_key:       r.match_key || ''
    };
  }).sort(function(a, b) {
    return (a.hora_chile || '').localeCompare(b.hora_chile || '');
  });

  return { fecha: ayer, partidos: partidos_out };
}

// ─── Tab: proximos ───────────────────────────────────────────────────────────

function getWebProximos_() {
  var today = todayChile_();
  var partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  // Filtrar: status NS / vacío / null y fecha > hoy
  var proximos = partidos.filter(function(r) {
    var status = String(r.status || '').toUpperCase();
    var fecha  = normalizeFecha_(r.fecha) || normalizeFecha_(r.fecha_chile);
    return (status === 'NS' || status === '') && fecha > today;
  });

  // Agrupar por fecha
  var byDate = {};
  proximos.forEach(function(r) {
    var fecha = normalizeFecha_(r.fecha) || normalizeFecha_(r.fecha_chile);
    if (!fecha) return;
    if (!byDate[fecha]) byDate[fecha] = [];
    if (byDate[fecha].length >= 16) return; // max 16 por día
    byDate[fecha].push({
      local:     teamNameToSpanish_(r.local     || ''),
      visitante: teamNameToSpanish_(r.visitante || ''),
      hora_chile: safeHoraChile_(r.hora_chile || r.hora),
      grupo:     r.grupo   || '',
      ronda:     r.ronda   || '',
      estadio:   r.estadio || '',
      match_key: r.match_key || ''
    });
  });

  // Ordenar fechas asc, limitar a 5 días
  var fechas = Object.keys(byDate).sort();
  fechas = fechas.slice(0, 5);

  var dias = fechas.map(function(f) {
    byDate[f].sort(function(a, b) { return (a.hora_chile || '').localeCompare(b.hora_chile || ''); });
    return { fecha: f, partidos: byDate[f] };
  });

  return { dias: dias };
}

// ─── Tab: noticias ───────────────────────────────────────────────────────────

function getWebNoticias_() {
  // La hoja Noticias no tiene fila de encabezados — leer valores crudos
  // Estructura por columna (basado en ingesta Google News RSS):
  // 0:id_hash  1:pubDate  2:updated_at  3:desc  4:?  5:titulo  6:categoria
  // 7:equipos_mencionados  8:url  9:fuente  10:fixture_id  11:equipo_local  12:equipo_visitante
  var sheet  = getSheet_(CONFIG.SHEETS.NOTICIAS);
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];

  // Detectar si la primera fila es header o data (header tendría strings como 'titulo', 'url', etc.)
  var firstRow   = values[0];
  var hasHeader  = String(firstRow[0] || '').toLowerCase() === 'id_hash' ||
                   String(firstRow[5] || '').toLowerCase() === 'titulo';
  var dataRows   = hasHeader ? values.slice(1) : values;

  // Intentar detectar la columna de titulo buscando una fila con texto largo en col 5 vs col 2
  var COL_TITULO  = 5;
  var COL_URL     = 8;
  var COL_FUENTE  = 9;
  var COL_FECHA   = 1;  // pubDate string
  var COL_EQUIPO  = 11; // equipo_local

  // Si el primer valor de col 5 parece una URL o hash, ajustar (fallback a SheetManager order)
  if (dataRows.length > 0) {
    var sample = String(dataRows[0][5] || '');
    if (sample.startsWith('http') || sample.length < 5) {
      // Estructura alternativa (SheetManager): id_hash, fixture_id, titulo, desc, fuente, url, pubDate, equipos, updated_at
      COL_TITULO = 2; COL_URL = 5; COL_FUENTE = 4; COL_FECHA = 6; COL_EQUIPO = -1;
    }
  }

  var today     = todayChile_();
  var yesterday = yesterdayChile_();

  // Equipos que juegan hoy — filtrar noticias solo para esos partidos
  var normN_ = function(s) { return String(s||'').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z]/g,''); };
  var equiposHoy = [];
  try {
    readAll_(CONFIG.SHEETS.PARTIDOS)
      .filter(function(r) { return normalizeFecha_(r.fecha) === today; })
      .forEach(function(r) {
        var l = normN_(teamNameToSpanish_(r.local     || ''));
        var v = normN_(teamNameToSpanish_(r.visitante || ''));
        if (l) equiposHoy.push(l);
        if (v) equiposHoy.push(v);
      });
  } catch(e_) {}

  var noticias = dataRows.map(function(row) {
    var titulo = String(row[COL_TITULO] || '');
    if (!titulo || titulo.startsWith('http') || titulo.length < 10) return null;

    // Parsear pubDate (RFC 2822: 'Wed, 17 Jun 2026 14:20:35 GMT')
    var fechaIso = '';
    try {
      var pubRaw = row[COL_FECHA];
      var d = (pubRaw instanceof Date) ? pubRaw : new Date(String(pubRaw || ''));
      if (!isNaN(d.getTime())) {
        fechaIso = Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd');
      }
    } catch(e_) {}

    // Solo noticias de hoy o ayer
    if (fechaIso && fechaIso < yesterday) return null;

    // Solo noticias relevantes para equipos que juegan hoy
    if (equiposHoy.length > 0) {
      var equipo = COL_EQUIPO >= 0 ? normN_(teamNameToSpanish_(String(row[COL_EQUIPO] || ''))) : '';
      var tituloNorm = normN_(titulo);
      var esRelevante = (equipo && equiposHoy.indexOf(equipo) !== -1) ||
                        equiposHoy.some(function(eq) { return tituloNorm.indexOf(eq) !== -1; });
      if (!esRelevante) return null;
    }

    return {
      titulo: titulo,
      url:    String(row[COL_URL]    || ''),
      fuente: String(row[COL_FUENTE] || ''),
      equipo: COL_EQUIPO >= 0 ? teamNameToSpanish_(String(row[COL_EQUIPO] || '')) : '',
      fecha:  fechaIso
    };
  }).filter(function(n) { return n && n.titulo; });

  noticias.sort(function(a, b) {
    return String(b.fecha || '').localeCompare(String(a.fecha || ''));
  });

  return noticias.slice(0, 30);
}

// ─── Tab: squad ──────────────────────────────────────────────────────────────

function getWebSquad_(e) {
  var equipoParam = (e.parameter && e.parameter.equipo) ? e.parameter.equipo : '';
  if (!equipoParam) return { error: 'Parámetro equipo requerido' };

  var equipoParamLower = equipoParam.toLowerCase();

  // Leer jugadores y filtrar por equipo
  var jugadores = readAll_(CONFIG.SHEETS.JUGADORES);
  var squad = jugadores.filter(function(r) {
    var eq = String(r.equipo || '').toLowerCase();
    var eqEs = teamNameToSpanish_(r.equipo || '').toLowerCase();
    return eq === equipoParamLower || eqEs === equipoParamLower ||
           eq.includes(equipoParamLower) || eqEs.includes(equipoParamLower);
  });

  if (!squad.length) return { equipo: equipoParam, jugadores: [] };

  // Deduplicar jugadores por nombre normalizado: múltiples fuentes (API-Football + ESPN)
  // pueden cargar el mismo jugador con distinto equipo_id y player_id format.
  // Prioridad: player_id numérico (API-Football) > espn_ prefixed > cualquier otro.
  var dedupSquad = {};
  squad.forEach(function(r) {
    var nomKey = String(r.nombre || '').toLowerCase().replace(/\s+/g,' ').trim();
    if (!nomKey) return;
    var existing = dedupSquad[nomKey];
    if (!existing) { dedupSquad[nomKey] = r; return; }
    // Prefiere API-Football (player_id numérico) sobre ESPN (espn_ prefixed)
    var curPid  = String(r.player_id_api_football || '');
    var exPid   = String(existing.player_id_api_football || '');
    var curIsAF = curPid && !curPid.startsWith('espn_');
    var exIsAF  = exPid  && !exPid.startsWith('espn_');
    if (curIsAF && !exIsAF) dedupSquad[nomKey] = r;
  });
  squad = Object.values(dedupSquad);

  var equipoName = teamNameToSpanish_(squad[0].equipo || equipoParam);

  // Acumular stats de ResumenJugadorPartido (deduplicado por fixture_id+jugador_id)
  var resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

  var dedupMap = {};
  resumen.forEach(function(r) {
    var fid = r.fixture_id || r.match_id || '';
    var pid = String(r.jugador_id || '');
    if (!fid || !pid) return;
    var k = fid + '_' + pid;
    if (!dedupMap[k]) dedupMap[k] = r;
  });

  // Helper de normalización de nombre para fallback
  function normNombre_(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Agregar por jugador_id — y también indexar por nombre normalizado como fallback
  var statsByPid  = {};
  var statsByName = {};
  Object.keys(dedupMap).forEach(function(k) {
    var r   = dedupMap[k];
    var pid = String(r.jugador_id || '');
    if (!pid) return;
    if (!statsByPid[pid]) statsByPid[pid] = { goles: 0, asistencias: 0, amarillas: 0, rojas: 0, partidos: 0 };
    statsByPid[pid].goles       += Number(r.goles             || 0);
    statsByPid[pid].asistencias += Number(r.asistencias       || 0);
    statsByPid[pid].amarillas   += Number(r.tarjetas_amarillas || r.amarillas || 0);
    statsByPid[pid].rojas       += Number(r.tarjetas_rojas     || r.rojas    || 0);
    statsByPid[pid].partidos    += 1;
    // Fallback por nombre
    var nk = normNombre_(r.jugador);
    if (nk) {
      if (!statsByName[nk]) statsByName[nk] = { goles: 0, asistencias: 0, amarillas: 0, rojas: 0, partidos: 0 };
      statsByName[nk].goles       += Number(r.goles             || 0);
      statsByName[nk].asistencias += Number(r.asistencias       || 0);
      statsByName[nk].amarillas   += Number(r.tarjetas_amarillas || r.amarillas || 0);
      statsByName[nk].rojas       += Number(r.tarjetas_rojas     || r.rojas    || 0);
      statsByName[nk].partidos    += 1;
    }
  });

  // Rating y minutos desde PlayerMatchStats (coincide por player_id con jugador_id de Plantel)
  var ratingByPid = {};
  var minutosByPid = {};
  var ratingByName  = {};
  var minutosByName = {};
  try {
    var pmsRows = readAll_(CONFIG.SHEETS.PLAYER_MATCH_STATS);
    pmsRows.forEach(function(r) {
      var pid = String(r.player_id || r.jugador_id || '');
      var min = Number(r.minutes_played || r.minutos || r.minutes || 0);
      var rat = Number(r.rating || 0);
      // Índice por ID numérico
      if (pid && !isNaN(Number(pid))) {
        if (!minutosByPid[pid]) minutosByPid[pid] = 0;
        if (!ratingByPid[pid])  ratingByPid[pid]  = { sum: 0, cnt: 0 };
        minutosByPid[pid] += min;
        if (rat > 0) { ratingByPid[pid].sum += rat; ratingByPid[pid].cnt++; }
      }
      // Índice por nombre como fallback
      var nk = normNombre_(r.player_name || r.jugador || '');
      if (nk) {
        if (!minutosByName[nk]) minutosByName[nk] = 0;
        if (!ratingByName[nk])  ratingByName[nk]  = { sum: 0, cnt: 0 };
        minutosByName[nk] += min;
        if (rat > 0) { ratingByName[nk].sum += rat; ratingByName[nk].cnt++; }
      }
    });
  } catch(e_) {}

  var lineupByName = {};
  try {
    readAll_(CONFIG.SHEETS.ALINEACIONES).forEach(function(r) {
      if (teamNameToSpanish_(r.equipo || '') !== equipoName) return;
      var nk = normNombre_(r.jugador || '');
      if (!nk) return;
      if (!lineupByName[nk]) lineupByName[nk] = { partidos: 0 };
      lineupByName[nk].partidos += 1;
    });
  } catch(e_) {}

  // Posicion sort order
  var posOrder = { 'Portero': 1, 'Goalkeeper': 1, 'Defensa': 2, 'Defender': 2, 'Mediocampista': 3, 'Midfielder': 3, 'Delantero': 4, 'Forward': 4, 'Attacker': 4 };

  var jugadoresOut = squad.map(function(r) {
    var pid  = String(r.player_id_api_football || r.jugador_id || '');
    var nk   = normNombre_(r.nombre);
    // Fallback por nombre cuando el ID es ESPN format (espn_XXXXXX) o no está en statsByPid
    var stats    = statsByPid[pid] || statsByName[nk] || { goles: 0, asistencias: 0, amarillas: 0, rojas: 0, partidos: 0 };
    var ratObj   = ratingByPid[pid]  || ratingByName[nk];
    var minutos  = minutosByPid[pid] || minutosByName[nk] || 0;
    var lineupStats = lineupByName[nk] || null;
    var partidos = stats.partidos || (lineupStats ? lineupStats.partidos : 0);
    return {
      nombre:      r.nombre   || '',
      posicion:    r.posicion || '',
      edad:        r.edad     || '',
      foto:        r.foto     || '',
      altura:      r.altura   || '',
      peso:        r.peso     || '',
      goles:       stats.goles,
      asistencias: stats.asistencias,
      amarillas:   stats.amarillas,
      rojas:       stats.rojas,
      partidos:    partidos,
      minutos:     minutos,
      rating:      ratObj && ratObj.cnt ? Math.round(ratObj.sum / ratObj.cnt * 10) / 10 : 0
    };
  });

  jugadoresOut.sort(function(a, b) {
    var pa = posOrder[a.posicion] || 5;
    var pb = posOrder[b.posicion] || 5;
    if (pa !== pb) return pa - pb;
    return (a.nombre || '').localeCompare(b.nombre || '');
  });

  return { equipo: equipoName, jugadores: jugadoresOut };
}

// ─── Tab: stats ──────────────────────────────────────────────────────────────

function getWebStats_() {
  // EspnStats tiene columnas local/visitante (no equipo) y datos por lado del partido
  var espnStats  = readAll_(CONFIG.SHEETS.ESPN_STATS);
  var partidos   = readAll_(CONFIG.SHEETS.PARTIDOS);

  function ensureStat(map, eq) {
    if (!map[eq]) map[eq] = { equipo:eq, posesion_sum:0, posesion_n:0,
      tiros:0, tiros_arco:0, corners:0, faltas:0, amarillas:0, rojas:0 };
  }

  var statsMap = {};
  // Deduplicar EspnStats por fixture_id (puede haber duplicados del mismo partido)
  var espnDedup = {};
  espnStats.forEach(function(r) {
    var fid = String(r.fixture_id || '');
    if (!fid) return;
    if (!espnDedup[fid]) espnDedup[fid] = r;
  });

  Object.values(espnDedup).forEach(function(r) {
    var lEq = teamNameToSpanish_(r.local     || '');
    var vEq = teamNameToSpanish_(r.visitante || '');
    if (!lEq && !vEq) return;

    if (lEq) {
      ensureStat(statsMap, lEq);
      var posL = parseFloat(String(r.posesion_local || '0').replace('%',''));
      if (!isNaN(posL) && posL > 0) { statsMap[lEq].posesion_sum += posL; statsMap[lEq].posesion_n += 1; }
      statsMap[lEq].tiros      += Number(r.tiros_local      || 0);
      statsMap[lEq].tiros_arco += Number(r.tiros_arco_local || 0);
      statsMap[lEq].corners    += Number(r.corners_local    || 0);
      statsMap[lEq].faltas     += Number(r.faltas_local     || 0);
      statsMap[lEq].amarillas  += Number(r.amarillas_local  || 0);
      statsMap[lEq].rojas      += Number(r.rojas_local      || 0);
    }
    if (vEq) {
      ensureStat(statsMap, vEq);
      var posV = parseFloat(String(r.posesion_visitante || '0').replace('%',''));
      if (!isNaN(posV) && posV > 0) { statsMap[vEq].posesion_sum += posV; statsMap[vEq].posesion_n += 1; }
      statsMap[vEq].tiros      += Number(r.tiros_visitante      || 0);
      statsMap[vEq].tiros_arco += Number(r.tiros_arco_visitante || 0);
      statsMap[vEq].corners    += Number(r.corners_visitante    || 0);
      statsMap[vEq].faltas     += Number(r.faltas_visitante     || 0);
      statsMap[vEq].amarillas  += Number(r.amarillas_visitante  || 0);
      statsMap[vEq].rojas      += Number(r.rojas_visitante      || 0);
    }
  });

  // Agregar W/D/L y GF/GA desde Partidos (deduplicar por par de equipos, priorizando filas con match_id)
  var wdlMap = {};
  var FINAL_STATUS = ['FT', 'AET', 'PEN'];
  var normTeam = function(s) {
    return teamNameToSpanish_(String(s || '')).toLowerCase()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
      .replace(/[^a-z]/g,'');
  };
  var partidosDedup = {};
  partidos.forEach(function(r) {
    var status = String(r.status || '').toUpperCase();
    if (!FINAL_STATUS.includes(status)) return; // solo contar partidos terminados
    // Clave por par de equipos (independiente de fuente o fecha)
    var pairKey = normTeam(r.local) + '_' + normTeam(r.visitante);
    var hasId = !!(r.match_id || r.fixture_id_api_football);
    var existing = partidosDedup[pairKey];
    // Preferir la fila que tenga match_id
    if (!existing || (hasId && !(existing.match_id || existing.fixture_id_api_football))) {
      partidosDedup[pairKey] = r;
    }
  });
  Object.values(partidosDedup).forEach(function(r) {
    var status = String(r.status || '').toUpperCase();
    if (!FINAL_STATUS.includes(status)) return;
    var gl = Number(r.goles_local     || 0);
    var gv = Number(r.goles_visitante || 0);
    var local     = teamNameToSpanish_(r.local     || '');
    var visitante = teamNameToSpanish_(r.visitante || '');

    function ensureTeam(eq) {
      if (!wdlMap[eq]) wdlMap[eq] = { pj:0, pg:0, pe:0, pp:0, gf:0, ga:0 };
    }
    ensureTeam(local);
    ensureTeam(visitante);

    wdlMap[local].pj += 1;
    wdlMap[local].gf += gl;
    wdlMap[local].ga += gv;
    wdlMap[visitante].pj += 1;
    wdlMap[visitante].gf += gv;
    wdlMap[visitante].ga += gl;

    if (gl > gv) {
      wdlMap[local].pg    += 1;
      wdlMap[visitante].pp += 1;
    } else if (gl < gv) {
      wdlMap[visitante].pg += 1;
      wdlMap[local].pp     += 1;
    } else {
      wdlMap[local].pe     += 1;
      wdlMap[visitante].pe += 1;
    }
  });

  // Combinar y construir resultado
  var allTeams = {};
  Object.keys(statsMap).forEach(function(eq) { allTeams[eq] = true; });
  Object.keys(wdlMap).forEach(function(eq)   { allTeams[eq] = true; });

  var result = Object.keys(allTeams).map(function(equipo) {
    var s   = statsMap[equipo] || { posesion_sum:0, posesion_n:0, tiros:0, tiros_arco:0, corners:0, faltas:0, amarillas:0, rojas:0 };
    var w   = wdlMap[equipo]  || { pj:0, pg:0, pe:0, pp:0, gf:0, ga:0 };
    return {
      equipo:       equipo,
      pj:           w.pj,
      pg:           w.pg,
      pe:           w.pe,
      pp:           w.pp,
      gf:           w.gf,
      ga:           w.ga,
      gd:           w.gf - w.ga,
      posesion_avg: s.posesion_n > 0 ? Math.round(s.posesion_sum / s.posesion_n) : 0,
      tiros:        s.tiros,
      tiros_arco:   s.tiros_arco,
      corners:      s.corners,
      faltas:       s.faltas,
      amarillas:    s.amarillas,
      rojas:        s.rojas
    };
  });

  result.sort(function(a, b) { return b.gf - a.gf || b.pg - a.pg; });
  return result;
}

// ─── Tab: arbitros ────────────────────────────────────────────────────────────

function getWebArbitros_() {
  try {
    const rows = readAll_(CONFIG.SHEETS.ARBITROS);
    if (!rows.length) return [];

    // Agrupar por árbitro
    const byRef = {};
    rows.forEach(r => {
      const nombre = r.nombre || '';
      if (!nombre) return;
      if (!byRef[nombre]) {
        byRef[nombre] = {
          nombre,
          nacionalidad:  r.nacionalidad  || '',
          confederacion: r.confederacion || '',
          partidos: [], amarillas: 0, rojas: 0, penales: 0
        };
      }
      byRef[nombre].partidos.push({
        fecha:           r.fecha           || '',
        local:           teamNameToSpanish_(r.equipo_local    || ''),
        visitante:       teamNameToSpanish_(r.equipo_visitante|| ''),
        amarillas:       Number(r.amarillas || 0),
        rojas:           Number(r.rojas     || 0),
        penales:         Number(r.penales   || 0)
      });
      byRef[nombre].amarillas += Number(r.amarillas || 0);
      byRef[nombre].rojas     += Number(r.rojas     || 0);
      byRef[nombre].penales   += Number(r.penales   || 0);
    });

    return Object.values(byRef).map(ref => {
      const pj = ref.partidos.length;
      const amarillasPP = pj ? (ref.amarillas / pj) : 0;
      return {
        nombre:        ref.nombre,
        nacionalidad:  ref.nacionalidad,
        confederacion: ref.confederacion,
        pj,
        amarillas:     ref.amarillas,
        rojas:         ref.rojas,
        penales:       ref.penales,
        amarillas_pp:  Number(amarillasPP.toFixed(1)),
        tendencia:     amarillasPP >= 4.5 ? 'ESTRICTO' : amarillasPP <= 2.5 ? 'PERMISIVO' : 'NORMAL',
        partidos:      ref.partidos.slice(-5) // últimos 5
      };
    }).sort((a, b) => b.pj - a.pj);
  } catch(e) {
    return { error: e.message };
  }
}

// ─── Tab: calibracion ────────────────────────────────────────────────────────

function getWebCalibrationData_() {
  // 1. Bucket calibration desde AnalisisIA + Partidos
  let pairs = [];
  try {
    const aiRows    = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    const matchRows = readAll_(CONFIG.SHEETS.PARTIDOS);
    aiRows.forEach(ai => {
      if (!ai.prob_local) return;
      const match = matchRows.find(m => String(m.fixture_id_af||'') === String(ai.fixture_id));
      if (!match || !isFinishedStatus_(match.status)) return;
      const gH = Number(match.goles_local ?? -1), gA = Number(match.goles_visitante ?? -1);
      if (gH < 0 || gA < 0) return;
      const pH = Number(ai.prob_local||0), pD = Number(ai.prob_empate||0), pA = Number(ai.prob_visitante||0);
      pairs.push({ prob: pH, ocurrió: gH > gA ? 1 : 0 });
      pairs.push({ prob: pD, ocurrió: gH === gA ? 1 : 0 });
      pairs.push({ prob: pA, ocurrió: gH < gA ? 1 : 0 });
    });
  } catch(e_) {}

  const limits = [0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.01];
  const buckets = [];
  for (let i = 0; i < limits.length - 1; i++) {
    const lo = limits[i], hi = limits[i + 1];
    const inB = pairs.filter(p => p.prob >= lo && p.prob < hi);
    if (!inB.length) continue;
    const midpoint = (lo + hi) / 2;
    const realRate = inB.filter(p => p.ocurrió).length / inB.length;
    buckets.push({
      label:    `${Math.round(lo*100)}–${Math.round(hi*100)}%`,
      midpoint: midpoint,
      real:     realRate,
      n:        inB.length,
      bias:     realRate - midpoint
    });
  }

  // 2. ROI por rango EV desde EvHistorico
  let evRoiBuckets = [];
  try {
    const hist = readAll_(CONFIG.SHEETS.EV_HISTORICO)
      .filter(r => r.resultado === 'WIN' || r.resultado === 'LOSS');
    const evBands = [
      { label:'EV<0%',  lo:-1,   hi:0    },
      { label:'0–5%',   lo:0,    hi:0.05 },
      { label:'5–10%',  lo:0.05, hi:0.10 },
      { label:'10–20%', lo:0.10, hi:0.20 },
      { label:'20%+',   lo:0.20, hi:99   }
    ];
    evBands.forEach(band => {
      const inB = hist.filter(r => Number(r.ev||0) >= band.lo && Number(r.ev||0) < band.hi);
      if (!inB.length) { evRoiBuckets.push({ label: band.label, roi: null, n: 0 }); return; }
      const totalStake = inB.length; // stake = 1 por pick
      const totalPnl   = inB.reduce((s, r) => s + Number(r.pnl || 0), 0);
      evRoiBuckets.push({ label: band.label, roi: totalPnl / totalStake, n: inB.length });
    });
  } catch(e_) {}

  // 3. Brier Score más reciente
  let brierLast = null;
  try {
    const calRows = readAll_(CONFIG.SHEETS.MODEL_CALIBRATION);
    if (calRows.length) brierLast = calRows[calRows.length - 1];
  } catch(e_) {}

  return { buckets, evRoiBuckets, brierLast };
}

// ─── Tab: bankroll ────────────────────────────────────────────────────────────

function getWebBankrollSim_() {
  let hist;
  try { hist = readAll_(CONFIG.SHEETS.EV_HISTORICO); } catch(e) { return { picks: [], strategies: [] }; }

  // Solo picks EV+ resueltos, ordenados por fecha
  const picks = hist
    .filter(r => Number(r.ev||0) > 0 && (r.resultado === 'WIN' || r.resultado === 'LOSS'))
    .sort((a, b) => String(a.timestamp||'').localeCompare(String(b.timestamp||'')));

  if (!picks.length) return { picks: [], strategies: [] };

  // Simular 3 estrategias: flat, kelly_25, kelly_50
  const strategies = [
    { id: 'flat',     label: 'Flat (1u)',     bankroll: 100, points: [] },
    { id: 'kelly_25', label: 'Kelly 25%',     bankroll: 100, points: [] },
    { id: 'kelly_50', label: 'Kelly 50%',     bankroll: 100, points: [] }
  ];

  picks.forEach(p => {
    const pnlUnit = Number(p.pnl || 0); // ganancia/pérdida en unidades de 1
    const kelly   = Math.max(0, Math.min(Number(p.kelly || 0), 0.25));
    const cuota   = Number(p.cuota || 1);

    strategies.forEach(st => {
      let stake, pnl;
      if (st.id === 'flat') {
        stake = 1;
      } else if (st.id === 'kelly_25') {
        stake = Math.max(0.1, st.bankroll * kelly * 0.25);
      } else {
        stake = Math.max(0.1, st.bankroll * kelly * 0.50);
      }
      pnl = p.resultado === 'WIN' ? stake * (cuota - 1) : -stake;
      st.bankroll = Math.max(0, st.bankroll + pnl);
      st.points.push(Math.round(st.bankroll * 100) / 100);
    });
  });

  return {
    n:          picks.length,
    labels:     picks.map(p => `${p.local?.substring(0,3)||''}vs${p.visitante?.substring(0,3)||''}`),
    strategies: strategies.map(st => ({ id: st.id, label: st.label, final: st.bankroll, points: st.points }))
  };
}
