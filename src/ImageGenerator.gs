/**
 * ImageGenerator.gs
 *
 * Genera URLs de gráficos usando QuickChart.io (100% gratuito, sin API key).
 * Las URLs se pasan directamente a Telegram sendPhoto — no es necesario
 * descargar la imagen; Telegram la descarga por su cuenta desde QuickChart.
 *
 * API: GET https://quickchart.io/chart?c={config_json}&w=600&h=350&bkg=white
 * Límite de URL: ~8000 chars. Mantener labels cortos (≤12 chars por equipo).
 *
 * Funciones públicas:
 *   buildProbabilityChartUrl_   — bar chart 1X2 con probabilidades
 *   buildEloComparisonChartUrl_ — bar chart comparación de ELO
 *   buildOddsEvolutionChartUrl_ — line chart evolución de cuotas en el tiempo
 *   buildLiveScoreChartUrl_     — horizontal bar chart de estadísticas en vivo
 *   buildRadarComparisonChartUrl_ — radar chart comparación táctica (5 ejes)
 */

const QUICKCHART_BASE = 'https://quickchart.io/chart';
const QUICKCHART_W    = 600;
const QUICKCHART_H    = 340;

// ─── Helper interno ────────────────────────────────────────────────────────────

/**
 * Construye la URL final de QuickChart dado un objeto de configuración Chart.js.
 * Si la URL supera el límite seguro, la acorta usando la API POST de QuickChart.
 * @returns {string|null} URL de la imagen o null si falla
 */
function buildChartUrl_(config) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  const url     = `${QUICKCHART_BASE}?c=${encoded}&w=${QUICKCHART_W}&h=${QUICKCHART_H}&bkg=white&devicePixelRatio=2`;

  // Dentro del límite seguro de URL
  if (url.length <= 7500) return url;

  // URL demasiado larga → usar API POST para obtener URL corta
  try {
    const resp = UrlFetchApp.fetch('https://quickchart.io/chart/create', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chart: config,
        width:  QUICKCHART_W,
        height: QUICKCHART_H,
        backgroundColor: 'white',
        devicePixelRatio: 2
      }),
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() === 200) {
      const data = JSON.parse(resp.getContentText());
      return data.url || null;
    }
  } catch (e) {
    console.warn('QuickChart POST failed:', e.message);
  }

  return null;
}

/**
 * Trunca el nombre de un equipo para que quepa en labels de gráfico.
 * @param {string} name
 * @param {number} maxLen
 */
function shortName_(name, maxLen) {
  return String(name || '').substring(0, maxLen || 13);
}

// ─── 1. Probabilidades 1X2 ────────────────────────────────────────────────────

/**
 * Bar chart horizontal con las probabilidades de resultado de un partido.
 * Colores: local=azul, empate=naranja, visitante=rojo.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {number} probHome  [0,1]
 * @param {number} probDraw  [0,1]
 * @param {number} probAway  [0,1]
 * @returns {string|null} URL de imagen
 */
function buildProbabilityChartUrl_(homeTeam, awayTeam, probHome, probDraw, probAway) {
  if (!probHome && !probDraw && !probAway) return null;

  const home = shortName_(homeTeam, 13);
  const away = shortName_(awayTeam, 13);

  const ph = Math.round((probHome || 0) * 100);
  const pd = Math.round((probDraw || 0) * 100);
  const pa = Math.round((probAway || 0) * 100);

  const config = {
    type: 'horizontalBar',
    data: {
      labels: [home, 'Empate', away],
      datasets: [{
        label: 'Probabilidad %',
        data: [ph, pd, pa],
        backgroundColor: ['#2196F3', '#FF9800', '#F44336'],
        borderColor:     ['#1565C0', '#E65100', '#B71C1C'],
        borderWidth: 1
      }]
    },
    options: {
      title: {
        display: true,
        text: `${home} vs ${away} — Probabilidades`,
        fontSize: 15,
        fontColor: '#333'
      },
      legend: { display: false },
      scales: {
        xAxes: [{
          ticks: { min: 0, max: 100, callback: v => v + '%' },
          gridLines: { color: '#eee' }
        }],
        yAxes: [{ gridLines: { display: false } }]
      },
      plugins: {
        datalabels: {
          anchor: 'end',
          align:  'right',
          formatter: v => v + '%',
          color: '#333',
          font: { size: 13, weight: 'bold' }
        }
      }
    }
  };

  return buildChartUrl_(config);
}

// ─── 2. Comparación de ELO ────────────────────────────────────────────────────

/**
 * Bar chart de dos barras comparando el ELO de ambos equipos.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {number} eloHome
 * @param {number} eloAway
 * @returns {string|null}
 */
function buildEloComparisonChartUrl_(homeTeam, awayTeam, eloHome, eloAway) {
  if (!eloHome || !eloAway) return null;

  const home = shortName_(homeTeam, 13);
  const away = shortName_(awayTeam, 13);
  const diff = eloHome - eloAway;
  const diffStr = diff > 0 ? `+${diff}` : String(diff);

  const config = {
    type: 'bar',
    data: {
      labels: [home, away],
      datasets: [{
        label: 'ELO Rating',
        data: [eloHome, eloAway],
        backgroundColor: ['#2196F3', '#F44336'],
        borderColor:     ['#1565C0', '#B71C1C'],
        borderWidth: 1
      }]
    },
    options: {
      title: {
        display: true,
        text:    `Comparación ELO — Diferencia: ${diffStr}`,
        fontSize: 14,
        fontColor: '#333'
      },
      legend: { display: false },
      scales: {
        yAxes: [{
          ticks: {
            min: Math.min(eloHome, eloAway) - 100,
            max: Math.max(eloHome, eloAway) + 100
          }
        }]
      },
      plugins: {
        datalabels: {
          anchor: 'end',
          align: 'top',
          formatter: v => v,
          font: { size: 14, weight: 'bold' },
          color: '#333'
        }
      }
    }
  };

  return buildChartUrl_(config);
}

// ─── 3. Evolución de cuotas ───────────────────────────────────────────────────

/**
 * Line chart mostrando cómo evolucionó la probabilidad del equipo local
 * según las cuotas de mercado guardadas en OddsApuestas.
 * Retorna null si hay menos de 2 puntos de datos.
 *
 * @param {string|number} fixtureId
 * @param {string}        homeTeam
 * @returns {string|null}
 */
function buildOddsEvolutionChartUrl_(fixtureId, homeTeam) {
  let rows;
  try {
    rows = readAll_(CONFIG.SHEETS.ODDS).filter(r =>
      String(r.fixture_id)  === String(fixtureId) &&
      String(r.mercado      || '') === '1X2'       &&
      String(r.fuente       || '') === 'THE_ODDS_API' &&
      teamNameMatches_(r.seleccion, homeTeam)
    ).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  } catch (e) { return null; }

  if (!rows || rows.length < 2) return null;

  // Tomar máximo 8 puntos para no saturar la URL
  const sample = rows.length <= 8 ? rows : rows.filter((_, i) => i % Math.ceil(rows.length / 8) === 0);

  const labels = sample.map(r => String(r.timestamp || '').substring(11, 16)); // HH:MM
  const data   = sample.map(r => Math.round(Number(r.probabilidad_modelo || 0) * 100));

  const home = shortName_(homeTeam, 13);

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${home} %`,
        data,
        borderColor: '#2196F3',
        backgroundColor: 'rgba(33,150,243,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4
      }]
    },
    options: {
      title: {
        display: true,
        text:    `Evolución de cuota — ${home}`,
        fontSize: 14
      },
      scales: {
        yAxes: [{
          ticks: { min: 0, max: 100, callback: v => v + '%' },
          gridLines: { color: '#eee' }
        }]
      },
      plugins: {
        datalabels: { display: false }
      }
    }
  };

  return buildChartUrl_(config);
}

// ─── 4. Estadísticas en vivo (post-gol) ───────────────────────────────────────

/**
 * Horizontal bar chart comparando estadísticas en vivo de ambos equipos.
 * Se envía tras un gol o roja durante el partido.
 *
 * @param {Object} fixture   Objeto fixture (mínimo: teams.home.name, teams.away.name, goals)
 * @param {Object} liveStats { home: {posesion, tiros, tirosArco, corners, faltas}, away: {...} }
 * @param {number} [minute]  Minuto del partido (para el título)
 * @returns {string|null}
 */
function buildLiveScoreChartUrl_(fixture, liveStats, minute) {
  if (!liveStats || !liveStats.home || !liveStats.away) return null;

  const home    = shortName_(fixture.teams.home.name, 12);
  const away    = shortName_(fixture.teams.away.name, 12);
  const goalsH  = fixture.goals ? (fixture.goals.home || 0) : 0;
  const goalsA  = fixture.goals ? (fixture.goals.away || 0) : 0;
  const minStr  = minute ? `${minute}'` : '';
  const title   = `${home} ${goalsH} - ${goalsA} ${away}${minStr ? ' (' + minStr + ')' : ''}`;

  const metrics = ['Posesión %', 'Tiros', 'Tiros arco', 'Córners', 'Faltas'];
  const dataH   = [
    Number(liveStats.home.posesion   || 0),
    Number(liveStats.home.tiros      || 0),
    Number(liveStats.home.tirosArco  || 0),
    Number(liveStats.home.corners    || 0),
    Number(liveStats.home.faltas     || 0)
  ];
  const dataA   = [
    Number(liveStats.away.posesion   || 0),
    Number(liveStats.away.tiros      || 0),
    Number(liveStats.away.tirosArco  || 0),
    Number(liveStats.away.corners    || 0),
    Number(liveStats.away.faltas     || 0)
  ];

  const config = {
    type: 'horizontalBar',
    data: {
      labels: metrics,
      datasets: [
        {
          label: home,
          data: dataH,
          backgroundColor: 'rgba(33,150,243,0.8)',
          borderColor: '#1565C0',
          borderWidth: 1
        },
        {
          label: away,
          data: dataA,
          backgroundColor: 'rgba(244,67,54,0.8)',
          borderColor: '#B71C1C',
          borderWidth: 1
        }
      ]
    },
    options: {
      title: { display: true, text: title, fontSize: 15, fontColor: '#333' },
      scales: {
        xAxes: [{ ticks: { min: 0 }, gridLines: { color: '#eee' } }],
        yAxes: [{ gridLines: { display: false } }]
      },
      plugins: {
        datalabels: {
          anchor: 'end', align: 'right',
          formatter: v => v,
          font: { size: 11 }, color: '#333'
        }
      }
    }
  };

  return buildChartUrl_(config);
}

// ─── 5. Radar táctico ─────────────────────────────────────────────────────────

/**
 * Radar chart de 5 ejes comparando ambos equipos.
 * Solo genera el gráfico si hay ≥ 2 partidos terminados para ambos equipos.
 * Los valores se normalizan a [0, 100] para el gráfico.
 *
 * Ejes: ELO relativo | Goles a favor | Goles en contra (invertido) | Posesión | Disciplina
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {string|null}
 */
function buildRadarComparisonChartUrl_(homeTeam, awayTeam) {
  let matchRows;
  try { matchRows = readAll_(CONFIG.SHEETS.PARTIDOS); } catch (e) { return null; }

  // Partidos terminados para cada equipo
  const getTeamRows = team => matchRows.filter(r =>
    isFinishedStatus_(r.status) &&
    (teamNameMatches_(r.local, team) || teamNameMatches_(r.visitante, team))
  );

  const homeRows = getTeamRows(homeTeam);
  const awayRows = getTeamRows(awayTeam);
  if (homeRows.length < 2 || awayRows.length < 2) return null;

  const calcStats = (rows, team) => {
    let gf = 0, gc = 0, pos = 0, faltas = 0, amarillas = 0;
    rows.forEach(r => {
      const isHome = teamNameMatches_(r.local, team);
      gf         += isHome ? Number(r.goles_local || 0)      : Number(r.goles_visitante || 0);
      gc         += isHome ? Number(r.goles_visitante || 0)   : Number(r.goles_local || 0);
      pos        += isHome ? Number(r.posesion_local || 50)   : Number(r.posesion_visitante || 50);
      faltas     += isHome ? Number(r.faltas_local || 0)      : Number(r.faltas_visitante || 0);
      amarillas  += isHome ? Number(r.amarillas_local || 0)   : Number(r.amarillas_visitante || 0);
    });
    const n = rows.length;
    return { gf: gf/n, gc: gc/n, pos: pos/n, faltas: faltas/n, amarillas: amarillas/n };
  };

  const sh = calcStats(homeRows, homeTeam);
  const sa = calcStats(awayRows, awayTeam);

  // ELO relativo: normalizar respecto al máximo de los dos
  const eloH = getTeamElo_(homeTeam);
  const eloA = getTeamElo_(awayTeam);
  const eloMax = Math.max(eloH, eloA);
  const eloMin = Math.min(eloH, eloA);
  const eloRange = eloMax - eloMin || 1;

  // Normalizar cada eje [0,100] (mayor = mejor)
  const norm = (v, min, max) => max > min ? Math.round((v - min) / (max - min) * 100) : 50;

  const gfMin  = Math.min(sh.gf,  sa.gf);   const gfMax  = Math.max(sh.gf,  sa.gf)  || 1;
  const gcMin  = Math.min(sh.gc,  sa.gc);   const gcMax  = Math.max(sh.gc,  sa.gc)  || 1;
  const posMin = Math.min(sh.pos, sa.pos);  const posMax = Math.max(sh.pos, sa.pos) || 1;
  const discMin = 0; const discMax = Math.max(sh.faltas + sh.amarillas*2, sa.faltas + sa.amarillas*2) || 1;

  const dataH = [
    Math.round((eloH - eloMin) / eloRange * 100),
    norm(sh.gf,  gfMin,  gfMax),
    100 - norm(sh.gc,  gcMin,  gcMax),  // goles en contra invertido: menos = mejor
    norm(sh.pos, posMin, posMax),
    100 - norm(sh.faltas + sh.amarillas * 2, discMin, discMax)  // disciplina: menos faltas = mejor
  ];
  const dataA = [
    Math.round((eloA - eloMin) / eloRange * 100),
    norm(sa.gf,  gfMin,  gfMax),
    100 - norm(sa.gc,  gcMin,  gcMax),
    norm(sa.pos, posMin, posMax),
    100 - norm(sa.faltas + sa.amarillas * 2, discMin, discMax)
  ];

  const home = shortName_(homeTeam, 12);
  const away = shortName_(awayTeam, 12);

  const config = {
    type: 'radar',
    data: {
      labels: ['ELO', 'Goles F.', 'Def.', 'Posesión', 'Disciplina'],
      datasets: [
        {
          label: home,
          data: dataH,
          borderColor: '#2196F3',
          backgroundColor: 'rgba(33,150,243,0.25)',
          pointBackgroundColor: '#2196F3'
        },
        {
          label: away,
          data: dataA,
          borderColor: '#F44336',
          backgroundColor: 'rgba(244,67,54,0.25)',
          pointBackgroundColor: '#F44336'
        }
      ]
    },
    options: {
      title: {
        display: true,
        text: `${home} vs ${away} — Comparación táctica`,
        fontSize: 14
      },
      scale: {
        ticks: { min: 0, max: 100, stepSize: 25, display: false },
        gridLines: { color: '#ddd' }
      },
      plugins: { datalabels: { display: false } }
    }
  };

  return buildChartUrl_(config);
}
