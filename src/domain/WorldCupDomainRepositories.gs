/**
 * WorldCupDomainRepositories.gs
 *
 * Repositorios de dominio para competencia, teams, venues, matches y mercados.
 */

function ptGetWorldCupSeason_() {
  return ptSelectOne_('competition_seasons', 'select=*&slug=eq.' + encodeURIComponent(PT_WC2026.seasonSlug));
}

function ptBootstrapWorldCupCompetition_() {
  const comp = ptUpsertOneReturn_('competitions', {
    slug: PT_WC2026.competitionSlug,
    display_name: PT_WC2026.competitionName,
    competition_type: 'TOURNAMENT',
    country_code: null,
    region: 'Global',
    tier: 1,
    is_international: true,
    metadata: { source: 'poolteam_clean_jobs', format: 'GROUP_THEN_KNOCKOUT' }
  }, 'slug');

  const season = ptUpsertOneReturn_('competition_seasons', {
    competition_id: comp.competition_id,
    slug: PT_WC2026.seasonSlug,
    season_label: PT_WC2026.seasonLabel,
    starts_at: PT_WC2026.startAt,
    ends_at: PT_WC2026.endAt,
    timezone_name: PT_WC2026.timezoneName,
    status: 'ACTIVE',
    format_code: 'GROUP_THEN_KNOCKOUT',
    metadata: { source: 'poolteam_clean_jobs', host_countries: ['United States', 'Mexico', 'Canada'] }
  }, 'slug');

  ptUpsert_('competition_status', [{
    competition_season_id: season.competition_season_id,
    status: 'OBSERVATION',
    status_reason: 'Initial clean bootstrap',
    readiness_score: 0
  }], 'competition_season_id');

  ptBootstrapStagesAndGroups_(season.competition_season_id);
  ptBootstrapReadinessChecks_(season.competition_season_id);
  ptBootstrapMarkets_();
  ptUpsertExternalRef_('COMPETITION', comp.competition_id, 'ESPN', 'league', PT_WC2026.espnLeaguePath, PT_WC2026.competitionName, null, {}, true);
  ptUpsertExternalRef_('COMPETITION_SEASON', season.competition_season_id, 'FOOTBALL_DATA', 'competition-season', PT_WC2026.footballDataCode + ':' + PT_WC2026.footballDataSeason, 'World Cup 2026', null, {}, false);
  return { competition: comp, season: season };
}

function ptBootstrapStagesAndGroups_(seasonId) {
  const stages = [
    ['GROUP_STAGE', 'Group Stage', 'GROUP_STAGE', 1],
    ['ROUND_OF_32', 'Round of 32', 'KNOCKOUT', 2],
    ['ROUND_OF_16', 'Round of 16', 'KNOCKOUT', 3],
    ['QUARTER_FINAL', 'Quarter-final', 'KNOCKOUT', 4],
    ['SEMI_FINAL', 'Semi-final', 'KNOCKOUT', 5],
    ['THIRD_PLACE', 'Third place', 'THIRD_PLACE', 6],
    ['FINAL', 'Final', 'FINAL', 7]
  ].map(function(s) {
    return {
      competition_season_id: seasonId,
      stage_code: s[0],
      stage_name: s[1],
      stage_type: s[2],
      stage_order: s[3],
      rules: { source: 'poolteam_clean_jobs' }
    };
  });
  ptUpsert_('competition_stages', stages, 'competition_season_id,stage_code');
  if (ptDryRun_()) return;
  const groupStage = ptFindStage_(seasonId, 'GROUP_STAGE');
  const groups = 'ABCDEFGHIJKL'.split('').map(function(letter, i) {
    return {
      competition_season_id: seasonId,
      stage_id: groupStage.stage_id,
      group_code: 'Grupo ' + letter,
      group_name: 'Grupo ' + letter,
      group_order: i + 1,
      metadata: { source: 'poolteam_clean_jobs' }
    };
  });
  ptUpsert_('competition_groups', groups, 'competition_season_id,stage_id,group_code');
}

function ptBootstrapReadinessChecks_(seasonId) {
  const checks = [
    'fixtures_reliable', 'results_reliable', 'odds_sufficient', 'aliases_normalized',
    'minimum_history', 'separate_calibration', 'liquidity_tier_defined',
    'closing_odds_available', 'data_quality_clean', 'backtest_available',
    'market_benchmark_available'
  ].map(function(name) {
    return {
      competition_season_id: seasonId,
      check_name: name,
      status: 'WARN',
      score: 0,
      details: { source: 'poolteam_clean_jobs', reason: 'pending_operational_validation' },
      checked_at: ptNowIso_()
    };
  });
  ptUpsert_('competition_readiness_checks', checks, 'competition_season_id,check_name');
}

function ptBootstrapMarkets_() {
  const markets = [
    { market_code: '1X2', display_name: '1X2', category: '1X2', selections: ['HOME', 'DRAW', 'AWAY'] },
    { market_code: 'OVER_UNDER', display_name: 'Over/Under', category: 'OVER_UNDER', selections: ['OVER', 'UNDER'] },
    { market_code: 'BTTS', display_name: 'Both Teams To Score', category: 'BTTS', selections: ['YES', 'NO'] }
  ];
  markets.forEach(function(marketDef) {
    const market = ptUpsertOneReturn_('markets', {
      market_code: marketDef.market_code,
      display_name: marketDef.display_name,
      category: marketDef.category,
      is_active: true,
      metadata: { source: 'poolteam_clean_jobs' }
    }, 'market_code');
    const selections = marketDef.selections.map(function(code, i) {
      return {
        market_id: market.market_id,
        selection_code: code,
        display_name: code,
        sort_order: i + 1,
        metadata: { source: 'poolteam_clean_jobs' }
      };
    });
    ptUpsert_('market_selections', selections, 'market_id,selection_code');
  });
}

function ptFindStage_(seasonId, stageCode) {
  return ptSelectOne_('competition_stages', 'select=*&competition_season_id=eq.' + seasonId + '&stage_code=eq.' + encodeURIComponent(stageCode));
}

function ptFindGroup_(seasonId, stageId, groupCode) {
  if (!groupCode) return null;
  return ptSelectOne_('competition_groups',
    'select=*&competition_season_id=eq.' + seasonId + '&stage_id=eq.' + stageId + '&group_code=eq.' + encodeURIComponent(groupCode));
}

function ptResolveTeam_(normalizedTeam, seasonId, groupId) {
  if (!normalizedTeam || !normalizedTeam.display_name) {
    ptEnqueueResolution_('TEAM', normalizedTeam && normalizedTeam.source, normalizedTeam && normalizedTeam.source_team_id, 'unknown', '', normalizedTeam || {});
    return null;
  }
  const ref = ptFindExternalRef_('TEAM', normalizedTeam.source, normalizedTeam.source_team_id);
  let team = ref ? ptSelectOne_('teams', 'select=*&team_id=eq.' + ref.entity_id) : null;
  if (!team) {
    const slug = ptSlug_(normalizedTeam.display_name);
    team = ptUpsertOneReturn_('teams', {
      slug: slug,
      team_type: 'NATIONAL_TEAM',
      display_name: normalizedTeam.display_name,
      normalized_name: normalizedTeam.normalized_name,
      country_code: normalizedTeam.country_code,
      gender: 'MEN',
      metadata: {
        source: normalizedTeam.source,
        abbreviation: normalizedTeam.abbreviation,
        external_refs: normalizedTeam.source_team_id ? [{ source: normalizedTeam.source, id: normalizedTeam.source_team_id }] : []
      }
    }, 'slug');
  }
  ptUpsert_('team_aliases', [{
    team_id: team.team_id,
    alias: normalizedTeam.display_name,
    normalized_alias: normalizedTeam.normalized_name,
    source: normalizedTeam.source,
    confidence: 1
  }], 'normalized_alias,source');
  ptUpsertExternalRef_('TEAM', team.team_id, normalizedTeam.source, 'team', normalizedTeam.source_team_id, normalizedTeam.display_name, null, normalizedTeam.payload, true);
  if (normalizedTeam.logo_url) {
    ptUpsert_('entity_media_assets', [{
      entity_type: 'TEAM',
      entity_id: team.team_id,
      media_type: 'LOGO',
      source: normalizedTeam.source,
      url: normalizedTeam.logo_url,
      is_primary: true,
      payload: normalizedTeam.payload || {}
    }], 'entity_type,entity_id,media_type,source');
  }
  if (seasonId) {
    const entry = ptUpsertOneReturn_('competition_team_entries', {
      competition_season_id: seasonId,
      team_id: team.team_id,
      entry_status: 'ACTIVE',
      metadata: { source: normalizedTeam.source }
    }, 'competition_season_id,team_id');
    if (groupId) {
      ptUpsert_('competition_group_memberships', [{
        group_id: groupId,
        competition_team_entry_id: entry.competition_team_entry_id,
        membership_status: 'ACTIVE',
        metadata: { source: normalizedTeam.source }
      }], 'group_id,competition_team_entry_id');
    }
  }
  return team;
}

function ptResolveVenue_(normalizedVenue) {
  if (!normalizedVenue || !normalizedVenue.display_name) return null;
  const ref = ptFindExternalRef_('VENUE', normalizedVenue.source, normalizedVenue.source_venue_id);
  let venue = ref ? ptSelectOne_('venues', 'select=*&venue_id=eq.' + ref.entity_id) : null;
  if (!venue) {
    venue = ptUpsertOneReturn_('venues', {
      slug: ptSlug_([normalizedVenue.display_name, normalizedVenue.city].join(' ')),
      display_name: normalizedVenue.display_name,
      city: normalizedVenue.city,
      country_code: normalizedVenue.country_code,
      timezone_name: normalizedVenue.timezone_name,
      latitude: normalizedVenue.latitude,
      longitude: normalizedVenue.longitude,
      metadata: { source: normalizedVenue.source }
    }, 'slug');
  }
  ptUpsertExternalRef_('VENUE', venue.venue_id, normalizedVenue.source, 'venue', normalizedVenue.source_venue_id, normalizedVenue.display_name, null, normalizedVenue.payload, true);
  return venue;
}

function ptResolveMatch_(season, normalizedMatch) {
  if (!normalizedMatch || !normalizedMatch.kickoff_at) {
    ptLogQuality_('CANONICAL', 'ERROR', 'FIXTURE_WITHOUT_KICKOFF', 'Fixture without kickoff_at', normalizedMatch || {});
    return null;
  }
  const stage = ptFindStage_(season.competition_season_id, normalizedMatch.stage_code || 'GROUP_STAGE') || ptFindStage_(season.competition_season_id, 'GROUP_STAGE');
  const group = stage ? ptFindGroup_(season.competition_season_id, stage.stage_id, normalizedMatch.group_code) : null;
  const venue = ptResolveVenue_(normalizedMatch.venue);
  const homeTeam = ptResolveTeam_(normalizedMatch.home, season.competition_season_id, group && group.group_id);
  const awayTeam = ptResolveTeam_(normalizedMatch.away, season.competition_season_id, group && group.group_id);
  if (!homeTeam || !awayTeam) {
    ptLogQuality_('CANONICAL', 'ERROR', 'MATCH_WITHOUT_TEAM', 'Match cannot resolve HOME/AWAY', normalizedMatch);
    return null;
  }
  const externalRef = ptFindExternalRef_('MATCH', normalizedMatch.source, normalizedMatch.source_match_id);
  let match = externalRef ? ptSelectOne_('matches', 'select=*&match_id=eq.' + externalRef.entity_id) : null;
  const row = {
    competition_season_id: season.competition_season_id,
    stage_id: stage && stage.stage_id,
    group_id: group && group.group_id,
    venue_id: venue && venue.venue_id,
    slug: match ? match.slug : ptMatchSlug_(season.slug, normalizedMatch),
    match_number: normalizedMatch.match_number || null,
    kickoff_at: normalizedMatch.kickoff_at,
    status: normalizedMatch.status,
    is_neutral: true,
    home_score: normalizedMatch.home_score,
    away_score: normalizedMatch.away_score,
    winner_team_id: ptWinnerTeamId_(homeTeam.team_id, awayTeam.team_id, normalizedMatch.home_score, normalizedMatch.away_score, normalizedMatch.status),
    metadata: { source: normalizedMatch.source, source_match_name: normalizedMatch.source_match_name }
  };
  match = ptUpsertOneReturn_('matches', row, 'slug');
  ptUpsert_('match_participants', [
    {
      match_id: match.match_id,
      side: 'HOME',
      participant_role: 'TEAM',
      team_id: homeTeam.team_id,
      is_home_designation: true,
      score: normalizedMatch.home_score,
      metadata: { source: normalizedMatch.source }
    },
    {
      match_id: match.match_id,
      side: 'AWAY',
      participant_role: 'TEAM',
      team_id: awayTeam.team_id,
      is_home_designation: false,
      score: normalizedMatch.away_score,
      metadata: { source: normalizedMatch.source }
    }
  ], 'match_id,side');
  ptUpsertExternalRef_('MATCH', match.match_id, normalizedMatch.source, 'event', normalizedMatch.source_match_id, normalizedMatch.source_match_name, null, normalizedMatch.payload, true);
  return match;
}

function ptWinnerTeamId_(homeTeamId, awayTeamId, homeScore, awayScore, status) {
  if (status !== 'FINISHED') return null;
  if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) return null;
  if (Number(homeScore) > Number(awayScore)) return homeTeamId;
  if (Number(awayScore) > Number(homeScore)) return awayTeamId;
  return null;
}
