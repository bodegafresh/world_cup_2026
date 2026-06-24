/**
 * InitialBootstrapLoad.gs
 *
 * ETL inicial Google Sheets -> Supabase limpio.
 * No replica hoja=tabla. Promueve datos repartidos hacia el modelo relacional
 * definido en supabase/new_project/001_clean_schema.sql.
 */

const BOOTSTRAP_CONFIG = {
  competitionSeasonSlug: 'wc2026',
  competitionSlug: 'fifa-world-cup',
  batchSize: 100,
  timezone: 'UTC',
  sourceLocalTimezone: 'America/Santiago',
  supabaseUrl: '',
  supabaseAnonOrServiceKey: '',
  spreadsheetId: '',
  dryRun: false,
  maxRuntimeMs: 280000
};

const BOOTSTRAP_PROGRESS_PROP = 'BOOTSTRAP_INITIAL_LOAD_PROGRESS_V1';
const BOOTSTRAP_CONTEXT_PROP = 'BOOTSTRAP_INITIAL_LOAD_CONTEXT_V1';

const BOOTSTRAP_RAW_SHEETS = [
  'Partidos', 'Equipos', 'Jugadores', 'Planteles', 'Alineaciones',
  'PlayerMatchStats', 'EventosLive', 'SourceFixtures', 'MatchMapping',
  'OddsApuestas', 'EvOpportunities', 'PoissonOdds', 'ModelCalibration',
  'EloRatings', 'Clasificacion', 'EstadiosClima', 'Noticias',
  'DataQualityLog', 'PipelineRuns', 'ResumenJugadorPartido', 'AnalisisIA',
  'CardsOdds', 'CornersOdds', 'BettingHistory', 'EvHistorico'
];

const BOOTSTRAP_STEPS = [
  { name: 'raw', fn: bootstrapInitialLoad_step1_raw },
  { name: 'competitions', fn: bootstrapInitialLoad_step2_competitions },
  { name: 'teams', fn: bootstrapInitialLoad_step3_teams },
  { name: 'players', fn: bootstrapInitialLoad_step4_players },
  { name: 'matches', fn: bootstrapInitialLoad_step5_matches },
  { name: 'rosters_lineups', fn: bootstrapInitialLoad_step6_rosters_lineups },
  { name: 'stats_events', fn: bootstrapInitialLoad_step7_stats_events },
  { name: 'odds_predictions_ev', fn: bootstrapInitialLoad_step8_odds_predictions_ev },
  { name: 'calibration_ratings', fn: bootstrapInitialLoad_step9_calibration_ratings },
  { name: 'quality_validation', fn: bootstrapInitialLoad_step10_quality_validation }
];

function bootstrapInitialLoadRunner() {
  return withBootstrapLock_(function() {
    const progress = getBootstrapProgress_();
    const next = BOOTSTRAP_STEPS.find(function(step) {
      return !(progress.steps[step.name] && progress.steps[step.name].done);
    });
    if (!next) return { ok: true, done: true, progress: progress };
    const out = next.fn();
    return { ok: true, done: Boolean(out.done), active_step: next.name, result: out, progress: getBootstrapProgress_() };
  });
}

function bootstrapInitialLoadRunnerUntilPause() {
  return withBootstrapLock_(function() {
    const started = new Date().getTime();
    const maxMs = getBootstrapConfig_().maxRuntimeMs;
    const results = [];
    while (new Date().getTime() - started < maxMs - 20000) {
      const progress = getBootstrapProgress_();
      const next = BOOTSTRAP_STEPS.find(function(step) {
        return !(progress.steps[step.name] && progress.steps[step.name].done);
      });
      if (!next) {
        const done = { ok: true, done: true, results: results, progress: progress, counts: validateBootstrapCounts() };
        Logger.log(JSON.stringify(done));
        return done;
      }
      const out = next.fn();
      const item = { step: next.name, result: out };
      results.push(item);
      Logger.log(JSON.stringify(item));
    }
    const paused = { ok: true, done: false, paused: true, results: results, progress: getBootstrapProgress_(), counts: validateBootstrapCounts() };
    Logger.log(JSON.stringify(paused));
    return paused;
  });
}

function bootstrapInitialLoad_step1_raw() {
  return withBootstrapStep_('raw', function(ctx) {
    const sheets = BOOTSTRAP_RAW_SHEETS;
    const sheetName = ctx.sheet || sheets[0];
    const idx = sheets.indexOf(sheetName);
    if (idx < 0) return bootstrapDone_('raw', { processed: 0 });

    const out = processSheetBatch_('raw', sheetName, function(row, rowNumber) {
      const payloadHash = hashPayload_(row);
      return {
        source: 'GOOGLE_SHEET',
        source_entity_type: sheetName,
        source_entity_id: sheetName + ':' + rowNumber + ':' + payloadHash,
        payload_hash: payloadHash,
        payload: { sheet: sheetName, row_number: rowNumber, values: row },
        status: 'RECEIVED',
        received_at: nowIso_()
      };
    }, function(rows) {
      return supabaseBootstrapUpsert_('raw_source_payloads', rows, 'source,source_entity_type,payload_hash');
    });

    if (!out.done) return out;
    const nextSheet = sheets[idx + 1];
    if (nextSheet) {
      setBootstrapCursor_('raw', { sheet: nextSheet, nextRow: 2, done: false });
      return Object.assign(out, { done: false, next_sheet: nextSheet });
    }
    return bootstrapDone_('raw', out);
  });
}

function bootstrapInitialLoad_step2_competitions() {
  return withBootstrapStep_('competitions', function() {
    const comp = upsertOneReturn_('competitions', {
      slug: BOOTSTRAP_CONFIG.competitionSlug,
      display_name: 'FIFA World Cup',
      competition_type: 'TOURNAMENT',
      country_code: null,
      region: 'Global',
      tier: 1,
      metadata: { source: 'bootstrap', international: true, format: 'GROUP_THEN_KNOCKOUT' }
    }, 'slug');

    const season = upsertOneReturn_('competition_seasons', {
      competition_id: comp.competition_id,
      slug: BOOTSTRAP_CONFIG.competitionSeasonSlug,
      display_name: 'Mundial FIFA 2026',
      season_label: '2026',
      status: 'ACTIVE',
      starts_at: '2026-06-11T00:00:00.000Z',
      ends_at: '2026-07-19T23:59:59.000Z',
      timezone_name: 'UTC',
      metadata: { source: 'bootstrap', host_countries: ['United States', 'Mexico', 'Canada'] }
    }, 'slug');

    setBootstrapContext_({ competition_id: comp.competition_id, competition_season_id: season.competition_season_id });

    supabaseBootstrapUpsert_('competition_status', [{
      competition_season_id: season.competition_season_id,
      status: 'OBSERVATION',
      status_reason: 'Initial bootstrap load',
      readiness_score: 0
    }], 'competition_season_id');

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
        competition_season_id: season.competition_season_id,
        stage_code: s[0],
        stage_name: s[1],
        stage_type: s[2],
        stage_order: s[3],
        rules: { source: 'bootstrap' }
      };
    });
    const savedStages = supabaseUpsertReturn_('competition_stages', stages, 'competition_season_id,stage_code');
    const groupStage = savedStages.find(function(s) { return s.stage_code === 'GROUP_STAGE'; }) ||
      supabaseSelectOne_('competition_stages', 'select=*&competition_season_id=eq.' + season.competition_season_id + '&stage_code=eq.GROUP_STAGE');

    const groups = 'ABCDEFGHIJKL'.split('').map(function(letter, i) {
      return {
        competition_season_id: season.competition_season_id,
        stage_id: groupStage.stage_id,
        group_code: 'Grupo ' + letter,
        group_name: 'Grupo ' + letter,
        group_order: i + 1,
        metadata: { source: 'bootstrap' }
      };
    });
    supabaseBootstrapUpsert_('competition_groups', groups, 'competition_season_id,stage_id,group_code');

    const checks = [
      'fixtures_reliable', 'results_reliable', 'odds_sufficient', 'aliases_normalized',
      'minimum_history', 'separate_calibration', 'liquidity_tier_defined',
      'closing_odds_available', 'data_quality_clean', 'backtest_available',
      'market_benchmark_available'
    ].map(function(name) {
      return {
        competition_season_id: season.competition_season_id,
        check_name: name,
        status: 'WARN',
        score: 0,
        details: { source: 'initial_bootstrap', reason: 'pending_validation' }
      };
    });
    supabaseBootstrapUpsert_('competition_readiness_checks', checks, 'competition_season_id,check_name');
    return bootstrapDone_('competitions', { competition_season_id: season.competition_season_id, stages: stages.length, groups: groups.length });
  });
}

function bootstrapInitialLoad_step3_teams() {
  return withBootstrapStep_('teams', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['Equipos', 'Clasificacion', 'Partidos', 'SourceFixtures', 'Planteles'];
    return processMultiSheetPromoter_('teams', sheetOrder, function(sheetName, row) {
      return extractTeamCandidates_(sheetName, row).map(function(candidate) {
        return promoteTeamCandidate_(ctx, candidate);
      });
    });
  });
}

function bootstrapInitialLoad_step4_players() {
  return withBootstrapStep_('players', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['Jugadores', 'Planteles', 'Alineaciones', 'PlayerMatchStats', 'EventosLive', 'ResumenJugadorPartido'];
    return processMultiSheetPromoter_('players', sheetOrder, function(sheetName, row) {
      return extractPlayerCandidates_(sheetName, row).map(function(candidate) {
        return promotePlayerCandidate_(ctx, candidate);
      });
    });
  });
}

function bootstrapInitialLoad_step5_matches() {
  return withBootstrapStep_('matches', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['SourceFixtures', 'Partidos', 'MatchMapping'];
    return processMultiSheetPromoter_('matches', sheetOrder, function(sheetName, row) {
      if (sheetName === 'MatchMapping') return promoteMatchMapping_(ctx, row);
      return promoteMatchRow_(ctx, row);
    });
  });
}

function bootstrapInitialLoad_step6_rosters_lineups() {
  return withBootstrapStep_('rosters_lineups', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['Planteles', 'Alineaciones'];
    return processMultiSheetPromoter_('rosters_lineups', sheetOrder, function(sheetName, row) {
      if (sheetName === 'Planteles') return promoteRosterRow_(ctx, row);
      return promoteLineupRow_(ctx, row);
    });
  });
}

function bootstrapInitialLoad_step7_stats_events() {
  return withBootstrapStep_('stats_events', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['PlayerMatchStats', 'ResumenJugadorPartido', 'EventosLive'];
    return processMultiSheetPromoter_('stats_events', sheetOrder, function(sheetName, row) {
      if (sheetName === 'EventosLive') return promoteEventRow_(ctx, row);
      return promotePlayerStatsRow_(ctx, row);
    });
  });
}

function bootstrapInitialLoad_step8_odds_predictions_ev() {
  return withBootstrapStep_('odds_predictions_ev', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['OddsApuestas', 'PoissonOdds', 'EvOpportunities', 'EvHistorico', 'BettingHistory'];
    return processMultiSheetPromoter_('odds_predictions_ev', sheetOrder, function(sheetName, row) {
      if (sheetName === 'OddsApuestas') return promoteOddsRow_(ctx, row);
      if (sheetName === 'PoissonOdds') return promotePoissonRow_(ctx, row);
      if (sheetName === 'EvOpportunities' || sheetName === 'EvHistorico') return promoteEvRow_(ctx, row, sheetName);
      return promoteBetRow_(ctx, row);
    });
  });
}

function bootstrapInitialLoad_step9_calibration_ratings() {
  return withBootstrapStep_('calibration_ratings', function() {
    const ctx = requireBootstrapContext_();
    const sheetOrder = ['ModelCalibration', 'EloRatings'];
    return processMultiSheetPromoter_('calibration_ratings', sheetOrder, function(sheetName, row) {
      if (sheetName === 'ModelCalibration') return promoteCalibrationRow_(ctx, row);
      return promoteRatingRow_(ctx, row);
    });
  });
}

function bootstrapInitialLoad_step10_quality_validation() {
  return withBootstrapStep_('quality_validation', function() {
    const result = validateBootstrapCounts();
    const severity = result.critical > 0 ? 'ERROR' : (result.warn > 0 ? 'WARN' : 'OK');
    insertPipelineRun_('bootstrap_initial_load_validation', severity, 0, result);
    return bootstrapDone_('quality_validation', result);
  });
}

function resetBootstrapProgress() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BOOTSTRAP_PROGRESS_PROP);
  props.deleteProperty(BOOTSTRAP_CONTEXT_PROP);
  return { ok: true, reset: true };
}

function resetBootstrapProgressFromStep(stepName) {
  const progress = getBootstrapProgress_();
  const idx = BOOTSTRAP_STEPS.findIndex(function(step) { return step.name === stepName; });
  if (idx < 0) throw new Error('Step no reconocido: ' + stepName);
  for (let i = idx; i < BOOTSTRAP_STEPS.length; i++) {
    delete progress.steps[BOOTSTRAP_STEPS[i].name];
  }
  saveBootstrapProgress_(progress);
  const out = { ok: true, reset_from_step: stepName, progress: progress };
  Logger.log(JSON.stringify(out));
  return out;
}

function resetBootstrapProgressFromTeams() {
  return resetBootstrapProgressFromStep('teams');
}

function resetBootstrapProgressFromPlayers() {
  return resetBootstrapProgressFromStep('players');
}

function resetBootstrapProgressFromMatches() {
  return resetBootstrapProgressFromStep('matches');
}

function resetBootstrapProgressFromOddsPredictionsEv() {
  return resetBootstrapProgressFromStep('odds_predictions_ev');
}

function getBootstrapProgress() {
  const out = { progress: getBootstrapProgress_(), context: getBootstrapContext_(), counts: validateBootstrapCounts() };
  Logger.log(JSON.stringify(out));
  return out;
}

function validateBootstrapCounts() {
  const checks = [];
  function count(table, query) {
    try { return supabaseCount_(table, query || ''); } catch (e) { return null; }
  }
  checks.push({ check: 'teams', value: count('teams'), severity: 'INFO' });
  checks.push({ check: 'players', value: count('players'), severity: 'INFO' });
  checks.push({ check: 'matches', value: count('matches'), severity: 'INFO' });
  checks.push({ check: 'pending_entity_resolution', value: count('entity_resolution_queue', 'resolution_status=in.(OPEN,IN_REVIEW)'), severity: 'WARN' });

  let health = [];
  try { health = supabaseSelect_('published_data_quality_health', 'select=*'); } catch (e) {
    checks.push({ check: 'published_data_quality_health', severity: 'ERROR', message: e.message });
  }
  health.forEach(function(h) {
    checks.push({ check: h.check_name, severity: h.severity, value: Number(h.issue_count || 0), sample: h.sample });
  });
  return {
    checks: checks,
    critical: checks.filter(function(c) { return c.severity === 'CRITICAL' && Number(c.value || 0) > 0; }).length,
    error: checks.filter(function(c) { return c.severity === 'ERROR' && Number(c.value || 0) > 0; }).length,
    warn: checks.filter(function(c) { return c.severity === 'WARN' && Number(c.value || 0) > 0; }).length,
    ts: nowIso_()
  };
}

function processMultiSheetPromoter_(stepName, sheetOrder, mapper) {
  const ctx = getBootstrapCursor_(stepName);
  const sheetName = ctx.sheet || sheetOrder[0];
  const idx = sheetOrder.indexOf(sheetName);
  if (idx < 0) return bootstrapDone_(stepName, { processed: 0 });
  const out = processSheetBatch_(stepName, sheetName, function(row, rowNumber) {
    try {
      const result = mapper(sheetName, row, rowNumber);
      return Array.isArray(result) ? result : (result ? [result] : []);
    } catch (e) {
      logDataQualityEvent_({
        layer: 'STAGING',
        severity: 'ERROR',
        check_type: 'BOOTSTRAP_ROW_ERROR',
        message: stepName + ' ' + sheetName + ' row ' + rowNumber + ': ' + e.message,
        payload: { row: row, row_number: rowNumber }
      });
      return [];
    }
  }, function() { return { count: 0 }; }, { mapperWrites: true });

  if (!out.done) return out;
  const nextSheet = sheetOrder[idx + 1];
  if (nextSheet) {
    setBootstrapCursor_(stepName, { sheet: nextSheet, nextRow: 2, done: false });
    return Object.assign(out, { done: false, next_sheet: nextSheet });
  }
  return bootstrapDone_(stepName, out);
}

function processSheetBatch_(stepName, sheetName, mapper, writer, options) {
  options = options || {};
  const started = new Date().getTime();
  const cursor = getBootstrapCursor_(stepName);
  const nextRow = Number(cursor.nextRow || 2);
  const rows = readSheetRows_(sheetName, nextRow, getBootstrapConfig_().batchSize);
  if (!rows.rows.length) {
    setBootstrapCursor_(stepName, { sheet: sheetName, nextRow: nextRow, done: true });
    return { step: stepName, sheet: sheetName, processed: 0, nextRow: nextRow, done: true };
  }

  let payload = [];
  let processed = 0;
  rows.rows.forEach(function(rowObj, i) {
    if (new Date().getTime() - started > getBootstrapConfig_().maxRuntimeMs - 20000) return;
    const mapped = mapper(rowObj, nextRow + i);
    if (Array.isArray(mapped)) payload = payload.concat(mapped);
    else if (mapped) payload.push(mapped);
    processed++;
  });

  let writeResult = { count: 0 };
  if (!options.mapperWrites && payload.length) writeResult = writer(payload);

  const newNext = nextRow + processed;
  const done = processed < rows.rows.length || rows.endReached ? (newNext > rows.lastRow) : false;
  setBootstrapCursor_(stepName, { sheet: sheetName, nextRow: newNext, done: done });
  const result = { step: stepName, sheet: sheetName, processed: processed, payload: payload.length, nextRow: newNext, lastRow: rows.lastRow, done: done, write_result: writeResult };
  insertPipelineRun_('bootstrap_' + stepName + '_' + sheetName, 'OK', processed, result);
  Logger.log(JSON.stringify(result));
  return result;
}

function readSheetRows_(sheetName, startRow, limit) {
  const ss = getBootstrapSpreadsheet_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { headers: [], rows: [], lastRow: 0, endReached: true };
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1 || startRow > lastRow) return { headers: [], rows: [], lastRow: lastRow, endReached: true };
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); });
  const normalizedHeaders = headers.map(function(h) { return normalizeHeaderKey_(h); });
  const n = Math.min(limit || getBootstrapConfig_().batchSize, lastRow - startRow + 1);
  const values = sheet.getRange(startRow, 1, n, lastCol).getValues();
  const rows = values.map(function(valuesRow) {
    const obj = {};
    headers.forEach(function(h, i) {
      if (!h) return;
      obj[h] = valuesRow[i];
      if (normalizedHeaders[i] && !Object.prototype.hasOwnProperty.call(obj, normalizedHeaders[i])) {
        obj[normalizedHeaders[i]] = valuesRow[i];
      }
    });
    return obj;
  }).filter(function(obj) {
    return Object.keys(obj).some(function(k) { return obj[k] !== '' && obj[k] !== null && obj[k] !== undefined; });
  });
  return { headers: headers, rows: rows, lastRow: lastRow, endReached: startRow + n > lastRow };
}

function getOrCreateTeam_(teamName, externalRefs) {
  const name = String(teamName || '').trim();
  if (!name) return null;
  const slug = makeSlug_(canonicalTeamDisplayName_(name));
  let team = supabaseSelectOne_('teams', 'select=*&slug=eq.' + encodeURIComponent(slug));
  if (!team) {
    team = upsertOneReturn_('teams', {
      slug: slug,
      team_type: 'NATIONAL_TEAM',
      display_name: canonicalTeamDisplayName_(name),
      normalized_name: normalizeName_(name),
      country_code: null,
      gender: 'MEN',
      metadata: { source: 'initial_bootstrap' }
    }, 'slug');
  }
  supabaseBootstrapUpsert_('team_aliases', [{
    team_id: team.team_id,
    alias: name,
    normalized_alias: normalizeName_(name),
    source: 'GOOGLE_SHEET',
    confidence: 1
  }], 'normalized_alias,source');
  (externalRefs || []).filter(function(r) { return r && r.source_entity_id; }).forEach(function(ref) {
    upsertExternalRef_('TEAM', team.team_id, ref.source, 'team', ref.source_entity_id, ref.source_entity_name || name, ref.payload || {});
  });
  return team;
}

function getOrCreatePlayer_(playerName, externalRefs) {
  const name = String(playerName || '').trim();
  if (!name) return null;
  const refs = externalRefs || [];
  const primary = refs.find(function(r) { return r && r.source_entity_id; });
  const slug = primary ? makeSlug_('player-' + primary.source + '-' + primary.source_entity_id) : makeSlug_(name);
  let player = supabaseSelectOne_('players', 'select=*&slug=eq.' + encodeURIComponent(slug));
  if (!player) {
    player = upsertOneReturn_('players', {
      slug: slug,
      display_name: name,
      normalized_name: normalizeName_(name),
      gender: 'MEN',
      metadata: { source: 'initial_bootstrap' }
    }, 'slug');
  }
  supabaseBootstrapUpsert_('player_aliases', [{
    player_id: player.player_id,
    alias: name,
    normalized_alias: normalizeName_(name),
    source: 'GOOGLE_SHEET',
    confidence: 1
  }], 'normalized_alias,source');
  refs.filter(function(r) { return r && r.source_entity_id; }).forEach(function(ref) {
    upsertExternalRef_('PLAYER', player.player_id, ref.source, 'player', ref.source_entity_id, ref.source_entity_name || name, ref.payload || {});
  });
  return player;
}

function getOrCreateMatch_(row) {
  const ctx = requireBootstrapContext_();
  const sourceMatchId = firstNonEmpty_(row.match_id, row.fixture_id, row.source_match_id, row.fixture_id_api_football, row.match_key);
  if (sourceMatchId) {
    const ref = supabaseSelectOne_('entity_external_refs', 'select=*&entity_type=eq.MATCH&source=eq.GOOGLE_SHEET&source_entity_id=eq.' + encodeURIComponent(String(sourceMatchId)));
    if (ref) return supabaseSelectOne_('matches', 'select=*&match_id=eq.' + ref.entity_id);
  }
  const slug = makeMatchSlug_(row);
  return supabaseSelectOne_('matches', 'select=*&slug=eq.' + encodeURIComponent(slug));
}

function promoteTeamCandidate_(ctx, candidate) {
  if (!candidate || !candidate.name) return null;
  const team = getOrCreateTeam_(candidate.name, candidate.externalRefs);
  const entry = upsertOneReturn_('competition_team_entries', {
    competition_season_id: ctx.competition_season_id,
    team_id: team.team_id,
    entry_status: 'ACTIVE',
    metadata: { source: candidate.sourceSheet || 'bootstrap' }
  }, 'competition_season_id,team_id');
  if (candidate.groupCode) {
    const group = findGroup_(ctx.competition_season_id, candidate.groupCode);
    if (group) {
      supabaseBootstrapUpsert_('competition_group_memberships', [{
        group_id: group.group_id,
        competition_team_entry_id: entry.competition_team_entry_id,
        membership_status: 'ACTIVE',
        metadata: { source: candidate.sourceSheet || 'bootstrap' }
      }], 'group_id,competition_team_entry_id');
    }
  }
  return { team_id: team.team_id };
}

function promotePlayerCandidate_(ctx, candidate) {
  if (!candidate || !candidate.name) return null;
  const player = getOrCreatePlayer_(candidate.name, candidate.externalRefs);
  const team = candidate.teamName ? getOrCreateTeam_(candidate.teamName, candidate.teamExternalRefs) : null;
  if (team) {
    supabaseBootstrapUpsert_('team_memberships', [{
      player_id: player.player_id,
      team_id: team.team_id,
      membership_type: 'NATIONAL_TEAM',
      valid_from_at: null,
      valid_to_at: null,
      source: 'GOOGLE_SHEET',
      metadata: { source: candidate.sourceSheet || 'bootstrap' }
    }], 'player_id,team_id,membership_type,source');
    supabaseBootstrapUpsert_('competition_rosters', [{
      competition_season_id: ctx.competition_season_id,
      team_id: team.team_id,
      player_id: player.player_id,
      shirt_number: toNumberOrNull_(candidate.number),
      position: candidate.position || null,
      roster_status: 'ACTIVE',
      metadata: { source: candidate.sourceSheet || 'bootstrap', role: candidate.role || null }
    }], 'competition_season_id,team_id,player_id');
  }
  return { player_id: player.player_id };
}

function promoteMatchRow_(ctx, row) {
  const homeName = firstNonEmpty_(row.local, row.home_team_name, row.equipo_local);
  const awayName = firstNonEmpty_(row.visitante, row.away_team_name, row.equipo_visitante);
  if (!homeName || !awayName) return null;
  const home = getOrCreateTeam_(homeName, buildTeamRefs_(row, 'home'));
  const away = getOrCreateTeam_(awayName, buildTeamRefs_(row, 'away'));
  const venue = getOrCreateVenue_(row);
  const stage = findStageFromRow_(ctx.competition_season_id, row);
  const group = findGroup_(ctx.competition_season_id, firstNonEmpty_(row.grupo, row.group_name, row.group));
  const kickoff = parseSheetDateToUtc_(row, ['date_utc', 'kickoff_at', 'fecha']);
  if (!kickoff) {
    logDataQualityEvent_({ layer: 'CANONICAL', severity: 'ERROR', check_type: 'MATCH_WITHOUT_KICKOFF', message: 'No kickoff_at for match', payload: row });
    return null;
  }
  const match = upsertOneReturn_('matches', {
    competition_season_id: ctx.competition_season_id,
    stage_id: stage && stage.stage_id,
    group_id: group && group.group_id,
    venue_id: venue && venue.venue_id,
    slug: makeMatchSlug_(row),
    match_number: toNumberOrNull_(row.match_number),
    kickoff_at: kickoff,
    status: mapMatchStatus_(firstNonEmpty_(row.status, row.estado)),
    is_neutral: true,
    home_score: toNumberOrNull_(firstNonEmpty_(row.goles_local, row.home_score)),
    away_score: toNumberOrNull_(firstNonEmpty_(row.goles_visitante, row.away_score)),
    winner_team_id: null,
    metadata: { source: 'GOOGLE_SHEET', payload_hash: hashPayload_(row), original: row }
  }, 'slug');
  upsertMatchParticipant_(match.match_id, 'HOME', home.team_id, row.goles_local || row.home_score);
  upsertMatchParticipant_(match.match_id, 'AWAY', away.team_id, row.goles_visitante || row.away_score);
  upsertMatchExternalRefs_(match.match_id, row);
  return { match_id: match.match_id };
}

function promoteMatchMapping_(ctx, row) {
  const match = getOrCreateMatch_(row);
  if (!match) return enqueueEntityResolution_({ entity_type: 'MATCH', source: 'GOOGLE_SHEET', source_entity_id: row.match_key || hashPayload_(row), source_entity_name: row.match_key || 'unresolved_match', normalized_name: normalizeName_(row.match_key || ''), payload: row });
  if (row.fixture_id_api_football) upsertExternalRef_('MATCH', match.match_id, 'API_FOOTBALL', 'fixture', row.fixture_id_api_football, row.match_key, row);
  if (row.match_id_football_data) upsertExternalRef_('MATCH', match.match_id, 'FOOTBALL_DATA', 'match', row.match_id_football_data, row.match_key, row);
  return { match_id: match.match_id };
}

function promoteRosterRow_(ctx, row) {
  return promotePlayerCandidate_(ctx, {
    name: firstNonEmpty_(row.jugador, row.player_name),
    teamName: firstNonEmpty_(row.equipo, row.team_name),
    position: row.posicion,
    number: row.numero,
    role: row.rol,
    sourceSheet: 'Planteles',
    externalRefs: [{ source: 'API_FOOTBALL', source_entity_id: row.player_id }],
    teamExternalRefs: [{ source: 'API_FOOTBALL', source_entity_id: row.team_id }]
  });
}

function promoteLineupRow_(ctx, row) {
  const match = getOrCreateMatch_(row);
  const team = getOrCreateTeam_(row.equipo, [{ source: 'API_FOOTBALL', source_entity_id: row.equipo_id }]);
  const player = getOrCreatePlayer_(row.jugador, [{ source: 'API_FOOTBALL', source_entity_id: row.jugador_id }]);
  if (!match || !team || !player) return null;
  return supabaseBootstrapUpsert_('match_lineups', [{
    match_id: match.match_id,
    team_id: team.team_id,
    player_id: player.player_id,
    lineup_role: mapLineupRole_(row.rol),
    position: row.posicion || null,
    shirt_number: toNumberOrNull_(row.numero),
    is_captain: false,
    source: 'GOOGLE_SHEET',
    metadata: { original: row }
  }], 'match_id,team_id,player_id,source');
}

function promotePlayerStatsRow_(ctx, row) {
  const match = getOrCreateMatch_(row);
  const team = getOrCreateTeam_(firstNonEmpty_(row.team_name, row.equipo), [{ source: 'API_FOOTBALL', source_entity_id: firstNonEmpty_(row.team_id, row.equipo_id) }]);
  const player = getOrCreatePlayer_(firstNonEmpty_(row.player_name, row.jugador), [{ source: 'API_FOOTBALL', source_entity_id: firstNonEmpty_(row.player_id, row.jugador_id) }]);
  if (!match || !team || !player) return null;
  const stats = [];
  Object.keys(row).forEach(function(k) {
    if (['fixture_id','match_id','player_id','player_name','jugador_id','jugador','team_id','team_name','equipo_id','equipo','loaded_at','timestamp_carga'].indexOf(k) !== -1) return;
    const v = toNumberOrNull_(row[k]);
    if (v === null) return;
    stats.push({
      match_id: match.match_id,
      team_id: team.team_id,
      player_id: player.player_id,
      stat_name: k,
      stat_value: v,
      source: 'GOOGLE_SHEET',
      captured_at: parseSheetDateToUtc_(row, ['loaded_at', 'timestamp_carga']) || nowIso_(),
      payload: { original: row }
    });
  });
  return stats.length ? supabaseBootstrapUpsert_('player_match_stats', stats, 'match_id,player_id,stat_name,source') : null;
}

function promoteEventRow_(ctx, row) {
  const match = getOrCreateMatch_(row);
  if (!match) return null;
  const team = row.equipo ? getOrCreateTeam_(row.equipo, [{ source: 'API_FOOTBALL', source_entity_id: row.equipo_id }]) : null;
  const player = row.jugador ? getOrCreatePlayer_(row.jugador, [{ source: 'API_FOOTBALL', source_entity_id: row.jugador_id }]) : null;
  const assist = row.assist ? getOrCreatePlayer_(row.assist, [{ source: 'API_FOOTBALL', source_entity_id: row.assist_id }]) : null;
  return supabaseBootstrapUpsert_('match_events', [{
    match_id: match.match_id,
    team_id: team && team.team_id,
    player_id: player && player.player_id,
    related_player_id: assist && assist.player_id,
    event_type: String(firstNonEmpty_(row.tipo_evento, row.event_type, 'UNKNOWN')).toUpperCase(),
    event_detail: firstNonEmpty_(row.detalle_evento, row.event_detail),
    minute: toNumberOrNull_(row.minuto),
    stoppage_minute: toNumberOrNull_(row.extra),
    occurred_at: null,
    source: 'GOOGLE_SHEET',
    source_event_id: firstNonEmpty_(row.evento_id, hashPayload_(row)),
    payload: { original: row }
  }], 'source,source_event_id');
}

function promoteOddsRow_(ctx, row) {
  const match = getOrCreateMatch_(row);
  if (!match) return null;
  const price = toNumberOrNull_(row.cuota);
  if (!price || price <= 1) return null;
  const market = resolveMarket_(row.mercado || '1X2');
  const selection = resolveSelection_(market, row.seleccion, row.local, row.visitante);
  const bookmaker = getOrCreateBookmaker_(row.fuente || 'UNKNOWN');
  return supabaseBootstrapUpsert_('odds_snapshots', [{
    match_id: match.match_id,
    bookmaker_id: bookmaker.bookmaker_id,
    source: String(row.fuente || 'GOOGLE_SHEET').toUpperCase(),
    source_snapshot_id: firstNonEmpty_(row.snapshot_id, row.odds_id),
    market_id: market.market_id,
    selection_id: selection.selection_id,
    line: inferLine_(row),
    decimal_odds: price,
    captured_at: parseSheetDateToUtc_(row, ['timestamp', 'captured_at', 'updated_at']) || nowIso_(),
    payload: { original: row }
  }], 'match_id,bookmaker_id,source,market_id,selection_id,line,captured_at');
}

function promotePoissonRow_(ctx, row) {
  const match = getOrCreateMatch_(row);
  if (!match) return null;
  const model = getOrCreateModel_('POISSON_BIVARIATE_DC', 'sheet-bootstrap');
  const market = resolveMarket_('1X2');
  const run = upsertOneReturn_('model_runs', {
    model_id: model.model_id,
    competition_season_id: ctx.competition_season_id,
    market_id: market.market_id,
    run_status: 'SUCCEEDED',
    prediction_as_of: parseSheetDateToUtc_(row, ['updated_at', 'fecha']) || nowIso_(),
    feature_set_version: 'sheet-bootstrap',
    dataset_version: 'google-sheet-initial',
    params: { source: 'PoissonOdds' },
    finished_at: parseSheetDateToUtc_(row, ['updated_at']) || nowIso_()
  }, 'model_id,competition_season_id,market_id,prediction_as_of');
  const rows = [
    ['HOME', row.prob_home, row.cuota_fair_h],
    ['DRAW', row.prob_draw, row.cuota_fair_d],
    ['AWAY', row.prob_away, row.cuota_fair_a]
  ].map(function(x) {
    const selection = resolveSelection_(market, x[0], row.local, row.visitante);
    const prob = probability_(x[1]);
    return {
      model_run_id: run.model_run_id,
      competition_season_id: ctx.competition_season_id,
      match_id: match.match_id,
      market_id: market.market_id,
      selection_id: selection.selection_id,
      raw_probability: prob,
      calibrated_probability: prob,
      fair_odds: toNumberOrNull_(x[2]),
      as_of: parseSheetDateToUtc_(row, ['updated_at', 'fecha']) || nowIso_(),
      flags: ['UNCALIBRATED', 'SHEET_BOOTSTRAP'],
      payload: { original: row }
    };
  }).filter(function(r) { return r.raw_probability !== null; });
  return rows.length ? supabaseBootstrapUpsert_('model_predictions', rows, 'model_run_id,match_id,market_id,selection_id,line,as_of') : null;
}

function promoteEvRow_(ctx, row, sheetName) {
  const match = getOrCreateMatch_(row);
  if (!match) return null;
  const market = resolveMarket_(row.mercado || '1X2');
  const selection = resolveSelection_(market, row.seleccion, row.local, row.visitante);
  const prediction = findPrediction_(match.match_id, market.market_id, selection.selection_id, inferLine_(row));
  const odds = findComparableOdds_(match.match_id, market.market_id, selection.selection_id, inferLine_(row), row.cuota);
  if (!prediction || !odds) {
    logDataQualityEvent_({
      layer: 'ANALYTICS',
      severity: 'WARN',
      check_type: 'EV_WITHOUT_PREDICTION_OR_ODDS',
      message: 'EV row could not link prediction/odds',
      payload: { sheet: sheetName, row: row, prediction_found: Boolean(prediction), odds_found: Boolean(odds) }
    });
    return null;
  }
  const ev = toNumberOrNull_(row.ev);
  return supabaseBootstrapUpsert_('betting_decisions', [{
    competition_season_id: ctx.competition_season_id,
    match_id: match.match_id,
    prediction_id: prediction.prediction_id,
    odds_snapshot_id: odds.odds_snapshot_id,
    decision_status: ev > 0 ? 'PAPER_ONLY' : 'NO_EDGE',
    risk_level: mapRisk_(row.confianza),
    block_reason: ev > 0 ? null : 'EV_NOT_POSITIVE',
    calibrated_probability_used: probability_(firstNonEmpty_(row.prob_modelo, row.probability, prediction.calibrated_probability)),
    market_probability: odds.implied_probability || (odds.decimal_odds ? 1 / odds.decimal_odds : null),
    edge: toNumberOrNull_(row.edge),
    ev: ev,
    kelly_fraction: toNumberOrNull_(row.kelly),
    stake_fraction: null,
    settlement_status: sheetName === 'EvHistorico' ? mapSettlementStatus_(row.resultado) : 'NOT_APPLICABLE',
    settlement_result: mapSettlementResult_(row.resultado),
    settlement_profit_units: toNumberOrNull_(row.pnl),
    settled_at: row.resultado ? parseSheetDateToUtc_(row, ['timestamp', 'fecha']) : null,
    decided_at: parseSheetDateToUtc_(row, ['timestamp', 'fecha']) || nowIso_(),
    payload: { original: row, sheet: sheetName }
  }], 'prediction_id,odds_snapshot_id');
}

function promoteBetRow_(ctx, row) {
  const decision = null;
  if (!row.bet_id && !row.stake) return null;
  return supabaseBootstrapUpsert_('bets', [{
    bet_id: row.bet_id || Utilities.getUuid(),
    betting_decision_id: decision,
    bet_mode: 'PAPER',
    bet_status: mapBetStatus_(row.resultado),
    stake: toNumberOrNull_(row.stake) || 0,
    decimal_odds_taken: toNumberOrNull_(row.cuota) || 1.01,
    placed_at: parseSheetDateToUtc_(row, ['fecha']) || nowIso_(),
    settled_at: row.resultado ? nowIso_() : null,
    profit_loss: toNumberOrNull_(row.profit_loss),
    payload: { original: row }
  }], 'bet_id');
}

function promoteCalibrationRow_(ctx, row) {
  const model = getOrCreateModel_('POISSON_BIVARIATE_DC', 'sheet-bootstrap');
  const market = resolveMarket_('1X2');
  return supabaseInsert_('calibration_runs', [{
    model_id: model.model_id,
    competition_season_id: ctx.competition_season_id,
    market_id: market.market_id,
    method: 'NONE',
    sample_size: toNumberOrNull_(row.partidos_evaluados) || 0,
    train_end_at: parseSheetDateToUtc_(row, ['fecha', 'updated_at']),
    brier_score: toNumberOrNull_(row.brier_score),
    payload: { original: row, accuracy: row.accuracy, interpretation: row.interpretacion }
  }]);
}

function promoteRatingRow_(ctx, row) {
  const team = getOrCreateTeam_(row.equipo, []);
  return supabaseBootstrapUpsert_('rating_snapshots', [{
    competition_season_id: ctx.competition_season_id,
    team_id: team.team_id,
    rating_type: 'ELO',
    rating_value: toNumberOrNull_(row.elo_actual),
    as_of: parseSheetDateToUtc_(row, ['updated_at']) || nowIso_(),
    payload: { original: row }
  }], 'competition_season_id,team_id,rating_type,as_of');
}

function extractTeamCandidates_(sheetName, row) {
  const out = [];
  function add(name, groupCode, refs) {
    if (!name) return;
    out.push({ name: name, groupCode: groupCode, externalRefs: refs || [], sourceSheet: sheetName });
  }
  if (sheetName === 'Equipos') add(firstNonEmpty_(row.nombre, row.equipo, row.team, row.display_name), firstNonEmpty_(row.grupo, row.group_code), buildGenericExternalRefs_(row, 'team'));
  if (sheetName === 'Clasificacion') add(row.equipo, row.grupo, [{ source: 'API_FOOTBALL', source_entity_id: row.equipo_id }]);
  if (sheetName === 'Partidos') { add(row.local, row.grupo, buildTeamRefs_(row, 'home')); add(row.visitante, row.grupo, buildTeamRefs_(row, 'away')); }
  if (sheetName === 'SourceFixtures') { add(row.home_team_name, row.group_name, [{ source: row.source || 'SOURCE', source_entity_id: row.home_team_id }]); add(row.away_team_name, row.group_name, [{ source: row.source || 'SOURCE', source_entity_id: row.away_team_id }]); }
  if (sheetName === 'Planteles') add(row.equipo, null, [{ source: 'API_FOOTBALL', source_entity_id: row.team_id }]);
  return out;
}

function extractPlayerCandidates_(sheetName, row) {
  const out = [];
  function add(name, teamName, playerId, teamId, position, number, role) {
    if (!name) return;
    out.push({
      name: name,
      teamName: teamName,
      position: position,
      number: number,
      role: role,
      sourceSheet: sheetName,
      externalRefs: [{ source: 'API_FOOTBALL', source_entity_id: playerId }],
      teamExternalRefs: [{ source: 'API_FOOTBALL', source_entity_id: teamId }]
    });
  }
  if (sheetName === 'Jugadores') add(firstNonEmpty_(row.jugador, row.player_name, row.nombre), firstNonEmpty_(row.equipo, row.team_name), firstNonEmpty_(row.jugador_id, row.player_id), firstNonEmpty_(row.equipo_id, row.team_id), row.posicion || row.position, row.numero, row.rol);
  if (sheetName === 'Planteles') add(row.jugador, row.equipo, row.player_id, row.team_id, row.posicion, row.numero, row.rol);
  if (sheetName === 'Alineaciones') add(row.jugador, row.equipo, row.jugador_id, row.equipo_id, row.posicion, row.numero, row.rol);
  if (sheetName === 'PlayerMatchStats') add(row.player_name, row.team_name, row.player_id, row.team_id, row.position, null, null);
  if (sheetName === 'EventosLive') { add(row.jugador, row.equipo, row.jugador_id, row.equipo_id, null, null, null); add(row.assist, row.equipo, row.assist_id, row.equipo_id, null, null, null); }
  if (sheetName === 'ResumenJugadorPartido') add(row.jugador, row.equipo, row.jugador_id, row.equipo_id, null, null, null);
  return out;
}

function getBootstrapConfig_() {
  const props = PropertiesService.getScriptProperties();
  const configuredSpreadsheetId = props.getProperty('BOOTSTRAP_SPREADSHEET_ID') || BOOTSTRAP_CONFIG.spreadsheetId || '';
  return Object.assign({}, BOOTSTRAP_CONFIG, {
    supabaseUrl: props.getProperty('SUPABASE_URL') || BOOTSTRAP_CONFIG.supabaseUrl,
    supabaseAnonOrServiceKey: props.getProperty('SUPABASE_SERVICE_ROLE_KEY') || props.getProperty('SUPABASE_ANON_KEY') || BOOTSTRAP_CONFIG.supabaseAnonOrServiceKey,
    spreadsheetId: configuredSpreadsheetId,
    batchSize: Number(props.getProperty('BOOTSTRAP_BATCH_SIZE') || BOOTSTRAP_CONFIG.batchSize),
    dryRun: String(props.getProperty('BOOTSTRAP_DRY_RUN') || BOOTSTRAP_CONFIG.dryRun).toLowerCase() === 'true'
  });
}

function getBootstrapSpreadsheet_() {
  const id = getBootstrapConfig_().spreadsheetId;
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : SpreadsheetApp.getActive();
  if (active) return active;
  throw new Error('Falta BOOTSTRAP_SPREADSHEET_ID. Configura el ID del Google Sheet en Script Properties para ejecutar este ETL desde un proyecto standalone.');
}

function withBootstrapLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Bootstrap already running');
  try { return fn(); } finally { lock.releaseLock(); }
}

function withBootstrapStep_(stepName, fn) {
  try {
    bootstrapSupabasePreflight_();
    return fn(getBootstrapCursor_(stepName));
  }
  catch (e) {
    try {
      logDataQualityEvent_({ layer: 'STAGING', severity: 'ERROR', check_type: 'BOOTSTRAP_STEP_ERROR', message: stepName + ': ' + e.message, payload: { stack: e.stack } });
    } catch (logErr) {
      Logger.log('No se pudo registrar data_quality_event: ' + (logErr && logErr.message ? logErr.message : logErr));
    }
    try {
      insertPipelineRun_('bootstrap_' + stepName, 'ERROR', 0, { error: e.message });
    } catch (runErr) {
      Logger.log('No se pudo registrar pipeline_run: ' + (runErr && runErr.message ? runErr.message : runErr));
    }
    throw e;
  }
}

function getBootstrapProgress_() {
  const raw = PropertiesService.getScriptProperties().getProperty(BOOTSTRAP_PROGRESS_PROP);
  return raw ? JSON.parse(raw) : { started_at: nowIso_(), steps: {} };
}

function saveBootstrapProgress_(progress) {
  PropertiesService.getScriptProperties().setProperty(BOOTSTRAP_PROGRESS_PROP, JSON.stringify(progress));
}

function getBootstrapCursor_(stepName) {
  const progress = getBootstrapProgress_();
  return progress.steps[stepName] || { nextRow: 2, done: false };
}

function setBootstrapCursor_(stepName, cursor) {
  const progress = getBootstrapProgress_();
  progress.steps[stepName] = Object.assign({}, progress.steps[stepName] || {}, cursor, { updated_at: nowIso_() });
  saveBootstrapProgress_(progress);
}

function bootstrapDone_(stepName, details) {
  setBootstrapCursor_(stepName, Object.assign({}, details || {}, { done: true }));
  return Object.assign({ step: stepName, done: true }, details || {});
}

function setBootstrapContext_(ctx) {
  const current = getBootstrapContext_();
  PropertiesService.getScriptProperties().setProperty(BOOTSTRAP_CONTEXT_PROP, JSON.stringify(Object.assign(current, ctx || {})));
}

function getBootstrapContext_() {
  const raw = PropertiesService.getScriptProperties().getProperty(BOOTSTRAP_CONTEXT_PROP);
  return raw ? JSON.parse(raw) : {};
}

function requireBootstrapContext_() {
  const ctx = getBootstrapContext_();
  if (ctx.competition_season_id) return ctx;
  const season = supabaseSelectOne_('competition_seasons', 'select=*&slug=eq.' + encodeURIComponent(BOOTSTRAP_CONFIG.competitionSeasonSlug));
  if (!season) throw new Error('Run bootstrapInitialLoad_step2_competitions first');
  setBootstrapContext_({ competition_season_id: season.competition_season_id, competition_id: season.competition_id });
  return getBootstrapContext_();
}

function supabaseInsert_(table, rows) {
  if (!rows || !rows.length) return { count: 0 };
  if (getBootstrapConfig_().dryRun) return { count: rows.length, dryRun: true };
  supabaseBootstrapInsert_(table, rows);
  return { count: rows.length };
}

function supabaseUpsertReturn_(table, rows, conflictColumns) {
  if (!rows || !rows.length) return [];
  if (getBootstrapConfig_().dryRun) return rows;
  const payload = supabaseDedupeRowsByConflict_(rows, conflictColumns);
  if (typeof supabaseTransactionalUpsert_ === 'function') {
    const conflictList = String(conflictColumns || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
    if (conflictList.length) {
      supabaseTransactionalUpsert_(table, payload, conflictList);
      return selectRowsByConflict_(table, payload, conflictList);
    }
  }
  throw new Error('supabaseTransactionalUpsert_ no disponible para upsert con retorno en ' + table + '. Ejecuta con src/SupabaseClient.gs actualizado y la RPC app_transaction_batch aplicada en Supabase.');
}

function supabaseBootstrapInsert_(table, rows) {
  if (!rows || !rows.length) return { count: 0 };
  if (typeof supabaseTransaction_ === 'function') {
    const result = supabaseTransaction_([{ action: 'insert', table: table, rows: rows }], { retries: 1 });
    return { count: rows.length, transaction: result };
  }
  throw new Error('supabaseTransaction_ no disponible para bootstrap. Ejecuta con src/SupabaseClient.gs actualizado y la RPC app_transaction_batch aplicada en Supabase.');
}

function supabaseBootstrapUpsert_(table, rows, conflictColumns) {
  if (!rows || !rows.length) return { count: 0 };
  const payload = supabaseDedupeRowsByConflict_(rows, conflictColumns);
  if (!payload.length) return { count: 0 };
  const conflictList = String(conflictColumns || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (typeof supabaseTransactionalUpsert_ === 'function' && conflictList.length) {
    const result = supabaseTransactionalUpsert_(table, payload, conflictList);
    return { count: payload.length, source_count: rows.length, duplicates_removed: rows.length - payload.length, transaction: result };
  }
  throw new Error('supabaseTransactionalUpsert_ no disponible para bootstrap de ' + table + '. Ejecuta con src/SupabaseClient.gs actualizado y la RPC app_transaction_batch aplicada en Supabase.');
}

function bootstrapSupabasePreflight_() {
  if (getBootstrapConfig_().dryRun) return { ok: true, dryRun: true };
  try {
    return supabaseRpc_('app_transaction_batch', { p_operations: [] }, { retries: 0 });
  } catch (e) {
    const msg = String(e && e.message || e);
    if (msg.indexOf('401') !== -1 || msg.indexOf('row-level security') !== -1) {
      throw new Error('Supabase RLS bloquea la carga inicial. Configura SUPABASE_SERVICE_ROLE_KEY con la service_role key real, no anon key, y aplica 001_clean_schema.sql actualizado con app_transaction_batch SECURITY DEFINER. Detalle: ' + msg);
    }
    if (msg.indexOf('app_transaction_batch') !== -1 || msg.indexOf('Could not find') !== -1 || msg.indexOf('404') !== -1) {
      throw new Error('Falta RPC app_transaction_batch en Supabase. Ejecuta nuevamente supabase/new_project/001_clean_schema.sql actualizado antes del bootstrap. Detalle: ' + msg);
    }
    throw e;
  }
}

function upsertOneReturn_(table, row, conflictColumns) {
  const rows = supabaseUpsertReturn_(table, [row], conflictColumns);
  if (rows && rows[0]) return rows[0];
  return selectOneByConflict_(table, row, String(conflictColumns).split(',').map(function(c) { return c.trim(); }).filter(Boolean));
}

function selectRowsByConflict_(table, rows, conflictColumns) {
  return (rows || []).map(function(row) {
    return selectOneByConflict_(table, row, conflictColumns);
  }).filter(Boolean);
}

function selectOneByConflict_(table, row, conflictColumns) {
  const filters = (conflictColumns || []).map(function(c) {
    return c + '=eq.' + encodeURIComponent(row[c]);
  }).join('&');
  return supabaseSelectOne_(table, 'select=*&' + filters);
}

function supabaseSelectOne_(table, query) {
  const rows = supabaseSelect_(table, query + (query.indexOf('limit=') === -1 ? '&limit=1' : ''));
  return rows && rows.length ? rows[0] : null;
}

function normalizeName_(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeHeaderKey_(value) {
  return normalizeName_(value).replace(/\s+/g, '_');
}

function makeSlug_(value) {
  return normalizeName_(value).replace(/\s+/g, '-');
}

function hashPayload_(obj) {
  return hash_(JSON.stringify(obj || {}, Object.keys(obj || {}).sort()));
}

function excelSerialToUtcIso_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return new Date(ms).toISOString();
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseSheetDateToUtc_(row, fields) {
  row = row || {};
  fields = fields || [];
  for (let i = 0; i < fields.length; i++) {
    const iso = excelSerialToUtcIso_(row[fields[i]]);
    if (iso) return iso;
  }
  if (row.fecha && row.hora_chile) {
    const datePart = normalizeFecha_(row.fecha);
    const timePart = normalizeHora_(row.hora_chile) || '00:00';
    const d = new Date(datePart + 'T' + timePart + ':00-04:00');
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function canonicalTeamDisplayName_(name) {
  if (typeof teamNameToSpanish_ === 'function') return teamNameToSpanish_(name);
  return String(name || '').trim();
}

function makeMatchSlug_(row) {
  return makeSlug_(firstNonEmpty_(row.match_key, row.source_fixture_key, row.fixture_id, row.match_id,
    [normalizeFecha_(firstNonEmpty_(row.fecha, row.date_utc)), firstNonEmpty_(row.local, row.home_team_name, row.equipo_local), firstNonEmpty_(row.visitante, row.away_team_name, row.equipo_visitante)].join(' ')));
}

function firstNonEmpty_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return '';
}

function buildGenericExternalRefs_(row, kind) {
  const refs = [];
  Object.keys(row || {}).forEach(function(k) {
    if (!/_id$|^id$/.test(k)) return;
    if (!row[k]) return;
    refs.push({ source: inferSourceFromColumn_(k), source_entity_id: row[k], source_entity_name: row.nombre || row.equipo || row.team || '', payload: { column: k } });
  });
  return refs;
}

function buildTeamRefs_(row, side) {
  const prefix = side === 'home' ? 'home' : 'away';
  const id = firstNonEmpty_(row[prefix + '_team_id'], row[prefix + '_id']);
  return id ? [{ source: String(row.source || 'SOURCE').toUpperCase(), source_entity_id: id }] : [];
}

function inferSourceFromColumn_(col) {
  const c = String(col || '').toLowerCase();
  if (c.indexOf('api_football') !== -1 || c === 'team_id' || c === 'player_id' || c === 'fixture_id') return 'API_FOOTBALL';
  if (c.indexOf('football_data') !== -1) return 'FOOTBALL_DATA';
  if (c.indexOf('espn') !== -1) return 'ESPN';
  return 'GOOGLE_SHEET';
}

function upsertExternalRef_(entityType, entityId, source, sourceType, sourceId, sourceName, payload) {
  if (!entityId || !sourceId) return null;
  return supabaseBootstrapUpsert_('entity_external_refs', [{
    entity_type: entityType,
    entity_id: entityId,
    source: String(source || 'GOOGLE_SHEET').toUpperCase(),
    source_entity_type: sourceType || null,
    source_entity_id: String(sourceId),
    source_entity_name: sourceName || null,
    confidence: 1,
    is_primary: false,
    payload: payload || {}
  }], 'entity_type,source,source_entity_id');
}

function enqueueEntityResolution_(entity) {
  entity = entity || {};
  return supabaseBootstrapUpsert_('entity_resolution_queue', [{
    entity_type: entity.entity_type || 'OTHER',
    source: entity.source || 'GOOGLE_SHEET',
    source_entity_type: entity.source_entity_type || null,
    source_entity_id: String(entity.source_entity_id || hashPayload_(entity)),
    source_entity_name: entity.source_entity_name || 'unknown',
    normalized_name: entity.normalized_name || normalizeName_(entity.source_entity_name),
    resolution_status: 'OPEN',
    candidate_entities: entity.candidate_entities || [],
    payload: entity.payload || entity
  }], 'entity_type,source,source_entity_id,normalized_name');
}

function findGroup_(seasonId, groupName) {
  const g = String(groupName || '').trim();
  if (!g) return null;
  const normalized = /^grupo\s+/i.test(g) ? g : 'Grupo ' + g;
  return supabaseSelectOne_('competition_groups', 'select=*&competition_season_id=eq.' + seasonId + '&group_code=eq.' + encodeURIComponent(normalized));
}

function findStageFromRow_(seasonId, row) {
  const raw = String(firstNonEmpty_(row.fase, row.stage, row.ronda, row.round) || '').toLowerCase();
  let code = 'GROUP_STAGE';
  if (raw.indexOf('32') !== -1 || raw.indexOf('dieciseis') !== -1) code = 'ROUND_OF_32';
  else if (raw.indexOf('16') !== -1 || raw.indexOf('octav') !== -1) code = 'ROUND_OF_16';
  else if (raw.indexOf('quarter') !== -1 || raw.indexOf('cuarto') !== -1) code = 'QUARTER_FINAL';
  else if (raw.indexOf('semi') !== -1) code = 'SEMI_FINAL';
  else if (raw.indexOf('third') !== -1 || raw.indexOf('tercer') !== -1) code = 'THIRD_PLACE';
  else if (raw.indexOf('final') !== -1) code = 'FINAL';
  return supabaseSelectOne_('competition_stages', 'select=*&competition_season_id=eq.' + seasonId + '&stage_code=eq.' + code);
}

function getOrCreateVenue_(row) {
  const name = firstNonEmpty_(row.estadio, row.venue_name);
  if (!name) return null;
  return upsertOneReturn_('venues', {
    slug: makeSlug_(name + ' ' + firstNonEmpty_(row.ciudad, row.venue_city)),
    display_name: name,
    city: firstNonEmpty_(row.ciudad, row.venue_city),
    country_code: null,
    timezone_name: firstNonEmpty_(row.timezone_estadio, row.venue_timezone),
    latitude: toNumberOrNull_(firstNonEmpty_(row.lat, row.latitude)),
    longitude: toNumberOrNull_(firstNonEmpty_(row.lon, row.longitude)),
    metadata: { source: 'GOOGLE_SHEET', original: row }
  }, 'slug');
}

function upsertMatchParticipant_(matchId, side, teamId, score) {
  return supabaseBootstrapUpsert_('match_participants', [{
    match_id: matchId,
    side: side,
    participant_role: 'TEAM',
    team_id: teamId,
    score: toNumberOrNull_(score),
    metadata: { source: 'initial_bootstrap' }
  }], 'match_id,side');
}

function upsertMatchExternalRefs_(matchId, row) {
  if (row.match_id) upsertExternalRef_('MATCH', matchId, 'GOOGLE_SHEET', 'match', row.match_id, row.match_key, row);
  if (row.fixture_id) upsertExternalRef_('MATCH', matchId, 'API_FOOTBALL', 'fixture', row.fixture_id, row.match_key, row);
  if (row.source_match_id) upsertExternalRef_('MATCH', matchId, row.source || 'SOURCE', 'match', row.source_match_id, row.source_fixture_key, row);
  if (row.fixture_id_api_football) upsertExternalRef_('MATCH', matchId, 'API_FOOTBALL', 'fixture', row.fixture_id_api_football, row.match_key, row);
  if (row.match_id_football_data) upsertExternalRef_('MATCH', matchId, 'FOOTBALL_DATA', 'match', row.match_id_football_data, row.match_key, row);
}

function resolveMarket_(marketName) {
  const raw = normalizeName_(marketName || '1X2');
  let code = '1X2';
  if (raw.indexOf('over') !== -1 || raw.indexOf('total') !== -1 || raw.indexOf('under') !== -1) code = 'OVER_UNDER';
  if (raw.indexOf('btts') !== -1 || raw.indexOf('ambos') !== -1) code = 'BTTS';
  if (raw.indexOf('handicap') !== -1 || raw.indexOf('spread') !== -1 || raw.indexOf('ah') !== -1) code = 'HANDICAP';
  if (raw.indexOf('card') !== -1 || raw.indexOf('tarjeta') !== -1) code = 'CARDS';
  if (raw.indexOf('corner') !== -1) code = 'CORNERS';
  return supabaseSelectOne_('markets', 'select=*&market_code=eq.' + encodeURIComponent(code)) ||
    upsertOneReturn_('markets', { market_code: code, display_name: code, category: code }, 'market_code');
}

function resolveSelection_(market, selection, homeTeam, awayTeam) {
  const raw = normalizeName_(selection || '');
  let code = 'HOME';
  if (raw === 'x' || raw === 'draw' || raw === 'empate') code = 'DRAW';
  else if (raw === 'away' || raw === 'visitante' || raw === normalizeName_(awayTeam)) code = 'AWAY';
  else if (raw === 'over' || raw.indexOf('over') !== -1 || raw.indexOf('mas') !== -1) code = 'OVER';
  else if (raw === 'under' || raw.indexOf('under') !== -1 || raw.indexOf('menos') !== -1) code = 'UNDER';
  else if (raw === 'yes' || raw === 'si' || raw === 'btts yes') code = 'YES';
  else if (raw === 'no' || raw === 'btts no') code = 'NO';
  else if (raw === 'home' || raw === 'local' || raw === normalizeName_(homeTeam)) code = 'HOME';
  let found = supabaseSelectOne_('market_selections', 'select=*&market_id=eq.' + market.market_id + '&selection_code=eq.' + encodeURIComponent(code));
  if (!found) {
    found = upsertOneReturn_('market_selections', {
      market_id: market.market_id,
      selection_code: code,
      display_name: code
    }, 'market_id,selection_code');
  }
  return found;
}

function getOrCreateBookmaker_(name) {
  const display = String(name || 'UNKNOWN').trim() || 'UNKNOWN';
  return upsertOneReturn_('bookmaker_profiles', {
    slug: makeSlug_(display),
    display_name: display,
    metadata: { source: 'initial_bootstrap' }
  }, 'slug');
}

function getOrCreateModel_(name, version) {
  return upsertOneReturn_('model_registry', {
    model_name: name,
    model_version: version,
    model_family: name.split('_')[0],
    champion_status: 'EXPERIMENTAL',
    payload: { source: 'initial_bootstrap' }
  }, 'model_name,model_version');
}

function findPrediction_(matchId, marketId, selectionId, line) {
  return supabaseSelectOne_('model_predictions', 'select=*&match_id=eq.' + matchId + '&market_id=eq.' + marketId + '&selection_id=eq.' + selectionId + '&order=as_of.desc');
}

function findComparableOdds_(matchId, marketId, selectionId, line, decimalOdds) {
  const rows = supabaseSelect_('odds_snapshots', 'select=*&match_id=eq.' + matchId + '&market_id=eq.' + marketId + '&selection_id=eq.' + selectionId + '&order=captured_at.desc&limit=20');
  if (!rows.length && decimalOdds) return upsertOneReturn_('odds_snapshots', {
    match_id: matchId,
    bookmaker_id: getOrCreateBookmaker_('SHEET_IMPLIED').bookmaker_id,
    source: 'GOOGLE_SHEET',
    market_id: marketId,
    selection_id: selectionId,
    line: line,
    decimal_odds: toNumberOrNull_(decimalOdds),
    captured_at: nowIso_(),
    payload: { created_from_ev_row: true }
  }, 'match_id,bookmaker_id,source,market_id,selection_id,line,captured_at');
  return rows[0] || null;
}

function inferLine_(row) {
  return toNumberOrNull_(firstNonEmpty_(row.line, row.handicap, row.total));
}

function probability_(value) {
  const n = toNumberOrNull_(value);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}

function mapMatchStatus_(status) {
  const s = String(status || '').toUpperCase();
  if (['FT', 'FINISHED', 'FINAL'].indexOf(s) !== -1) return 'FINISHED';
  if (['LIVE', 'HT', '1H', '2H'].indexOf(s) !== -1) return 'LIVE';
  if (s === 'POSTPONED') return 'POSTPONED';
  if (s === 'CANCELLED') return 'CANCELLED';
  return 'SCHEDULED';
}

function mapLineupRole_(role) {
  const r = normalizeName_(role);
  if (r.indexOf('titular') !== -1 || r === 'starter') return 'STARTER';
  if (r.indexOf('supl') !== -1 || r === 'substitute') return 'SUBSTITUTE';
  return 'UNKNOWN';
}

function mapRisk_(confidence) {
  const c = normalizeName_(confidence);
  if (c.indexOf('alta') !== -1 || c === 'high') return 'LOW';
  if (c.indexOf('media') !== -1 || c === 'medium') return 'MEDIUM';
  return 'HIGH';
}

function mapSettlementStatus_(result) {
  return result ? 'SETTLED' : 'PENDING';
}

function mapSettlementResult_(result) {
  const r = normalizeName_(result);
  if (r === 'win' || r === 'won') return 'WIN';
  if (r === 'loss' || r === 'lost') return 'LOSS';
  if (r === 'void') return 'VOID';
  if (r === 'push') return 'PUSH';
  return null;
}

function mapBetStatus_(result) {
  const r = mapSettlementResult_(result);
  if (r === 'WIN') return 'WON';
  if (r === 'LOSS') return 'LOST';
  if (r === 'VOID') return 'VOID';
  return 'OPEN';
}

function logDataQualityEvent_(event) {
  event = event || {};
  return supabaseInsert_('data_quality_events', [{
    layer: event.layer || 'STAGING',
    entity_type: event.entity_type || null,
    entity_id: event.entity_id || null,
    severity: event.severity || 'WARN',
    check_type: event.check_type || 'BOOTSTRAP',
    message: event.message || 'Bootstrap data quality event',
    payload: event.payload || {}
  }]);
}

function insertPipelineRun_(jobName, status, recordsProcessed, payload) {
  return supabaseInsert_('pipeline_runs', [{
    job_name: jobName,
    status: status || 'OK',
    started_at: nowIso_(),
    finished_at: nowIso_(),
    records_processed: recordsProcessed || 0,
    error_message: payload && payload.error,
    payload: payload || {}
  }]);
}
