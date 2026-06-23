/**
 * CompetitionReadiness.gs
 *
 * Gobierno multi-competencia:
 * - Catálogo canónico desde CONFIG.LEAGUES.CATALOG.
 * - Estados OBSERVATION / PAPER_TRADING / BETTABLE / DISABLED.
 * - Readiness checks mínimos antes de permitir EV apostable.
 *
 * Regla dura: si la competencia no está en BETTABLE, EV real queda bloqueado.
 */

const COMPETITION_STATUSES = {
  OBSERVATION: 'OBSERVATION',
  PAPER_TRADING: 'PAPER_TRADING',
  BETTABLE: 'BETTABLE',
  DISABLED: 'DISABLED'
};

const COMPETITION_BLOCKED_DECISION = 'BLOCKED_COMPETITION_NOT_BETTABLE';

const COMPETITION_REQUIRED_CHECKS = [
  'fixtures_reliable',
  'results_reliable',
  'odds_sufficient',
  'aliases_normalized',
  'minimum_history',
  'separate_calibration',
  'liquidity_tier_defined',
  'closing_odds_available',
  'data_quality_clean',
  'backtest_available',
  'market_benchmark_available'
];

function getCompetitionSeasonIdFromLeague_(league) {
  if (!league) return 'WC2026';
  if (league.competition_season_id) return String(league.competition_season_id);
  if (String(league.name || '').toLowerCase().indexOf('world cup') !== -1) return 'WC2026';
  return String(league.id || 'WC2026') + '_' + String(league.season || '');
}

function getActiveCompetitionSeasonId_() {
  return getCompetitionSeasonIdFromLeague_(getActiveLeague_());
}

function getCompetitionSeasonIdFromFixture_(fixtureOrRow) {
  const row = fixtureOrRow || {};
  if (row.competition_season_id) return String(row.competition_season_id);
  if (row.league && row.league.competition_season_id) return String(row.league.competition_season_id);

  const leagueId = row.league_id || (row.league && row.league.id);
  const season = row.season || (row.league && row.league.season);
  if (leagueId) {
    const match = Object.keys(CONFIG.LEAGUES.CATALOG).map(function(k) {
      return CONFIG.LEAGUES.CATALOG[k];
    }).find(function(l) {
      return String(l.id) === String(leagueId) && (!season || String(l.season) === String(season));
    });
    if (match) return getCompetitionSeasonIdFromLeague_(match);
  }
  return getActiveCompetitionSeasonId_();
}

function getMatchTypeFromFixture_(fixtureOrRow) {
  const row = fixtureOrRow || {};
  const round = String((row.league && row.league.round) || row.fase || row.ronda || row.round || row.stage || '').toLowerCase();
  const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
  const league = row.league || getLeagueByCompetitionSeasonId_(competitionSeasonId) || getActiveLeague_();
  if (isTournamentSlotName_(row.local || row.equipo_local || row.home_team) ||
      isTournamentSlotName_(row.visitante || row.equipo_visitante || row.away_team)) return 'KNOCKOUT';
  if (round.indexOf('group') !== -1 || round.indexOf('grupo') !== -1) return 'GROUP_STAGE';
  if (round.indexOf('final') !== -1 || round.indexOf('semi') !== -1 || round.indexOf('quarter') !== -1 || round.indexOf('16') !== -1 || round.indexOf('knockout') !== -1) return 'KNOCKOUT';
  if (round.indexOf('qualif') !== -1 || round.indexOf('clasific') !== -1) return 'QUALIFIER';
  const inferredByCalendar = inferMatchTypeFromCompetitionCalendar_(league, normalizeFecha_(row.fecha || row.date || row.fecha_chile));
  if (inferredByCalendar) return inferredByCalendar;
  if (String(league.type || '').toLowerCase() === 'league') return 'LEAGUE_REGULAR';
  if (String(league.competition_id || '').indexOf('LIBERTADORES') !== -1 || String(league.region || '').toLowerCase().indexOf('south') !== -1 && String(league.type || '').toLowerCase() === 'cup') return 'CONTINENTAL_CLUB';
  if (String(league.type || '').toLowerCase() === 'cup' && String(league.country || '').toLowerCase() === 'world') return 'INTERNATIONAL_CUP';
  if (String(league.type || '').toLowerCase() === 'cup') return 'DOMESTIC_CUP';
  return 'LEAGUE_REGULAR';
}

function getLeagueByCompetitionSeasonId_(competitionSeasonId) {
  const id = String(competitionSeasonId || '');
  return Object.keys(CONFIG.LEAGUES.CATALOG).map(function(k) {
    return CONFIG.LEAGUES.CATALOG[k];
  }).find(function(l) {
    return getCompetitionSeasonIdFromLeague_(l) === id;
  }) || null;
}

function inferMatchTypeFromCompetitionCalendar_(league, date) {
  if (!league || !date) return '';
  const rules = league.stage_rules || {};
  if (String(league.format || '').toUpperCase() === 'GROUP_THEN_KNOCKOUT') {
    if (rules.group_stage_end && date <= rules.group_stage_end) return 'GROUP_STAGE';
    if (rules.knockout_start && date >= rules.knockout_start) return 'KNOCKOUT';
  }
  return '';
}

function getCompetitionCatalogRows_() {
  return Object.keys(CONFIG.LEAGUES.CATALOG).map(function(key) {
    const l = CONFIG.LEAGUES.CATALOG[key];
    const competitionSeasonId = getCompetitionSeasonIdFromLeague_(l);
    const competitionId = l.competition_id || competitionSeasonId.replace(/_\d+$/, '');
    const isLeague = String(l.type || '').toLowerCase() === 'league';
    const isCup = !isLeague;
    const isInternational = String(l.country || '').toLowerCase() === 'world' ||
      String(l.country || '').toLowerCase() === 'europe' ||
      String(l.country || '').toLowerCase().indexOf('america') !== -1 ||
      String(l.region || '').toLowerCase().indexOf('america') !== -1 && isCup;
    return {
      key: key,
      competition_id: competitionId,
      competition_season_id: competitionSeasonId,
      display_name: l.name,
      country: l.country || '',
      region: l.region || '',
      competition_type: isLeague ? 'domestic_league' : (isInternational ? 'continental_or_international_cup' : 'domestic_cup'),
      tier: l.tier || 1,
      is_international: Boolean(isInternational),
      is_domestic: !isInternational,
      is_cup: isCup,
      is_league: isLeague,
      season: l.season,
      format: isLeague ? 'domestic_league' : 'cup',
      home_advantage_policy: isLeague ? 'club_home_away' : (competitionSeasonId === 'WC2026' ? 'neutral_with_hosts' : 'club_home_away'),
      source_primary: competitionSeasonId === 'WC2026' ? 'espn' : 'api_football',
      odds_sport_key: l.sport_key,
      api_football_league_id: String(l.id || ''),
      strength_coefficient: l.home_adv || 1,
      target_status: l.target_status || COMPETITION_STATUSES.OBSERVATION,
      liquidity_tier: l.liquidity_tier || 'LOW'
    };
  });
}

function seedCompetitionCatalogToSupabase() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = getCompetitionCatalogRows_();
  const now = nowIso_();

  const competitions = {};
  rows.forEach(function(r) {
    competitions[r.competition_id] = {
      competition_id: r.competition_id,
      display_name: r.display_name,
      country: r.country,
      region: r.region,
      competition_type: r.competition_type,
      tier: r.tier,
      is_international: r.is_international,
      is_domestic: r.is_domestic,
      is_cup: r.is_cup,
      is_league: r.is_league,
      payload: { catalog_key: r.key, priority: getCompetitionPriority_(r.competition_season_id) },
      updated_at: now
    };
  });

  supabaseUpsert_('competitions', Object.values(competitions), 'competition_id');
  supabaseUpsert_('competition_seasons', rows.map(function(r) {
    return {
      competition_season_id: r.competition_season_id,
      competition_id: r.competition_id,
      season: r.season,
      display_name: r.display_name,
      format: r.format,
      home_advantage_policy: r.home_advantage_policy,
      source_primary: r.source_primary,
      odds_sport_key: r.odds_sport_key,
      api_football_league_id: r.api_football_league_id,
      strength_coefficient: r.strength_coefficient,
      payload: { target_status: r.target_status, liquidity_tier: r.liquidity_tier, catalog_key: r.key },
      updated_at: now
    };
  }), 'competition_season_id');

  const existingStatusIds = {};
  try {
    supabaseSelect_('competition_status', 'select=competition_season_id').forEach(function(r) {
      existingStatusIds[String(r.competition_season_id)] = true;
    });
  } catch (e_) {}
  const statusRows = rows.filter(function(r) {
    return !existingStatusIds[r.competition_season_id];
  }).map(function(r) {
    const initialStatus = r.competition_season_id === 'WC2026'
      ? COMPETITION_STATUSES.PAPER_TRADING
      : COMPETITION_STATUSES.OBSERVATION;
    return {
      competition_season_id: r.competition_season_id,
      status: initialStatus,
      status_reason: initialStatus === COMPETITION_STATUSES.PAPER_TRADING
        ? 'Mundial 2026 starts in paper trading until readiness validates BETTABLE.'
        : 'Default onboarding state: betting disabled until readiness passes.',
      readiness_score: 0,
      updated_at: now
    };
  });
  if (statusRows.length) supabaseUpsert_('competition_status', statusRows, 'competition_season_id');

  const checks = [];
  const existingCheckKeys = {};
  try {
    supabaseSelect_('competition_readiness_checks', 'select=competition_season_id,check_name').forEach(function(r) {
      existingCheckKeys[String(r.competition_season_id) + '|' + String(r.check_name)] = true;
    });
  } catch (e_) {}
  rows.forEach(function(r) {
    COMPETITION_REQUIRED_CHECKS.forEach(function(checkName) {
      if (existingCheckKeys[r.competition_season_id + '|' + checkName]) return;
      checks.push({
        competition_season_id: r.competition_season_id,
        check_name: checkName,
        status: 'FAIL',
        score: 0,
        details: { required_for_bettable: true },
        checked_at: now
      });
    });
  });
  if (checks.length) supabaseUpsert_('competition_readiness_checks', checks, 'competition_season_id,check_name');
  Logger.log('seedCompetitionCatalogToSupabase: competitions=' + Object.keys(competitions).length + ' seasons=' + rows.length + ' checks=' + checks.length);
  return { competitions: Object.keys(competitions).length, seasons: rows.length, checks: checks.length };
}

function getCompetitionPriority_(competitionSeasonId) {
  const order = ['WC2026', 'UCL_2025', 'EPL_2025', 'LIBERTADORES_2025', 'BRASILEIRAO_2025', 'ARG_PRIMERA_2025', 'CHI_PRIMERA_2025'];
  const idx = order.indexOf(String(competitionSeasonId || ''));
  return idx === -1 ? 999 : idx + 1;
}

function getCompetitionStatus_(competitionSeasonId) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  if (!isSupabaseConfigured_()) {
    return {
      competition_season_id: id,
      status: id === 'WC2026' ? COMPETITION_STATUSES.PAPER_TRADING : COMPETITION_STATUSES.OBSERVATION,
      status_reason: 'Supabase not configured; defaulting to non-bettable safe mode.',
      readiness_score: 0
    };
  }
  try {
    const rows = supabaseSelect_('competition_status', 'select=*&competition_season_id=eq.' + encodeURIComponent(id) + '&limit=1');
    if (rows && rows.length) return rows[0];
  } catch (e) {
    Logger.log('getCompetitionStatus_ fallback: ' + e.message);
  }
  return {
    competition_season_id: id,
    status: COMPETITION_STATUSES.OBSERVATION,
    status_reason: 'Competition has no status row; betting disabled.',
    readiness_score: 0
  };
}

function getCompetitionReadinessChecks_(competitionSeasonId) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  if (!isSupabaseConfigured_()) return [];
  try {
    return supabaseSelect_('competition_readiness_checks', 'select=*&competition_season_id=eq.' + encodeURIComponent(id));
  } catch (e) {
    Logger.log('getCompetitionReadinessChecks_ failed: ' + e.message);
    return [];
  }
}

function isCompetitionBettable_(competitionSeasonId) {
  return String(getCompetitionStatus_(competitionSeasonId).status || '') === COMPETITION_STATUSES.BETTABLE;
}

function buildCompetitionBettingGate_(competitionSeasonId) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  const status = getCompetitionStatus_(id);
  if (String(status.status || '') !== COMPETITION_STATUSES.BETTABLE) {
    return {
      allowed: false,
      competition_season_id: id,
      decision: COMPETITION_BLOCKED_DECISION,
      block_reason: 'Competition status is ' + (status.status || 'UNKNOWN') + '; BETTABLE required.',
      status: status
    };
  }
  return {
    allowed: true,
    competition_season_id: id,
    decision: 'BETTABLE',
    block_reason: '',
    status: status
  };
}

function recordCompetitionBlockedDecision_(fixtureOrRow, opportunity, gate) {
  if (!isSupabaseConfigured_() || !gate || gate.allowed) return null;
  const o = opportunity || {};
  const matchId = ensureMatchIdFromRow_({
    match_id: o.match_id,
    fixture_id: o.fixture_id || (fixtureOrRow && fixtureOrRow.fixture && fixtureOrRow.fixture.id),
    fecha: fixtureOrRow && fixtureOrRow.fixture ? fixtureOrRow.fixture.date : (fixtureOrRow && fixtureOrRow.fecha),
    local: o.equipo_local || (fixtureOrRow && fixtureOrRow.teams && fixtureOrRow.teams.home && fixtureOrRow.teams.home.name),
    visitante: o.equipo_visitante || (fixtureOrRow && fixtureOrRow.teams && fixtureOrRow.teams.away && fixtureOrRow.teams.away.name)
  });
  const payload = {
    competition_season_id: gate.competition_season_id,
    match_id: matchId,
    market: safe_(o.mercado || o.market || 'UNKNOWN'),
    selection: safe_(o.seleccion || o.selection || 'UNKNOWN'),
    model_probability: toNumberOrNull_(o.prob_modelo || o.model_probability),
    decimal_odds: toNumberOrNull_(o.cuota || o.decimal_odds),
    edge: toNumberOrNull_(o.edge),
    ev: toNumberOrNull_(o.ev),
    kelly_fraction: toNumberOrNull_(o.kelly),
    decision: gate.decision,
    block_reason: gate.block_reason,
    payload: {
      status: gate.status,
      opportunity: o
    }
  };
  try {
    supabaseUpsert_('betting_decisions', [payload], null);
    return payload;
  } catch (e) {
    Logger.log('recordCompetitionBlockedDecision_ failed: ' + e.message);
    return null;
  }
}

function updateCompetitionStatus_(competitionSeasonId, status, reason, approvedBy) {
  const id = String(competitionSeasonId || '').trim();
  const next = String(status || '').trim().toUpperCase();
  if (!id) throw new Error('competitionSeasonId requerido.');
  if (!COMPETITION_STATUSES[next]) throw new Error('Estado de competencia inválido: ' + status);
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const row = {
    competition_season_id: id,
    status: next,
    status_reason: reason || '',
    updated_at: nowIso_()
  };
  if (next === COMPETITION_STATUSES.BETTABLE) {
    const readiness = evaluateCompetitionReadiness_(id);
    if (!readiness.bettable) throw new Error('No se puede activar BETTABLE: readiness incompleto (' + readiness.failed.join(', ') + ')');
    row.readiness_score = readiness.score;
    row.approved_at = nowIso_();
    row.approved_by = approvedBy || 'manual';
  }
  supabaseUpsert_('competition_status', [row], 'competition_season_id');
  return row;
}

function setCompetitionObservation(competitionSeasonId, reason) {
  return updateCompetitionStatus_(
    competitionSeasonId,
    COMPETITION_STATUSES.OBSERVATION,
    reason || 'Competition set to observation mode; betting disabled.',
    ''
  );
}

function setCompetitionPaperTrading(competitionSeasonId, reason) {
  const readiness = evaluateCompetitionReadiness_(competitionSeasonId);
  const blockers = ['fixtures_reliable', 'results_reliable', 'aliases_normalized', 'odds_sufficient']
    .filter(function(name) { return readiness.failed.indexOf(name) !== -1; });
  if (blockers.length) {
    throw new Error('No se puede activar PAPER_TRADING: faltan checks base (' + blockers.join(', ') + ')');
  }
  return updateCompetitionStatus_(
    competitionSeasonId,
    COMPETITION_STATUSES.PAPER_TRADING,
    reason || 'Competition approved for paper trading; real betting remains disabled.',
    ''
  );
}

function setCompetitionBettable(competitionSeasonId, reason, approvedBy) {
  return updateCompetitionStatus_(
    competitionSeasonId,
    COMPETITION_STATUSES.BETTABLE,
    reason || 'Competition approved as BETTABLE after readiness validation.',
    approvedBy || 'manual'
  );
}

function disableCompetition(competitionSeasonId, reason) {
  return updateCompetitionStatus_(
    competitionSeasonId,
    COMPETITION_STATUSES.DISABLED,
    reason || 'Competition disabled by operator.',
    ''
  );
}

function setCompetitionReadinessCheck(competitionSeasonId, checkName, status, score, details) {
  const id = String(competitionSeasonId || '').trim();
  const check = String(checkName || '').trim();
  const next = String(status || '').trim().toUpperCase();
  if (!id) throw new Error('competitionSeasonId requerido.');
  if (COMPETITION_REQUIRED_CHECKS.indexOf(check) === -1) throw new Error('Readiness check inválido: ' + checkName);
  if (['PASS','WARN','FAIL','NOT_APPLICABLE'].indexOf(next) === -1) throw new Error('Estado de readiness inválido: ' + status);
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const row = {
    competition_season_id: id,
    check_name: check,
    status: next,
    score: Math.max(0, Math.min(1, Number(score || 0))),
    details: details || {},
    checked_at: nowIso_()
  };
  supabaseUpsert_('competition_readiness_checks', [row], 'competition_season_id,check_name');
  return evaluateCompetitionReadiness_(id);
}

function markCompetitionCheckPass(competitionSeasonId, checkName, details) {
  return setCompetitionReadinessCheck(competitionSeasonId, checkName, 'PASS', 1, details || {});
}

function markCompetitionCheckFail(competitionSeasonId, checkName, details) {
  return setCompetitionReadinessCheck(competitionSeasonId, checkName, 'FAIL', 0, details || {});
}

function evaluateCompetitionReadiness_(competitionSeasonId) {
  const checks = getCompetitionReadinessChecks_(competitionSeasonId);
  const byName = {};
  checks.forEach(function(c) { byName[c.check_name] = c; });
  const failed = [];
  let score = 0;
  COMPETITION_REQUIRED_CHECKS.forEach(function(name) {
    const c = byName[name];
    if (!c || String(c.status) === 'FAIL') failed.push(name);
    score += c && Number(c.score) > 0 ? Number(c.score) : 0;
  });
  const normalized = COMPETITION_REQUIRED_CHECKS.length ? score / COMPETITION_REQUIRED_CHECKS.length : 0;
  return {
    competition_season_id: competitionSeasonId,
    bettable: failed.length === 0,
    failed: failed,
    score: Math.round(normalized * 10000) / 10000,
    checks: checks
  };
}

function buildCompetitionStatusText_() {
  const rows = getCompetitionCatalogRows_().sort(function(a, b) {
    return getCompetitionPriority_(a.competition_season_id) - getCompetitionPriority_(b.competition_season_id);
  });
  let msg = '🏟️ <b>Estado multi-competencia</b>\n\n';
  rows.forEach(function(r) {
    const st = getCompetitionStatus_(r.competition_season_id);
    msg += '<b>' + r.display_name + '</b>\n';
    msg += '  <code>' + r.competition_season_id + '</code> · ' + (st.status || 'OBSERVATION') + ' · readiness ' + Math.round(Number(st.readiness_score || 0) * 100) + '%\n';
  });
  msg += '\n<i>Solo BETTABLE puede generar EV apostable.</i>';
  return msg;
}
