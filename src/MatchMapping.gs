function saveMatchMappings_(mappings) {
  const headers = SHEET_HEADERS.MatchMapping || [
    'match_key','fixture_id_api_football','match_id_football_data','home_normalized',
    'away_normalized','date_utc','confidence','mapping_method','created_at','updated_at'
  ];
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

  upsertRowsByKey_(CONFIG.SHEETS.MATCH_MAPPING, headers, rows, ['match_key']);
}
