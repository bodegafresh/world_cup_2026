/**
 * PublishedReadService.gs
 *
 * Lecturas para frontend o API. Las listas simples usan vistas published.
 * El agrupador por fase es un endpoint derivado backend-side porque la vista
 * published_match_schedule no expone stage/group en el esquema actual.
 */

function publishedWorldCupPlayedMatches() {
  return ptSelect_('published_match_schedule',
    'select=*&competition_season_slug=eq.' + PT_WC2026.seasonSlug + '&status=eq.FINISHED&order=kickoff_at.asc');
}

function publishedWorldCupTodayMatches() {
  const today = ptTodayUtcDate_();
  return ptSelect_('published_match_schedule',
    'select=*&competition_season_slug=eq.' + PT_WC2026.seasonSlug +
    '&kickoff_at=gte.' + today + 'T00:00:00.000Z&kickoff_at=lt.' + ptAddDays_(today, 1) + 'T00:00:00.000Z&order=kickoff_at.asc');
}

function publishedWorldCupFutureMatches() {
  return ptSelect_('published_match_schedule',
    'select=*&competition_season_slug=eq.' + PT_WC2026.seasonSlug + '&kickoff_at=gt.' + encodeURIComponent(ptNowIso_()) + '&order=kickoff_at.asc');
}

function publishedWorldCupScheduleByStage() {
  const season = ptGetWorldCupSeason_();
  if (!season) return {};
  const rows = ptSelect_('matches',
    'select=match_id,kickoff_at,status,home_score,away_score,stage_id,group_id,venue_id&competition_season_id=eq.' +
    season.competition_season_id + '&order=kickoff_at.asc');
  const stages = ptSelect_('competition_stages', 'select=*&competition_season_id=eq.' + season.competition_season_id)
    .reduce(function(acc, s) { acc[s.stage_id] = s; return acc; }, {});
  const groups = ptSelect_('competition_groups', 'select=*&competition_season_id=eq.' + season.competition_season_id)
    .reduce(function(acc, g) { acc[g.group_id] = g; return acc; }, {});
  return rows.reduce(function(acc, row) {
    const stageRow = stages[row.stage_id] || {};
    const groupRow = groups[row.group_id] || {};
    const stage = stageRow.stage_code || 'UNKNOWN';
    row.stage_code = stage;
    row.stage_name = stageRow.stage_name || null;
    row.group_code = groupRow.group_code || null;
    if (!acc[stage]) acc[stage] = [];
    acc[stage].push(row);
    return acc;
  }, {});
}
