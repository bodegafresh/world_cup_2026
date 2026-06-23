/**
 * SupabaseMigration.gs
 *
 * Funciones publicas para migrar Google Sheets -> Supabase de forma controlada.
 *
 * Orden recomendado:
 *   1. supabaseStatus()
 *   2. supabaseMigrationDryRun()
 *   3. supabaseMigrationApply()
 *   4. supabaseValidateAgainstSheets()
 *   5. supabaseSetDualWrite(true)
 *   6. supabaseSetPrimaryRead(true) solo cuando la validacion este OK.
 */

function supabaseMigrationDryRun() {
  return supabaseMigrateSheets_({ apply: false });
}

function supabaseMigrationApply() {
  return supabaseMigrateSheets_({ apply: true });
}

function supabaseMigrateCoreApply() {
  return supabaseMigrateSheets_({
    apply: true,
    sheets: [
      CONFIG.SHEETS.PARTIDOS,
      CONFIG.SHEETS.EQUIPOS,
      CONFIG.SHEETS.JUGADORES,
      CONFIG.SHEETS.CLASIFICACION,
      CONFIG.SHEETS.PLAYER_MATCH_STATS,
      CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO,
      CONFIG.SHEETS.ODDS,
      CONFIG.SHEETS.POISSON_ODDS,
      CONFIG.SHEETS.AI_ANALYSIS,
      CONFIG.SHEETS.EV_OPPORTUNITIES,
      CONFIG.SHEETS.EV_HISTORICO,
      CONFIG.SHEETS.BETTING_HISTORY,
      CONFIG.SHEETS.MODEL_CALIBRATION,
      CONFIG.SHEETS.SIM_GRUPOS,
      CONFIG.SHEETS.ELO_RATINGS
    ]
  });
}

function supabaseMigrateMvp30Apply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const catalog = seedCompetitionCatalogToSupabase();
  const core = supabaseMigrationApply();
  const mappings = supabaseMigrateCompetitionMappingsApply();
  const validation = supabaseValidateAgainstSheets();
  supabaseSetDualWrite(true);
  supabaseSetPrimaryRead(false);
  supabaseSetPrimaryWrite(false);
  return {
    status: core.totalErrors ? 'WARN' : 'OK',
    catalog: catalog,
    core: core,
    mappings: mappings,
    validation: validation,
    runtime: supabaseStatus(),
    next_step: 'Keep SUPABASE_PRIMARY_READ=false until validation blockers are reviewed.'
  };
}

function supabaseMigrateCompetitionMappingsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const teamsPayload = [];
  const aliasPayload = [];
  const sourceMappingPayload = [];
  const competitionTeamPayload = [];
  const seen = {};

  function addTeam(teamName, sourceRow) {
    const name = teamNameToSpanish_(teamName || '');
    const teamKey = canonicalTeamKey_(name);
    if (!teamKey) return null;
    if (!seen['team|' + teamKey]) {
      teamsPayload.push({
        team_key: teamKey,
        display_name: name,
        normalized_name: normalizeTeamNameStrong_(name),
        group_code: safe_(sourceRow && (sourceRow.grupo || sourceRow.group_code)),
        api_football_team_id: safe_(sourceRow && (sourceRow.team_id_api_football || sourceRow.equipo_id || sourceRow.team_id)),
        football_data_team_id: safe_(sourceRow && sourceRow.team_id_football_data),
        country_code: safe_(sourceRow && (sourceRow.country_code || sourceRow.codigo_pais)),
        payload: sourceRow || {},
        updated_at: nowIso_()
      });
      seen['team|' + teamKey] = true;
    }
    addAlias(teamKey, name, 'canonical', sourceRow);
    if (sourceRow) {
      ['nombre', 'equipo', 'team', 'display_name', 'nombre_normalizado'].forEach(function(field) {
        if (sourceRow[field]) addAlias(teamKey, sourceRow[field], field, sourceRow);
      });
      addSourceMapping(teamKey, 'api_football', sourceRow.team_id_api_football || sourceRow.equipo_id || sourceRow.team_id, name, sourceRow);
      addSourceMapping(teamKey, 'football_data', sourceRow.team_id_football_data, name, sourceRow);
    }
    return teamKey;
  }

  function addAlias(teamKey, alias, source, sourceRow) {
    const raw = String(alias || '').trim();
    const normalized = normalizeTeamNameStrong_(raw);
    if (!teamKey || !normalized) return;
    const key = 'alias|' + source + '|' + normalized;
    if (seen[key]) return;
    seen[key] = true;
    aliasPayload.push({
      alias_key: hash_([teamKey, source, normalized].join('|')),
      team_key: teamKey,
      alias: raw,
      normalized_alias: normalized,
      language: '',
      source: source,
      confidence: 1,
      payload: sourceRow || {},
      updated_at: nowIso_()
    });
  }

  function addSourceMapping(teamKey, source, sourceId, sourceTeamName, sourceRow) {
    const id = String(sourceId || '').trim();
    if (!teamKey || !id) return;
    const key = 'source|' + source + '|' + id;
    if (seen[key]) return;
    seen[key] = true;
    sourceMappingPayload.push({
      source: source,
      source_team_id: id,
      team_key: teamKey,
      competition_season_id: safe_(sourceRow && sourceRow.competition_season_id) || 'WC2026',
      source_team_name: safe_(sourceTeamName),
      confidence: 1,
      payload: sourceRow || {},
      updated_at: nowIso_()
    });
  }

  function addCompetitionTeam(competitionSeasonId, teamKey, teamName, groupCode, sourceRow) {
    if (!competitionSeasonId || !teamKey) return;
    const key = 'competition_team|' + competitionSeasonId + '|' + teamKey;
    if (seen[key]) return;
    seen[key] = true;
    competitionTeamPayload.push({
      competition_season_id: competitionSeasonId,
      team_key: teamKey,
      group_code: safe_(groupCode),
      status: 'ACTIVE',
      seed_rating: null,
      payload: Object.assign({}, sourceRow || {}, { team_name: teamName }),
      updated_at: nowIso_()
    });
  }

  readAllFromSheet_(CONFIG.SHEETS.EQUIPOS).forEach(function(r) {
    const name = r.nombre || r.equipo || r.team || r.display_name;
    const teamKey = addTeam(name, r);
    if (teamKey) addCompetitionTeam(r.competition_season_id || 'WC2026', teamKey, name, r.grupo || r.group_code, r);
  });

  readAllFromSheet_(CONFIG.SHEETS.CLASIFICACION).forEach(function(r) {
    const name = r.equipo || r.team;
    const teamKey = addTeam(name, r);
    if (teamKey) addCompetitionTeam(r.competition_season_id || 'WC2026', teamKey, name, r.grupo || r.group_code, r);
  });

  if (teamsPayload.length) supabaseUpsert_('teams', teamsPayload, 'team_key');
  if (aliasPayload.length) supabaseUpsert_('team_aliases', aliasPayload, 'alias_key');
  if (sourceMappingPayload.length) supabaseUpsert_('source_team_mapping', sourceMappingPayload, 'source,source_team_id');
  if (competitionTeamPayload.length) supabaseUpsert_('competition_team_mapping', competitionTeamPayload, 'competition_season_id,team_key');

  const summary = {
    teams: teamsPayload.length,
    aliases: aliasPayload.length,
    source_team_mapping: sourceMappingPayload.length,
    competition_team_mapping: competitionTeamPayload.length
  };
  Logger.log('supabaseMigrateCompetitionMappingsApply: ' + JSON.stringify(summary));
  return summary;
}

function supabaseMvp30Status() {
  const status = supabaseStatus();
  const activeCompetition = getActiveCompetitionSeasonId_();
  return {
    supabase: status,
    active_competition_season_id: activeCompetition,
    active_competition_status: getCompetitionStatus_(activeCompetition),
    active_competition_readiness: evaluateCompetitionReadiness_(activeCompetition)
  };
}

function supabasePrepareExpansion60Apply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  seedCompetitionCatalogToSupabase();
  const marketProfiles = supabaseSeedCompetitionMarketProfiles_();
  const features = supabaseSeedFeatureDefinitions_();
  const ratings = supabaseSeedLeagueStrengthCoefficients_();
  return {
    status: 'OK',
    market_profiles: marketProfiles,
    feature_definitions: features,
    league_strength_coefficients: ratings,
    note: 'Expansion 60d scaffold ready. Competitions remain non-bettable until readiness passes.'
  };
}

function supabasePreparePlatform90Apply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const expansion = supabasePrepareExpansion60Apply();
  const registry = [
    {
      model_name: 'POISSON_DC',
      model_version: 'v1',
      status: 'CHAMPION',
      payload: { scope: 'baseline', requires_calibration: true }
    },
    {
      model_name: 'ELO_CONTEXTUAL',
      model_version: 'v1',
      status: 'CHALLENGER',
      payload: { scope: 'rating', requires_calibration: true }
    },
    {
      model_name: 'LIGHTGBM_TABULAR',
      model_version: 'planned_v1',
      status: 'PLANNED',
      payload: { scope: '90d', requires_feature_snapshots: true }
    }
  ];
  supabaseUpsert_('model_registry', registry, 'model_name,model_version');
  return {
    status: 'OK',
    expansion: expansion,
    model_registry: registry.length,
    note: 'Platform 90d scaffold ready for champion/challenger tracking.'
  };
}

function supabaseSeedCompetitionMarketProfiles_() {
  const now = nowIso_();
  const payload = getCompetitionCatalogRows_().map(function(r) {
    const tier = r.liquidity_tier || 'LOW';
    const score = tier === 'HIGH' ? 0.9 : tier === 'MEDIUM' ? 0.65 : tier === 'LOW' ? 0.35 : 0;
    return {
      competition_season_id: r.competition_season_id,
      market: '1X2',
      bookmaker_count: null,
      market_quality_score: score,
      liquidity_tier: tier,
      odds_volatility: null,
      closing_efficiency: null,
      updated_at: now,
      payload: {
        seeded_from_catalog: true,
        target_status: r.target_status
      }
    };
  });
  if (payload.length) supabaseUpsert_('competition_market_profiles', payload, 'competition_season_id,market');
  return payload.length;
}

function supabaseSeedLeagueStrengthCoefficients_() {
  const payload = getCompetitionCatalogRows_().map(function(r) {
    return {
      competition_season_id: r.competition_season_id,
      coefficient: Number(r.strength_coefficient || 1),
      method: 'catalog_initial_prior',
      sample_size: null,
      updated_at: nowIso_(),
      payload: {
        seeded_from_catalog: true,
        competition_id: r.competition_id
      }
    };
  });
  if (payload.length) supabaseUpsert_('league_strength_coefficients', payload, 'competition_season_id');
  return payload.length;
}

function supabaseSeedFeatureDefinitions_() {
  const definitions = [
    {
      feature_name: 'elo_global_pre_match',
      feature_set_version: 'v1',
      valid_contexts: ['international_cup', 'domestic_league', 'continental_club'],
      requires_home_advantage: false,
      requires_league_strength: false,
      description: 'Global pre-match team ELO.'
    },
    {
      feature_name: 'elo_contextual_diff',
      feature_set_version: 'v1',
      valid_contexts: ['international_cup', 'domestic_league', 'continental_club'],
      requires_home_advantage: true,
      requires_league_strength: false,
      description: 'Contextual home-away ELO difference.'
    },
    {
      feature_name: 'poisson_lambda_home',
      feature_set_version: 'v1',
      valid_contexts: ['international_cup', 'domestic_league', 'continental_club'],
      requires_home_advantage: true,
      requires_league_strength: false,
      description: 'Home scoring intensity from Poisson model.'
    },
    {
      feature_name: 'poisson_lambda_away',
      feature_set_version: 'v1',
      valid_contexts: ['international_cup', 'domestic_league', 'continental_club'],
      requires_home_advantage: false,
      requires_league_strength: false,
      description: 'Away scoring intensity from Poisson model.'
    },
    {
      feature_name: 'market_implied_probability_no_vig',
      feature_set_version: 'v1',
      valid_contexts: ['international_cup', 'domestic_league', 'continental_club'],
      requires_home_advantage: false,
      requires_league_strength: false,
      description: 'No-vig implied probability from market odds.'
    },
    {
      feature_name: 'rest_days_diff',
      feature_set_version: 'v1',
      valid_contexts: ['international_cup', 'domestic_league', 'continental_club'],
      requires_home_advantage: false,
      requires_league_strength: false,
      description: 'Difference in rest days before match.'
    },
    {
      feature_name: 'league_strength_coefficient',
      feature_set_version: 'v1',
      valid_contexts: ['continental_club'],
      requires_home_advantage: false,
      requires_league_strength: true,
      description: 'Competition strength prior for cross-league normalization.'
    }
  ].map(function(d) {
    d.payload = { seeded: true };
    d.updated_at = nowIso_();
    return d;
  });
  supabaseUpsert_('feature_definitions', definitions, 'feature_name');
  return definitions.length;
}

function supabaseValidateAgainstSheets() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');

  const report = [];
  Object.keys(SUPABASE_SHEET_TABLES).forEach(function(sheetName) {
    const cfg = SUPABASE_SHEET_TABLES[sheetName];
    const sheetRows = readAllFromSheet_(sheetName);
    const expectedRows = supabaseExpectedRowsForSheet_(sheetName, sheetRows);
    let remoteCount = 0;
    let error = '';
    try {
      remoteCount = supabaseCount_(cfg.table);
    } catch (e) {
      error = e.message;
    }
    report.push({
      sheet: sheetName,
      table: cfg.table,
      sheet_rows: sheetRows.length,
      expected_unique_rows: expectedRows,
      supabase_rows: remoteCount,
      delta: remoteCount - expectedRows,
      status: error ? 'ERROR' : (remoteCount >= expectedRows ? 'OK' : 'MISSING_ROWS'),
      error: error
    });
  });

  Logger.log(JSON.stringify(report, null, 2));
  try {
    appendRows_(CONFIG.SHEETS.NORMALIZATION_AUDIT, report.map(function(r) {
      return [
        nowChile_(),
        r.sheet,
        'supabase_validate',
        r.status === 'OK' ? 'OK' : 'P1',
        'sheet=' + r.sheet_rows + ' expected_unique=' + r.expected_unique_rows + ' supabase=' + r.supabase_rows + ' delta=' + r.delta,
        r.error || 'Revisar conteos antes de activar SUPABASE_PRIMARY_READ',
        'NOOP'
      ];
    }));
  } catch (e_) {}
  return report;
}

function supabaseExpectedRowsForSheet_(sheetName, sheetRows) {
  const cfg = SUPABASE_SHEET_TABLES[sheetName];
  if (!cfg) return (sheetRows || []).length;
  const payload = (sheetRows || []).map(cfg.transform).filter(Boolean);
  return supabaseDedupePayload_(payload, cfg).length;
}

function supabaseMigrateSheets_(options) {
  options = options || {};
  const apply = options.apply === true;
  if (apply && !isSupabaseConfigured_()) throw new Error('Supabase no configurado.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('No se pudo obtener lock de migracion Supabase');

  const run = createPipelineRun_({
    mode: apply ? 'SUPABASE_MIGRATION_APPLY' : 'SUPABASE_MIGRATION_DRY_RUN',
    step: 'supabase_migration',
    notes: 'Sheets -> Supabase'
  });

  const batchSize = getSupabaseBatchSize_();
  const sheetNames = options.sheets || CONFIG.SUPABASE.SUPPORTED_SHEETS;
  const summary = [];
  let totalRows = 0;
  let totalMigrated = 0;
  let totalErrors = 0;

  try {
    sheetNames.forEach(function(sheetName) {
      const sheetSummary = supabaseMigrateOneSheet_(sheetName, apply, batchSize);
      summary.push(sheetSummary);
      totalRows += sheetSummary.source_rows || 0;
      totalMigrated += sheetSummary.migrated_rows || 0;
      totalErrors += sheetSummary.errors || 0;
    });

    finishPipelineRun_(run, {
      status: totalErrors ? 'WARN' : 'OK',
      golden_count: totalRows,
      enriched_count: totalMigrated,
      errors: totalErrors ? String(totalErrors) : '',
      notes: JSON.stringify(summary).substring(0, 45000)
    });

    try { writeSupabaseMigrationAudit_(summary, apply); } catch (e_) {}
    Logger.log(JSON.stringify({ apply: apply, totalRows: totalRows, totalMigrated: totalMigrated, totalErrors: totalErrors }, null, 2));
    return { apply: apply, totalRows: totalRows, totalMigrated: totalMigrated, totalErrors: totalErrors, summary: summary };
  } catch (e) {
    finishPipelineRun_(run, {
      status: 'ERROR',
      errors: e.message,
      notes: JSON.stringify(summary).substring(0, 45000)
    });
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function supabaseMigrateOneSheet_(sheetName, apply, batchSize) {
  const headers = getHeadersSafe_(sheetName);
  const rows = readSheetRowsAsArrays_(sheetName, headers.length);
  const cfg = SUPABASE_SHEET_TABLES[sheetName];
  const summary = {
    sheet: sheetName,
    table: cfg ? cfg.table : 'sheet_raw_rows',
    source_rows: rows.length,
    migrated_rows: 0,
    skipped_rows: 0,
    errors: 0,
    status: 'DRY_RUN'
  };

  if (!rows.length) {
    summary.status = 'EMPTY';
    return summary;
  }

  if (!apply) {
    summary.migrated_rows = rows.length;
    summary.status = cfg ? 'READY' : 'READY_RAW';
    return summary;
  }

  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    try {
      const result = cfg
        ? supabaseMirrorRowsDirect_(sheetName, headers, chunk)
        : supabaseMirrorRawRowsDirect_(sheetName, headers, chunk);
      summary.migrated_rows += result.mirrored || 0;
      summary.skipped_rows += chunk.length - (result.mirrored || 0);
    } catch (e) {
      summary.errors++;
      summary.last_error = e.message;
      Logger.log('Supabase migration error ' + sheetName + ' rows ' + start + '-' + (start + chunk.length) + ': ' + e.message);
    }
    Utilities.sleep(150);
  }

  summary.status = summary.errors ? 'WARN' : 'OK';
  return summary;
}

function supabaseMirrorRowsDirect_(sheetName, headers, rows) {
  if (!rows || !rows.length) return { mirrored: 0 };
  if (!isSupabaseSheetSupported_(sheetName)) return supabaseMirrorRawRowsDirect_(sheetName, headers, rows);
  const cfg = SUPABASE_SHEET_TABLES[sheetName];
  const objects = rowsToObjects_(headers, rows);
  const payload = objects.map(cfg.transform).filter(Boolean);
  if (!payload.length) return { mirrored: 0 };
  const deduped = supabaseDedupePayload_(payload, cfg);
  if (!deduped.length) return { mirrored: 0 };
  supabaseUpsert_(cfg.table, deduped, cfg.conflict);
  return { mirrored: deduped.length, table: cfg.table };
}

function supabaseMirrorRawRowsDirect_(sheetName, headers, rows) {
  if (!rows || !rows.length) return { mirrored: 0 };
  const payload = rowsToObjects_(headers, rows).map(function(row) {
    return {
      sheet_name: sheetName,
      row_key: hash_(sheetName + '|' + JSON.stringify(row)),
      source_row_number: null,
      payload: row,
      synced_at: nowIso_()
    };
  });
  supabaseUpsert_('sheet_raw_rows', payload, 'sheet_name,row_key');
  return { mirrored: payload.length, table: 'sheet_raw_rows' };
}

function getHeadersSafe_(sheetName) {
  try {
    const headers = getHeaders_(sheetName).map(String);
    if (headers.length && headers.join('').trim()) return headers;
  } catch (e_) {}
  return (SHEET_HEADERS && SHEET_HEADERS[sheetName]) ? SHEET_HEADERS[sheetName] : [];
}

function readSheetRowsAsArrays_(sheetName, expectedCols) {
  const sheet = getSheetIfExists_(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const width = Math.max(expectedCols || 0, sheet.getLastColumn());
  if (!width) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues()
    .filter(function(row) { return row.some(function(v) { return v !== '' && v !== null && v !== undefined; }); });
}

function writeSupabaseMigrationAudit_(summary, apply) {
  const rows = summary.map(function(s) {
    return [
      nowChile_(),
      s.sheet,
      apply ? 'supabase_migration_apply' : 'supabase_migration_dry_run',
      s.status === 'OK' || s.status === 'READY' || s.status === 'READY_RAW' || s.status === 'EMPTY' ? 'OK' : 'P1',
      'table=' + s.table + ' source=' + s.source_rows + ' migrated=' + s.migrated_rows + ' skipped=' + s.skipped_rows,
      s.last_error || 'Validar conteos antes de activar lectura primaria',
      apply ? 'APPLIED' : 'DRY_RUN'
    ];
  });
  appendRows_(CONFIG.SHEETS.NORMALIZATION_AUDIT, rows);
}

function supabaseEnableAfterValidation() {
  const report = supabaseValidateAgainstSheets();
  const blockers = report.filter(function(r) { return r.status !== 'OK'; });
  if (blockers.length) {
    throw new Error('No se activa Supabase primary read: hay validaciones pendientes. Blockers=' + blockers.map(function(r) { return r.sheet + ':' + r.status; }).join(', '));
  }
  supabaseSetDualWrite(true);
  supabaseSetPrimaryRead(true);
  supabaseSetPrimaryWrite(false);
  return supabaseStatus();
}

function supabaseCutoverToPrimaryApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');

  const validation = supabaseValidateAgainstSheets();
  const blockers = validation.filter(function(r) { return r.status !== 'OK'; });
  if (blockers.length) {
    throw new Error('No se activa Supabase como fuente unica: hay validaciones pendientes. Blockers=' + blockers.map(function(r) {
      return r.sheet + ':' + r.status + '(sheet=' + r.sheet_rows + ',supabase=' + r.supabase_rows + ')';
    }).join(', '));
  }

  supabaseSetPrimaryRead(true);
  supabaseSetPrimaryWrite(true);
  supabaseSetDualWrite(false);

  try {
    appendRows_(CONFIG.SHEETS.NORMALIZATION_AUDIT, [[
      nowChile_(),
      'SUPABASE_PRIMARY',
      'cutover',
      'OK',
      'Supabase activado como fuente unica operacional',
      'Sheets queda solo para reportes/export legacy. Escrituras centrales van directo a Supabase.',
      'APPLIED'
    ]]);
  } catch (e_) {}

  return {
    status: 'OK',
    runtime: supabaseStatus(),
    validation: validation,
    note: 'Supabase es fuente unica para readAll_, appendRows_, appendRow_ y upsertRowsByKey_ en hojas soportadas.'
  };
}

function supabaseRollbackToSheetsApply() {
  supabaseSetPrimaryWrite(false);
  supabaseSetPrimaryRead(false);
  supabaseSetDualWrite(false);
  return {
    status: 'OK',
    runtime: supabaseStatus(),
    note: 'Rollback operativo: lecturas/escrituras centrales vuelven a Google Sheets.'
  };
}

function supabaseDisableRuntime() {
  supabaseSetPrimaryRead(false);
  supabaseSetPrimaryWrite(false);
  supabaseSetDualWrite(false);
  return supabaseStatus();
}
