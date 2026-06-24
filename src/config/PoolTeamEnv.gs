/**
 * PoolTeamEnv.gs
 *
 * Configuracion operacional limpia para jobs nuevos.
 * No depende de Google Sheets como fuente de verdad.
 */

const PT_WC2026 = {
  competitionSlug: 'fifa-world-cup',
  seasonSlug: 'wc2026',
  competitionName: 'FIFA World Cup',
  seasonLabel: '2026',
  startAt: '2026-06-11T00:00:00.000Z',
  endAt: '2026-07-19T23:59:59.000Z',
  timezoneName: 'UTC',
  espnLeaguePath: 'fifa.world',
  footballDataCode: 'WC',
  footballDataSeason: 2026
};

function ptEnv_(key, defaultValue) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (value === null || value === undefined || value === '') return defaultValue || '';
  return value;
}

function ptRequiredEnv_(key) {
  const value = ptEnv_(key, '');
  if (!value) throw new Error('Falta Script Property: ' + key);
  return value;
}

function ptDryRun_() {
  return String(ptEnv_('POOLTEAM_DRY_RUN', 'false')).toLowerCase() === 'true';
}

function ptFootballDataEnabled_() {
  return Boolean(ptEnv_('FOOTBALL_DATA_KEY', ''));
}

function ptWorldCupDateRange_() {
  return {
    from: ptEnv_('WC2026_SYNC_FROM', '2026-06-11'),
    to: ptEnv_('WC2026_SYNC_TO', '2026-07-19')
  };
}

function ptTodayUtcDate_() {
  return Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
}

