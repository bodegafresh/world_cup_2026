/**
 * features/FeatureSnapshots.gs
 *
 * Feature snapshots reproducibles. En MVP se guardan en Supabase como JSONB;
 * no intentan computar todo el universo de features.
 */

const FEATURE_SET_VERSION_DEFAULT = 'v1';

function featureSnapshotBuildFromMatch_(matchRow, options) {
  options = options || {};
  const competitionSeasonId = getCompetitionSeasonIdFromFixture_(matchRow || {});
  const matchId = coreEnsureMatchId_(matchRow || {});
  const home = matchRow.local || matchRow.home_team || matchRow.equipo_local || '';
  const away = matchRow.visitante || matchRow.away_team || matchRow.equipo_visitante || '';
  const features = {
    competition_season_id: competitionSeasonId,
    match_type: getMatchTypeFromFixture_(matchRow || {}),
    home_team_key: coreTeamKey_(home),
    away_team_key: coreTeamKey_(away),
    home_team_name: coreTeamDisplayName_(home),
    away_team_name: coreTeamDisplayName_(away),
    kickoff_date: coreNormalizeDate_(matchRow.fecha || matchRow.date || matchRow.fecha_chile),
    kickoff_time_chile: safeHoraChile_(matchRow.hora_chile || matchRow.hora || ''),
    status: String(matchRow.status || matchRow.estado || 'NS')
  };

  try {
    const elo = getEloProbabilities_(home, away);
    if (elo) {
      features.elo_home_win = Number(elo.home_win || elo.home || 0);
      features.elo_draw = Number(elo.draw || 0);
      features.elo_away_win = Number(elo.away_win || elo.away || 0);
      features.elo_home = Number(elo.elo_home || 0);
      features.elo_away = Number(elo.elo_away || 0);
      features.elo_diff = features.elo_home - features.elo_away;
    }
  } catch (e_) {}

  try {
    const poisson = getPoissonOdds_(home, away, matchRow.match_key || matchRow.fixture_id_api_football || '');
    if (poisson) {
      features.poisson_lambda_home = Number(poisson.lambda_home || poisson.lambdaH || 0);
      features.poisson_lambda_away = Number(poisson.lambda_away || poisson.lambdaA || 0);
      features.poisson_prob_home = Number(poisson.prob_home || 0);
      features.poisson_prob_draw = Number(poisson.prob_draw || 0);
      features.poisson_prob_away = Number(poisson.prob_away || 0);
    }
  } catch (e_) {}

  if (options.market) features.market = options.market;
  if (options.market_implied_probability_no_vig != null) {
    features.market_implied_probability_no_vig = Number(options.market_implied_probability_no_vig);
  }

  return {
    competition_season_id: competitionSeasonId,
    match_id: matchId,
    feature_set_version: options.feature_set_version || FEATURE_SET_VERSION_DEFAULT,
    as_of: options.as_of || nowIso_(),
    features: features
  };
}

function featureSnapshotSave_(snapshot) {
  if (!snapshot || !snapshot.match_id) throw new Error('Feature snapshot invalido.');
  const row = {
    competition_season_id: snapshot.competition_season_id,
    match_id: snapshot.match_id,
    feature_set_version: snapshot.feature_set_version || FEATURE_SET_VERSION_DEFAULT,
    as_of: snapshot.as_of || nowIso_(),
    features: snapshot.features || {}
  };
  supabaseUpsert_('feature_snapshots', [row], 'competition_season_id,match_id,feature_set_version,as_of');
  domainEventFeatureSnapshotCreated_(hash_(JSON.stringify(row)), row.competition_season_id, row);
  return row;
}

function featureSnapshotCreateForMatch_(matchIdOrKey, options) {
  const matches = readAll_(CONFIG.SHEETS.PARTIDOS);
  const row = matches.find(function(m) {
    return String(m.match_id || '') === String(matchIdOrKey) ||
      String(m.match_key || '') === String(matchIdOrKey) ||
      String(m.fixture_id_api_football || m.fixture_id_af || '') === String(matchIdOrKey);
  });
  if (!row) throw new Error('No se encontro partido para feature snapshot: ' + matchIdOrKey);
  return featureSnapshotSave_(featureSnapshotBuildFromMatch_(row, options || {}));
}
