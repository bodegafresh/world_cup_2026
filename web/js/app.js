// ─── Utilidades ──────────────────────────────────────────────────────────────

const FLAGS = {
  'Argentina':'🇦🇷','Brasil':'🇧🇷','Francia':'🇫🇷','Alemania':'🇩🇪','España':'🇪🇸',
  'England':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Inglaterra':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Portugal':'🇵🇹','Países Bajos':'🇳🇱','Belgium':'🇧🇪',
  'Bélgica':'🇧🇪','Uruguay':'🇺🇾','Colombia':'🇨🇴','México':'🇲🇽','USA':'🇺🇸',
  'Estados Unidos':'🇺🇸','Canadá':'🇨🇦','Canada':'🇨🇦','Marruecos':'🇲🇦','Senegal':'🇸🇳',
  'Japón':'🇯🇵','Corea del Sur':'🇰🇷','Australia':'🇦🇺','Ecuador':'🇪🇨','Chile':'🇨🇱',
  'Perú':'🇵🇪','Venezuela':'🇻🇪','Bolivia':'🇧🇴','Paraguay':'🇵🇾','Costa Rica':'🇨🇷',
  'Panamá':'🇵🇦','Honduras':'🇭🇳','Jamaica':'🇯🇲','Qatar':'🇶🇦','Arabia Saudita':'🇸🇦',
  'Irán':'🇮🇷','Irak':'🇮🇶','Suiza':'🇨🇭','Croacia':'🇭🇷','Serbia':'🇷🇸',
  'Polonia':'🇵🇱','Dinamarca':'🇩🇰','Austria':'🇦🇹','Turquía':'🇹🇷','Ucrania':'🇺🇦',
  'Nigeria':'🇳🇬','Ghana':'🇬🇭','Costa de Marfil':'🇨🇮','Camerún':'🇨🇲','Túnez':'🇹🇳',
  'Egipto':'🇪🇬','Argelia':'🇩🇿','Suecia':'🇸🇪','Noruega':'🇳🇴','Escocia':'🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'Italia':'🇮🇹','Rep. Checa':'🇨🇿','Eslovaquia':'🇸🇰','Hungría':'🇭🇺','Rumanía':'🇷🇴',
  'Grecia':'🇬🇷','Albania':'🇦🇱','Georgia':'🇬🇪','Eslovenia':'🇸🇮','Austria':'🇦🇹',
  'China':'🇨🇳','India':'🇮🇳','Nueva Zelanda':'🇳🇿','Arabia Saudita':'🇸🇦','Panamá':'🇵🇦'
};
const flag = t => FLAGS[t] || '🏳️';

const fmt = {
  pct:  v => `${Number(v||0).toFixed(1)}%`,
  dec:  v => Number(v||0).toFixed(2),
  int:  v => Math.round(Number(v||0)),
  sign: v => { const n = Number(v||0); return (n>0?'+':'')+n.toFixed(1)+'%'; }
};

function evColor(ev) {
  const v = Number(ev) * 100;
  if (v >= 10) return 'alta';
  if (v >= 5)  return 'media';
  return 'baja';
}

function probBarColor(p) {
  const v = Number(p);
  if (v >= 65) return '#00c853';
  if (v >= 45) return '#ffd700';
  return '#90a4ae';
}

function simBarColor(p) {
  if (p >= 70) return '#00c853';
  if (p >= 40) return '#ffd700';
  return '#ff7043';
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchTab(tab) {
  if (!GAS_URL) throw new Error('GAS_URL no configurado en config.js');
  const url = `${GAS_URL}?tab=${tab}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json.data;
}

// ─── Estado de la app ─────────────────────────────────────────────────────────

const state = {
  activeSection: 'hoy',
  activeGroup:   'A',
  data: {}
};

// ─── Render helpers ───────────────────────────────────────────────────────────

function loading(html = '') {
  return `<div class="loading-center"><div class="spinner"></div><span>Cargando...</span></div>${html}`;
}

function skeletonCards(n = 3) {
  return `<div class="matches-grid">${'<div class="skeleton skel-card"></div>'.repeat(n)}</div>`;
}

function error(msg) {
  return `<div class="error-state"><div class="icon">⚠️</div><p>${msg}</p></div>`;
}

// ─── Render: Match card ───────────────────────────────────────────────────────

function renderMatchCard(m, predictions) {
  const pred   = predictions && predictions.find(p => p.match_key === m.match_key);
  const isLive = ['1H','2H','HT','ET','BT','P'].includes(String(m.status||'').toUpperCase());
  const isFT   = ['FT','AET','PEN'].includes(String(m.status||'').toUpperCase());
  const hScore = m.goles_local     != null ? m.goles_local     : '';
  const aScore = m.goles_visitante != null ? m.goles_visitante : '';
  const hasScore = hScore !== '' && aScore !== '';

  const statusHtml = isLive
    ? `<span class="status-live">🔴 EN VIVO ${m.status}</span>`
    : isFT ? `<span class="status-ft">FT</span>`
    : `<span>${m.hora || ''}</span>`;

  const scoreHtml = hasScore
    ? `<div class="match-score">${hScore} - ${aScore}</div>`
    : `<div class="match-score pending">${m.hora || 'vs'}</div>`;

  let probHtml = '';
  if (pred && pred.poisson) {
    const ph = parseFloat(pred.poisson.prob_home);
    const pd = parseFloat(pred.poisson.prob_draw);
    const pa = parseFloat(pred.poisson.prob_away);
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
        xG: <span>${pred.poisson.lambda_h}</span> - <span>${pred.poisson.lambda_a}</span>
        &nbsp;·&nbsp; O2.5: <span>${fmt.pct(pred.poisson.over25)}</span>
        &nbsp;·&nbsp; BTTS: <span>${fmt.pct(pred.poisson.btts)}</span>
      </div>`;
  }

  return `
  <div class="match-card${isLive?' live':''}">
    <div class="match-meta">
      <span class="grupo">${m.grupo||m.ronda||''}</span>
      ${statusHtml}
    </div>
    <div class="match-teams">
      <div class="match-team">
        <div class="flag">${flag(m.local)}</div>
        <div class="name">${m.local}</div>
      </div>
      ${scoreHtml}
      <div class="match-team">
        <div class="flag">${flag(m.visitante)}</div>
        <div class="name">${m.visitante}</div>
      </div>
    </div>
    ${probHtml}
  </div>`;
}

// ─── Render: Sección HOY ──────────────────────────────────────────────────────

async function renderHoy() {
  const el = document.getElementById('section-hoy');
  el.innerHTML = skeletonCards(4);

  try {
    const [dash, preds] = await Promise.all([
      state.data.dashboard || fetchTab('dashboard').then(d => { state.data.dashboard = d; return d; }),
      state.data.predictions || fetchTab('predictions').then(d => { state.data.predictions = d; return d; })
    ]);
    state.data.dashboard    = dash;
    state.data.predictions  = preds;

    let html = '';

    if (dash.en_vivo && dash.en_vivo.length) {
      html += `<h3 class="section-title">🔴 En vivo</h3>
               <div class="matches-grid">
                 ${dash.en_vivo.map(m => renderMatchCard(m, preds)).join('')}
               </div>`;
    }

    const proximos = dash.hoy || [];
    if (proximos.length) {
      html += `<h3 class="section-title" style="margin-top:1.5rem">⚽ Hoy</h3>
               <div class="matches-grid">
                 ${proximos.map(m => renderMatchCard(m, preds)).join('')}
               </div>`;
    }

    if (dash.mañana && dash.mañana.length) {
      html += `<h3 class="section-title" style="margin-top:1.5rem">📅 Mañana</h3>
               <div class="matches-grid">
                 ${dash.mañana.map(m => renderMatchCard(m, preds)).join('')}
               </div>`;
    }

    if (!html) {
      html = `<div class="error-state"><div class="icon">📅</div><p>No hay partidos próximos registrados.</p></div>`;
    }

    // Badge live en header
    if (dash.en_vivo && dash.en_vivo.length) {
      document.getElementById('live-badge').style.display = 'inline-flex';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = error('No se pudo cargar los partidos: ' + e.message);
  }
}

// ─── Render: Tabla de posiciones ─────────────────────────────────────────────

async function renderStandings(groupKey) {
  const el = document.getElementById('standings-content');
  el.innerHTML = `<div class="skeleton skel-row"></div>`.repeat(4);

  try {
    const data = state.data.standings || await fetchTab('standings').then(d => { state.data.standings = d; return d; });
    state.data.standings = data;

    const grupos = Object.keys(data).sort();

    // Render tabs si no existen
    const tabsEl = document.getElementById('groups-tabs');
    if (!tabsEl.children.length) {
      tabsEl.innerHTML = grupos.map(g =>
        `<button class="group-tab${g===state.activeGroup?' active':''}" onclick="switchGroup('${g}')">Grupo ${g}</button>`
      ).join('');
    }

    const group = data[groupKey || state.activeGroup] || data[grupos[0]] || [];

    el.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th>
          <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
        </tr>
      </thead>
      <tbody>
        ${group.map((t, i) => `
          <tr class="${i < 2 ? 'classify' : ''}">
            <td>${t.pos}</td>
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
    el.innerHTML = error('No se pudo cargar la tabla: ' + e.message);
  }
}

function switchGroup(g) {
  state.activeGroup = g;
  document.querySelectorAll('.group-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === `Grupo ${g}`);
  });
  renderStandings(g);
}

// ─── Render: EV Opportunities ────────────────────────────────────────────────

async function renderEV() {
  const el = document.getElementById('section-ev');
  el.innerHTML = `<div class="skeleton skel-row"></div>`.repeat(5);

  try {
    const data = state.data.ev || await fetchTab('ev').then(d => { state.data.ev = d; return d; });
    state.data.ev = data;

    if (!data.length) {
      el.innerHTML = `<div class="error-state"><div class="icon">🔍</div><p>Sin oportunidades EV+ por ahora.</p></div>`;
      return;
    }

    el.innerHTML = `
    <div style="overflow-x:auto">
    <table class="ev-table">
      <thead>
        <tr>
          <th>Partido</th><th>Mercado</th><th>Selección</th>
          <th>Modelo</th><th>Cuota</th><th>EV</th><th>Kelly</th><th>Fuente</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td>${flag(r.local)}${r.local} vs ${flag(r.visitante)}${r.visitante}<br>
                <small style="color:var(--text3)">${r.fecha}</small></td>
            <td><small>${r.mercado}</small></td>
            <td><strong>${r.seleccion}</strong></td>
            <td>${fmt.pct(r.prob_modelo * 100)}</td>
            <td><strong style="color:var(--gold)">${fmt.dec(r.cuota)}</strong></td>
            <td><span class="ev-badge ${evColor(r.ev)}">+${(r.ev*100).toFixed(1)}%</span></td>
            <td style="color:var(--text2)">${(r.kelly*100).toFixed(1)}%</td>
            <td><small style="color:var(--text3)">${r.fuente}</small></td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <p style="font-size:.7rem;color:var(--text3);margin-top:.75rem">
      EV = (Prob. modelo × cuota) − 1 · Cuotas: The Odds API / Pinnacle
    </p>`;
  } catch (e) {
    el.innerHTML = error('No se pudo cargar EV: ' + e.message);
  }
}

// ─── Render: ELO Rankings ────────────────────────────────────────────────────

async function renderElo() {
  const el = document.getElementById('section-elo');
  el.innerHTML = loading();

  try {
    const data = state.data.elo || await fetchTab('elo').then(d => { state.data.elo = d; return d; });
    state.data.elo = data;

    const top20 = data.slice(0, 20);

    el.innerHTML = `<div class="elo-chart-wrap"><canvas id="elo-chart"></canvas></div>`;

    const ctx = document.getElementById('elo-chart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top20.map(t => `${flag(t.equipo)} ${t.equipo}`),
        datasets: [{
          label: 'ELO',
          data: top20.map(t => t.elo),
          backgroundColor: top20.map((t, i) =>
            i === 0 ? '#ffd700' : i < 4 ? '#00c853' : i < 8 ? '#448aff' : '#546e7a'
          ),
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ELO: ${ctx.parsed.x}`
            }
          }
        },
        scales: {
          x: {
            grid:  { color: 'rgba(30,45,77,.5)' },
            ticks: { color: '#90a4ae' },
            min:   top20.length ? top20[top20.length-1].elo - 50 : 1500
          },
          y: {
            grid:  { display: false },
            ticks: { color: '#e8eaf6', font: { size: 12 } }
          }
        }
      }
    });
  } catch (e) {
    el.innerHTML = error('No se pudo cargar ELO: ' + e.message);
  }
}

// ─── Render: Simulación ───────────────────────────────────────────────────────

async function renderSimulation() {
  const el = document.getElementById('section-sim');
  el.innerHTML = loading();

  try {
    const data = state.data.simulation || await fetchTab('simulation').then(d => { state.data.simulation = d; return d; });
    state.data.simulation = data;

    const grupos = Object.keys(data).sort();
    if (!grupos.length) {
      el.innerHTML = `<div class="error-state"><div class="icon">🎲</div><p>Simulación aún no disponible.</p></div>`;
      return;
    }

    el.innerHTML = `<div class="sim-grid">${grupos.map(g => {
      const teams = data[g];
      return `<div class="sim-group-card">
        <div class="sim-group-title">Grupo ${g}</div>
        ${teams.map(t => {
          const p = Number(t.prob_clasificar || 0);
          return `<div class="sim-row">
            <div class="team-name">${flag(t.equipo)} ${t.equipo}</div>
            <div class="sim-prob-bar-wrap">
              <div class="sim-prob-bar" style="width:${p}%;background:${simBarColor(p)}"></div>
            </div>
            <div class="prob-val" style="color:${simBarColor(p)}">${Math.round(p)}%</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}</div>
    <p style="font-size:.7rem;color:var(--text3);margin-top:.75rem">
      Probabilidad de clasificar a octavos de final (Monte Carlo 2000 simulaciones)
    </p>`;
  } catch (e) {
    el.innerHTML = error('No se pudo cargar la simulación: ' + e.message);
  }
}

// ─── Render: Performance ─────────────────────────────────────────────────────

async function renderPerformance() {
  const el = document.getElementById('section-perf');
  el.innerHTML = loading();

  try {
    const data = state.data.performance || await fetchTab('performance').then(d => { state.data.performance = d; return d; });
    state.data.performance = data;

    const cal  = data.calibration  || {};
    const bets = data.bettingStats || {};

    const cards = [
      { label: 'Brier Score',  val: cal.brier_score  ? cal.brier_score.toFixed(3)  : '—', type: 'blue',  note: 'Menor = mejor' },
      { label: 'Accuracy',     val: cal.accuracy     ? fmt.pct(cal.accuracy*100)    : '—', type: 'green', note: 'Predicciones correctas' },
      { label: 'Win Rate',     val: bets.win_rate    ? fmt.pct(bets.win_rate)       : '—', type: 'gold',  note: `${bets.ganadas||0}/${bets.total||0} apuestas` },
      { label: 'ROI',          val: bets.roi         ? fmt.sign(bets.roi)           : '—', type: Number(bets.roi||0)>=0?'green':'red', note: 'Retorno sobre inversión' },
    ];

    el.innerHTML = `<div class="perf-grid">${cards.map(c => `
      <div class="perf-card ${c.type}">
        <div class="val">${c.val}</div>
        <div class="label">${c.label}</div>
        <div style="font-size:.68rem;color:var(--text3);margin-top:.2rem">${c.note}</div>
      </div>`).join('')}</div>`;
  } catch (e) {
    el.innerHTML = error('No se pudo cargar rendimiento: ' + e.message);
  }
}

// ─── Navegación ───────────────────────────────────────────────────────────────

function showSection(id) {
  state.activeSection = id;

  document.querySelectorAll('.section-panel').forEach(s => {
    s.style.display = s.id === `panel-${id}` ? '' : 'none';
  });
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.section === id);
  });

  switch (id) {
    case 'hoy':         renderHoy();         break;
    case 'tabla':       renderStandings();   break;
    case 'ev':          renderEV();          break;
    case 'elo':         renderElo();         break;
    case 'simulacion':  renderSimulation();  break;
    case 'rendimiento': renderPerformance(); break;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!GAS_URL || !SPREADSHEET_ID) {
    document.getElementById('config-banner').style.display = '';
    document.getElementById('app-content').style.display   = 'none';
    return;
  }

  document.getElementById('config-banner').style.display = 'none';
  document.getElementById('app-content').style.display   = '';
  document.getElementById('torneo-nombre').textContent = TORNEO_NOMBRE;
  document.getElementById('torneo-emoji').textContent  = TORNEO_EMOJI;

  // Wiring de nav
  document.querySelectorAll('nav a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      showSection(a.dataset.section);
    });
  });

  showSection('hoy');

  // Auto-refresh cada 5 minutos
  setInterval(() => {
    state.data.dashboard   = null;
    state.data.predictions = null;
    if (state.activeSection === 'hoy') renderHoy();
    if (state.activeSection === 'ev')  { state.data.ev = null; renderEV(); }
  }, 5 * 60 * 1000);
});
