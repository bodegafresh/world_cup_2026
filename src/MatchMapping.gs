function saveMatchMappings_(mappings) {
  const rows = mappings.map(m => [
    m.match_key,
    m.api_football ? m.api_football.source_match_id : '',
    m.football_data ? m.football_data.source_match_id : '',
    normalizeTeamNameStrong_(m.api_football.home_team_name),
    normalizeTeamNameStrong_(m.api_football.away_team_name),
    m.api_football.date_utc,
    m.confidence,
    m.mapping_method,
    nowChile_(),
    nowChile_()
  ]);

  appendRows_(CONFIG.SHEETS.MATCH_MAPPING, rows);
}