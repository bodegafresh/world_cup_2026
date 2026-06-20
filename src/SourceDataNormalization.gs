/**
 * SourceDataNormalization.gs
 *
 * Utilidades sin llamadas externas para auditar y reparar el Google Sheet fuente.
 * Todas las funciones corren en modo dry-run salvo que se invoque
 * normalizeSourceApply().
 */

const NORMALIZATION_AUDIT_HEADERS = [
  'timestamp','sheet','check_type','severity','details','recommended_action','apply_status'
];

const NORMALIZATION_EXPECTED_HEADERS = {
  Noticias: [
    'id_hash','pubDate','updated_at','source_match_id','query','titulo',
    'tipo','status','url','fuente','fixture_id','equipo_local','equipo_visitante'
  ],
  EstadiosClima: [
    'venue_id','estadio','ciudad','pais','latitud_longitud',
    'temperatura_c','humedad','viento_kmh','prob_lluvia','condicion',
    'updated_at','fuente','fixture_id'
  ],
  EvOpportunities: [
    'fixture_id','timestamp','fecha','local','visitante','mercado','seleccion','cuota',
    'cuota_justa','prob_modelo','ev','edge','kelly','ev_positivo',
    'confianza','fuente_modelo','sospechoso','outlier'
  ]
};

const NORMALIZATION_DEDUP_RULES = [
  { sheet: 'SourceFixtures', keyCols: ['source_fixture_key'], keep: 'last' },
  { sheet: 'MatchMapping', keyCols: ['match_key'], keep: 'best_confidence_then_last' },
  { sheet: 'PlayerMatchStats', keyCols: ['fixture_id','player_id'], keep: 'last' },
  { sheet: 'Alineaciones', keyCols: ['fixture_id','jugador_id','rol'], keep: 'last' },
  { sheet: 'EventosLive', keyCols: ['evento_id'], keep: 'last' },
  { sheet: 'EvHistorico', keyCols: ['fecha','local','visitante','mercado','seleccion'], keep: 'last' }
];

/**
 * Auditoria completa sin modificar datos.
 * Ejecutar primero desde Apps Script.
 */
function normalizeSourceDryRun() {
  return normalizeSourceWorkbook_({ apply: false, writeReport: true });
}

/**
 * Aplica reparaciones seguras:
 * - Inserta headers faltantes en Noticias y EstadiosClima.
 * - Completa match_id faltantes en Partidos.
 * - Recalcula flags y metricas EV derivadas.
 * - Deduplica hojas allowlist preservando la fila elegida por regla.
 *
 * Recomendacion: ejecutar normalizeSourceDryRun() antes y revisar NormalizationAudit.
 */
function normalizeSourceApply() {
  return normalizeSourceWorkbook_({ apply: true, writeReport: true });
}

/**
 * Solo recalcula columnas derivadas de EV+, sin deduplicar otras hojas.
 */
function normalizeEvOpportunitiesApply() {
  const findings = [];
  const changed = normalizeEvOpportunities_(true, findings);
  writeNormalizationAudit_(findings);
  Logger.log('normalizeEvOpportunitiesApply: ' + changed + ' fila(s) actualizadas');
  return { changed: changed, findings: findings.length };
}

function normalizeSourceWorkbook_(options) {
  options = options || {};
  const apply = options.apply === true;
  const writeReport = options.writeReport !== false;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('No se pudo obtener lock de normalizacion');

  const findings = [];
  const counters = {
    headers_fixed: 0,
    match_ids_filled: 0,
    ev_rows_updated: 0,
    duplicate_rows_removed: 0
  };

  try {
    counters.headers_fixed += ensureNormalizationHeaders_(CONFIG.SHEETS.NOTICIAS, NORMALIZATION_EXPECTED_HEADERS.Noticias, apply, findings);
    counters.headers_fixed += ensureNormalizationHeaders_(CONFIG.SHEETS.ESTADIOS_CLIMA, NORMALIZATION_EXPECTED_HEADERS.EstadiosClima, apply, findings);
    counters.match_ids_filled += fillMissingPartidosMatchIds_(apply, findings);
    counters.ev_rows_updated += normalizeEvOpportunities_(apply, findings);

    NORMALIZATION_DEDUP_RULES.forEach(rule => {
      counters.duplicate_rows_removed += dedupeNormalizationSheet_(rule, apply, findings);
    });

    auditPipelineRunsShape_(findings);

    if (writeReport) writeNormalizationAudit_(findings);
    Logger.log('normalizeSourceWorkbook_: ' + JSON.stringify({ apply: apply, counters: counters, findings: findings.length }));
    return { apply: apply, counters: counters, findings: findings.length };
  } finally {
    lock.releaseLock();
  }
}

function ensureNormalizationHeaders_(sheetName, expectedHeaders, apply, findings) {
  const sheet = getSheetIfExists_(sheetName);
  if (!sheet) {
    addNormalizationFinding_(findings, sheetName, 'missing_sheet', 'P1', 'La hoja no existe', 'Crear hoja con headers canonicos', apply, 'SKIPPED');
    return 0;
  }

  const lastCol = Math.max(sheet.getLastColumn(), expectedHeaders.length);
  const firstRow = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const current = firstRow.slice(0, expectedHeaders.length).map(normalizeHeaderCell_);
  const expected = expectedHeaders.map(normalizeHeaderCell_);
  const matches = expected.every((h, i) => current[i] === h);

  if (matches) {
    addNormalizationFinding_(findings, sheetName, 'headers', 'OK', 'Headers canonicos presentes', 'Sin accion', apply, 'NOOP');
    return 0;
  }

  const firstRowLooksLikeData = firstRow.some(v => v !== '' && v !== null) &&
    expected.filter(h => current.indexOf(h) !== -1).length < Math.ceil(expected.length * 0.5);
  const action = firstRowLooksLikeData
    ? 'Insertar fila 1 con headers canonicos preservando datos actuales'
    : 'Reemplazar fila 1 con headers canonicos';

  if (apply) {
    if (firstRowLooksLikeData) sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
  }

  addNormalizationFinding_(findings, sheetName, 'headers', 'P1', 'Headers ausentes o incompatibles', action, apply, apply ? 'APPLIED' : 'DRY_RUN');
  return 1;
}

function fillMissingPartidosMatchIds_(apply, findings) {
  const sheetName = CONFIG.SHEETS.PARTIDOS;
  const values = getSheetValues_(sheetName);
  if (values.length <= 1) return 0;
  const headers = values[0].map(String);
  const idx = headerIndexMap_(headers);
  if (idx.match_id === undefined) {
    addNormalizationFinding_(findings, sheetName, 'match_id', 'P1', 'No existe columna match_id', 'Agregar columna match_id antes de normalizar', apply, 'SKIPPED');
    return 0;
  }

  const fechaCol = idx.fecha !== undefined ? idx.fecha : idx.fecha_chile;
  const localCol = idx.local;
  const visitanteCol = idx.visitante;
  if (fechaCol === undefined || localCol === undefined || visitanteCol === undefined) {
    addNormalizationFinding_(findings, sheetName, 'match_id', 'P1', 'Faltan columnas fecha/local/visitante', 'Revisar schema de Partidos', apply, 'SKIPPED');
    return 0;
  }

  let changed = 0;
  const output = values.slice(1).map(row => {
    const current = String(row[idx.match_id] || '').trim();
    if (current) return [current];
    const id = buildCanonicalMatchId_(row[fechaCol], row[localCol], row[visitanteCol]);
    if (id) changed++;
    return [id];
  });

  if (changed && apply) {
    getSheet_(sheetName).getRange(2, idx.match_id + 1, output.length, 1).setValues(output);
  }
  addNormalizationFinding_(findings, sheetName, 'match_id', changed ? 'P1' : 'OK', changed + ' match_id faltante(s)', 'Completar match_id canonico derivado de fecha/local/visitante', apply, changed ? (apply ? 'APPLIED' : 'DRY_RUN') : 'NOOP');
  return changed;
}

function normalizeEvOpportunities_(apply, findings) {
  const sheetName = CONFIG.SHEETS.EV_OPPORTUNITIES;
  const sheet = getSheetIfExists_(sheetName);
  if (!sheet) return 0;
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return 0;

  const headers = values[0].map(String);
  const idx = headerIndexMap_(headers);
  const required = ['cuota','prob_modelo','ev','edge','kelly','ev_positivo','cuota_justa','sospechoso','outlier'];
  const missing = required.filter(h => idx[h] === undefined);
  if (missing.length) {
    addNormalizationFinding_(findings, sheetName, 'ev_schema', 'P1', 'Faltan columnas: ' + missing.join(', '), 'Alinear headers EvOpportunities', apply, 'SKIPPED');
    return 0;
  }

  let changed = 0;
  const updates = values.slice(1).map(row => {
    const cuota = Number(row[idx.cuota] || 0);
    const prob = Number(row[idx.prob_modelo] || 0);
    if (!(cuota > 1) || !(prob > 0 && prob < 1)) {
      return [
        row[idx.cuota_justa], row[idx.ev], row[idx.edge], row[idx.kelly],
        row[idx.ev_positivo], row[idx.sospechoso], row[idx.outlier]
      ];
    }
    const m = bettingMetrics_(prob, cuota);
    const kelly = Math.max(0, Math.min(m.kelly_25_pct, typeof KELLY_MAX_FRACTION !== 'undefined' ? KELLY_MAX_FRACTION : 0.025));
    const next = [
      roundNorm_(m.fair_odds, 4),
      roundNorm_(m.ev_pct, 6),
      roundNorm_(m.edge_pp, 6),
      roundNorm_(kelly, 6),
      (m.ev_pct > EV_POSITIVE_THRESHOLD && m.edge_pp > EDGE_MIN_THRESHOLD && m.ev_pct <= EV_SUSPICIOUS_THRESHOLD) ? 'SI' : 'NO',
      (m.ev_pct > EV_SUSPICIOUS_THRESHOLD && m.ev_pct <= EV_OUTLIER_THRESHOLD) ? 'SI' : 'NO',
      (m.ev_pct > EV_OUTLIER_THRESHOLD) ? 'SI' : 'NO'
    ];
    const prev = [
      row[idx.cuota_justa], row[idx.ev], row[idx.edge], row[idx.kelly],
      row[idx.ev_positivo], row[idx.sospechoso], row[idx.outlier]
    ].map(String).join('|');
    if (prev !== next.map(String).join('|')) changed++;
    return next;
  });

  if (changed && apply) {
    const cols = [idx.cuota_justa, idx.ev, idx.edge, idx.kelly, idx.ev_positivo, idx.sospechoso, idx.outlier].map(i => i + 1);
    const startRow = 2;
    cols.forEach((col, j) => {
      sheet.getRange(startRow, col, updates.length, 1).setValues(updates.map(r => [r[j]]));
    });
  }
  addNormalizationFinding_(findings, sheetName, 'ev_metrics', changed ? 'P1' : 'OK', changed + ' fila(s) con metricas/flags derivadas inconsistentes', 'Recalcular EV, edge, Kelly 25%, flags EV+/sospechoso/outlier', apply, changed ? (apply ? 'APPLIED' : 'DRY_RUN') : 'NOOP');
  return changed;
}

function dedupeNormalizationSheet_(rule, apply, findings) {
  const values = getSheetValues_(rule.sheet);
  if (values.length <= 1) return 0;
  const headers = values[0].map(String);
  const idx = headerIndexMap_(headers);
  const missing = rule.keyCols.filter(c => idx[c] === undefined);
  if (missing.length) {
    addNormalizationFinding_(findings, rule.sheet, 'dedupe', 'P2', 'No se puede deduplicar. Faltan columnas: ' + missing.join(', '), 'Revisar schema antes de deduplicar', apply, 'SKIPPED');
    return 0;
  }

  const rows = values.slice(1);
  const chosen = {};
  let keyedRows = 0;
  let missingKeyRows = 0;
  rows.forEach((row, pos) => {
    const key = buildRowKey_(row, idx, rule.keyCols);
    if (!key) {
      missingKeyRows++;
      return;
    }
    keyedRows++;
    if (shouldReplaceDedupRow_(rule.keep, row, rows[chosen[key]], idx, pos, chosen[key])) {
      chosen[key] = pos;
    }
  });

  if (missingKeyRows) {
    addNormalizationFinding_(findings, rule.sheet, 'missing_key', 'P2', missingKeyRows + ' fila(s) sin clave ' + rule.keyCols.join('+'), 'Completar claves antes de confiar en agregados', apply, 'REPORT_ONLY');
  }

  const duplicateCount = keyedRows - Object.keys(chosen).length;
  if (duplicateCount <= 0) {
    addNormalizationFinding_(findings, rule.sheet, 'dedupe', 'OK', 'Sin duplicados por ' + rule.keyCols.join('+'), 'Sin accion', apply, 'NOOP');
    return 0;
  }

  if (apply) {
    const keepSet = {};
    Object.keys(chosen).forEach(k => keepSet[chosen[k]] = true);
    const newRows = rows.filter((row, pos) => {
      const key = buildRowKey_(row, idx, rule.keyCols);
      return !key || keepSet[pos];
    });
    const sheet = getSheet_(rule.sheet);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (newRows.length) sheet.getRange(2, 1, newRows.length, headers.length).setValues(newRows.map(r => padRow_(r, headers.length)));
  }

  addNormalizationFinding_(findings, rule.sheet, 'dedupe', 'P1', duplicateCount + ' fila(s) duplicada(s) por ' + rule.keyCols.join('+'), 'Deduplicar preservando regla: ' + rule.keep, apply, apply ? 'APPLIED' : 'DRY_RUN');
  return duplicateCount;
}

function auditPipelineRunsShape_(findings) {
  const sheetName = CONFIG.SHEETS.PIPELINE_RUNS;
  const values = getSheetValues_(sheetName);
  if (values.length <= 1) return;
  const headers = values[0].map(String);
  const idx = headerIndexMap_(headers);
  if (idx.started_at === undefined || idx.status === undefined) return;
  let suspicious = 0;
  values.slice(1).forEach(row => {
    const started = String(row[idx.started_at] || '');
    const status = String(row[idx.status] || '');
    if (/^cron[A-Z]/.test(started) || !status) suspicious++;
  });
  addNormalizationFinding_(findings, sheetName, 'shape', suspicious ? 'P1' : 'OK', suspicious + ' fila(s) con posible corrimiento o status vacio', 'No reparar automaticamente; alinear writer de PipelineRuns primero', false, 'REPORT_ONLY');
}

function writeNormalizationAudit_(findings) {
  const sheet = getOrCreateSheet_(CONFIG.SHEETS.NORMALIZATION_AUDIT, NORMALIZATION_AUDIT_HEADERS);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, NORMALIZATION_AUDIT_HEADERS.length).setValues([NORMALIZATION_AUDIT_HEADERS]);
  if (!findings.length) return;
  const rows = findings.map(f => NORMALIZATION_AUDIT_HEADERS.map(h => f[h] || ''));
  sheet.getRange(2, 1, rows.length, NORMALIZATION_AUDIT_HEADERS.length).setValues(rows);
}

function addNormalizationFinding_(findings, sheet, checkType, severity, details, action, apply, status) {
  findings.push({
    timestamp: nowChile_(),
    sheet: sheet,
    check_type: checkType,
    severity: severity,
    details: details,
    recommended_action: action,
    apply_status: status || (apply ? 'APPLIED' : 'DRY_RUN')
  });
}

function getSheetIfExists_(sheetName) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  return ss.getSheetByName(sheetName);
}

function getSheetValues_(sheetName) {
  const sheet = getSheetIfExists_(sheetName);
  if (!sheet) return [];
  return sheet.getDataRange().getValues();
}

function headerIndexMap_(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const k = normalizeHeaderCell_(h);
    if (k) idx[k] = i;
  });
  return idx;
}

function normalizeHeaderCell_(value) {
  return String(value || '').trim();
}

function buildCanonicalMatchId_(fecha, local, visitante) {
  const f = normalizeFecha_(fecha);
  const h = normalizeIdPart_(local);
  const a = normalizeIdPart_(visitante);
  return f && h && a ? 'match_' + f.replace(/-/g, '_') + '_' + h + '_' + a : '';
}

function normalizeIdPart_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildRowKey_(row, idx, keyCols) {
  const parts = keyCols.map(c => {
    const v = row[idx[c]];
    return v === null || v === undefined ? '' : String(v).trim();
  });
  return parts.some(Boolean) ? parts.join('|') : '';
}

function shouldReplaceDedupRow_(keep, candidate, current, idx, candidatePos, currentPos) {
  if (!current) return true;
  if (keep === 'best_confidence_then_last') {
    const c1 = Number(candidate[idx.confidence] || 0);
    const c0 = Number(current[idx.confidence] || 0);
    if (c1 !== c0) return c1 > c0;
  }
  return candidatePos > currentPos;
}

function padRow_(row, len) {
  const out = row.slice(0, len);
  while (out.length < len) out.push('');
  return out;
}

function roundNorm_(value, decimals) {
  const n = Number(value);
  if (!isFinite(n)) return '';
  const p = Math.pow(10, decimals || 4);
  return Math.round(n * p) / p;
}
