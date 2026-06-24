/**
 * WorldCupOperationalJobs.gs
 *
 * Jobs publicos ejecutables desde Google Apps Script.
 */

function ptRunJob_(jobName, fn) {
  const started = ptNowIso_();
  ptLogPipelineStart_(jobName, { dryRun: ptDryRun_() });
  try {
    const result = fn() || {};
    const records = Number(result.records_processed || result.records_upserted || result.matches || result.events || 0);
    ptLogPipelineFinish_(jobName, result.status || 'OK', started, records, result, null);
    ptLog_(jobName + ' OK', result);
    return Object.assign({ ok: true, job_name: jobName }, result);
  } catch (e) {
    const payload = { error: e.message, stack: e.stack };
    ptLogQuality_('STAGING', 'ERROR', 'JOB_ERROR', jobName + ': ' + e.message, payload);
    ptLogPipelineFinish_(jobName, 'ERROR', started, 0, payload, e.message);
    throw e;
  }
}

function job_worldCup_bootstrapCompetition() {
  return ptRunJob_('worldcup_bootstrap_competition', function() {
    const out = ptBootstrapWorldCupCompetition_();
    return {
      status: 'OK',
      records_upserted: 1,
      competition_id: out.competition.competition_id,
      competition_season_id: out.season.competition_season_id
    };
  });
}

function job_worldCup_syncFixturesFromEspn() {
  return ptRunJob_('worldcup_sync_fixtures_espn', function() {
    const boot = ptBootstrapWorldCupCompetition_();
    const range = ptWorldCupDateRange_();
    const fetched = espnFetchWorldCupSchedule_(range.from, range.to);
    let normalized = 0;
    let upserted = 0;
    let raw = 0;
    fetched.calls.forEach(function(call) {
      ptSaveRawApiCall_('ESPN', 'scoreboard', { date: call.date }, call.response);
      if (!call.response.ok) {
        ptLogQuality_('RAW', 'WARN', 'ESPN_API_ERROR', 'ESPN scoreboard failed for ' + call.date, call.response);
      }
    });
    fetched.events.forEach(function(event) {
      raw++;
      ptSaveRawPayload_('ESPN', 'event', event.id, event, null);
      const nm = ptNormalizeMatchFromEspn_(event);
      normalized++;
      const match = ptResolveMatch_(boot.season, nm);
      if (match) upserted++;
    });
    return {
      status: 'OK',
      source: 'ESPN',
      date_from: range.from,
      date_to: range.to,
      raw_events: raw,
      records_normalized: normalized,
      records_upserted: upserted
    };
  });
}

function job_worldCup_syncResultsFromEspn() {
  return ptRunJob_('worldcup_sync_results_espn', function() {
    const boot = ptBootstrapWorldCupCompetition_();
    const range = ptWorldCupDateRange_();
    const fetched = espnFetchWorldCupSchedule_(range.from, range.to);
    let settled = 0;
    let updated = 0;
    fetched.events.forEach(function(event) {
      ptSaveRawPayload_('ESPN', 'event_result', event.id, event, null);
      const nm = ptNormalizeMatchFromEspn_(event);
      const match = ptResolveMatch_(boot.season, nm);
      if (!match) return;
      updated++;
      if (nm.status === 'FINISHED') {
        settled++;
        try {
          const summary = espnFetchWorldCupEvent_(event.id);
          ptSaveRawApiCall_('ESPN', 'summary', { event_id: event.id }, summary);
          if (summary.ok) ptSaveRawPayload_('ESPN', 'event_summary', event.id, summary.json, null);
        } catch (e) {
          ptLogQuality_('RAW', 'WARN', 'ESPN_SUMMARY_ERROR', 'Could not fetch ESPN summary', { event_id: event.id, error: e.message });
        }
        if (typeof recordDomainEvent_ === 'function') {
          try {
            recordDomainEvent_('MATCH_SETTLED', 'MATCH', match.match_id, {
              source: 'ESPN',
              home_score: nm.home_score,
              away_score: nm.away_score
            });
          } catch (domainErr) {
            ptLogQuality_('CANONICAL', 'WARN', 'DOMAIN_EVENT_SKIPPED', 'MATCH_SETTLED domain event skipped', { error: domainErr.message });
          }
        }
      }
    });
    return { status: 'OK', source: 'ESPN', records_upserted: updated, matches_settled: settled };
  });
}

function job_worldCup_syncFixturesFromFootballData() {
  return ptRunJob_('worldcup_sync_fixtures_football_data', function() {
    const boot = ptBootstrapWorldCupCompetition_();
    const response = footballDataFetchCompetitionMatches_(PT_WC2026.footballDataCode, PT_WC2026.footballDataSeason);
    if (response.skipped) return { status: 'WARN', skipped: true, reason: response.reason, records_upserted: 0 };
    ptSaveRawApiCall_('FOOTBALL_DATA', 'competition_matches', { code: PT_WC2026.footballDataCode, season: PT_WC2026.footballDataSeason }, response);
    if (!response.ok) {
      ptLogQuality_('RAW', 'WARN', 'FOOTBALL_DATA_API_ERROR', 'FootballData matches failed', response);
      return { status: 'WARN', records_upserted: 0, error: response.status };
    }
    let upserted = 0;
    let conflicts = 0;
    (response.matches || []).forEach(function(match) {
      ptSaveRawPayload_('FOOTBALL_DATA', 'match', match.id, match, null);
      const nm = ptNormalizeMatchFromFootballData_(match);
      const existingRef = ptFindExternalRef_('MATCH', 'FOOTBALL_DATA', nm.source_match_id);
      const saved = ptResolveMatch_(boot.season, nm);
      if (saved) upserted++;
      if (!existingRef && saved) {
        const espnSameSlug = ptSelectOne_('matches', 'select=*&slug=eq.' + encodeURIComponent(saved.slug));
        if (espnSameSlug && espnSameSlug.match_id !== saved.match_id) {
          conflicts++;
          ptLogQuality_('CANONICAL', 'WARN', 'ESPN_FOOTBALL_DATA_MATCH_CONFLICT', 'FootballData match may differ from ESPN canonical match', { football_data: nm, match: saved });
        }
      }
    });
    return { status: conflicts ? 'WARN' : 'OK', source: 'FOOTBALL_DATA', records_upserted: upserted, conflicts: conflicts };
  });
}

function job_worldCup_dailyRefresh() {
  return ptRunJob_('worldcup_daily_refresh', function() {
    const results = [];
    results.push(job_worldCup_bootstrapCompetition());
    results.push(job_worldCup_syncFixturesFromEspn());
    results.push(job_worldCup_syncResultsFromEspn());
    if (ptFootballDataEnabled_()) results.push(job_worldCup_syncFixturesFromFootballData());
    const health = validateWorldCupDataHealth();
    return { status: health.status === 'OK' ? 'OK' : 'WARN', records_processed: results.length, results: results, health: health };
  });
}

function job_worldCup_liveRefresh() {
  return ptRunJob_('worldcup_live_refresh', function() {
    const boot = ptBootstrapWorldCupCompetition_();
    const today = ptTodayUtcDate_();
    const response = espnFetchWorldCupScoreboard_(today);
    ptSaveRawApiCall_('ESPN', 'scoreboard_live', { date: today }, response);
    if (!response.ok) return { status: 'WARN', records_upserted: 0, error: response.status };
    let upserted = 0;
    (response.json.events || []).forEach(function(event) {
      ptSaveRawPayload_('ESPN', 'live_event', event.id, event, null);
      const match = ptResolveMatch_(boot.season, ptNormalizeMatchFromEspn_(event));
      if (match) upserted++;
    });
    return { status: 'OK', date: today, records_upserted: upserted };
  });
}

function setupWorldCup2026InitialData() {
  return job_worldCup_bootstrapCompetition();
}

function runWorldCupDailyRefresh() {
  return job_worldCup_dailyRefresh();
}

function runWorldCupLiveRefresh() {
  return job_worldCup_liveRefresh();
}

function runWorldCupFixturesBackfill() {
  return job_worldCup_syncFixturesFromEspn();
}

function runWorldCupResultsBackfill() {
  return job_worldCup_syncResultsFromEspn();
}

function validateWorldCupDataHealth() {
  const season = ptGetWorldCupSeason_();
  const seasonFilter = season ? 'competition_season_id=eq.' + season.competition_season_id : '';
  function count(table, query) {
    try { return supabaseCount_(table, query || ''); } catch (e) { return null; }
  }
  const checks = {
    competitions: count('competitions', 'slug=eq.' + PT_WC2026.competitionSlug),
    competition_seasons: count('competition_seasons', 'slug=eq.' + PT_WC2026.seasonSlug),
    teams: count('teams'),
    matches: season ? count('matches', seasonFilter) : 0,
    match_participants: count('match_participants'),
    raw_payloads_espn: count('raw_source_payloads', 'source=eq.ESPN'),
    data_quality_open: count('entity_resolution_queue', 'resolution_status=in.(OPEN,IN_REVIEW)')
  };
  const missingHomeAway = season ? ptSelect_('published_data_quality_health', 'select=*&check_name=eq.MATCH_WITHOUT_HOME_OR_AWAY') : [];
  const status = checks.competitions && checks.competition_seasons ? 'OK' : 'WARN';
  const out = { ok: status === 'OK', status: status, checks: checks, published_health: missingHomeAway, ts: ptNowIso_() };
  ptLog_(ptJson_(out));
  return out;
}

function printWorldCupSyncSummary() {
  const season = ptGetWorldCupSeason_();
  const rows = season ? ptSelect_('published_match_schedule',
    'select=*&competition_season_slug=eq.' + PT_WC2026.seasonSlug + '&order=kickoff_at.asc') : [];
  const now = ptNowIso_();
  const summary = {
    season_id: season && season.competition_season_id,
    total_matches: rows.length,
    played: rows.filter(function(r) { return r.status === 'FINISHED'; }).length,
    today: rows.filter(function(r) { return ptDateToYmd_(r.kickoff_at) === ptTodayUtcDate_(); }).length,
    future: rows.filter(function(r) { return r.kickoff_at > now; }).length,
    by_status: rows.reduce(function(acc, r) { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})
  };
  ptLog_(ptJson_(summary));
  return summary;
}
