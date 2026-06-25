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

function publishedWebBootstrap_(query) {
  query = query || {};
  return {
    matches: publishedWebMatches_(query),
    standings: publishedWebStandings_(query),
    teams: publishedWebTeams_(query),
    knockout: publishedWebKnockout_(query)
  };
}

function publishedWebSeason_(query) {
  const slug = (query && query.season) || PT_WC2026.seasonSlug;
  return ptSelectOne_('competition_seasons', 'select=*&slug=eq.' + encodeURIComponent(slug));
}

function publishedWebMatches_(query) {
  query = query || {};
  const season = publishedWebSeason_(query);
  if (!season) return { matches: [], generated_at: ptNowIso_() };

  let filter = 'select=*&competition_season_id=eq.' + season.competition_season_id;
  if (query.kickoff_from) filter += '&kickoff_at=gte.' + encodeURIComponent(String(query.kickoff_from));
  if (query.kickoff_to) filter += '&kickoff_at=lt.' + encodeURIComponent(String(query.kickoff_to));
  if (query.date_from) filter += '&kickoff_at=gte.' + encodeURIComponent(String(query.date_from).substring(0, 10) + 'T00:00:00.000Z');
  if (query.date_to) filter += '&kickoff_at=lt.' + encodeURIComponent(ptAddDays_(String(query.date_to).substring(0, 10), 1) + 'T00:00:00.000Z');
  if (query.status) filter += '&status=eq.' + encodeURIComponent(String(query.status).toUpperCase());
  filter += '&order=kickoff_at.asc';

  const matches = ptSelect_('matches', filter);
  const context = publishedWebContext_(season, matches);
  const weatherRefresh = publishedWebMaybeRefreshWeather_(matches, context, query);
  return {
    season: publishedWebSeasonSummary_(season),
    matches: matches.map(function(match) { return publishedWebMatchRow_(match, context); }),
    weather_refresh: weatherRefresh,
    generated_at: ptNowIso_()
  };
}

function publishedWebStandings_(query) {
  query = query || {};
  const season = publishedWebSeason_(query);
  if (!season) return { groups: [], generated_at: ptNowIso_() };
  const groups = publishedWebGroups_(season);
  const teams = publishedWebTeamsMap_();
  const countries = publishedWebCountriesMap_();
  const standings = ptSelect_('standings',
    'select=*&competition_season_id=eq.' + season.competition_season_id + '&order=position.asc');

  const latestByGroupTeam = {};
  standings.forEach(function(row) {
    const key = [row.group_id || '', row.team_id].join('|');
    if (!latestByGroupTeam[key] || String(row.as_of || '') > String(latestByGroupTeam[key].as_of || '')) {
      latestByGroupTeam[key] = row;
    }
  });

  return {
    season: publishedWebSeasonSummary_(season),
    groups: groups.map(function(group) {
      const rows = Object.keys(latestByGroupTeam).map(function(key) { return latestByGroupTeam[key]; })
        .filter(function(row) { return row.group_id === group.group_id; })
        .sort(function(a, b) {
          return Number(a.position || 999) - Number(b.position || 999) ||
            Number(b.points || 0) - Number(a.points || 0) ||
            Number(b.goal_difference || 0) - Number(a.goal_difference || 0);
        })
        .map(function(row) {
          const team = teams[row.team_id] || {};
          return {
            team_id: row.team_id,
            team_slug: team.slug,
            team_name: team.display_name,
            flag_emoji: publishedWebFlag_(team, countries),
            position: row.position,
            played: row.played || 0,
            wins: row.wins || 0,
            draws: row.draws || 0,
            losses: row.losses || 0,
            goals_for: row.goals_for || 0,
            goals_against: row.goals_against || 0,
            goal_difference: row.goal_difference || 0,
            points: row.points || 0,
            source: row.source
          };
        });
      return {
        group_id: group.group_id,
        group_code: group.group_code,
        group_name: group.group_name,
        group_order: group.group_order,
        standings: rows
      };
    }),
    generated_at: ptNowIso_()
  };
}

function publishedWebTeams_(query) {
  query = query || {};
  const season = publishedWebSeason_(query);
  if (!season) return { groups: [], teams: [], generated_at: ptNowIso_() };
  const teams = publishedWebTeamsMap_();
  const countries = publishedWebCountriesMap_();
  const groups = publishedWebGroups_(season);
  const groupById = groups.reduce(function(acc, group) { acc[group.group_id] = group; return acc; }, {});
  const standingsPayload = publishedWebStandings_(query);
  const standingsByTeam = {};
  standingsPayload.groups.forEach(function(group) {
    group.standings.forEach(function(row) { standingsByTeam[row.team_id] = row; });
  });
  const entries = ptSelect_('competition_team_entries',
    'select=*&competition_season_id=eq.' + season.competition_season_id);
  const memberships = ptSelect_('competition_group_memberships',
    'select=*&group_id=in.(' + groups.map(function(group) { return group.group_id; }).join(',') + ')');
  const membershipByEntry = memberships.reduce(function(acc, row) {
    acc[row.competition_team_entry_id] = row;
    return acc;
  }, {});
  const rosters = ptSelect_('competition_rosters',
    'select=team_id,player_id&competition_season_id=eq.' + season.competition_season_id);
  const rosterCount = rosters.reduce(function(acc, row) {
    acc[row.team_id] = (acc[row.team_id] || 0) + 1;
    return acc;
  }, {});

  const rows = entries.map(function(entry) {
    const team = teams[entry.team_id] || {};
    const membership = membershipByEntry[entry.competition_team_entry_id] || {};
    const group = groupById[membership.group_id] || {};
    const standing = standingsByTeam[entry.team_id] || {};
    return {
      team_id: team.team_id,
      slug: team.slug,
      display_name: team.display_name,
      country_code: team.country_code,
      flag_emoji: publishedWebFlag_(team, countries),
      group_id: group.group_id || null,
      group_code: group.group_code || null,
      group_name: group.group_name || null,
      group_order: group.group_order || null,
      seed_rating: entry.seed_rating,
      roster_count: rosterCount[entry.team_id] || 0,
      points: standing.points || 0,
      played: standing.played || 0,
      wins: standing.wins || 0,
      draws: standing.draws || 0,
      losses: standing.losses || 0,
      goals_for: standing.goals_for || 0,
      goals_against: standing.goals_against || 0,
      goal_difference: standing.goal_difference || 0,
      metadata: team.metadata || {}
    };
  }).sort(function(a, b) {
    return Number(a.group_order || 999) - Number(b.group_order || 999) ||
      Number(b.points || 0) - Number(a.points || 0) ||
      String(a.display_name || '').localeCompare(String(b.display_name || ''));
  });

  return {
    season: publishedWebSeasonSummary_(season),
    groups: groups,
    teams: rows,
    generated_at: ptNowIso_()
  };
}

function publishedWebTeamDetail_(query) {
  query = query || {};
  const season = publishedWebSeason_(query);
  if (!season) return { team: null, matches: [], roster: [], generated_at: ptNowIso_() };
  const teamSlug = query.team_slug || query.slug;
  const teamId = query.team_id;
  const team = teamId
    ? ptSelectOne_('teams', 'select=*&team_id=eq.' + encodeURIComponent(teamId))
    : ptSelectOne_('teams', 'select=*&slug=eq.' + encodeURIComponent(teamSlug || ''));
  if (!team) return { team: null, matches: [], roster: [], generated_at: ptNowIso_() };

  const countries = publishedWebCountriesMap_();
  const groups = publishedWebGroups_(season);
  const groupById = groups.reduce(function(acc, group) { acc[group.group_id] = group; return acc; }, {});
  const entry = ptSelectOne_('competition_team_entries',
    'select=*&competition_season_id=eq.' + season.competition_season_id + '&team_id=eq.' + encodeURIComponent(team.team_id));
  let group = {};
  if (entry) {
    const membership = ptSelectOne_('competition_group_memberships',
      'select=*&competition_team_entry_id=eq.' + encodeURIComponent(entry.competition_team_entry_id));
    group = groupById[membership && membership.group_id] || {};
  }

  const participants = ptSelect_('match_participants',
    'select=match_id,side,score,penalty_score&team_id=eq.' + encodeURIComponent(team.team_id));
  const matchIds = participants.map(function(row) { return row.match_id; });
  const participantByMatch = participants.reduce(function(acc, row) { acc[row.match_id] = row; return acc; }, {});
  const matches = matchIds.length ? ptSelect_('matches',
    'select=*&competition_season_id=eq.' + season.competition_season_id +
    '&match_id=in.(' + matchIds.join(',') + ')' +
    '&order=kickoff_at.asc') : [];
  const context = publishedWebContext_(season, matches);
  const matchRows = matches.map(function(match) {
    const row = publishedWebMatchRow_(match, context);
    row.team_result = publishedWebTeamResult_(row, participantByMatch[match.match_id]);
    return row;
  });

  const rosters = ptSelect_('competition_rosters',
    'select=*&competition_season_id=eq.' + season.competition_season_id +
    '&team_id=eq.' + encodeURIComponent(team.team_id) +
    '&order=position.asc,shirt_number.asc');
  const playerIds = rosters.map(function(row) { return row.player_id; });
  const players = playerIds.length ? ptSelect_('players',
    'select=*&player_id=in.(' + playerIds.join(',') + ')') : [];
  const playersById = players.reduce(function(acc, player) { acc[player.player_id] = player; return acc; }, {});
  const stats = playerIds.length ? ptSelect_('player_match_stats',
    'select=*&team_id=eq.' + encodeURIComponent(team.team_id) +
    '&player_id=in.(' + playerIds.join(',') + ')') : [];
  const statsByPlayer = publishedWebPlayerStatsSummary_(stats);

  return {
    season: publishedWebSeasonSummary_(season),
    team: {
      team_id: team.team_id,
      slug: team.slug,
      display_name: team.display_name,
      country_code: team.country_code,
      flag_emoji: publishedWebFlag_(team, countries),
      group_id: group.group_id || null,
      group_code: group.group_code || null,
      group_name: group.group_name || null,
      metadata: team.metadata || {}
    },
    matches: matchRows,
    roster: rosters.map(function(roster) {
      const player = playersById[roster.player_id] || {};
      const summary = statsByPlayer[roster.player_id] || {};
      return {
        player_id: roster.player_id,
        slug: player.slug,
        display_name: player.display_name,
        shirt_number: roster.shirt_number,
        position: roster.position || 'UNKNOWN',
        roster_status: roster.roster_status,
        metadata: player.metadata || {},
        stats: summary
      };
    }),
    generated_at: ptNowIso_()
  };
}

function publishedWebTeamResult_(match, participant) {
  if (!participant || match.home_score === null || match.home_score === undefined || match.away_score === null || match.away_score === undefined) {
    return null;
  }
  const own = participant.side === 'HOME' ? Number(match.home_score) : Number(match.away_score);
  const opp = participant.side === 'HOME' ? Number(match.away_score) : Number(match.home_score);
  return own > opp ? 'W' : own < opp ? 'L' : 'D';
}

function publishedWebPlayerStatsSummary_(stats) {
  return stats.reduce(function(acc, row) {
    if (!acc[row.player_id]) {
      acc[row.player_id] = {
        appearances: 0,
        minutes: 0,
        goals: 0,
        assists: 0,
        yellow_cards: 0,
        red_cards: 0,
        avg_rating: null
      };
    }
    const item = acc[row.player_id];
    const name = String(row.stat_name || '').toLowerCase();
    const value = Number(row.stat_value || 0);
    if (name === 'minutes') {
      item.appearances += 1;
      item.minutes += value;
    } else if (name === 'goals_scored' || name === 'goals') {
      item.goals += value;
    } else if (name === 'assists') {
      item.assists += value;
    } else if (name === 'yellow_cards') {
      item.yellow_cards += value;
    } else if (name === 'red_cards') {
      item.red_cards += value;
    } else if (name === 'rating') {
      const ratings = item._ratings || [];
      ratings.push(value);
      item._ratings = ratings;
      item.avg_rating = Math.round((ratings.reduce(function(a, b) { return a + b; }, 0) / ratings.length) * 100) / 100;
    }
    return acc;
  }, {});
}

function publishedWebKnockout_(query) {
  query = query || {};
  const season = publishedWebSeason_(query);
  if (!season) return { stages: [], matches: [], generated_at: ptNowIso_() };
  const stages = ptSelect_('competition_stages',
    'select=*&competition_season_id=eq.' + season.competition_season_id + '&order=stage_order.asc');
  const knockoutStageIds = stages
    .filter(function(stage) { return stage.stage_type !== 'GROUP_STAGE'; })
    .map(function(stage) { return stage.stage_id; });
  if (!knockoutStageIds.length) return { stages: [], matches: [], generated_at: ptNowIso_() };
  const matches = ptSelect_('matches',
    'select=*&competition_season_id=eq.' + season.competition_season_id +
    '&stage_id=in.(' + knockoutStageIds.join(',') + ')' +
    '&order=kickoff_at.asc');
  const context = publishedWebContext_(season, matches);
  return {
    season: publishedWebSeasonSummary_(season),
    stages: stages.filter(function(stage) { return knockoutStageIds.indexOf(stage.stage_id) !== -1; }),
    matches: matches.map(function(match) { return publishedWebMatchRow_(match, context); }),
    generated_at: ptNowIso_()
  };
}

function publishedWebContext_(season, matches) {
  matches = matches || [];
  const matchIds = matches.map(function(match) { return match.match_id; });
  const teamMap = publishedWebTeamsMap_();
  const countryMap = publishedWebCountriesMap_();
  const stageMap = ptSelect_('competition_stages',
    'select=*&competition_season_id=eq.' + season.competition_season_id)
    .reduce(function(acc, row) { acc[row.stage_id] = row; return acc; }, {});
  const groupMap = publishedWebGroups_(season)
    .reduce(function(acc, row) { acc[row.group_id] = row; return acc; }, {});
  const venueMap = ptSelect_('venues', 'select=*')
    .reduce(function(acc, row) { acc[row.venue_id] = row; return acc; }, {});
  const slotMap = ptSelect_('tournament_slots',
    'select=*&competition_season_id=eq.' + season.competition_season_id)
    .reduce(function(acc, row) { acc[row.tournament_slot_id] = row; return acc; }, {});
  const participants = matchIds.length ? ptSelect_('match_participants',
    'select=*&match_id=in.(' + matchIds.join(',') + ')') : [];
  const participantsByMatch = participants.reduce(function(acc, row) {
    if (!acc[row.match_id]) acc[row.match_id] = {};
    acc[row.match_id][row.side] = row;
    return acc;
  }, {});
  return {
    teams: teamMap,
    countries: countryMap,
    stages: stageMap,
    groups: groupMap,
    venues: venueMap,
    slots: slotMap,
    participants: participantsByMatch
  };
}

function publishedWebMatchRow_(match, context) {
  const home = publishedWebParticipant_(context.participants[match.match_id] && context.participants[match.match_id].HOME, context);
  const away = publishedWebParticipant_(context.participants[match.match_id] && context.participants[match.match_id].AWAY, context);
  const stage = context.stages[match.stage_id] || {};
  const group = context.groups[match.group_id] || {};
  const venue = context.venues[match.venue_id] || {};
  return {
    match_id: match.match_id,
    slug: match.slug,
    match_number: match.match_number,
    kickoff_at: match.kickoff_at,
    status: match.status,
    stage_code: stage.stage_code || null,
    stage_name: stage.stage_name || null,
    stage_type: stage.stage_type || null,
    group_code: group.group_code || null,
    group_name: group.group_name || null,
    venue: venue.venue_id ? {
      venue_id: venue.venue_id,
      slug: venue.slug,
      display_name: venue.display_name,
      city: venue.city,
      country_code: venue.country_code,
      timezone_name: venue.timezone_name,
      latitude: venue.latitude,
      longitude: venue.longitude,
      metadata: venue.metadata || {}
    } : null,
    weather: publishedWebWeather_(match),
    home: home,
    away: away,
    home_score: match.home_score,
    away_score: match.away_score,
    metadata: match.metadata || {}
  };
}

function publishedWebWeather_(match) {
  const metadata = match.metadata || {};
  if (metadata.weather) return metadata.weather;
  if (metadata.clima) return metadata.clima;
  const sportmonks = metadata.sportmonks || {};
  const report = sportmonks.weatherReport || sportmonks.weather_report || sportmonks.weather || null;
  if (!report) return null;
  return {
    source: 'SPORTMONKS',
    temperature_c: report.temperature_celsius || report.temperature || report.temp || null,
    humidity_pct: report.humidity || report.humidity_percentage || null,
    wind_kph: report.wind_speed || report.wind_kph || null,
    condition: report.description || report.condition || report.type || null,
    payload: report
  };
}

function publishedWebMaybeRefreshWeather_(matches, context, query) {
  query = query || {};
  if (String(query.weather || '').toLowerCase() === 'none') {
    return { enabled: false, reason: 'disabled_by_query' };
  }
  if (typeof refreshWeatherCacheForMatches_ !== 'function') {
    return { enabled: false, reason: 'weather_service_unavailable' };
  }
  try {
    const result = refreshWeatherCacheForMatches_(matches, context, {
      refresh_limit: query.weather_refresh_limit || query.weather_limit || PT_WEATHER_DEFAULT_REFRESH_LIMIT,
      ttl_minutes: query.weather_ttl_minutes || null,
      force: String(query.weather || '').toLowerCase() === 'refresh' || String(query.weather_force || '').toLowerCase() === 'true'
    });
    return Object.assign({ enabled: true }, result);
  } catch (e) {
    try {
      ptLogQuality_('PUBLISHED', 'WARN', 'PUBLISHED_WEATHER_REFRESH_ERROR', 'Published weather refresh failed', { error: e.message });
    } catch (ignored_) {}
    return { enabled: true, status: 'WARN', error: e.message };
  }
}

function publishedWebParticipant_(participant, context) {
  if (!participant) return null;
  if (participant.participant_role === 'TEAM') {
    const team = context.teams[participant.team_id] || {};
    return {
      role: 'TEAM',
      team_id: team.team_id,
      slug: team.slug,
      display_name: team.display_name,
      country_code: team.country_code,
      flag_emoji: publishedWebFlag_(team, context.countries),
      score: participant.score,
      penalty_score: participant.penalty_score
    };
  }
  const slot = context.slots[participant.tournament_slot_id] || {};
  return {
    role: 'SLOT',
    tournament_slot_id: slot.tournament_slot_id,
    slot_code: slot.slot_code,
    display_name: slot.slot_label || 'Por definir',
    flag_emoji: '🏳️',
    score: participant.score,
    penalty_score: participant.penalty_score
  };
}

function publishedWebTeamsMap_() {
  return ptSelect_('teams', 'select=*').reduce(function(acc, row) {
    acc[row.team_id] = row;
    return acc;
  }, {});
}

function publishedWebCountriesMap_() {
  return ptSelect_('published_country_catalog', 'select=*').reduce(function(acc, row) {
    acc[row.code_alpha2] = row;
    return acc;
  }, {});
}

function publishedWebGroups_(season) {
  return ptSelect_('competition_groups',
    'select=*&competition_season_id=eq.' + season.competition_season_id + '&order=group_order.asc');
}

function publishedWebFlag_(team, countries) {
  const country = countries[String(team && team.country_code || '').toUpperCase()] || {};
  return country.flag_emoji || '🏳️';
}

function publishedWebSeasonSummary_(season) {
  return {
    competition_season_id: season.competition_season_id,
    slug: season.slug,
    season_label: season.season_label,
    starts_at: season.starts_at,
    ends_at: season.ends_at,
    timezone_name: season.timezone_name
  };
}
