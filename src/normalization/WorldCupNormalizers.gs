/**
 * WorldCupNormalizers.gs
 *
 * Normalizadores puros para WC2026. No escriben en Supabase.
 */

function ptNormalizeTeamFromEspn_(competitor) {
  competitor = competitor || {};
  const team = competitor.team || competitor || {};
  const id = team.id || competitor.id;
  const name = team.displayName || team.name || competitor.displayName || competitor.name || '';
  return {
    source: 'ESPN',
    source_team_id: id ? String(id) : '',
    display_name: name,
    normalized_name: ptNormalizeName_(name),
    abbreviation: team.abbreviation || team.shortDisplayName || '',
    country_code: team.abbreviation || null,
    logo_url: ((team.logos || [])[0] || {}).href || team.logo || null,
    payload: competitor
  };
}

function ptNormalizeTeamFromFootballData_(team) {
  team = team || {};
  const name = team.name || team.shortName || team.tla || '';
  return {
    source: 'FOOTBALL_DATA',
    source_team_id: team.id ? String(team.id) : '',
    display_name: name,
    normalized_name: ptNormalizeName_(name),
    abbreviation: team.tla || team.shortName || '',
    country_code: team.tla || null,
    logo_url: team.crest || null,
    payload: team
  };
}

function ptNormalizeStageCode_(value) {
  const raw = ptNormalizeName_(value || '');
  if (!raw) return 'GROUP_STAGE';
  if (raw.indexOf('round of 32') !== -1 || raw.indexOf('last 32') !== -1 || raw.indexOf('dieciseis') !== -1) return 'ROUND_OF_32';
  if (raw.indexOf('round of 16') !== -1 || raw.indexOf('last 16') !== -1 || raw.indexOf('octav') !== -1) return 'ROUND_OF_16';
  if (raw.indexOf('quarter') !== -1 || raw.indexOf('cuarto') !== -1) return 'QUARTER_FINAL';
  if (raw.indexOf('semi') !== -1) return 'SEMI_FINAL';
  if (raw.indexOf('third') !== -1 || raw.indexOf('tercer') !== -1) return 'THIRD_PLACE';
  if (raw === 'final' || raw.indexOf(' final') !== -1) return 'FINAL';
  if (raw.indexOf('group') !== -1 || raw.indexOf('grupo') !== -1) return 'GROUP_STAGE';
  return 'GROUP_STAGE';
}

function ptNormalizeGroupCode_(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(?:group|grupo)\s*([a-l])/i) || raw.match(/^([A-L])$/i);
  if (!match) return null;
  return 'Grupo ' + match[1].toUpperCase();
}

function ptNormalizeVenueFromEspn_(competition) {
  competition = competition || {};
  const venue = competition.venue || {};
  if (!venue.fullName && !venue.name) return null;
  const address = venue.address || {};
  return {
    source: 'ESPN',
    source_venue_id: venue.id ? String(venue.id) : '',
    display_name: venue.fullName || venue.name,
    city: address.city || null,
    country_code: address.country || null,
    timezone_name: venue.timeZone || null,
    latitude: venue.latitude || null,
    longitude: venue.longitude || null,
    payload: venue
  };
}

function ptNormalizeMatchStatusFromEspn_(statusType) {
  statusType = statusType || {};
  const name = String(statusType.name || statusType.state || statusType.description || '').toUpperCase();
  const completed = Boolean(statusType.completed);
  if (completed || name.indexOf('FINAL') !== -1 || name === 'STATUS_FINAL') return 'FINISHED';
  if (name.indexOf('IN_PROGRESS') !== -1 || name.indexOf('HALFTIME') !== -1 || name.indexOf('STATUS_IN_PROGRESS') !== -1) return 'LIVE';
  if (name.indexOf('POSTPONED') !== -1) return 'POSTPONED';
  if (name.indexOf('CANCELED') !== -1 || name.indexOf('CANCELLED') !== -1) return 'CANCELLED';
  return 'SCHEDULED';
}

function ptNormalizeMatchFromEspn_(event) {
  event = event || {};
  const competition = (event.competitions || [])[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find(function(c) { return String(c.homeAway || '').toLowerCase() === 'home'; }) || competitors[0] || {};
  const away = competitors.find(function(c) { return String(c.homeAway || '').toLowerCase() === 'away'; }) || competitors[1] || {};
  const statusType = ((competition.status || event.status || {}).type) || {};
  const stageText = event.seasonType && event.seasonType.name || event.group && event.group.name || competition.notes && competition.notes[0] && competition.notes[0].headline || event.name || '';
  const groupText = event.group && (event.group.name || event.group.shortName) || stageText;
  return {
    source: 'ESPN',
    source_match_id: event.id ? String(event.id) : '',
    source_match_name: event.name || event.shortName || '',
    kickoff_at: ptToUtcIso_(event.date || competition.date),
    status: ptNormalizeMatchStatusFromEspn_(statusType),
    stage_code: ptNormalizeStageCode_(stageText),
    group_code: ptNormalizeGroupCode_(groupText),
    match_number: event.uid ? null : null,
    home: ptNormalizeTeamFromEspn_(home),
    away: ptNormalizeTeamFromEspn_(away),
    home_score: home.score === undefined || home.score === '' ? null : Number(home.score),
    away_score: away.score === undefined || away.score === '' ? null : Number(away.score),
    venue: ptNormalizeVenueFromEspn_(competition),
    payload: event
  };
}

function ptNormalizeMatchFromFootballData_(match) {
  match = match || {};
  return {
    source: 'FOOTBALL_DATA',
    source_match_id: match.id ? String(match.id) : '',
    source_match_name: (match.homeTeam || {}).name + ' vs ' + (match.awayTeam || {}).name,
    kickoff_at: ptToUtcIso_(match.utcDate),
    status: match.status === 'FINISHED' ? 'FINISHED' : (match.status === 'IN_PLAY' || match.status === 'PAUSED' ? 'LIVE' : 'SCHEDULED'),
    stage_code: ptNormalizeStageCode_(match.stage || match.group),
    group_code: ptNormalizeGroupCode_(match.group),
    home: ptNormalizeTeamFromFootballData_(match.homeTeam || {}),
    away: ptNormalizeTeamFromFootballData_(match.awayTeam || {}),
    home_score: match.score && match.score.fullTime ? match.score.fullTime.home : null,
    away_score: match.score && match.score.fullTime ? match.score.fullTime.away : null,
    venue: null,
    payload: match
  };
}

function ptMatchSlug_(competitionSeasonSlug, normalizedMatch) {
  const date = ptDateToYmd_(normalizedMatch.kickoff_at);
  return ptSlug_([competitionSeasonSlug, date, normalizedMatch.home.display_name, normalizedMatch.away.display_name].join(' '));
}

