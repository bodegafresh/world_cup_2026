function saveSourceFixtures_(apiFixturesWrapped, fdMatchesWrapped) {
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

  appendRows_(CONFIG.SHEETS.SOURCE_FIXTURES, rows);
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