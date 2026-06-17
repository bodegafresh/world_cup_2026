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

  const sheet = getSheet_(sheetName);
  const startRow = sheet.getLastRow() + 1;
  const startCol = 1;

  sheet.getRange(startRow, startCol, rows.length, rows[0].length).setValues(rows);
}

function readAll_(sheetName) {
  let sheet;
  try { sheet = getSheet_(sheetName); } catch(e_) { return []; }
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) return [];

  const headers = values[0];

  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
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