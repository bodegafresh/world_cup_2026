// ─── Flags ───────────────────────────────────────────────────────────────────
const FLAGS = {
  'Argentina':'🇦🇷','Brasil':'🇧🇷','Francia':'🇫🇷','Alemania':'🇩🇪','España':'🇪🇸',
  'Inglaterra':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','England':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Portugal':'🇵🇹','Países Bajos':'🇳🇱',
  'Bélgica':'🇧🇪','Uruguay':'🇺🇾','Colombia':'🇨🇴','México':'🇲🇽',
  'USA':'🇺🇸','Estados Unidos':'🇺🇸','Canadá':'🇨🇦','Canada':'🇨🇦',
  'Marruecos':'🇲🇦','Senegal':'🇸🇳','Japón':'🇯🇵','Corea del Sur':'🇰🇷',
  'Australia':'🇦🇺','Ecuador':'🇪🇨','Chile':'🇨🇱','Perú':'🇵🇪',
  'Venezuela':'🇻🇪','Bolivia':'🇧🇴','Paraguay':'🇵🇾','Costa Rica':'🇨🇷',
  'Panamá':'🇵🇦','Honduras':'🇭🇳','Jamaica':'🇯🇲','Qatar':'🇶🇦',
  'Arabia Saudita':'🇸🇦','Irán':'🇮🇷','Irak':'🇮🇶','Suiza':'🇨🇭',
  'Croacia':'🇭🇷','Serbia':'🇷🇸','Polonia':'🇵🇱','Dinamarca':'🇩🇰',
  'Austria':'🇦🇹','Turquía':'🇹🇷','Ucrania':'🇺🇦','Nigeria':'🇳🇬',
  'Ghana':'🇬🇭','Costa de Marfil':'🇨🇮','Camerún':'🇨🇲','Túnez':'🇹🇳',
  'Egipto':'🇪🇬','Argelia':'🇩🇿','Suecia':'🇸🇪','Noruega':'🇳🇴',
  'Italia':'🇮🇹','Escocia':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','Grecia':'🇬🇷','Georgia':'🇬🇪',
  'China':'🇨🇳','Nueva Zelanda':'🇳🇿','Rep. Checa':'🇨🇿','Rumanía':'🇷🇴',
  'Eslovaquia':'🇸🇰','Hungría':'🇭🇺','Albania':'🇦🇱','Eslovenia':'🇸🇮',
};
const flag = t => FLAGS[t] || '🏳️';

// ─── Utilidades ──────────────────────────────────────────────────────────────
const fmt = {
  pct:  v => `${Number(v||0).toFixed(1)}%`,
  dec:  v => Number(v||0).toFixed(2),
  sign: v => { const n = Number(v||0); return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
};

function normDate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.substring(0, 10);
  // gviz devuelve fechas como "Date(2026,5,17)" → parsear
  const m = String(v).match(/Date\((\d+),(\d+),(\d+)/);
  if (m) {
    const yy = m[1], mo = String(+m[2]+1).padStart(2,'0'), dd = String(+m[3]).padStart(2,'0');
    return `${yy}-${mo}-${dd}`;
  }
  return String(v).substring(0, 10);
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
}
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
}

function evColor(ev) {
  const v = Number(ev) * 100;
  if (v >= 10) return 'alta';
  if (v >=  5) return 'media';
  return 'baja';
}
function simBarColor(p) {
  if (p >= 70) return '#00c853';
  if (p >= 40) return '#ffd700';
  return '#ff7043';
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const KEY_STORAGE = 'wc2026_key';

function getSavedKey() { return localStorage.getItem(KEY_STORAGE) || ''; }
function saveKey(k)    { localStorage.setItem(KEY_STORAGE, k); }
function clearKey()    { localStorage.removeItem(KEY_STORAGE); }

// ─── API fetcher (via Cloudflare Worker) ─────────────────────────────────────

async function fetchTab(tab) {
  const key = getSavedKey();
  const url = `${WORKER_URL}/api?tab=${encodeURIComponent(tab)}&key=${encodeURIComponent(key)}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (res.status === 401 || (json && json.error === 'Unauthorized')) {
    clearKey();
    showLogin('Clave incorrecta. Inténtalo de nuevo.');
    throw new Error('Unauthorized');
  }
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json.data;
}

// ─── Cache simple ─────────────────────────────────────────────────────────────
const cache = {};
async function getData(tab, ttlMs = 5 * 60 * 1000) {
  const now = Date.now();
  if (cache[tab] && (now - cache[tab].ts) < ttlMs) return cache[tab].data;
  const data = await fetchTab(tab);
  cache[tab] = { data, ts: now };
  return data;
}

// ─── Estado ──────────────────────────────────────────────────────────────────
const state = { activeGroup: 'A' };

// ─── Loading / Error helpers ──────────────────────────────────────────────────
const loadingHtml = () => `<div class="loading-center"><div class="spinner"></div><span>Cargando...</span></div>`;
const errorHtml   = msg => `<div class="error-state"><div class="icon">⚠️</div><p>${msg}</p></div>`;
const skeletons   = n => `<div class="matches-grid">${'<div class="skeleton skel-card"></div>'.repeat(n)}</div>`;

// ─── Render: Match card ───────────────────────────────────────────────────────
function renderMatchCard(m, poissonRows) {
  const mk      = m.match_key || '';
  const isLive  = ['1H','2H','HT','ET','BT','P'].includes(String(m.status||'').toUpperCase());
  const isFT    = ['FT','AET','PEN'].includes(String(m.status||'').toUpperCase());
  const hScore  = m.goles_local     != null ? m.goles_local     : '';
  const aScore  = m.goles_visitante != null ? m.goles_visitante : '';
  const hasScore = hScore !== '' && aScore !== '';

  const statusHtml = isLive
    ? `<span class="status-live">🔴 EN VIVO ${m.status||''}</span>`
    : isFT ? `<span class="status-ft">FT</span>`
    : `<span>${m.hora_chile || m.hora || ''}</span>`;

  const scoreHtml = hasScore
    ? `<div class="match-score">${hScore} - ${aScore}</div>`
    : `<div class="match-score pending">${m.hora_chile || m.hora || 'vs'}</div>`;

  // Buscar predicción Poisson
  const pred = poissonRows && poissonRows.find(p => p.match_key === mk || (
    String(p.local||'').toLowerCase() === String(m.local||'').toLowerCase() &&
    String(p.visitante||'').toLowerCase() === String(m.visitante||'').toLowerCase()
  ));

  let probHtml = '';
  if (pred) {
    const ph = Number(pred.prob_home || pred.prob_local || 0) * 100;
    const pd = Number(pred.prob_draw || 0) * 100;
    const pa = Number(pred.prob_away || pred.prob_visitante || 0) * 100;
    const lh = Number(pred.lambda_h || pred.lambda_home || 0).toFixed(2);
    const la = Number(pred.lambda_a || pred.lambda_away || 0).toFixed(2);
    const o25 = Number(pred.over_2_5 || pred['over_2.5'] || 0) * 100;
    const btts = Number(pred.btts_yes || pred.btts || 0) * 100;
    probHtml = `
      <div class="prob-bar">
        <div class="ph" style="width:${ph}%"></div>
        <div class="pd" style="width:${pd}%"></div>
        <div class="pa" style="width:${pa}%"></div>
      </div>
      <div class="prob-labels">
        <span class="ph-l">${fmt.pct(ph)}</span>
        <span style="color:var(--text3)">${fmt.pct(pd)}</span>
        <span class="pa-l">${fmt.pct(pa)}</span>
      </div>
      <div class="match-xg">
        xG: <span>${lh}</span>–<span>${la}</span>
        &nbsp;·&nbsp; O2.5: <span>${fmt.pct(o25)}</span>
        &nbsp;·&nbsp; BTTS: <span>${fmt.pct(btts)}</span>
      </div>`;
  }

  return `
  <div class="match-card${isLive ? ' live' : ''}">
    <div class="match-meta">
      <span class="grupo">${m.grupo || m.ronda || ''}</span>
      ${statusHtml}
    </div>
    <div class="match-teams">
      <div class="match-team">
        <div class="flag">${flag(m.local)}</div>
        <div class="name">${m.local || ''}</div>
      </div>
      ${scoreHtml}
      <div class="match-team">
        <div class="flag">${flag(m.visitante)}</div>
        <div class="name">${m.visitante || ''}</div>
      </div>
    </div>
    ${probHtml}
  </div>`;
}

// ─── Sección: HOY ─────────────────────────────────────────────────────────────
async function renderHoy() {
  document.getElementById('section-hoy').innerHTML = skeletons(3);
  try {
    const dash  = await getData('dashboard', 2 * 60 * 1000);
    const preds = await getData('predictions').catch(() => []);

    const enVivo     = dash.en_vivo  || [];
    const pendientes = dash.hoy      || [];
    const matchMan   = dash.mañana   || [];

    let html = '';
    if (enVivo.length) {
      html += `<h3 class="section-title">🔴 En vivo</h3>
               <div class="matches-grid">${enVivo.map(m => renderMatchCard(m, preds)).join('')}</div>`;
      document.getElementById('live-badge').style.display = 'inline-flex';
    }
    if (pendientes.length) {
      html += `<h3 class="section-title" style="margin-top:1.5rem">⚽ Hoy</h3>
               <div class="matches-grid">${pendientes.map(m => renderMatchCard(m, preds)).join('')}</div>`;
    }
    if (matchMan.length) {
      html += `<h3 class="section-title" style="margin-top:1.5rem">📅 Mañana</h3>
               <div class="matches-grid">${matchMan.map(m => renderMatchCard(m, preds)).join('')}</div>`;
    }
    if (!html) {
      html = `<div class="error-state"><div class="icon">📅</div><p>No hay partidos para hoy ni mañana.</p></div>`;
    }
    document.getElementById('section-hoy').innerHTML = html;
  } catch (e) {
    document.getElementById('section-hoy').innerHTML = errorHtml('No se pudo cargar: ' + e.message);
  }
}

// ─── Sección: TABLA DE POSICIONES ────────────────────────────────────────────
async function renderStandings(groupKey) {
  document.getElementById('standings-content').innerHTML = `<div class="skeleton skel-row"></div>`.repeat(4);
  try {
    const grupos = await getData('standings');
    const letras = Object.keys(grupos).sort();
    const tabsEl = document.getElementById('groups-tabs');
    if (!tabsEl.children.length) {
      tabsEl.innerHTML = letras.map(g =>
        `<button class="group-tab${g === state.activeGroup ? ' active' : ''}" onclick="switchGroup('${g}')">Grupo ${g}</button>`
      ).join('');
    }
    const active = groupKey || state.activeGroup;
    const equipo = grupos[active] || grupos[letras[0]] || [];

    document.getElementById('standings-content').innerHTML = `
    <table class="standings-table">
      <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${equipo.map((t, i) => `
        <tr class="${i < 2 ? 'classify' : ''}">
          <td>${i+1}</td>
          <td><div class="team-cell">${flag(t.equipo)} ${t.equipo}</div></td>
          <td>${t.pj}</td><td>${t.pg}</td><td>${t.pe}</td><td>${t.pp}</td>
          <td>${t.gf}</td><td>${t.gc}</td>
          <td style="color:${t.gd>0?'var(--green)':t.gd<0?'var(--red)':'var(--text2)'}">${t.gd>0?'+':''}${t.gd}</td>
          <td class="pts">${t.pts}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p style="font-size:.7rem;color:var(--text3);margin-top:.5rem">🟩 Clasifican a octavos de final</p>`;
  } catch (e) {
    document.getElementById('standings-content').innerHTML = errorHtml('Error tabla: ' + e.message);
  }
}
function switchGroup(g) {
  state.activeGroup = g;
  document.querySelectorAll('.group-tab').forEach(b => b.classList.toggle('active', b.textContent === `Grupo ${g}`));
  renderStandings(g);
}

// ─── Sección: EV ─────────────────────────────────────────────────────────────
async function renderEV() {
  document.getElementById('section-ev').innerHTML = `<div class="skeleton skel-row"></div>`.repeat(5);
  try {
    const opps = await getData('ev');

    if (!opps.length) {
      document.getElementById('section-ev').innerHTML = `<div class="error-state"><div class="icon">🔍</div><p>Sin oportunidades EV+ por ahora.</p></div>`;
      return;
    }
    document.getElementById('section-ev').innerHTML = `
    <div style="overflow-x:auto">
    <table class="ev-table">
      <thead><tr><th>Partido</th><th>Mercado</th><th>Selección</th><th>Modelo</th><th>Cuota</th><th>EV</th><th>Kelly</th></tr></thead>
      <tbody>${opps.map(r => `
        <tr>
          <td>${flag(r.local||'')}${r.local||''} vs ${flag(r.visitante||'')}${r.visitante||''}<br>
              <small style="color:var(--text3)">${r.fecha||''}</small></td>
          <td><small>${r.mercado||''}</small></td>
          <td><strong>${r.seleccion||''}</strong></td>
          <td>${fmt.pct(Number(r.prob_modelo||0)*100)}</td>
          <td><strong style="color:var(--gold)">${fmt.dec(r.cuota)}</strong></td>
          <td><span class="ev-badge ${evColor(r.ev)}">+${(Number(r.ev||0)*100).toFixed(1)}%</span></td>
          <td style="color:var(--text2)">${(Number(r.kelly||0)*100).toFixed(1)}%</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <p style="font-size:.7rem;color:var(--text3);margin-top:.75rem">EV = (Prob. modelo × cuota) − 1 · Cuotas: Pinnacle / The Odds API</p>`;
  } catch (e) {
    document.getElementById('section-ev').innerHTML = errorHtml('Error EV: ' + e.message);
  }
}

// ─── Sección: ELO ────────────────────────────────────────────────────────────
async function renderElo() {
  document.getElementById('section-elo').innerHTML = loadingHtml();
  try {
    const rows  = await getData('elo');
    const top20 = rows.slice(0, 20).map(r => [r.equipo, r.elo]);

    document.getElementById('section-elo').innerHTML = `<div class="elo-chart-wrap"><canvas id="elo-chart"></canvas></div>`;
    new Chart(document.getElementById('elo-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: top20.map(([t]) => `${flag(t)} ${t}`),
        datasets: [{ label: 'ELO', data: top20.map(([,v]) => v),
          backgroundColor: top20.map((_,i) => i===0?'#ffd700':i<4?'#00c853':i<8?'#448aff':'#546e7a'),
          borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ELO: ${c.parsed.x}` } } },
        scales: {
          x: { grid: { color:'rgba(30,45,77,.5)' }, ticks: { color:'#90a4ae' },
               min: top20.length ? top20[top20.length-1][1] - 80 : 1400 },
          y: { grid: { display:false }, ticks: { color:'#e8eaf6', font:{ size:12 } } }
        }
      }
    });
  } catch (e) {
    document.getElementById('section-elo').innerHTML = errorHtml('Error ELO: ' + e.message);
  }
}

// ─── Sección: SIMULACIÓN ──────────────────────────────────────────────────────
async function renderSimulation() {
  document.getElementById('section-sim').innerHTML = loadingHtml();
  try {
    const grupos = await getData('simulation');
    const letras = Object.keys(grupos).sort();
    if (!letras.length) {
      document.getElementById('section-sim').innerHTML = `<div class="error-state"><div class="icon">🎲</div><p>Simulación aún no disponible. Ejecuta runGroupSimulation() en Apps Script.</p></div>`;
      return;
    }
    document.getElementById('section-sim').innerHTML = `<div class="sim-grid">${letras.map(g => {
      const teams = grupos[g];
      return `<div class="sim-group-card">
        <div class="sim-group-title">Grupo ${g}</div>
        ${teams.map(t => {
          const p = Number(t.prob_clasificar || 0);
          return `<div class="sim-row">
            <div class="team-name">${flag(t.equipo)} ${t.equipo}</div>
            <div class="sim-prob-bar-wrap"><div class="sim-prob-bar" style="width:${Math.min(p,100)}%;background:${simBarColor(p)}"></div></div>
            <div class="prob-val" style="color:${simBarColor(p)}">${Math.round(p)}%</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}</div>
    <p style="font-size:.7rem;color:var(--text3);margin-top:.75rem">Probabilidad de clasificar a octavos · Monte Carlo 2000 simulaciones</p>`;
  } catch (e) {
    document.getElementById('section-sim').innerHTML = errorHtml('Error simulación: ' + e.message);
  }
}

// ─── Sección: RENDIMIENTO ────────────────────────────────────────────────────
async function renderPerformance() {
  document.getElementById('section-perf').innerHTML = loadingHtml();
  try {
    const perf = await getData('performance');
    const cal  = perf.calibration  || {};
    const bets = perf.bettingStats || {};
    const roi  = bets.roi  != null ? bets.roi  : null;
    const wr   = bets.win_rate != null ? bets.win_rate : null;

    const cards = [
      { label:'Brier Score', val: cal.brier_score ? Number(cal.brier_score).toFixed(3) : '—', type:'blue',  note:'Calibración · menor = mejor' },
      { label:'Accuracy',    val: cal.accuracy    ? fmt.pct(Number(cal.accuracy)*100)  : '—', type:'green', note:'Predicciones correctas' },
      { label:'Win Rate',    val: wr !== null      ? fmt.pct(wr)                        : '—', type:'gold',  note:`${bets.ganadas||0}/${bets.total||0} apuestas` },
      { label:'ROI',         val: roi !== null     ? fmt.sign(roi)                      : '—', type: roi>=0?'green':'red', note:'Retorno sobre inversión' },
    ];
    document.getElementById('section-perf').innerHTML = `<div class="perf-grid">${cards.map(c =>`
      <div class="perf-card ${c.type}">
        <div class="val">${c.val}</div>
        <div class="label">${c.label}</div>
        <div style="font-size:.68rem;color:var(--text3);margin-top:.2rem">${c.note}</div>
      </div>`).join('')}</div>`;
  } catch (e) {
    document.getElementById('section-perf').innerHTML = errorHtml('Error rendimiento: ' + e.message);
  }
}

// ─── Sección: EN VIVO ─────────────────────────────────────────────────────────
let liveInterval = null;

async function renderLive() {
  document.getElementById('section-live').innerHTML = loadingHtml();
  try {
    const matches = await fetchTab('live');
    if (!matches.length) {
      document.getElementById('section-live').innerHTML =
        `<div class="error-state"><div class="icon">📡</div><p>No hay partidos en vivo ahora mismo.</p></div>`;
      return;
    }
    document.getElementById('live-badge').style.display = 'inline-flex';
    document.getElementById('section-live').innerHTML = matches.map(m => buildLiveCard(m)).join('');
  } catch(e) {
    document.getElementById('section-live').innerHTML = errorHtml('Error en vivo: ' + e.message);
  }
}

function buildLiveCard(m) {
  const eventIcons = { Goal:'⚽', subst:'🔄', yellowcard:'🟨', yellowredcard:'🟨🟥', redcard:'🟥', var:'📺' };
  const evHtml = m.eventos.map(ev => {
    const icon = eventIcons[ev.tipo] || eventIcons[ev.detalle] || '•';
    const min  = ev.extra ? `${ev.minuto}+${ev.extra}'` : `${ev.minuto}'`;
    return `<div class="live-event">
      <span class="live-min">${min}</span>
      <span class="live-icon">${icon}</span>
      <span class="live-team">${ev.equipo}</span>
      <span class="live-player">${ev.jugador}${ev.asistente ? ` <small>(${ev.asistente})</small>` : ''}</span>
    </div>`;
  }).join('') || `<p style="color:var(--text3);font-size:.8rem;padding:.5rem 0">Sin eventos registrados aún</p>`;

  const statsHtml = m.stats ? buildStatsBars(m.local, m.visitante, m.stats) : '';

  return `<div class="match-detail-card live">
    <div class="md-header">
      <span class="live-pill">🔴 EN VIVO</span>
      <span style="color:var(--text3);font-size:.8rem">${m.status} · ${m.estadio||''}</span>
    </div>
    <div class="md-score">
      <div class="md-team">${flag(m.local)} <span>${m.local}</span></div>
      <div class="md-scorebox">${m.goles_local ?? '–'} – ${m.goles_visitante ?? '–'}</div>
      <div class="md-team right">${flag(m.visitante)} <span>${m.visitante}</span></div>
    </div>
    <div class="live-events-list">${evHtml}</div>
    ${statsHtml}
  </div>`;
}

// ─── Sección: DETALLE DE PARTIDO ─────────────────────────────────────────────
async function showMatchDetail(matchKey) {
  const el = document.getElementById(`detail-${matchKey}`);
  if (!el) return;
  if (el.dataset.loaded) { el.style.display = el.style.display === 'none' ? '' : 'none'; return; }
  el.style.display = '';
  el.innerHTML = loadingHtml();
  try {
    const key = getSavedKey();
    const url = `${WORKER_URL}/api?tab=match&match_key=${encodeURIComponent(matchKey)}&key=${encodeURIComponent(key)}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    el.dataset.loaded = '1';
    el.innerHTML = buildMatchDetail(json.data);
  } catch(e) {
    el.innerHTML = errorHtml('No se pudo cargar el detalle: ' + e.message);
  }
}

function buildMatchDetail(m) {
  const eventIcons = { Goal:'⚽', subst:'🔄', yellowcard:'🟨', yellowredcard:'🟨🟥', redcard:'🟥', var:'📺' };

  const evHtml = m.eventos && m.eventos.length
    ? m.eventos.map(ev => {
        const icon = eventIcons[ev.tipo] || '•';
        const min  = ev.extra ? `${ev.minuto}+${ev.extra}'` : `${ev.minuto}'`;
        return `<div class="live-event">
          <span class="live-min">${min}</span>
          <span class="live-icon">${icon}</span>
          <span class="live-team">${ev.equipo}</span>
          <span class="live-player">${ev.jugador}${ev.asistente ? ` <small>(${ev.asistente})</small>` : ''}</span>
        </div>`;
      }).join('')
    : '';

  const statsHtml = m.stats ? buildStatsBars(m.local, m.visitante, m.stats) : '';

  const poissonHtml = m.poisson ? `
    <div style="margin-top:1rem">
      <div class="section-title" style="font-size:.75rem">🎯 Predicción Poisson</div>
      <div class="prob-bar" style="height:10px;margin-bottom:.5rem">
        <div class="ph" style="width:${m.poisson.prob_home}%"></div>
        <div class="pd" style="width:${m.poisson.prob_draw}%"></div>
        <div class="pa" style="width:${m.poisson.prob_away}%"></div>
      </div>
      <div class="prob-labels">
        <span class="ph-l">${m.poisson.prob_home}%</span>
        <span style="color:var(--text3)">${m.poisson.prob_draw}%</span>
        <span class="pa-l">${m.poisson.prob_away}%</span>
      </div>
      <div class="match-xg" style="margin-top:.4rem">
        xG: <span>${m.poisson.lambda_h}</span>–<span>${m.poisson.lambda_a}</span>
        &nbsp;·&nbsp; O2.5: <span>${m.poisson.over25}%</span>
        &nbsp;·&nbsp; BTTS: <span>${m.poisson.btts}%</span>
      </div>
    </div>` : '';

  const alinHtml = buildLineups(m.local, m.visitante, m.alineaciones || []);

  const aiHtml = m.ai && m.ai.resumen ? `
    <div style="margin-top:1rem">
      <div class="section-title" style="font-size:.75rem">🤖 Análisis IA</div>
      <p style="font-size:.82rem;color:var(--text2);line-height:1.6">${m.ai.resumen}</p>
      ${m.ai.factores ? `<p style="font-size:.78rem;color:var(--text3);margin-top:.4rem">📌 ${m.ai.factores}</p>` : ''}
    </div>` : '';

  const h2hHtml = m.h2h && m.h2h.length ? `
    <div style="margin-top:1rem">
      <div class="section-title" style="font-size:.75rem">🔁 Historial H2H</div>
      ${m.h2h.map(h => `<div style="display:flex;justify-content:space-between;font-size:.78rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <span>${flag(h.local)} ${h.local}</span>
        <strong style="color:var(--gold)">${h.goles_local} – ${h.goles_visitante}</strong>
        <span>${flag(h.visitante)} ${h.visitante}</span>
      </div>`).join('')}
    </div>` : '';

  return `<div style="padding:1rem;background:var(--bg2);border-top:1px solid var(--border)">
    ${evHtml ? `<div class="section-title" style="font-size:.75rem">📋 Eventos</div><div class="live-events-list">${evHtml}</div>` : ''}
    ${statsHtml}
    ${poissonHtml}
    ${alinHtml}
    ${aiHtml}
    ${h2hHtml}
  </div>`;
}

function buildStatsBars(local, visitante, s) {
  const rows = [
    ['Posesión %',    s.posesion_local,    s.posesion_visitante,    100],
    ['Tiros',         s.tiros_local,       s.tiros_visitante,       null],
    ['Al arco',       s.tiros_arco_local,  s.tiros_arco_visitante,  null],
    ['Corners',       s.corners_local,     s.corners_visitante,     null],
    ['Faltas',        s.faltas_local,      s.faltas_visitante,      null],
    ['Amarillas 🟨', s.amarillas_local,   s.amarillas_visitante,   null],
    ['Rojas 🟥',     s.rojas_local,       s.rojas_visitante,       null],
  ].filter(([,l,v]) => (l||0) + (v||0) > 0);

  if (!rows.length) return '';
  return `<div style="margin-top:1rem">
    <div class="section-title" style="font-size:.75rem">📊 Estadísticas</div>
    <div class="stats-compare">
      <div class="stats-header">
        <span class="stats-team-l">${flag(local)} ${local}</span>
        <span></span>
        <span class="stats-team-r">${flag(visitante)} ${visitante}</span>
      </div>
      ${rows.map(([label, lv, rv, max]) => {
        const total = max || (Number(lv||0) + Number(rv||0)) || 1;
        const lPct  = Math.round(Number(lv||0) / total * 100);
        const rPct  = Math.round(Number(rv||0) / total * 100);
        return `<div class="stat-row">
          <span class="stat-val-l">${lv||0}</span>
          <div class="stat-bar-wrap">
            <div class="stat-bar-l" style="width:${lPct}%"></div>
            <span class="stat-label">${label}</span>
            <div class="stat-bar-r" style="width:${rPct}%"></div>
          </div>
          <span class="stat-val-r">${rv||0}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function buildLineups(local, visitante, alineaciones) {
  if (!alineaciones.length) return '';
  const local11  = alineaciones.filter(a => a.equipo === local  && a.rol === 'titular').sort((a,b)=>a.numero-b.numero);
  const visit11  = alineaciones.filter(a => a.equipo === visitante && a.rol === 'titular').sort((a,b)=>a.numero-b.numero);
  const localSub = alineaciones.filter(a => a.equipo === local  && a.rol !== 'titular');
  const visitSub = alineaciones.filter(a => a.equipo === visitante && a.rol !== 'titular');

  if (!local11.length && !visit11.length) return '';

  const playerRow = p => `<div class="lineup-player"><span class="lineup-num">${p.numero}</span><span>${p.jugador}</span><span class="lineup-pos">${p.posicion||''}</span></div>`;

  return `<div style="margin-top:1rem">
    <div class="section-title" style="font-size:.75rem">👥 Alineaciones</div>
    <div class="lineups-grid">
      <div class="lineup-col">
        <div class="lineup-team">${flag(local)} ${local}</div>
        ${local11.map(playerRow).join('')}
        ${localSub.length ? `<div class="lineup-subs">Suplentes: ${localSub.map(p=>p.jugador).join(', ')}</div>` : ''}
      </div>
      <div class="lineup-col">
        <div class="lineup-team">${flag(visitante)} ${visitante}</div>
        ${visit11.map(playerRow).join('')}
        ${visitSub.length ? `<div class="lineup-subs">Suplentes: ${visitSub.map(p=>p.jugador).join(', ')}</div>` : ''}
      </div>
    </div>
  </div>`;
}

// ─── Sección: EQUIPOS ─────────────────────────────────────────────────────────
async function renderTeams() {
  document.getElementById('section-teams').innerHTML = loadingHtml();
  try {
    const teams = await getData('teams', 10 * 60 * 1000);
    if (!teams.length) {
      document.getElementById('section-teams').innerHTML =
        `<div class="error-state"><div class="icon">🏳️</div><p>No hay datos de equipos aún.</p></div>`;
      return;
    }

    const grupos = {};
    teams.forEach(t => {
      const g = t.grupo || 'Sin grupo';
      if (!grupos[g]) grupos[g] = [];
      grupos[g].push(t);
    });

    const formaColor = r => ({ W:'var(--green)', D:'var(--text3)', L:'var(--red)' })[r] || 'var(--text3)';

    document.getElementById('section-teams').innerHTML = Object.keys(grupos).sort().map(g => `
      <div style="margin-bottom:1.5rem">
        <h3 class="section-title">Grupo ${g}</h3>
        <div class="teams-grid">
          ${grupos[g].map(t => `
            <div class="team-card">
              <div class="team-card-top">
                <span class="team-flag-big">${flag(t.nombre)}</span>
                <div>
                  <div class="team-name-big">${t.nombre}</div>
                  <div style="font-size:.72rem;color:var(--text3)">${t.confederacion||''} ${t.entrenador ? `· ${t.entrenador}` : ''}</div>
                </div>
                ${t.pos ? `<div class="team-pos">#${t.pos} <small style="color:var(--text3)">${t.pts}pts</small></div>` : ''}
              </div>
              ${t.elo ? `<div class="team-elo">ELO <strong style="color:var(--gold)">${Math.round(t.elo)}</strong></div>` : ''}
              ${t.forma ? `<div class="team-forma">${t.forma.split('').slice(-5).map(r =>
                `<span class="forma-dot" style="background:${formaColor(r)}">${r}</span>`
              ).join('')}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`).join('');
  } catch(e) {
    document.getElementById('section-teams').innerHTML = errorHtml('Error equipos: ' + e.message);
  }
}

// ─── Sección: JUGADORES ──────────────────────────────────────────────────────
async function renderPlayers() {
  document.getElementById('section-players').innerHTML = loadingHtml();
  try {
    const players = await getData('players', 10 * 60 * 1000);
    if (!players.length) {
      document.getElementById('section-players').innerHTML =
        `<div class="error-state"><div class="icon">👤</div><p>No hay estadísticas de jugadores aún. Se cargan al terminar los partidos.</p></div>`;
      return;
    }
    document.getElementById('section-players').innerHTML = `
    <div style="overflow-x:auto">
    <table class="standings-table">
      <thead><tr>
        <th>#</th><th>Jugador</th><th>Equipo</th>
        <th title="Goles">⚽</th><th title="Asistencias">🎯</th>
        <th title="Partidos">PJ</th><th title="Minutos">Min</th>
        <th title="Amarillas">🟨</th><th title="Rojas">🟥</th>
      </tr></thead>
      <tbody>${players.map((p, i) => `
        <tr>
          <td style="color:var(--text3)">${i+1}</td>
          <td><strong>${p.jugador}</strong></td>
          <td>${flag(p.equipo)} ${p.equipo}</td>
          <td><strong style="color:var(--gold)">${p.goles}</strong></td>
          <td>${p.asistencias}</td>
          <td style="color:var(--text2)">${p.partidos}</td>
          <td style="color:var(--text3)">${p.minutos}'</td>
          <td>${p.amarillas||0}</td>
          <td>${p.rojas||0}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
  } catch(e) {
    document.getElementById('section-players').innerHTML = errorHtml('Error jugadores: ' + e.message);
  }
}

// ─── Override renderHoy para añadir click → detalle ──────────────────────────
const _origRenderMatchCard = renderMatchCard;
function renderMatchCardClickable(m, poissonRows) {
  const inner = _origRenderMatchCard(m, poissonRows);
  const mk = m.match_key || '';
  if (!mk) return inner;
  const wrapped = inner.replace('<div class="match-card', `<div class="match-card" onclick="showMatchDetail('${mk}')" style="cursor:pointer"`);
  return wrapped + `<div id="detail-${mk}" class="match-detail-inline" style="display:none"></div>`;
}

// ─── Navegación ───────────────────────────────────────────────────────────────
let liveRefreshInterval = null;

const renderers = {
  hoy:         renderHoy,
  live:        renderLive,
  tabla:       renderStandings,
  ev:          renderEV,
  elo:         renderElo,
  simulacion:  renderSimulation,
  rendimiento: renderPerformance,
  equipos:     renderTeams,
  jugadores:   renderPlayers
};

function showSection(id) {
  document.querySelectorAll('.section-panel').forEach(s => s.style.display = s.id === `panel-${id}` ? '' : 'none');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.section === id));

  // Auto-polling en vivo cada 30s
  if (liveRefreshInterval) { clearInterval(liveRefreshInterval); liveRefreshInterval = null; }
  if (id === 'live') {
    liveRefreshInterval = setInterval(() => { delete cache['live']; renderLive(); }, 30 * 1000);
  }

  if (renderers[id]) renderers[id]();
}

// ─── Login ────────────────────────────────────────────────────────────────────
function showLogin(errorMsg) {
  document.getElementById('app-content').style.display   = 'none';
  document.getElementById('config-banner').style.display = 'none';
  document.getElementById('login-screen').style.display  = '';
  const errEl = document.getElementById('login-error');
  errEl.textContent    = errorMsg || '';
  errEl.style.display  = errorMsg ? '' : 'none';
}

function initApp() {
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('config-banner').style.display = 'none';
  document.getElementById('app-content').style.display   = '';
  const tnEl = document.getElementById('torneo-nombre');
  const teEl = document.getElementById('torneo-emoji');
  if (tnEl) tnEl.textContent = TORNEO_NOMBRE;
  if (teEl) teEl.textContent = TORNEO_EMOJI;

  document.querySelectorAll('nav a').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); showSection(a.dataset.section); })
  );
  showSection('hoy');

  setInterval(() => {
    delete cache['dashboard'];
    delete cache['ev'];
    const sec = document.querySelector('nav a.active')?.dataset.section;
    if (sec && renderers[sec]) renderers[sec]();
  }, 5 * 60 * 1000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!WORKER_URL) {
    document.getElementById('config-banner').style.display = '';
    document.getElementById('app-content').style.display   = 'none';
    document.getElementById('login-screen').style.display  = 'none';
    return;
  }

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const key = document.getElementById('login-key').value.trim();
    saveKey(key);
    try {
      await fetchTab('dashboard');
      initApp();
    } catch (err) {
      if (err.message !== 'Unauthorized') initApp(); // error de red, dejar pasar
    }
  });

  if (getSavedKey()) {
    fetchTab('dashboard')
      .then(() => initApp())
      .catch(err => err.message === 'Unauthorized' ? showLogin() : initApp());
  } else {
    showLogin();
  }
});
