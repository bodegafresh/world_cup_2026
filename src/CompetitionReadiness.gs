/**
 * CompetitionReadiness.gs
 *
 * Gobierno multi-competencia basado exclusivamente en Supabase.
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

function getActiveCompetitionSeasonId_() {
  return ptEnv_('ACTIVE_COMPETITION_SEASON_ID', 'wc2026');
}

function getCompetitionStatus_(competitionSeasonId) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  if (!isSupabaseConfigured_()) {
    return {
      competition_season_id: id,
      status: COMPETITION_STATUSES.OBSERVATION,
      status_reason: 'Supabase not configured',
      readiness_score: 0
    };
  }
  const rows = supabaseSelect_('competition_status', 'select=*&competition_season_id=eq.' + encodeURIComponent(id) + '&limit=1');
  return rows[0] || {
    competition_season_id: id,
    status: COMPETITION_STATUSES.OBSERVATION,
    status_reason: 'No status row',
    readiness_score: 0
  };
}

function getCompetitionReadinessChecks_(competitionSeasonId) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  if (!isSupabaseConfigured_()) return [];
  return supabaseSelect_('competition_readiness_checks',
    'select=*&competition_season_id=eq.' + encodeURIComponent(id) + '&order=check_name.asc');
}

function evaluateCompetitionReadiness_(competitionSeasonId) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  const status = getCompetitionStatus_(id);
  const checks = getCompetitionReadinessChecks_(id);
  const byName = {};
  checks.forEach(function(row) { byName[row.check_name] = row; });

  const required = COMPETITION_REQUIRED_CHECKS.map(function(name) {
    return byName[name] || {
      competition_season_id: id,
      check_name: name,
      status: 'FAIL',
      score: 0,
      details: { reason: 'missing_check' }
    };
  });

  const failCount = required.filter(function(row) { return row.status === 'FAIL'; }).length;
  const warnCount = required.filter(function(row) { return row.status === 'WARN'; }).length;
  const passCount = required.filter(function(row) { return row.status === 'PASS'; }).length;
  const score = required.length ? passCount / required.length : 0;

  return {
    competition_season_id: id,
    status: status.status,
    readiness_score: score,
    pass_count: passCount,
    warn_count: warnCount,
    fail_count: failCount,
    bettable_allowed: status.status === COMPETITION_STATUSES.BETTABLE && failCount === 0,
    checks: required
  };
}

function setCompetitionReadinessCheck(competitionSeasonId, checkName, status, score, details) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  const row = {
    competition_season_id: id,
    check_name: String(checkName || ''),
    status: String(status || 'WARN').toUpperCase(),
    score: score === null || score === undefined || score === '' ? null : Number(score),
    details: details || {},
    checked_at: nowIso_()
  };
  if (COMPETITION_REQUIRED_CHECKS.indexOf(row.check_name) === -1) {
    throw new Error('Readiness check desconocido: ' + row.check_name);
  }
  if (['PASS', 'WARN', 'FAIL', 'NOT_APPLICABLE'].indexOf(row.status) === -1) {
    throw new Error('Estado readiness inválido: ' + row.status);
  }
  supabaseUpsert_('competition_readiness_checks', [row], 'competition_season_id,check_name');
  return evaluateCompetitionReadiness_(id);
}

function setCompetitionStatus_(competitionSeasonId, status, reason, approvedBy) {
  const id = String(competitionSeasonId || getActiveCompetitionSeasonId_());
  const normalized = String(status || '').toUpperCase();
  if (!COMPETITION_STATUSES[normalized]) throw new Error('Estado de competencia inválido: ' + status);
  const row = {
    competition_season_id: id,
    status: normalized,
    status_reason: reason || '',
    readiness_score: evaluateCompetitionReadiness_(id).readiness_score,
    updated_at: nowIso_()
  };
  if (normalized === COMPETITION_STATUSES.BETTABLE) {
    row.approved_at = nowIso_();
    row.approved_by = approvedBy || 'system';
  }
  supabaseUpsert_('competition_status', [row], 'competition_season_id');
  return getCompetitionStatus_(id);
}

function setCompetitionObservation(competitionSeasonId, reason) {
  return setCompetitionStatus_(competitionSeasonId, COMPETITION_STATUSES.OBSERVATION, reason);
}

function setCompetitionPaperTrading(competitionSeasonId, reason) {
  return setCompetitionStatus_(competitionSeasonId, COMPETITION_STATUSES.PAPER_TRADING, reason);
}

function setCompetitionBettable(competitionSeasonId, reason, approvedBy) {
  const readiness = evaluateCompetitionReadiness_(competitionSeasonId);
  if (readiness.fail_count > 0) throw new Error('No se puede pasar a BETTABLE con checks FAIL.');
  return setCompetitionStatus_(competitionSeasonId, COMPETITION_STATUSES.BETTABLE, reason, approvedBy);
}

function disableCompetition(competitionSeasonId, reason) {
  return setCompetitionStatus_(competitionSeasonId, COMPETITION_STATUSES.DISABLED, reason);
}

function assertCompetitionBettable_(competitionSeasonId) {
  const status = getCompetitionStatus_(competitionSeasonId);
  if (status.status !== COMPETITION_STATUSES.BETTABLE) {
    return {
      allowed: false,
      decision: 'BLOCKED',
      block_reason: COMPETITION_BLOCKED_DECISION,
      competition_status: status.status
    };
  }
  return { allowed: true, competition_status: status.status };
}
