function normalizeApiFootballFixture_(fixture, rawFileUrl) {
  return {
    source_fixture_key: `api_football_${fixture.fixture.id}`,
    source: 'API_FOOTBALL',
    source_match_id: String(fixture.fixture.id),

    competition_id: safe_(fixture.league.id),
    competition_name: safe_(fixture.league.name),
    season: safe_(fixture.league.season),
    stage: safe_(fixture.league.round),
    group_name: extractGroupFromRound_(fixture.league.round),
    matchday: '',

    date_utc: safe_(fixture.fixture.date),
    date_chile: toChileDateTime_(fixture.fixture.date),
    status: safe_(fixture.fixture.status && fixture.fixture.status.short),

    home_team_id: safe_(fixture.teams.home.id),
    home_team_name: safe_(fixture.teams.home.name),
    away_team_id: safe_(fixture.teams.away.id),
    away_team_name: safe_(fixture.teams.away.name),

    home_score: safe_(fixture.goals.home),
    away_score: safe_(fixture.goals.away),
    winner: inferWinner_(fixture.goals.home, fixture.goals.away, fixture.teams.home.name, fixture.teams.away.name),

    venue_id: safe_(fixture.fixture.venue && fixture.fixture.venue.id),
    venue_name: safe_(fixture.fixture.venue && fixture.fixture.venue.name),
    venue_city: safe_(fixture.fixture.venue && fixture.fixture.venue.city),

    raw_file_url: rawFileUrl,
    loaded_at: nowChile_()
  };
}

function normalizeFootballDataMatch_(match, rawFileUrl) {
  return {
    source_fixture_key: `football_data_${match.id}`,
    source: 'FOOTBALL_DATA',
    source_match_id: String(match.id),

    competition_id: safe_(match.competition && match.competition.id),
    competition_name: safe_(match.competition && match.competition.name),
    season: safe_(match.season && match.season.id),
    stage: safe_(match.stage),
    group_name: safe_(match.group),
    matchday: safe_(match.matchday),

    date_utc: safe_(match.utcDate),
    date_chile: toChileDateTime_(match.utcDate),
    status: normalizeFootballDataStatus_(match.status),

    home_team_id: safe_(match.homeTeam && match.homeTeam.id),
    home_team_name: safe_(match.homeTeam && match.homeTeam.name),
    away_team_id: safe_(match.awayTeam && match.awayTeam.id),
    away_team_name: safe_(match.awayTeam && match.awayTeam.name),

    home_score: safe_(match.score && match.score.fullTime && match.score.fullTime.home),
    away_score: safe_(match.score && match.score.fullTime && match.score.fullTime.away),
    winner: normalizeFootballDataWinner_(match.score && match.score.winner, match.homeTeam, match.awayTeam),

    venue_id: '',
    venue_name: '',
    venue_city: '',

    raw_file_url: rawFileUrl,
    loaded_at: nowChile_()
  };
}

function normalizeFootballDataStatus_(status) {
  const map = {
    FINISHED: 'FT',
    SCHEDULED: 'NS',
    TIMED: 'NS',
    LIVE: 'LIVE',
    IN_PLAY: 'LIVE',
    PAUSED: 'HT',
    POSTPONED: 'PST',
    SUSPENDED: 'SUSP',
    CANCELLED: 'CANC'
  };

  return map[status] || status || '';
}

function normalizeFootballDataWinner_(winner, homeTeam, awayTeam) {
  if (winner === 'HOME_TEAM') return safe_(homeTeam && homeTeam.name);
  if (winner === 'AWAY_TEAM') return safe_(awayTeam && awayTeam.name);
  if (winner === 'DRAW') return 'DRAW';
  return '';
}

function inferWinner_(homeScore, awayScore, homeName, awayName) {
  if (homeScore === '' || awayScore === '' || homeScore === null || awayScore === null) return '';

  if (Number(homeScore) > Number(awayScore)) return homeName;
  if (Number(awayScore) > Number(homeScore)) return awayName;

  return 'DRAW';
}

function extractGroupFromRound_(round) {
  const text = String(round || '');
  const match = text.match(/Group\s+([A-L])/i);

  return match ? `GROUP_${match[1].toUpperCase()}` : '';
}