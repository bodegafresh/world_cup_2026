/**
 * BettingMath.gs
 *
 * Fuente unica para formulas de cuotas, EV, edge, overlay y Kelly.
 * Mantener este modulo como contrato entre predicciones, EV+, historico y ROI.
 */

const BETTING_MATH = {
  STALE_ODDS_HOURS: 6,
  EV_POSITIVE_THRESHOLD: 0,
  EDGE_POSITIVE_THRESHOLD: 0,
  EV_SUSPICIOUS_THRESHOLD: 0.25,
  EV_OUTLIER_THRESHOLD: 0.30,
  EV_MAX_CREDIBLE: 0.50,
  PROB_SUM_TOLERANCE: 0.01
};

function bettingFairOdds_(modelProbability) {
  const p = Number(modelProbability);
  return p > 0 && p < 1 ? 1 / p : null;
}

function bettingMarketProbability_(bookOdds) {
  const odds = Number(bookOdds);
  return odds > 1 ? 1 / odds : null;
}

function bettingEdgePp_(modelProbability, bookOdds) {
  const p = Number(modelProbability);
  const mp = bettingMarketProbability_(bookOdds);
  return p > 0 && mp !== null ? p - mp : null;
}

function bettingEvPct_(modelProbability, bookOdds) {
  const p = Number(modelProbability);
  const odds = Number(bookOdds);
  return p > 0 && p < 1 && odds > 1 ? (p * odds) - 1 : null;
}

function bettingOverlayPct_(modelProbability, bookOdds) {
  const fair = bettingFairOdds_(modelProbability);
  const odds = Number(bookOdds);
  return fair && odds > 1 ? (odds - fair) / fair : null;
}

function bettingKellyFullPct_(modelProbability, bookOdds) {
  const p = Number(modelProbability);
  const odds = Number(bookOdds);
  const ev = bettingEvPct_(p, odds);
  if (ev === null || ev <= 0 || odds <= 1) return 0;
  return Math.max(0, ((odds - 1) * p - (1 - p)) / (odds - 1));
}

function bettingMetrics_(modelProbability, bookOdds) {
  const fairOdds = bettingFairOdds_(modelProbability);
  const marketProbability = bettingMarketProbability_(bookOdds);
  const edgePp = bettingEdgePp_(modelProbability, bookOdds);
  const evPct = bettingEvPct_(modelProbability, bookOdds);
  const overlayPct = bettingOverlayPct_(modelProbability, bookOdds);
  const kellyFullPct = bettingKellyFullPct_(modelProbability, bookOdds);
  return {
    fair_odds: fairOdds,
    market_probability: marketProbability,
    edge_pp: edgePp,
    overlay_pct: overlayPct,
    ev_pct: evPct,
    kelly_full_pct: kellyFullPct,
    kelly_25_pct: kellyFullPct * 0.25,
    kelly_50_pct: kellyFullPct * 0.50,
    is_ev_positive: evPct !== null && evPct > BETTING_MATH.EV_POSITIVE_THRESHOLD && edgePp !== null && edgePp > BETTING_MATH.EDGE_POSITIVE_THRESHOLD,
    is_suspicious: evPct !== null && evPct > BETTING_MATH.EV_SUSPICIOUS_THRESHOLD,
    is_outlier: evPct !== null && evPct > BETTING_MATH.EV_OUTLIER_THRESHOLD,
    is_credible: evPct !== null && evPct <= BETTING_MATH.EV_MAX_CREDIBLE
  };
}

function bettingValidate1x2Probabilities_(homeProbability, drawProbability, awayProbability, tolerance) {
  const pH = Number(homeProbability);
  const pD = Number(drawProbability);
  const pA = Number(awayProbability);
  const tol = tolerance === undefined ? BETTING_MATH.PROB_SUM_TOLERANCE : Number(tolerance);
  const sum = pH + pD + pA;
  return {
    valid: pH > 0 && pD > 0 && pA > 0 && Math.abs(sum - 1) <= tol,
    sum: sum,
    normalized: sum > 0 ? { home: pH / sum, draw: pD / sum, away: pA / sum } : null
  };
}

function bettingIsOddsStale_(capturedAt, maxAgeHours) {
  if (!capturedAt) return true;
  const ts = new Date(capturedAt).getTime();
  if (!ts) return true;
  const hours = (Date.now() - ts) / 3600000;
  return hours > (maxAgeHours || BETTING_MATH.STALE_ODDS_HOURS);
}
