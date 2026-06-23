function getSheet_(name) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = ss.getSheetByName(name);

  if (!sheet) throw new Error(`No existe hoja: ${name}`);

  return sheet;
}

/**
 * Retorna la hoja o la crea con los headers dados si no existe.
 */
function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function appendRows_(sheetName, rows) {
  if (!rows || rows.length === 0) return;

  if (isSupabasePrimaryWriteEnabled_()) {
    const headers = getHeadersSafe_(sheetName);
    return supabaseWriteRowsFromSheet_(sheetName, headers, rows);
  }

  const sheet = getSheet_(sheetName);
  const startRow = sheet.getLastRow() + 1;
  const startCol = 1;

  sheet.getRange(startRow, startCol, rows.length, rows[0].length).setValues(rows);

  try {
    const headers = getHeaders_(sheetName);
    supabaseMirrorRows_(sheetName, headers, rows);
  } catch (e_) {
    Logger.log('Supabase mirror appendRows_ skipped for ' + sheetName + ': ' + e_.message);
  }
}

function appendRow_(sheetName, rowData) {
  if (isSupabasePrimaryWriteEnabled_()) {
    const headers = getHeadersSafe_(sheetName);
    const row = Array.isArray(rowData)
      ? rowData
      : headers.map(h => safe_(rowData[h]));
    return supabaseWriteRowsFromSheet_(sheetName, headers, [row]);
  }

  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheetName);
  const row = Array.isArray(rowData)
    ? rowData
    : headers.map(h => safe_(rowData[h]));
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);

  try {
    supabaseMirrorRows_(sheetName, headers, [row]);
  } catch (e_) {
    Logger.log('Supabase mirror appendRow_ skipped for ' + sheetName + ': ' + e_.message);
  }
}

function updateRow_(sheetName, zeroBasedDataIndex, rowData) {
  if (isSupabasePrimaryWriteEnabled_()) {
    throw new Error('updateRow_ por indice esta bloqueado con SUPABASE_PRIMARY_WRITE=true. Refactorizar a upsert por clave canonica: ' + sheetName);
  }

  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheetName);
  const rowNumber = zeroBasedDataIndex + 2;
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  Object.keys(rowData || {}).forEach(k => {
    const i = headers.indexOf(k);
    if (i !== -1) current[i] = safe_(rowData[k]);
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
}

function upsertRowsByKey_(sheetName, headers, rows, keyColumns, options) {
  options = options || {};
  if (!rows || !rows.length) return { inserted: 0, updated: 0 };

  if (isSupabasePrimaryWriteEnabled_()) {
    const writeRows = rows.map(row => Array.isArray(row) ? row : headers.map(h => safe_(row[h])));
    const result = supabaseWriteRowsFromSheet_(sheetName, headers, writeRows);
    return { inserted: result.mirrored || 0, updated: 0, primary_write: 'supabase' };
  }

  const sheet = getOrCreateSheet_(sheetName, headers);
  let values = sheet.getDataRange().getValues();
  if (!values.length || values[0].join('') === '') {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    values = [headers];
  }

  const currentHeaders = values[0].map(String);
  const existing = {};
  values.slice(1).forEach((row, i) => {
    const key = buildSheetKey_(row, currentHeaders, keyColumns);
    if (key) existing[key] = i + 2;
  });

  let inserted = 0;
  let updated = 0;
  const toAppend = [];
  rows.forEach(row => {
    const rowArray = Array.isArray(row) ? row : headers.map(h => safe_(row[h]));
    const key = buildSheetKey_(rowArray, headers, keyColumns);
    if (!key) return;
    if (existing[key]) {
      sheet.getRange(existing[key], 1, 1, headers.length).setValues([rowArray]);
      updated++;
    } else {
      toAppend.push(rowArray);
      inserted++;
    }
  });

  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  try {
    const mirroredRows = rows.map(row => Array.isArray(row) ? row : headers.map(h => safe_(row[h])));
    supabaseMirrorRows_(sheetName, headers, mirroredRows);
  } catch (e_) {
    Logger.log('Supabase mirror upsertRowsByKey_ skipped for ' + sheetName + ': ' + e_.message);
  }
  return { inserted: inserted, updated: updated };
}

function buildSheetKey_(row, headers, keyColumns) {
  const parts = keyColumns.map(col => {
    const i = headers.indexOf(col);
    return i === -1 ? '' : String(row[i] || '').trim();
  });
  return parts.every(Boolean) ? parts.join('|') : '';
}

function readAll_(sheetName) {
  try {
    const supabaseRows = supabaseReadSheet_(sheetName);
    if (supabaseRows) return supabaseRows;
  } catch (e_) {
    Logger.log('Supabase primary read fallback to Sheets for ' + sheetName + ': ' + e_.message);
  }
  return readAllFromSheet_(sheetName);
}

function readAllFromSheet_(sheetName) {
  let sheet;
  try { sheet = getSheet_(sheetName); } catch(e_) { return []; }
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) return [];

  const headers = values[0];

  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    applySheetAliases_(obj);
    return obj;
  });
}

function applySheetAliases_(obj) {
  if (obj.fixture_id_af === undefined && obj.fixture_id_api_football !== undefined) {
    obj.fixture_id_af = obj.fixture_id_api_football;
  }
  if (obj.fixture_id_fd === undefined && obj.match_id_football_data !== undefined) {
    obj.fixture_id_fd = obj.match_id_football_data;
  }
  if (obj.ronda === undefined && obj.fase !== undefined) {
    obj.ronda = obj.fase;
  }
  if (obj.estado === undefined && obj.status !== undefined) {
    obj.estado = obj.status;
  }
  return obj;
}

function getHeaders_(sheetName) {
  const sheet = getSheet_(sheetName);
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function clearDataKeepHeader_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

function getExistingIds_(sheetName, idColumnName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) return {};

  const headers = values[0];
  const idx = headers.indexOf(idColumnName);

  if (idx === -1) throw new Error(`No existe columna ${idColumnName} en ${sheetName}`);

  const map = {};

  values.slice(1).forEach(row => {
    if (row[idx]) map[String(row[idx])] = true;
  });

  return map;
}
