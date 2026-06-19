/**
 * GroupSimulator.gs
 *
 * Simula la probabilidad de clasificación de cada equipo en los grupos
 * usando Monte Carlo con probabilidades ELO.
 *
 * Hoja: SimulacionGrupos
 * Columnas: grupo, equipo, prob_clasificar, partidos_restantes, updated_at
 *
 * Funciones de entrada:
 *   runGroupSimulation()     — Actualiza la hoja SimulacionGrupos para todos los grupos
 *   buildGroupSimText_(grupo)— Texto para el comando /grupos [A-H]
 */

const SIM_RUNS            = 2000; // Reducir si hay timeout (mínimo recomendado: 500)
const SIM_CLASIFICAN      = 2;    // Equipos que clasifican por grupo (fase de grupos)
const SIM_HOJA            = 'SimulacionGrupos';
const SIM_DECISIVE_THRESH = 0.25; // Para ClassificationAlert

// ─── Simulación principal ─────────────────────────────────────────────────────

/**
 * Calcula P(clasificar) para todos los equipos con partidos pendientes.
 * Guarda/reemplaza en SimulacionGrupos.
 * Llamar desde cronEvCalculation() o manualmente.
 */
function runGroupSimulation() {
  let standings, fixtures;
  try {
    standings = readAll_(CONFIG.SHEETS.CLASIFICACION);
    fixtures  = readAll_(CONFIG.SHEETS.PARTIDOS);
  } catch (e) {
    Logger.log('runGroupSimulation: no hay datos de Clasificacion o Partidos. ' + e.message);
    return;
  }

  if (!standings.length) {
    Logger.log('runGroupSimulation: Clasificacion vacía — esperando datos de fase de grupos.');
    return;
  }

  const grupos = [...new Set(standings.map(r => r.grupo).filter(Boolean))].sort();
  const results = [];

  // Helper de normalización compartido
  const normPair = s => String(s||'').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');

  // Pre-construir set de pares de equipos que ya tienen resultado FT en la hoja.
  // Sirve para filtrar filas NS "fantasma" de partidos ya jugados que quedaron sin actualizar.
  const playedPairs = new Set();
  fixtures.filter(r => isFinishedStatus_(String(r.status || r.estado || '').toUpperCase()))
    .forEach(r => {
      const locEs = normPair(teamNameToSpanish_(r.local     || ''));
      const visEs = normPair(teamNameToSpanish_(r.visitante || ''));
      playedPairs.add([locEs, visEs].sort().join('_vs_'));
    });

  grupos.forEach(grupo => {
    const groupTeams = standings.filter(r => r.grupo === grupo);
    const normGrupo  = g => String(g||'').toLowerCase().replace(/grupo\s*/i,'').trim();
    const gNorm      = normGrupo(grupo);

    // 1. Buscar por columna 'grupo' (cuando está populada)
    let groupFixtures = fixtures.filter(r => {
      const rGrupo = normGrupo(r.grupo || r.group || '');
      return rGrupo === gNorm && !isFinishedStatus_(String(r.status || r.estado || ''));
    });

    // 2. Fallback: buscar por nombres de equipo del grupo cuando 'grupo' está vacío
    if (!groupFixtures.length) {
      const teamNorms = new Set(groupTeams.map(t => normPair(t.equipo || '')));
      groupFixtures = fixtures.filter(r => {
        if (isFinishedStatus_(String(r.status || r.estado || ''))) return false;
        const locEs = normPair(teamNameToSpanish_(r.local     || ''));
        const visEs = normPair(teamNameToSpanish_(r.visitante || ''));
        // Ambos equipos deben pertenecer al grupo
        return teamNorms.has(locEs) && teamNorms.has(visEs);
      });
    }

    // 3. Excluir filas NS "fantasma": partidos cuyo par ya tiene un resultado FT en otra fila.
    //    Causa: hoja pre-cargó 6 fixtures como NS, luego el partido se jugó y se agregó fila FT
    //    nueva → la fila NS original queda obsoleta pero sigue apareciendo como "pendiente".
    groupFixtures = groupFixtures.filter(r => {
      const locEs = normPair(teamNameToSpanish_(r.local     || ''));
      const visEs = normPair(teamNameToSpanish_(r.visitante || ''));
      return !playedPairs.has([locEs, visEs].sort().join('_vs_'));
    });

    // 4. Deduplicar pares idénticos (pueden existir 2 filas NS para el mismo partido futuro)
    {
      const seenPairs = new Map();
      groupFixtures.forEach(r => {
        const locEs = normPair(teamNameToSpanish_(r.local     || ''));
        const visEs = normPair(teamNameToSpanish_(r.visitante || ''));
        const key   = [locEs, visEs].sort().join('_vs_');
        if (!seenPairs.has(key)) seenPairs.set(key, r);
        else if (r.fixture_id_af && !seenPairs.get(key).fixture_id_af) seenPairs.set(key, r);
      });
      groupFixtures = [...seenPairs.values()];
    }

    if (!groupTeams.length) return;

    if (!groupFixtures.length) {
      // Grupo terminado: clasificación determinística
      const ranked = [...groupTeams].sort((a, b) => {
        const ptsDiff = Number(b.puntos || 0) - Number(a.puntos || 0);
        if (ptsDiff !== 0) return ptsDiff;
        const gdDiff  = Number(b.gd || 0) - Number(a.gd || 0);
        if (gdDiff  !== 0) return gdDiff;
        return Number(b.gf || 0) - Number(a.gf || 0);
      });

      ranked.forEach((t, i) => {
        results.push([grupo, t.equipo, i < SIM_CLASIFICAN ? '1.0000' : '0.0000', 0, nowChile_()]);
      });
      return;
    }

    Logger.log(`Simulando grupo ${grupo}: ${groupTeams.length} equipos, ${groupFixtures.length} partidos pendientes`);

    const simResult = simulateGroup_(groupTeams, groupFixtures);

    groupTeams.forEach(t => {
      const prob = simResult[t.equipo] || 0;
      results.push([grupo, t.equipo, prob.toFixed(4), groupFixtures.length, nowChile_()]);
    });
  });

  if (!results.length) {
    Logger.log('runGroupSimulation: sin resultados para guardar.');
    return;
  }

  // Reemplazar toda la hoja (upsert completo)
  const sheet = getOrCreateSheet_(SIM_HOJA,
    ['grupo', 'equipo', 'prob_clasificar', 'partidos_restantes', 'updated_at']
  );
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  sheet.getRange(2, 1, results.length, 5).setValues(results);
  Logger.log(`runGroupSimulation: ${results.length} filas actualizadas.`);
}

// ─── Motor de simulación ──────────────────────────────────────────────────────

/**
 * Simula SIM_RUNS veces los partidos pendientes de un grupo.
 * Usa getEloProbabilities_ para las probabilidades de cada partido.
 *
 * @param {Array} standings       Filas de Clasificacion del grupo
 * @param {Array} pendingFixtures Filas de Partidos pendientes del grupo
 * @returns {Object}  { equipo → prob_clasificar [0-1] }
 */
function simulateGroup_(standings, pendingFixtures) {
  const qualifyCount = {};
  standings.forEach(t => qualifyCount[t.equipo] = 0);

  // Pre-calcular probs ELO para cada partido (costoso solo si se hace fuera del loop)
  const fixtureProbs = pendingFixtures.map(fix => {
    let probs = { home: 0.4, draw: 0.25, away: 0.35 }; // fallback
    try {
      const p = getEloProbabilities_(fix.local, fix.visitante);
      if (p) probs = p;
    } catch (e_) { /* usar fallback */ }
    return { fix, probs };
  });

  for (let run = 0; run < SIM_RUNS; run++) {
    // Clonar estado actual del grupo
    const pts = {}, gd = {}, gf = {};
    standings.forEach(t => {
      pts[t.equipo] = Number(t.puntos || 0);
      gd[t.equipo]  = Number(t.gd    || 0);
      gf[t.equipo]  = Number(t.gf    || 0);
    });

    // Simular cada partido pendiente
    fixtureProbs.forEach(({ fix, probs }) => {
      const home = fix.local;
      const away = fix.visitante;
      const r    = Math.random();

      let goalsH, goalsA;

      if (r < probs.home) {
        // Victoria local
        goalsH = 1 + (Math.random() < 0.40 ? 1 : 0) + (Math.random() < 0.10 ? 1 : 0);
        goalsA = Math.random() < 0.30 ? 1 : 0;
        pts[home] = (pts[home] || 0) + 3;
      } else if (r < probs.home + probs.draw) {
        // Empate
        const g = Math.random() < 0.45 ? 1 : 0;
        goalsH = g; goalsA = g;
        pts[home] = (pts[home] || 0) + 1;
        pts[away] = (pts[away] || 0) + 1;
      } else {
        // Victoria visitante
        goalsH = Math.random() < 0.30 ? 1 : 0;
        goalsA = 1 + (Math.random() < 0.40 ? 1 : 0) + (Math.random() < 0.10 ? 1 : 0);
        pts[away] = (pts[away] || 0) + 3;
      }

      gd[home] = (gd[home] || 0) + (goalsH - goalsA);
      gd[away] = (gd[away] || 0) + (goalsA - goalsH);
      gf[home] = (gf[home] || 0) + goalsH;
      gf[away] = (gf[away] || 0) + goalsA;
    });

    // Clasificar: top SIM_CLASIFICAN por pts → gd → gf → desempate aleatorio
    const ranked = standings.map(t => t.equipo).sort((a, b) => {
      const ptsDiff = (pts[b] || 0) - (pts[a] || 0);
      if (ptsDiff !== 0) return ptsDiff;
      const gdDiff  = (gd[b]  || 0) - (gd[a]  || 0);
      if (gdDiff  !== 0) return gdDiff;
      const gfDiff  = (gf[b]  || 0) - (gf[a]  || 0);
      if (gfDiff  !== 0) return gfDiff;
      return Math.random() - 0.5; // desempate aleatorio
    });

    ranked.slice(0, SIM_CLASIFICAN).forEach(eq => qualifyCount[eq]++);
  }

  const result = {};
  Object.keys(qualifyCount).forEach(eq => {
    result[eq] = qualifyCount[eq] / SIM_RUNS;
  });
  return result;
}

/**
 * Simula asumiendo que un fixture específico tiene resultado fijo.
 * Usado por ClassificationAlert para calcular el impacto de un partido.
 *
 * @param {Array}  standings       Filas de Clasificacion del grupo
 * @param {Array}  pendingFixtures Todos los partidos pendientes del grupo
 * @param {Object} fixedFixture    El partido cuyo resultado se fija
 * @param {'home'|'draw'|'away'} outcome  Resultado fijo
 * @returns {Object}  { equipo → prob_clasificar [0-1] }
 */
function simulateGroupWithFixedResult_(standings, pendingFixtures, fixedFixture, outcome) {
  const fixedId  = String(fixedFixture.fixture_id_af || fixedFixture.match_id || '');
  const remaining = pendingFixtures.filter(r =>
    String(r.fixture_id_af || r.match_id || '') !== fixedId
  );

  // Aplicar el resultado fijo al estado inicial
  const baseStandings = standings.map(t => ({
    ...t,
    puntos: Number(t.puntos || 0),
    gd:     Number(t.gd     || 0),
    gf:     Number(t.gf     || 0)
  }));

  const home = fixedFixture.local;
  const away = fixedFixture.visitante;

  const applyResult = (standings_, outcome_) => {
    const s = standings_.map(t => ({ ...t }));
    const getTeam = eq => s.find(t => t.equipo === eq);

    const homeT = getTeam(home);
    const awayT = getTeam(away);
    if (!homeT || !awayT) return s;

    if (outcome_ === 'home') {
      homeT.puntos += 3;
      homeT.gd += 1; awayT.gd -= 1;
      homeT.gf += 1;
    } else if (outcome_ === 'draw') {
      homeT.puntos += 1; awayT.puntos += 1;
    } else {
      awayT.puntos += 3;
      awayT.gd += 1; homeT.gd -= 1;
      awayT.gf += 1;
    }
    return s;
  };

  const adjustedStandings = applyResult(baseStandings, outcome);

  return simulateGroup_(adjustedStandings, remaining);
}

// ─── Helper de status ─────────────────────────────────────────────────────────

function isFinishedStatus_(status) {
  return ['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(
    String(status || '').toUpperCase()
  );
}

// ─── Texto para bot /grupos ───────────────────────────────────────────────────

/**
 * Construye el texto de clasificación simulada para el comando /grupos.
 *
 * @param {string} [grupoArg]  Letra del grupo (A-H) o vacío para todos
 */
function buildGroupSimText_(grupoArg) {
  let rows;
  try { rows = readAll_(SIM_HOJA); } catch (e) { rows = []; }

  if (!rows.length) {
    return [
      '📊 <b>Simulación de Grupos</b>',
      '',
      'No hay datos de simulación disponibles.',
      '<i>Ejecuta runGroupSimulation() manualmente para calcular las probabilidades.</i>'
    ].join('\n');
  }

  // Filtrar por grupo si se especificó
  const grupoFiltro = grupoArg ? grupoArg.trim().toUpperCase() : null;
  const filtered = grupoFiltro
    ? rows.filter(r => String(r.grupo || '').toUpperCase() === grupoFiltro)
    : rows;

  if (grupoFiltro && !filtered.length) {
    return `No encontré datos para el Grupo ${grupoFiltro}.\n\nUsa /grupos sin argumento para ver todos.`;
  }

  // Agrupar por letra de grupo
  const byGroup = {};
  filtered.forEach(r => {
    const g = String(r.grupo || '');
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(r);
  });

  const updatedAt = filtered[0] && filtered[0].updated_at
    ? String(filtered[0].updated_at).substring(0, 16)
    : '';

  let msg = `📊 <b>Probabilidad de Clasificación</b>\n`;
  if (updatedAt) msg += `<i>Simulación Monte Carlo (${SIM_RUNS} runs) — ${updatedAt}</i>\n`;
  msg += '\n';

  Object.keys(byGroup).sort().forEach(grupo => {
    const equipos = byGroup[grupo].sort((a, b) =>
      Number(b.prob_clasificar || 0) - Number(a.prob_clasificar || 0)
    );
    const pendientes = Number(equipos[0].partidos_restantes || 0);

    msg += `<b>Grupo ${grupo}</b>`;
    if (pendientes === 0) msg += ' ✅ Terminado';
    msg += '\n';

    equipos.forEach((r, i) => {
      const prob   = Number(r.prob_clasificar || 0);
      const pct    = Math.round(prob * 100);
      const emoji  = prob >= 0.80 ? '🟢' : prob >= 0.50 ? '🟡' : prob >= 0.20 ? '🟠' : '🔴';
      const clasif = i < SIM_CLASIFICAN ? ' →' : '';
      msg += `  ${emoji} ${r.equipo}: <code>${pct}%</code>${clasif}\n`;
    });

    if (pendientes > 0) msg += `  <i>(${pendientes} partido${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''})</i>\n`;
    msg += '\n';
  });

  if (!grupoFiltro) {
    msg += '<i>Usa /grupos A para ver solo el Grupo A</i>';
  }

  return msg.trim();
}
