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
      case 'players':     data = getWebPlayers_();      break;
      case 'match':       data = getWebMatch_(e);       break;
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
    hora:         formatHoraChile_(r.hora_chile || r.hora),
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
      hora:       formatHoraChile_(r.hora_chile || r.hora),
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

// Convierte un valor hora de Google Sheets (Date object o string ISO) a "HH:mm" en hora Chile.
// Sheets serializa time-only como 1899-12-30T{UTC_hora}.000Z — la hora en UTC hay que convertirla.
function formatHoraChile_(val) {
  if (!val) return '';
  // Ya es "HH:mm" limpio → devolver directo
  if (typeof val === 'string' && /^\d{1,2}:\d{2}$/.test(val.trim())) return val.trim();

  // Extraer HH:MM desde ISO string o Date → siempre vía UTC hours para evitar bugs con 1899
  const s = (val instanceof Date) ? val.toISOString() : String(val);
  const m = s.match(/T(\d{2}):(\d{2})/);
  if (!m) return s.substring(0, 5);

  // Reconstruir con fecha de hoy para aplicar offset Chile correctamente
  const todayStr = todayChile_();
  const d = new Date(todayStr + 'T' + m[1] + ':' + m[2] + ':00Z');
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'HH:mm');
}

// ─── Tab: hoy ────────────────────────────────────────────────────────────────

function getWebHoy_() {
  const date     = todayChile_();
  const partidos = getTodayFixturesForReport_(date);

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
    .sort((a, b) => (a.hora_chile || '').localeCompare(b.hora_chile || ''));

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
  const norm = p => ({
    local:           teamNameToSpanish_(p.local),
    visitante:       teamNameToSpanish_(p.visitante),
    goles_local:     p.goles_local     !== undefined && p.goles_local     !== '' ? p.goles_local     : null,
    goles_visitante: p.goles_visitante !== undefined && p.goles_visitante !== '' ? p.goles_visitante : null,
    status:          p.status  || 'NS',
    minuto:          p.minuto  || '',
    hora_chile:      formatHoraChile_(p.hora_chile),
    grupo:           p.grupo   || '',
    ronda:           p.ronda   || '',
    estadio:         p.estadio || '',
    ciudad:          p.ciudad  || '',
    match_key:       p.match_key || ''
  });

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
  const liveMatches = partidos.filter(r =>
    liveStatuses.includes(String(r.status || '').toUpperCase())
  );

  const eventos = readAll_(CONFIG.SHEETS.EVENTOS_LIVE);

  return liveMatches.map(m => {
    const fid = String(m.fixture_id_af || m.fixture_id_fd || m.espn_id || '');
    const matchKey = m.match_key || '';

    const evs = eventos
      .filter(e => String(e.fixture_id || '') === fid || (fid === '' && String(e.fixture_id || '').includes(matchKey)))
      .sort((a, b) => Number(a.minuto || 0) - Number(b.minuto || 0))
      .map(e => ({
        minuto:   Number(e.minuto || 0),
        extra:    Number(e.minuto_extra || 0),
        tipo:     e.tipo     || '',
        detalle:  e.detalle  || '',
        equipo:   teamNameToSpanish_(e.equipo   || ''),
        jugador:  e.jugador  || '',
        asistente: e.asistente || ''
      }));

    let statsRow = null;
    try {
      const espnStats = readAll_(CONFIG.SHEETS.ESPN_STATS);
      statsRow = espnStats.find(s => String(s.fixture_id || '') === fid) || null;
    } catch (e_) {}

    return {
      match_key:       matchKey,
      local:           teamNameToSpanish_(m.local     || ''),
      visitante:       teamNameToSpanish_(m.visitante || ''),
      goles_local:     m.goles_local     ?? null,
      goles_visitante: m.goles_visitante ?? null,
      status:          m.status || '',
      estadio:         m.estadio || '',
      grupo:           m.grupo   || '',
      ronda:           m.ronda   || '',
      eventos:         evs,
      stats: statsRow ? {
        posesion_local:    Number(statsRow.posesion_local    || 0),
        posesion_visitante:Number(statsRow.posesion_visitante|| 0),
        tiros_local:       Number(statsRow.tiros_local       || 0),
        tiros_visitante:   Number(statsRow.tiros_visitante   || 0),
        tiros_arco_local:  Number(statsRow.tiros_arco_local  || 0),
        tiros_arco_visitante: Number(statsRow.tiros_arco_visitante || 0),
        corners_local:     Number(statsRow.corners_local     || 0),
        corners_visitante: Number(statsRow.corners_visitante || 0),
        amarillas_local:   Number(statsRow.amarillas_local   || 0),
        amarillas_visitante:Number(statsRow.amarillas_visitante||0),
        rojas_local:       Number(statsRow.rojas_local       || 0),
        rojas_visitante:   Number(statsRow.rojas_visitante   || 0)
      } : null
    };
  });
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
    hora:            formatHoraChile_(m.hora_chile || m.hora),
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

  const eloMap   = {};
  elo.forEach(r => { eloMap[String(r.equipo || '').toLowerCase()] = Number(r.elo_actual || r.elo || 0); });

  const formaMap = {};
  forma.forEach(r => { formaMap[String(r.equipo || '').toLowerCase()] = r.ultimos_5_resultados || ''; });

  const clasMap = {};
  clas.forEach(r => {
    const k = String(r.equipo || '').toLowerCase();
    clasMap[k] = { grupo: r.grupo || '', pos: Number(r.posicion || r.pos || 0), pts: Number(r.puntos || r.pts || 0) };
  });

  return equipos.map(eq => {
    const nombre = teamNameToSpanish_(eq.nombre || eq.name || eq.equipo || '');
    const k = nombre.toLowerCase();
    return {
      nombre,
      grupo:       eq.grupo || (clasMap[k] ? clasMap[k].grupo : ''),
      pos:         clasMap[k] ? clasMap[k].pos : 0,
      pts:         clasMap[k] ? clasMap[k].pts : 0,
      elo:         eloMap[k] || 0,
      forma:       formaMap[k] || '',
      confederacion: eq.confederacion || eq.confederation || '',
      entrenador:  eq.entrenador || eq.coach || '',
      espn_id:     eq.espn_id || ''
    };
  }).filter(eq => eq.nombre).sort((a, b) => (b.elo || 0) - (a.elo || 0));
}

// ─── Tab: players ────────────────────────────────────────────────────────────

function getWebPlayers_() {
  // Top goleadores y estadísticas desde ResumenJugadorPartido (agrupado por jugador)
  const resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

  // Dedup: fixture_id + jugador_id → keep latest by timestamp_carga
  const dedupMap = {};
  resumen.forEach(r => {
    const fid = r.fixture_id || r.match_id || '';
    const pid = r.jugador_id || '';
    if (!fid || !pid) return;
    const k = `${fid}_${pid}`;
    const ts = r.timestamp_carga || r.updated_at || '';
    if (!dedupMap[k] || String(ts) > String(dedupMap[k].timestamp_carga || '')) {
      dedupMap[k] = r;
    }
  });
  const deduped = Object.values(dedupMap);

  const byPlayer = {};
  deduped.forEach(r => {
    const name = r.jugador || '';
    if (!name) return;
    if (!byPlayer[name]) {
      byPlayer[name] = {
        jugador:     name,
        equipo:      teamNameToSpanish_(r.equipo || ''),
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

  // Si no hay resumen, intentar con PlayerMatchStats
  if (!Object.keys(byPlayer).length) {
    const pms = readAll_(CONFIG.SHEETS.PLAYER_MATCH_STATS);
    pms.forEach(r => {
      const name = r.player_name || '';
      if (!name) return;
      if (!byPlayer[name]) {
        byPlayer[name] = {
          jugador:     name,
          equipo:      teamNameToSpanish_(r.team_name || ''),
          goles:       0,
          asistencias: 0,
          amarillas:   0,
          rojas:       0,
          minutos:     0,
          partidos:    0
        };
      }
      const p = byPlayer[name];
      p.goles       += Number(r.goals_scored || 0);
      p.asistencias += Number(r.assists      || 0);
      p.amarillas   += Number(r.yellow_cards || 0);
      p.rojas       += Number(r.red_cards    || 0);
      p.minutos     += Number(r.minutes_played || 0);
      p.partidos    += 1;
    });
  }

  return Object.values(byPlayer)
    .sort((a, b) => b.goles - a.goles || b.asistencias - a.asistencias)
    .slice(0, 50);
}
