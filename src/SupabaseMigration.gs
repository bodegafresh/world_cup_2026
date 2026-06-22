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

function supabaseValidateAgainstSheets() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');

  const report = [];
  Object.keys(SUPABASE_SHEET_TABLES).forEach(function(sheetName) {
    const cfg = SUPABASE_SHEET_TABLES[sheetName];
    const sheetRows = readAllFromSheet_(sheetName);
    let remoteRows = [];
    let error = '';
    try {
      remoteRows = supabaseSelect_(cfg.table, 'select=*');
    } catch (e) {
      error = e.message;
    }
    report.push({
      sheet: sheetName,
      table: cfg.table,
      sheet_rows: sheetRows.length,
      supabase_rows: remoteRows.length,
      delta: remoteRows.length - sheetRows.length,
      status: error ? 'ERROR' : (remoteRows.length >= sheetRows.length ? 'OK' : 'MISSING_ROWS'),
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
        'sheet=' + r.sheet_rows + ' supabase=' + r.supabase_rows + ' delta=' + r.delta,
        r.error || 'Revisar conteos antes de activar SUPABASE_PRIMARY_READ',
        'NOOP'
      ];
    }));
  } catch (e_) {}
  return report;
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
  supabaseUpsert_(cfg.table, payload, cfg.conflict);
  return { mirrored: payload.length, table: cfg.table };
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
  return supabaseStatus();
}

function supabaseDisableRuntime() {
  supabaseSetPrimaryRead(false);
  supabaseSetDualWrite(false);
  return supabaseStatus();
}
