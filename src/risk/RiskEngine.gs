/**
 * risk/RiskEngine.gs
 *
 * Motor de decision EV/riesgo. EvModel puede calcular oportunidades, pero este
 * modulo decide si son apostables y registra razones de bloqueo.
 */

const RISK_ENGINE_VERSION = 'risk_v1';

function riskEvaluateOpportunity_(opportunity, fixtureOrRow, options) {
  options = options || {};
  const competitionSeasonId = options.competition_season_id || getCompetitionSeasonIdFromFixture_(fixtureOrRow || {});
  const gate = buildCompetitionBettingGate_(competitionSeasonId);
  const probability = Number(opportunity.prob_modelo || opportunity.model_probability || opportunity.probability || 0);
  const odds = Number(opportunity.cuota || opportunity.decimal_odds || opportunity.odds || 0);
  const metrics = bettingMetrics_(probability, odds);
  const reasons = [];

  if (!gate.allowed) reasons.push(gate.decision);
  if (!probability || probability <= 0 || probability >= 1) reasons.push('INVALID_MODEL_PROBABILITY');
  if (!odds || odds <= 1) reasons.push('INVALID_ODDS');
  if (metrics.ev_pct !== null && metrics.ev_pct > EV_MAX_CREDIBLE) reasons.push('EV_ABOVE_MAX_CREDIBLE');
  if (String(opportunity.confianza || '').toUpperCase() === 'BAJA') reasons.push('LOW_MODEL_CONFIDENCE');
  if (String(opportunity.confianza || '').toUpperCase() === 'PELIGRO') reasons.push('DANGEROUS_MODEL_CONFIDENCE');

  const allowed = reasons.length === 0;
  return {
    allowed: allowed,
    risk_engine_version: RISK_ENGINE_VERSION,
    competition_season_id: competitionSeasonId,
    decision: allowed ? 'BETTABLE' : reasons[0],
    block_reason: allowed ? '' : reasons.join('|'),
    metrics: metrics,
    kelly_fraction: allowed ? Math.max(0, Math.min(metrics.kelly_25_pct, KELLY_MAX_FRACTION)) : 0,
    gate: gate
  };
}

function riskApplyDecisionToOpportunity_(opportunity, fixtureOrRow, options) {
  const decision = riskEvaluateOpportunity_(opportunity, fixtureOrRow, options || {});
  opportunity.kelly = decision.kelly_fraction;
  opportunity.es_positivo = decision.allowed &&
    Number(decision.metrics.ev_pct || 0) > EV_POSITIVE_THRESHOLD &&
    Number(decision.metrics.edge_pp || 0) > EDGE_MIN_THRESHOLD;
  opportunity.betting_decision = decision.decision;
  opportunity.block_reason = decision.block_reason;
  opportunity.risk_engine_version = decision.risk_engine_version;
  return decision;
}

function riskRecordDecision_(fixtureOrRow, opportunity, decision) {
  if (!isSupabaseConfigured_()) return null;
  const matchId = coreEnsureMatchId_({
    match_id: opportunity.match_id,
    fixture_id: opportunity.fixture_id || (fixtureOrRow && fixtureOrRow.fixture && fixtureOrRow.fixture.id),
    fecha: opportunity.fecha || (fixtureOrRow && fixtureOrRow.fixture && fixtureOrRow.fixture.date),
    local: opportunity.equipo_local || opportunity.local || (fixtureOrRow && fixtureOrRow.teams && fixtureOrRow.teams.home && fixtureOrRow.teams.home.name),
    visitante: opportunity.equipo_visitante || opportunity.visitante || (fixtureOrRow && fixtureOrRow.teams && fixtureOrRow.teams.away && fixtureOrRow.teams.away.name),
    competition_season_id: decision.competition_season_id
  });
  const row = {
    competition_season_id: decision.competition_season_id,
    match_id: matchId,
    market: safe_(opportunity.mercado || opportunity.market || ''),
    selection: safe_(opportunity.seleccion || opportunity.selection || ''),
    model_probability: toNumberOrNull_(opportunity.prob_modelo || opportunity.model_probability),
    decimal_odds: toNumberOrNull_(opportunity.cuota || opportunity.decimal_odds),
    edge: decision.metrics.edge_pp,
    ev: decision.metrics.ev_pct,
    kelly_fraction: decision.kelly_fraction,
    decision: decision.allowed ? 'BETTABLE' : decision.decision,
    block_reason: decision.block_reason,
    risk_engine_version: decision.risk_engine_version,
    payload: {
      opportunity: opportunity,
      decision: decision
    }
  };
  supabaseRequest_('post', 'betting_decisions', [row], { prefer: 'return=representation' });
  domainEventEvDecisionCreated_(hash_(JSON.stringify(row)), decision.competition_season_id, row);
  return row;
}
