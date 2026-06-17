/**
 * SofaScoreApi.gs
 *
 * Integración con la API pública no oficial de SofaScore.
 * Provee datos avanzados no disponibles en ESPN ni API-Football:
 *   - Shot map con coordenadas (x, y) → xG calculado
 *   - Posesión por tercio de cancha (defensa/medio/ataque)
 *   - Mapa de presión (pressing zones)
 *   - Precisión de pases por zona
 *   - Rating y toques por jugador
 *
 * Sin autenticación, sin cuota conocida. Cache 4h en CacheService.
 *
 * Fuente de match ID: buscador por equipos + fecha.
 * Los IDs se guardan en Partidos (columna sofascore_id) para reutilizar.
 *
 * Resumen de disponibilidad (verificado 2026-06):
 *   ✅ Shotmap con coords x/y + xGOT (xG on target)
 *   ✅ Statistics (posesión por tercio, pases, duelos, presión)
 *   ✅ Incidents (goles, tarjetas, sustituciones con minuto)
 *   ✅ Momentum (gráfico de presión por tramo de 5min)
 *   ❌ Heat maps por jugador (estructura de imagen, no JSON de coords)
 *   ❌ Ball tracking raw (propietario FIFA/Hawk-Eye, no público)
 */

const SOFA_BASE = 'https://api.sofascore.com/api/v1';
const SOFA_CACHE_TTL = 4 * 60 * 60; // 4 horas en segundos

// SofaScore bloquea requests desde Google Apps Script con HTTP 403.
// Deshabilitado hasta que haya un proxy o método alternativo.
const SOFASCORE_ENABLED = false;

// ─── Fetch con cache ─────────────────────────────────────────────────────────

function sofaGet_(path) {
  if (!SOFASCORE_ENABLED) throw new Error('SofaScore deshabilitado (HTTP 403 desde GAS)');
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'sofa_' + path.replace(/[^a-z0-9]/gi, '_').substring(0, 240);
  const cached   = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e_) {}
  }

  const response = UrlFetchApp.fetch(SOFA_BASE + path, {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.sofascore.com/'
    }
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`SofaScore ${path} → HTTP ${response.getResponseCode()}`);
  }

  const data = JSON.parse(response.getContentText());
  try { cache.put(cacheKey, JSON.stringify(data), SOFA_CACHE_TTL); } catch (e_) {}
  return data;
}

// ─── Búsqueda de ID por equipos + fecha ─────────────────────────────────────

/**
 * Busca el SofaScore event ID dado dos equipos y una fecha.
 * Guarda el ID en la columna sofascore_id de Partidos para no repetir la búsqueda.
 *
 * @param {string} homeTeam - nombre en cualquier idioma
 * @param {string} awayTeam
 * @param {string} date     - 'yyyy-MM-dd'
 * @returns {string|null}
 */
function findSofaScoreEventId_(homeTeam, awayTeam, date) {
  // 1. Buscar en hoja Partidos si ya está guardado
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const normN    = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
  const qH = normN(homeTeam), qA = normN(awayTeam);

  const row = partidos.find(r => {
    const h = normN(r.local||''), a = normN(r.visitante||'');
    const f = normalizeFecha_(r.fecha);
    const dateMatch = f === date || Math.abs(new Date(f) - new Date(date)) < 86400000 * 2;
    return dateMatch && ((h.includes(qH)||qH.includes(h)) && (a.includes(qA)||qA.includes(a)) ||
                        (h.includes(qA)||qA.includes(h)) && (a.includes(qH)||qH.includes(a)));
  });

  if (row && row.sofascore_id) return String(row.sofascore_id);

  // 2. Buscar en SofaScore por fecha
  try {
    const data   = sofaGet_(`/sport/football/scheduled-events/${date}`);
    const events = data.events || [];
    for (const ev of events) {
      const hN = normN((ev.homeTeam || {}).name || '');
      const aN = normN((ev.awayTeam || {}).name || '');
      const match = (hN.includes(qH) || qH.includes(hN)) && (aN.includes(qA) || qA.includes(aN));
      const matchRev = (hN.includes(qA) || qA.includes(hN)) && (aN.includes(qH) || qH.includes(aN));
      if (match || matchRev) {
        const sofaId = String(ev.id);
        // Guardar en Partidos si encontramos el row
        if (row) _saveSofaIdToSheet_(row.match_key, sofaId);
        return sofaId;
      }
    }
  } catch (e) {
    console.warn(`findSofaScoreEventId_ ${homeTeam} vs ${awayTeam}: ${e.message}`);
  }
  return null;
}

function _saveSofaIdToSheet_(matchKey, sofaId) {
  if (!matchKey || !sofaId) return;
  try {
    const sheet   = getSheet_(CONFIG.SHEETS.PARTIDOS);
    const values  = sheet.getDataRange().getValues();
    const headers = values[0];
    const mkIdx   = headers.indexOf('match_key');
    let sofaIdx   = headers.indexOf('sofascore_id');

    // Agregar columna sofascore_id si no existe
    if (sofaIdx === -1) {
      sofaIdx = headers.length;
      sheet.getRange(1, sofaIdx + 1).setValue('sofascore_id');
    }

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][mkIdx]) === String(matchKey)) {
        sheet.getRange(i + 1, sofaIdx + 1).setValue(sofaId);
        break;
      }
    }
  } catch (e_) { console.warn('saveSofaId:', e_.message); }
}

// ─── Shot Map + xG ───────────────────────────────────────────────────────────

/**
 * Obtiene el shot map de un evento SofaScore.
 * Devuelve array de disparos con coordenadas y xG calculado.
 *
 * Coordenadas SofaScore: x=0 (propia portería) a 100 (portería rival), y=0 a 100 (ancho)
 *
 * @param {string} sofaId
 * @returns {{ home: Shot[], away: Shot[] }}
 */
function fetchSofaShotmap_(sofaId) {
  const data = sofaGet_(`/event/${sofaId}/shotmap`);
  const shots = (data.shotmap || []).map(s => ({
    playerId:  s.player ? s.player.id : null,
    playerName: s.player ? s.player.name : '',
    teamSide:  s.isHome ? 'home' : 'away',
    x:         s.playerCoordinates ? s.playerCoordinates.x : (s.draw ? s.draw.x : null),
    y:         s.playerCoordinates ? s.playerCoordinates.y : (s.draw ? s.draw.y : null),
    xgot:      s.xGOT  || s.expectedGoals || 0,   // xG on target de SofaScore
    xg:        s.xG    || calculateXg_(s.playerCoordinates || {}),
    outcome:   s.shotType || s.goalType || '',     // 'goal','save','miss','blocked'
    minute:    s.time  || s.minute || 0,
    bodyPart:  s.bodyPart || ''
  }));

  return {
    home: shots.filter(s => s.teamSide === 'home'),
    away: shots.filter(s => s.teamSide === 'away')
  };
}

/**
 * Calcula xG básico a partir de coordenadas si SofaScore no lo provee.
 * Modelo logístico simplificado basado en distancia y ángulo a portería.
 * Parámetros derivados de investigación pública (Power et al., 2017).
 */
function calculateXg_(coords) {
  if (!coords || coords.x == null || coords.y == null) return null;
  // Convertir a metros (cancha estándar 105x68m, coords 0-100)
  const dx = (100 - coords.x) * 1.05;   // distancia horizontal a portería
  const dy = (coords.y - 50) * 0.68;    // desplazamiento lateral al centro
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return 0.8;
  // Ángulo al arco (ancho arco = 7.32m)
  const angle = Math.atan2(7.32, distance) * (180 / Math.PI);
  // Regresión logística simplificada
  const logit = -0.0590 * distance + 0.0813 * angle - 2.04;
  return Math.round((1 / (1 + Math.exp(-logit))) * 100) / 100;
}

// ─── Estadísticas avanzadas ──────────────────────────────────────────────────

/**
 * Obtiene estadísticas completas del partido desde SofaScore.
 * Incluye posesión por tercio, presión, pases por zona.
 *
 * @param {string} sofaId
 * @returns {{ home: AdvStats, away: AdvStats }|null}
 */
function fetchSofaAdvancedStats_(sofaId) {
  try {
    const data  = sofaGet_(`/event/${sofaId}/statistics`);
    const stats = data.statistics || [];

    const extract = (period) => {
      const groups = stats.filter(s => !period || s.period === period);
      const result = {};
      groups.forEach(group => {
        (group.statisticsItems || group.groups || []).forEach(item => {
          // Cada item tiene key, homeValue, awayValue
          if (item.key) {
            result[item.key] = { home: item.homeValue, away: item.awayValue };
          }
          // Algunos tienen statisticsItems anidados
          (item.statisticsItems || []).forEach(sub => {
            if (sub.key) result[sub.key] = { home: sub.homeValue, away: sub.awayValue };
          });
        });
      });
      return result;
    };

    const raw = extract('ALL'); // periodo completo

    const get = (key, side) => {
      const v = raw[key];
      if (!v) return null;
      const val = v[side];
      return val !== undefined ? val : null;
    };

    const buildSide = (side) => ({
      // Posesión por tercio (clave del torneo: territorial dominance)
      posesion_tercio_defensa: get('defenseTerritory', side),
      posesion_tercio_medio:   get('middleTerritory', side),
      posesion_tercio_ataque:  get('attackTerritory', side),
      posesion_total:          get('possessionPercent', side) || get('ballPossession', side),

      // Presión (pressing)
      recuperaciones:          get('ballRecovery', side) || get('ballRecoveries', side),
      duelos_ganados:          get('groundDuelsWon', side),
      duelos_aereos:           get('aerialDuelsWon', side),
      tackles_exitosos:        get('successfulDribbles', side),

      // Pases y creación
      pases_totales:           get('totalPasses', side) || get('passes', side),
      pases_precisos:          get('accuratePasses', side),
      pases_largos:            get('longBalls', side),
      pases_clave:             get('keyPasses', side),
      centros:                 get('crosses', side),
      centros_precisos:        get('accurateCrosses', side),

      // Tiros
      tiros_totales:           get('shotsTotal', side) || get('shots', side),
      tiros_arco:              get('shotsOnTarget', side),
      grandes_oportunidades:   get('bigChanceCreated', side),
      grandes_falladas:        get('bigChanceMissed', side),

      // Presión compuesta (counter-press)
      presion_exitos:          get('counterPressureSuccessPercent', side),
    });

    return { home: buildSide('home'), away: buildSide('away'), raw };
  } catch (e) {
    console.warn(`fetchSofaAdvancedStats_ ${sofaId}:`, e.message);
    return null;
  }
}

/**
 * Obtiene el momentum del partido (presión por tramo de 5 min).
 * Refleja qué equipo dominó cada período del partido.
 * @returns {{ home: number[], away: number[] }} — arrays de 18 valores (90 min / 5min)
 */
function fetchSofaMomentum_(sofaId) {
  try {
    const data   = sofaGet_(`/event/${sofaId}/graph`);
    const points = data.graphPoints || [];
    return {
      home: points.map(p => Math.max(0, p.value)),
      away: points.map(p => Math.max(0, -p.value))
    };
  } catch (e) { return null; }
}

// ─── Datos completos de un partido para IA ───────────────────────────────────

/**
 * Punto de entrada principal: obtiene todos los datos SofaScore de un partido
 * y los devuelve en un objeto estructurado listo para el pipeline de IA.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} date        'yyyy-MM-dd'
 * @param {string} [sofaIdOverride]
 * @returns {SofaMatchData|null}
 */
function fetchSofaMatchData_(homeTeam, awayTeam, date, sofaIdOverride) {
  const sofaId = sofaIdOverride || findSofaScoreEventId_(homeTeam, awayTeam, date);
  if (!sofaId) {
    console.warn(`SofaScore: no se encontró ID para ${homeTeam} vs ${awayTeam} ${date}`);
    return null;
  }

  const shotmap = fetchSofaShotmap_(sofaId);
  const stats   = fetchSofaAdvancedStats_(sofaId);
  const momentum = fetchSofaMomentum_(sofaId);

  return {
    sofascore_id: sofaId,
    shotmap,
    stats,
    momentum,
    metrics: deriveSofaMetrics_(shotmap, stats, momentum)
  };
}

/**
 * Deriva métricas de alto nivel a partir de los datos crudos SofaScore.
 * Estas son las que va a consumir el prompt de IA.
 */
function deriveSofaMetrics_(shotmap, stats, momentum) {
  const metrics = {};

  if (shotmap) {
    ['home','away'].forEach(side => {
      const shots = shotmap[side] || [];
      const goals = shots.filter(s => (s.outcome||'').toLowerCase().includes('goal'));
      const xgSum = shots.reduce((acc, s) => acc + (Number(s.xg) || 0), 0);
      const xgotSum = shots.reduce((acc, s) => acc + (Number(s.xgot) || 0), 0);
      const shotsInBox = shots.filter(s => s.x != null && s.x > 83); // último 17% = área

      metrics[`xg_${side}`]             = Math.round(xgSum * 100) / 100;
      metrics[`xgot_${side}`]           = Math.round(xgotSum * 100) / 100;
      metrics[`tiros_${side}`]          = shots.length;
      metrics[`tiros_arco_${side}`]     = shots.filter(s => (s.outcome||'').includes('save') || (s.outcome||'').includes('goal')).length;
      metrics[`tiros_area_${side}`]     = shotsInBox.length;
      metrics[`conversion_${side}`]     = shots.length ? Math.round((goals.length / shots.length) * 100) : 0;
      metrics[`xg_difference_${side}`] = null; // se calcula abajo
    });

    // Diferencial xG: clave para evaluar mérito real
    metrics.xg_home_vs_away = (metrics.xg_home || 0) - (metrics.xg_away || 0);
    metrics.xg_dominance    = metrics.xg_home > metrics.xg_away ? 'home' : metrics.xg_away > metrics.xg_home ? 'away' : 'equal';
  }

  if (stats) {
    ['home','away'].forEach(side => {
      const s = stats[side] || {};
      metrics[`dominio_ataque_${side}`]  = s.posesion_tercio_ataque;
      metrics[`dominio_defensa_${side}`] = s.posesion_tercio_defensa;
      metrics[`oportunidades_${side}`]   = s.grandes_oportunidades;
      metrics[`oport_falladas_${side}`]  = s.grandes_falladas;
      metrics[`pases_clave_${side}`]     = s.pases_clave;
    });
  }

  if (momentum && momentum.home) {
    // % de minutos en que el equipo dominó (valor positivo de momentum)
    const total = momentum.home.length;
    metrics.momentum_home_pct = total ? Math.round((momentum.home.filter(v => v > 2).length / total) * 100) : null;
    metrics.momentum_away_pct = total ? Math.round((momentum.away.filter(v => v > 2).length / total) * 100) : null;
  }

  return metrics;
}

// ─── Guardado en hoja SofaStats ──────────────────────────────────────────────

/**
 * Guarda métricas SofaScore en hoja dedicada después de un partido.
 * Llamado desde cronPostMatch y backfill.
 */
function saveSofaDataForMatch_(homeTeam, awayTeam, date, matchKey) {
  const data = fetchSofaMatchData_(homeTeam, awayTeam, date);
  if (!data) return;

  const m  = data.metrics || {};
  const sh = (data.stats || {}).home || {};
  const sa = (data.stats || {}).away || {};

  const sheetName = 'SofaStats';
  const row = [
    matchKey, data.sofascore_id, date, homeTeam, awayTeam,
    m.xg_home, m.xg_away, m.xgot_home, m.xgot_away,
    m.tiros_home, m.tiros_away, m.tiros_arco_home, m.tiros_arco_away,
    m.tiros_area_home, m.tiros_area_away,
    m.conversion_home, m.conversion_away,
    m.xg_home_vs_away, m.xg_dominance,
    sh.posesion_tercio_ataque, sa.posesion_tercio_ataque,
    sh.posesion_tercio_defensa, sa.posesion_tercio_defensa,
    sh.grandes_oportunidades, sa.grandes_oportunidades,
    sh.grandes_falladas, sa.grandes_falladas,
    sh.pases_clave, sa.pases_clave,
    sh.duelos_ganados, sa.duelos_ganados,
    m.momentum_home_pct, m.momentum_away_pct,
    nowChile_()
  ];

  // Upsert por match_key
  const sheet  = getOrCreateSheet_(sheetName, [
    'match_key','sofascore_id','fecha','local','visitante',
    'xg_home','xg_away','xgot_home','xgot_away',
    'tiros_home','tiros_away','tiros_arco_home','tiros_arco_away',
    'tiros_area_home','tiros_area_away',
    'conversion_home','conversion_away',
    'xg_diferencia','xg_dominancia',
    'posesion_ataque_home','posesion_ataque_away',
    'posesion_defensa_home','posesion_defensa_away',
    'grandes_oport_home','grandes_oport_away',
    'grandes_falladas_home','grandes_falladas_away',
    'pases_clave_home','pases_clave_away',
    'duelos_home','duelos_away',
    'momentum_home_pct','momentum_away_pct',
    'updated_at'
  ]);

  const values   = sheet.getDataRange().getValues();
  const mkIdx    = values[0].indexOf('match_key');
  const existing = values.slice(1).findIndex(r => r[mkIdx] === matchKey);

  if (existing >= 0) {
    sheet.getRange(existing + 2, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  Logger.log(`SofaStats guardado: ${matchKey}`);
}

// ─── Contexto para IA ─────────────────────────────────────────────────────────

/**
 * Construye el contexto SofaScore para el prompt de IA.
 * Lee los últimos N partidos del equipo y calcula promedios de xG,
 * posesión por zona, y momentum para detectar tendencias.
 *
 * @param {string} teamName
 * @param {number} [lastN=5]
 * @returns {Object}
 */
function buildSofaTeamContext_(teamName, lastN) {
  lastN = lastN || 5;
  const normN = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
  const qN    = normN(teamName);

  let sofaRows = [];
  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName('SofaStats');
    if (sheet) {
      sofaRows = readAll_('SofaStats').filter(r =>
        normN(r.local||'').includes(qN) || normN(r.visitante||'').includes(qN)
      ).slice(-lastN);
    }
  } catch (e_) {}

  if (!sofaRows.length) return null;

  const avg = (key) => {
    const vals = sofaRows.map(r => parseFloat(r[key]||'')).filter(v => !isNaN(v));
    return vals.length ? Math.round((vals.reduce((a,b) => a+b, 0) / vals.length) * 100) / 100 : null;
  };

  const isHome = r => normN(r.local||'').includes(qN);

  const xg_prom = sofaRows.map(r => parseFloat(isHome(r) ? r.xg_home : r.xg_away)||0);
  const xg_against = sofaRows.map(r => parseFloat(isHome(r) ? r.xg_away : r.xg_home)||0);

  return {
    equipo:              teamName,
    partidos_analizados: sofaRows.length,
    xg_promedio_favor:   Math.round((xg_prom.reduce((a,b)=>a+b,0)/xg_prom.length)*100)/100,
    xg_promedio_contra:  Math.round((xg_against.reduce((a,b)=>a+b,0)/xg_against.length)*100)/100,
    grandes_oport_prom:  avg('grandes_oport_home'), // simplificado, mejorar por lado
    pases_clave_prom:    avg('pases_clave_home'),
    momentum_prom:       avg('momentum_home_pct'),
    tendencia_territorial: sofaRows.slice(-3).map(r =>
      isHome(r) ? r.posesion_ataque_home : r.posesion_ataque_away
    ).filter(Boolean)
  };
}

// ─── Backfill manual ─────────────────────────────────────────────────────────

/**
 * Función de ejecución manual: carga métricas SofaScore para todos los
 * partidos FT de la hoja Partidos que aún no tienen datos en SofaStats.
 *
 * Ejecutar desde Apps Script Editor cuando se quiere poblar datos históricos.
 * Respeta un sleep de 2s entre llamadas para no saturar SofaScore.
 */
function backfillSofaStats() {
  if (!SOFASCORE_ENABLED) {
    Logger.log('backfillSofaStats: SofaScore deshabilitado (HTTP 403). Usa backfillEspnHistorical() para stats históricas via ESPN.');
    return;
  }
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => String(r.status || '').toUpperCase() === 'FT');

  let existentes = new Set();
  try {
    existentes = new Set(readAll_('SofaStats').map(r => r.match_key).filter(Boolean));
  } catch (e_) {}

  const pendientes = partidos.filter(r => r.match_key && !existentes.has(r.match_key));
  Logger.log(`backfillSofaStats: ${pendientes.length} partidos pendientes de ${partidos.length} totales FT`);

  let ok = 0, fail = 0;
  pendientes.forEach((r, i) => {
    try {
      const fecha = normalizeFecha_(r.fecha);
      saveSofaDataForMatch_(r.local, r.visitante, fecha, r.match_key);
      ok++;
      Logger.log(`✅ ${i+1}/${pendientes.length} ${r.match_key}`);
    } catch (e) {
      fail++;
      console.warn(`❌ ${r.match_key}: ${e.message}`);
    }
    Utilities.sleep(2000);
  });

  Logger.log(`backfillSofaStats: ${ok} ok, ${fail} fallidos`);
}
