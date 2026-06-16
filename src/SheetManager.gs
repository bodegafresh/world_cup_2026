/**
 * SheetManager.gs
 *
 * Gestión del libro de Google Sheets: limpieza, auditoría y creación de hojas.
 *
 * FUNCIONES DE ENTRADA (ejecutar manualmente en Apps Script):
 *   sheetAudit()       — lista todas las hojas y clasifica cuáles deben existir
 *   sheetCleanup()     — elimina hojas no reconocidas que estén VACÍAS
 *   sheetCleanupForce()— elimina hojas no reconocidas aunque tengan datos (⚠️ irreversible)
 */

const VALID_SHEETS = new Set([
  'README',
  'Dashboard',
  'Partidos',
  'Equipos',
  'Jugadores',
  'Planteles',
  'PlayerMatchStats',
  'EventosLive',
  'ResumenJugadorPartido',
  'OddsApuestas',
  'EstadiosClima',
  'Noticias',
  'RawLog',
  'AnalisisIA',
  'Alertas',
  'ReportesTelegram',
  'SourceFixtures',
  'MatchMapping',
  'DataQualityLog',
  'PipelineRuns',
  'Clasificacion',
  'HistorialH2H'
]);

// ─── Auditoría ─────────────────────────────────────────────────────────────────

/**
 * Lista todas las hojas del libro con su estado.
 * No modifica nada. Ejecutar para revisar antes de limpiar.
 */
function sheetAudit() {
  const ss     = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheets = ss.getSheets();

  Logger.log('=== AUDITORÍA DE HOJAS ===');
  Logger.log(`Total hojas: ${sheets.length}`);
  Logger.log(`Hojas válidas definidas: ${VALID_SHEETS.size}\n`);

  const unknown = [];
  const valid   = [];

  sheets.forEach(sheet => {
    const name    = sheet.getName();
    const rows    = sheet.getLastRow();
    const cols    = sheet.getLastColumn();
    const isEmpty = rows <= 1 && cols <= 0;

    if (VALID_SHEETS.has(name)) {
      valid.push({ name, rows, cols });
      Logger.log(`✅ ${name} (${rows} filas)`);
    } else {
      unknown.push({ name, rows, cols, isEmpty });
      Logger.log(`❌ DESCONOCIDA: "${name}" (${rows} filas, ${cols} cols) ${isEmpty ? '— VACÍA' : '— TIENE DATOS'}`);
    }
  });

  Logger.log(`\nResumen: ${valid.length} válidas | ${unknown.length} desconocidas`);

  if (unknown.length) {
    const emptyUnknown = unknown.filter(s => s.isEmpty);
    const dataUnknown  = unknown.filter(s => !s.isEmpty);
    Logger.log(`  → ${emptyUnknown.length} desconocidas vacías (se pueden borrar con sheetCleanup())`);
    Logger.log(`  → ${dataUnknown.length} desconocidas con datos (requieren sheetCleanupForce())`);
  }

  Logger.log('=========================');
  return { valid, unknown };
}

// ─── Limpieza ──────────────────────────────────────────────────────────────────

/**
 * Elimina hojas no reconocidas que estén VACÍAS (sin datos debajo de la fila 1).
 * Seguro: no toca hojas con contenido.
 */
function sheetCleanup() {
  const ss      = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheets  = ss.getSheets();
  const deleted = [];
  const skipped = [];

  sheets.forEach(sheet => {
    const name    = sheet.getName();
    if (VALID_SHEETS.has(name)) return;

    const rows    = sheet.getLastRow();
    const cols    = sheet.getLastColumn();
    const isEmpty = rows <= 1 && cols <= 0;

    if (isEmpty) {
      ss.deleteSheet(sheet);
      deleted.push(name);
      Logger.log(`🗑️  Eliminada: "${name}"`);
    } else {
      skipped.push(name);
      Logger.log(`⏭️  Saltada (tiene datos): "${name}" — usa sheetCleanupForce() si quieres eliminarla`);
    }
  });

  Logger.log(`\nEliminadas: ${deleted.length} | Saltadas: ${skipped.length}`);
  return { deleted, skipped };
}

/**
 * Elimina hojas no reconocidas aunque tengan datos.
 * ⚠️ IRREVERSIBLE. Usar solo si estás seguro de que la hoja es basura.
 */
function sheetCleanupForce() {
  const ss      = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheets  = ss.getSheets();
  const deleted = [];

  if (ss.getSheets().length === 1) {
    Logger.log('No se puede eliminar la única hoja del libro.');
    return;
  }

  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (VALID_SHEETS.has(name)) return;

    ss.deleteSheet(sheet);
    deleted.push(name);
    Logger.log(`🗑️  Eliminada (forzado): "${name}"`);
  });

  Logger.log(`\nTotal eliminadas: ${deleted.length}`);
  return { deleted };
}

// ─── Creación de hojas faltantes ──────────────────────────────────────────────

/**
 * Verifica que todas las hojas válidas existan.
 * Las que falten las crea vacías (solo el nombre, sin headers).
 * Los headers los crean las funciones de cada módulo al primer insert.
 */
function sheetEnsureAll() {
  const ss      = SpreadsheetApp.openById(getSpreadsheetId_());
  const created = [];

  VALID_SHEETS.forEach(name => {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name);
      created.push(name);
      Logger.log(`➕ Creada: "${name}"`);
    }
  });

  if (!created.length) {
    Logger.log('Todas las hojas válidas ya existen.');
  }

  return { created };
}
