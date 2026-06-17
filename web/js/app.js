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

// ─── Navegación ───────────────────────────────────────────────────────────────
const renderers = {
  hoy: renderHoy, tabla: renderStandings, ev: renderEV,
  elo: renderElo, simulacion: renderSimulation, rendimiento: renderPerformance
};

function showSection(id) {
  document.querySelectorAll('.section-panel').forEach(s => s.style.display = s.id === `panel-${id}` ? '' : 'none');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.section === id));
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
  document.getElementById('torneo-nombre').textContent   = TORNEO_NOMBRE;
  document.getElementById('torneo-emoji').textContent    = TORNEO_EMOJI;

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
