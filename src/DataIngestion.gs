function saveSourceFixtures_(apiFixturesWrapped, fdMatchesWrapped) {
  const headers = SHEET_HEADERS.SourceFixtures || [
    'source_fixture_key','source','source_match_id','competition_id','competition_name',
    'season','stage','group_name','matchday','date_utc','date_chile','status',
    'home_team_id','home_team_name','away_team_id','away_team_name',
    'home_score','away_score','winner','venue_name','venue_city','raw_file_url','loaded_at'
  ];
  const rows = [];

  apiFixturesWrapped.forEach(item => {
    const normalized = normalizeApiFootballFixture_(
      item.fixture_raw,
      item.raw_file_url
    );

    rows.push(sourceFixtureToRow_(normalized));
  });

  fdMatchesWrapped.forEach(item => {
    const normalized = normalizeFootballDataMatch_(
      item.match_raw,
      item.raw_file_url
    );

    rows.push(sourceFixtureToRow_(normalized));
  });

  upsertRowsByKey_(CONFIG.SHEETS.SOURCE_FIXTURES, headers, rows, ['source_fixture_key']);
}

function sourceFixtureToRow_(n) {
  return [
    n.source_fixture_key,
    n.source,
    n.source_match_id,
    n.competition_id,
    n.competition_name,
    n.season,
    n.stage,
    n.group_name,
    n.matchday,
    n.date_utc,
    n.date_chile,
    n.status,
    n.home_team_id,
    n.home_team_name,
    n.away_team_id,
    n.away_team_name,
    n.home_score,
    n.away_score,
    n.winner,
    n.venue_name,
    n.venue_city,
    n.raw_file_url,
    n.loaded_at
  ];
}
