/**
 * core/MatchKeys.gs
 *
 * Contrato canonico de match ids. El ID interno no debe depender de una fuente
 * externa especifica como API-Football o ESPN.
 */

function coreMatchId_(competitionSeasonId, date, homeTeam, awayTeam) {
  const comp = String(competitionSeasonId || getActiveCompetitionSeasonId_() || 'WC2026');
  const canonical = buildCanonicalMatchId_(date, homeTeam, awayTeam);
  return comp + '-' + canonical;
}

function coreEnsureMatchId_(row) {
  const current = row && row.match_id ? String(row.match_id) : '';
  if (current) return current;
  const comp = getCompetitionSeasonIdFromFixture_(row || {});
  return coreMatchId_(comp, row && (row.fecha || row.date || row.fecha_chile), row && (row.local || row.home_team || row.equipo_local), row && (row.visitante || row.away_team || row.equipo_visitante));
}

function coreIdempotencyKey_(eventType, aggregateId, version) {
  return hash_([eventType, aggregateId, version || 'v1'].join('|'));
}
