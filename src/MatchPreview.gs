/**
 * MatchPreview.gs
 *
 * Construye el contexto completo de previa para un partido próximo.
 *
 * Agrega al input base (fixture + clima + noticias + cuotas):
 *   - Estado del grupo (posiciones, puntos, quién clasifica/queda eliminado)
 *   - Jugadores en riesgo de suspensión (≥2 amarillas acumuladas)
 *   - Jugadores con mención de lesión en noticias recientes
 *   - Rendimiento reciente de jugadores clave (rating del último partido)
 *   - Resumen H2H del partido
 *   - Contexto de la jornada (primera fase de grupos vs segunda vs eliminatorias)
 */

/**
 * Construye el input completo para OpenAI dado un fixture y sus datos de enriquecimiento.
 *
 * @param {Object} fixture    - Objeto fixture de API-Football
 * @param {Object} weather    - Objeto devuelto por fetchWeatherForFixture_
 * @param {Array}  news       - Array de artículos de noticias
 * @param {Object} baseOdds   - Objeto devuelto por calculateBasicOddsSignals_
 * @returns {Object}
 */
function buildEnrichedPreviewInput_(fixture, weather, news, baseOdds) {
  const homeTeam  = fixture.teams.home.name;
  const awayTeam  = fixture.teams.away.name;
  const fixtureId = fixture.fixture.id;
  const round     = fixture.league.round || '';

  const base = {
    fixture_id:  fixtureId,
    match: {
      home:             homeTeam,
      away:             awayTeam,
      date_utc:         fixture.fixture.date,
      date_chile:       toChileDateTime_(fixture.fixture.date),
      venue:            fixture.fixture.venue,
      round,
      stage:            classifyStage_(round)
    },
    league:  fixture.league,
    weather: weather || {},
    news:    (news || []).slice(0, 12),
    odds:    baseOdds || {}
  };

  base.group_context     = buildGroupContext_(homeTeam, awayTeam, round);
  base.suspension_risks  = buildSuspensionRisks_(homeTeam, awayTeam);
  base.injury_mentions   = extractInjuryMentions_(news || [], homeTeam, awayTeam);
  base.player_form       = buildPlayerFormContext_(homeTeam, awayTeam);
  base.h2h_summary       = buildH2HSummaryForPreview_(fixtureId, homeTeam, awayTeam);
  base.standings_stakes  = buildStandingsStakes_(homeTeam, awayTeam);
  base.referee           = getRefereeContextForFixture_(fixture);

  return base;
}

// ─── Contexto del grupo ────────────────────────────────────────────────────────

function buildGroupContext_(homeTeam, awayTeam) {
  try {
    const ss    = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName('Clasificacion');
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const rows = readAll_('Clasificacion');

    const homeRow = rows.find(r => teamNameMatches_(r.equipo, homeTeam));
    const awayRow = rows.find(r => teamNameMatches_(r.equipo, awayTeam));

    if (!homeRow && !awayRow) return null;

    const grupo = homeRow ? homeRow.grupo : awayRow.grupo;
    const groupRows = rows
      .filter(r => r.grupo === grupo)
      .sort((a, b) => Number(a.posicion) - Number(b.posicion));

    return {
      grupo,
      tabla: groupRows.map(r => ({
        pos:    r.posicion,
        equipo: r.equipo,
        pj:     r.pj,
        pg:     r.pg,
        pe:     r.pe,
        pp:     r.pp,
        gd:     r.gd,
        pts:    r.puntos,
        forma:  r.forma || '',
        clasificacion: r.descripcion || ''
      })),
      home_standing: homeRow ? {
        pos:  homeRow.posicion,
        pts:  homeRow.puntos,
        pj:   homeRow.pj,
        gd:   homeRow.gd,
        forma: homeRow.forma || ''
      } : null,
      away_standing: awayRow ? {
        pos:  awayRow.posicion,
        pts:  awayRow.puntos,
        pj:   awayRow.pj,
        gd:   awayRow.gd,
        forma: awayRow.forma || ''
      } : null
    };
  } catch (e) {
    console.warn('buildGroupContext_:', e.message);
    return null;
  }
}

// ─── Riesgo de suspensión ─────────────────────────────────────────────────────

function buildSuspensionRisks_(homeTeam, awayTeam) {
  const risks = { home: [], away: [] };

  try {
    const rows = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

    const byPlayer = {};
    rows.forEach(r => {
      const equipo = String(r.team_name || r.equipo || '');
      const isHome = teamNameMatches_(equipo, homeTeam);
      const isAway = teamNameMatches_(equipo, awayTeam);
      if (!isHome && !isAway) return;

      const key = String(r.player_id || r.jugador_id || r.player_name || r.jugador || '');
      if (!key) return;

      if (!byPlayer[key]) {
        byPlayer[key] = {
          nombre:    r.player_name || r.jugador || key,
          equipo,
          side:      isHome ? 'home' : 'away',
          amarillas: 0,
          rojas:     0,
          partidos:  0
        };
      }
      byPlayer[key].amarillas += Number(r.yellow_cards || r.tarjetas_amarillas || 0);
      byPlayer[key].rojas     += Number(r.red_cards    || r.tarjetas_rojas     || 0);
      byPlayer[key].partidos++;
    });

    Object.values(byPlayer).forEach(p => {
      if (p.amarillas >= 2) {
        risks[p.side].push({
          jugador:   p.nombre,
          equipo:    p.equipo,
          amarillas: p.amarillas,
          nivel:     p.amarillas >= 3 ? 'SUSPENSION_SEGURA' : 'RIESGO_ALTO'
        });
      }
    });

    risks.home.sort((a, b) => b.amarillas - a.amarillas);
    risks.away.sort((a, b) => b.amarillas - a.amarillas);
  } catch (e) {
    console.warn('buildSuspensionRisks_:', e.message);
  }

  return risks;
}

// ─── Menciones de lesión en noticias ─────────────────────────────────────────

const INJURY_KEYWORDS = [
  'lesion', 'lesionado', 'injury', 'injured', 'baja', 'duda', 'doubt',
  'out', 'ruled out', 'muscular', 'tobillo', 'rodilla', 'ankle', 'knee',
  'muscle', 'recuper', 'rehab', 'baje', 'no jugará', 'descartado', 'ruled'
];

function extractInjuryMentions_(news, homeTeam, awayTeam) {
  const mentions = [];

  news.forEach(item => {
    const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();

    const hasInjuryWord = INJURY_KEYWORDS.some(kw => text.includes(kw));
    if (!hasInjuryWord) return;

    const isHome = text.includes(homeTeam.toLowerCase().split(' ')[0]);
    const isAway = text.includes(awayTeam.toLowerCase().split(' ')[0]);

    if (hasInjuryWord && (isHome || isAway)) {
      mentions.push({
        equipo: isHome ? homeTeam : awayTeam,
        titular: item.title || '',
        fuente:  item.source || 'Google News',
        fecha:   String(item.pubDate || '').substring(0, 16)
      });
    }
  });

  return mentions.slice(0, 6);
}

// ─── Forma reciente de jugadores clave ────────────────────────────────────────

function buildPlayerFormContext_(homeTeam, awayTeam) {
  const form = { home: [], away: [] };

  try {
    const statsRows = readAll_(CONFIG.SHEETS.PLAYER_MATCH_STATS);
    if (!statsRows.length) return form;

    const byPlayer = {};
    statsRows.forEach(r => {
      const equipo = String(r.team_name || '');
      const isHome = teamNameMatches_(equipo, homeTeam);
      const isAway = teamNameMatches_(equipo, awayTeam);
      if (!isHome && !isAway) return;

      const key  = String(r.player_id || '');
      const rat  = Number(r.rating);
      if (!key || !rat) return;

      if (!byPlayer[key] || String(r.fixture_id) > String(byPlayer[key].fixture_id)) {
        byPlayer[key] = {
          nombre:     r.player_name || '',
          equipo,
          side:       isHome ? 'home' : 'away',
          fixture_id: r.fixture_id,
          rating:     rat,
          goles:      Number(r.goals_scored || 0),
          asistencias: Number(r.assists || 0),
          minutos:    Number(r.minutes_played || 0)
        };
      }
    });

    Object.values(byPlayer).forEach(p => {
      if (p.rating >= 7.0 && p.minutos >= 45) {
        form[p.side].push({
          jugador:     p.nombre,
          rating:      p.rating,
          goles:       p.goles,
          asistencias: p.asistencias,
          minutos:     p.minutos
        });
      }
    });

    form.home.sort((a, b) => b.rating - a.rating).splice(5);
    form.away.sort((a, b) => b.rating - a.rating).splice(5);
  } catch (e) {
    console.warn('buildPlayerFormContext_:', e.message);
  }

  return form;
}

// ─── H2H para el prompt ───────────────────────────────────────────────────────

function buildH2HSummaryForPreview_(fixtureId, homeTeam, awayTeam) {
  try {
    const ss    = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName('HistorialH2H');
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const rows = readAll_('HistorialH2H').filter(r =>
      String(r.fixture_ref_id || '') === String(fixtureId)
    );

    if (!rows.length) return null;

    const wins = { home: 0, away: 0, draw: 0 };
    const matches = rows.slice(0, 5).map(r => {
      const res = String(r.resultado || '');
      if (res === 'Empate')                             wins.draw++;
      else if (teamNameMatches_(res, homeTeam))         wins.home++;
      else                                              wins.away++;

      return {
        fecha:    String(r.fecha || '').substring(0, 10),
        local:    r.local,
        visitante: r.visitante,
        resultado: `${r.goles_local}-${r.goles_visitante}`,
        torneo:   r.torneo || ''
      };
    });

    return { partidos: matches, victorias: wins };
  } catch (e) {
    console.warn('buildH2HSummaryForPreview_:', e.message);
    return null;
  }
}

// ─── Qué se juega cada equipo en este partido ─────────────────────────────────

function buildStandingsStakes_(homeTeam, awayTeam) {
  try {
    const ss    = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName('Clasificacion');
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const rows  = readAll_('Clasificacion');
    const homeR = rows.find(r => teamNameMatches_(r.equipo, homeTeam));
    const awayR = rows.find(r => teamNameMatches_(r.equipo, awayTeam));

    const stakes = {};

    if (homeR) stakes.home = describeStakes_(homeR, rows, homeTeam);
    if (awayR) stakes.away = describeStakes_(awayR, rows, awayTeam);

    return Object.keys(stakes).length ? stakes : null;
  } catch (e) {
    console.warn('buildStandingsStakes_:', e.message);
    return null;
  }
}

function describeStakes_(row, allRows, teamName) {
  const grupo     = row.grupo;
  const groupRows = allRows
    .filter(r => r.grupo === grupo)
    .sort((a, b) => Number(a.posicion) - Number(b.posicion));

  const pos    = Number(row.posicion);
  const pj     = Number(row.pj || 0);
  const pts    = Number(row.puntos || 0);
  const total  = groupRows.length;
  const desc   = String(row.descripcion || '').toLowerCase();

  if (desc.includes('eliminat')) return `Eliminado`;
  if (desc.includes('advance'))  return `Ya clasificado`;

  if (pj === 0) return `Primer partido del torneo`;
  if (pj === 1) {
    if (pos === 1) return `Líder del grupo con ${pts} pts — debe mantener ventaja`;
    if (pos <= 2)  return `En zona de clasificación (${pos}°, ${pts} pts) — ganar asegura ventaja`;
    return `Fuera de zona (${pos}°, ${pts} pts) — necesita resultado positivo`;
  }
  if (pj === 2) {
    const secondRow = groupRows[1];
    if (pos === 1 && pts >= 6) return `Líder con ${pts}/6 pts — ya muy cerca de clasificar`;
    if (pos <= 2)  return `En zona de clasificación (${pos}°, ${pts}/6 pts) — empate podría bastar`;
    if (pts === 0) return `Sin puntos tras 2 partidos — DEBE ganar para seguir vivo`;
    return `(${pos}°, ${pts}/6 pts) — necesita resultado específico según otros partidos`;
  }

  return `Pos ${pos} con ${pts} pts`;
}

// ─── Clasificar etapa del torneo ──────────────────────────────────────────────

function classifyStage_(round) {
  const r = String(round || '').toLowerCase();
  if (r.includes('group'))      return 'group_stage';
  if (r.includes('round of 16') || r.includes('16')) return 'round_of_16';
  if (r.includes('quarter'))    return 'quarter_final';
  if (r.includes('semi'))       return 'semi_final';
  if (r.includes('final'))      return 'final';
  return 'unknown';
}

// ─── Helper matching tolerante de nombres ─────────────────────────────────────

function teamNameMatches_(a, b) {
  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}
