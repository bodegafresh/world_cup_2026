/**
 * SheetManager.gs
 *
 * Gestión del libro de Google Sheets: limpieza, auditoría y creación de hojas.
 *
 * FUNCIONES DE ENTRADA (ejecutar manualmente en Apps Script):
 *   sheetAudit()              — lista todas las hojas y clasifica cuáles deben existir
 *   sheetHeaderAudit()        — detecta hojas sin headers o con headers incorrectos
 *   sheetEnsureAll()          — crea hojas faltantes (sin headers)
 *   sheetEnsureAllWithHeaders()— crea hojas faltantes CON headers; si existe y está vacía, agrega headers
 *   sheetCleanup()            — elimina hojas no reconocidas que estén VACÍAS
 *   sheetCleanupForce()       — elimina hojas no reconocidas aunque tengan datos (⚠️ irreversible)
 */

// ─── Registro canónico de hojas ───────────────────────────────────────────────

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
  'HistorialH2H',
  // Hojas creadas en sesiones recientes (antes no estaban en VALID_SHEETS → aparecían como "desconocidas")
  'Suscriptores',
  'Alineaciones',
  'Arbitros',
  // Hojas nuevas — Fase 1: inteligencia estadística
  'EloRatings',
  'EvOpportunities',
  'BettingHistory',
  'ModelCalibration',
  // Hoja nueva — Fase 4: simulación de grupos
  'SimulacionGrupos',
  // Hojas nuevas — fuentes adicionales
  'EspnStats',
  'FormaEquipos'
]);

/**
 * Mapa centralizado de headers por hoja.
 * Es la fuente única de verdad para auditoría y creación con headers.
 * Los módulos individuales siguen usando sus propias constantes _HEADERS
 * para mayor legibilidad local; este mapa es el respaldo de auditoría.
 */
const SHEET_HEADERS = {
  Partidos: [
    'match_key','local','visitante','fecha','hora_chile','estadio','ciudad',
    'pais_estadio','lat','lon','timezone_estadio','resultado','goles_local',
    'goles_visitante','status','ronda','grupo','posesion_local','posesion_visitante',
    'tiros_local','tiros_visitante','tiros_al_arco_local','tiros_al_arco_visitante',
    'corners_local','corners_visitante','faltas_local','faltas_visitante',
    'amarillas_local','amarillas_visitante','rojas_local','rojas_visitante',
    'fixture_id_af','fixture_id_fd','sources_count','conflict_detail','updated_at'
  ],
  PlayerMatchStats: [
    'fixture_id','player_id','player_name','team_id','team_name',
    'minutes_played','rating','goals_scored','assists',
    'yellow_cards','red_cards','passes_total','passes_accuracy',
    'tackles_total','interceptions','duels_total','duels_won',
    'dribbles_attempts','dribbles_success','shots_total','shots_on','updated_at'
  ],
  ResumenJugadorPartido: [
    'fixture_id','jugador_id','jugador','equipo_id','equipo',
    'goles','asistencias','amarillas','rojas','minutos','updated_at'
  ],
  EventosLive: [
    'event_id','fixture_id','minuto','minuto_extra','tipo','detalle',
    'equipo_id','equipo','jugador_id','jugador','asistente_id','asistente','updated_at'
  ],
  Alineaciones: [
    'fixture_id','equipo','equipo_id','rol','numero',
    'jugador','jugador_id','posicion','grid','updated_at'
  ],
  Arbitros: [
    'arbitro_id','nombre','nacionalidad','confederacion',
    'fixture_id','fecha','equipo_local','equipo_visitante','ronda',
    'amarillas','rojas','penales','updated_at'
  ],
  OddsApuestas: [
    'fixture_id','fuente','mercado','seleccion','cuota',
    'probabilidad_modelo','ev','timestamp','confianza','razon'
  ],
  EstadiosClima: [
    'fixture_id','estadio','ciudad','lat','lon','temperatura_c','sensacion_termica',
    'humedad','viento_kmh','prob_lluvia','precipitacion_mm','condicion',
    'hora_partido_utc','updated_at'
  ],
  Noticias: [
    'id_hash','fixture_id','titulo','descripcion','fuente',
    'url','pubDate','equipos_mencionados','updated_at'
  ],
  HistorialH2H: [
    'fixture_ref_id','fecha','local','visitante','goles_local',
    'goles_visitante','resultado','torneo','updated_at'
  ],
  Clasificacion: [
    'grupo','posicion','equipo','equipo_id','pj','pg','pe','pp',
    'gf','gc','gd','puntos','forma','descripcion','updated_at'
  ],
  AnalisisIA: [
    'fixture_id','equipo_local','equipo_visitante','fecha_hora_chile',
    'prob_local','prob_empate','prob_visitante','over_2_5','btts',
    'confianza','resumen_previa','mensaje_telegram',
    'factores_clave','bajas_suspensiones','jugadores_forma',
    'contexto_grupo','alertas','updated_at','fuente'
  ],
  Alertas: [
    'timestamp','tipo','prioridad','fixture_id','mensaje','enviado_telegram'
  ],
  PipelineRuns: [
    'run_id','job_name','started_at','finished_at',
    'status','records_processed','errors','error_msg'
  ],
  Suscriptores: [
    'chat_id','username','fecha_registro','activo'
  ],
  // ── Hojas nuevas — Fase 1 ──────────────────────────────────────────────────
  EloRatings: [
    'equipo','elo_actual','elo_anterior','partidos',
    'victorias','empates','derrotas','updated_at'
  ],
  EvOpportunities: [
    'fixture_id','timestamp','fecha','local','visitante','mercado','seleccion','cuota',
    'prob_modelo','ev','edge','kelly','ev_positivo','confianza','fuente_modelo'
  ],
  BettingHistory: [
    'bet_id','fixture_id','fecha','equipo_local','equipo_visitante',
    'mercado','seleccion','cuota','prob_modelo','ev',
    'kelly_fraction','stake','resultado','profit_loss','roi_acum','notas'
  ],
  ModelCalibration: [
    'fecha','partidos_evaluados','accuracy','brier_score','interpretacion','updated_at'
  ],
  SimulacionGrupos: [
    'grupo','equipo','prob_clasificar','partidos_restantes','updated_at'
  ],
  EspnStats: [
    'fixture_id','espn_event_id','fecha','local','visitante',
    'posesion_local','posesion_visitante',
    'tiros_local','tiros_visitante',
    'tiros_arco_local','tiros_arco_visitante',
    'corners_local','corners_visitante',
    'faltas_local','faltas_visitante',
    'amarillas_local','amarillas_visitante',
    'rojas_local','rojas_visitante',
    'offsides_local','offsides_visitante',
    'saves_local','saves_visitante',
    'pases_local','pases_visitante',
    'pases_precisos_local','pases_precisos_visitante',
    'centros_local','centros_visitante',
    'centros_precisos_local','centros_precisos_visitante',
    'tackles_local','tackles_visitante',
    'tackles_efectivos_local','tackles_efectivos_visitante',
    'intercepciones_local','intercepciones_visitante',
    'despejes_local','despejes_visitante',
    'tiros_bloqueados_local','tiros_bloqueados_visitante',
    'asistencia','updated_at'
  ],
  FormaEquipos: [
    'equipo','espn_team_id',
    'ultimos_5_resultados','ultimos_5_rivales','ultimos_5_marcadores',
    'updated_at'
  ]
};

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

/**
 * Versión mejorada de sheetEnsureAll:
 * - Si la hoja no existe → la crea CON headers.
 * - Si la hoja existe pero la fila 1 está vacía → escribe los headers sin tocar datos.
 * - Si la hoja existe y ya tiene headers → no hace nada.
 * Nunca borra ni modifica filas de datos (fila 2 en adelante).
 *
 * Ejecutar al inicializar el sistema o después de agregar nuevas hojas.
 */
function sheetEnsureAllWithHeaders() {
  const ss      = SpreadsheetApp.openById(getSpreadsheetId_());
  const created = [];
  const fixed   = [];
  const skipped = [];

  VALID_SHEETS.forEach(name => {
    const headers = SHEET_HEADERS[name];
    let sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      if (headers && headers.length) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      created.push(name);
      Logger.log(`➕ Creada con headers: "${name}"`);
      return;
    }

    // La hoja existe — verificar si fila 1 está vacía o sin contenido
    if (!headers || !headers.length) {
      skipped.push(name);
      Logger.log(`⏭️  Sin headers definidos: "${name}"`);
      return;
    }

    const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const isEmpty  = firstRow.every(cell => cell === '' || cell === null);

    if (isEmpty) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      fixed.push(name);
      Logger.log(`🔧 Headers agregados: "${name}"`);
    } else {
      skipped.push(name);
    }
  });

  Logger.log(`\nCreadas: ${created.length} | Headers agregados: ${fixed.length} | Sin cambios: ${skipped.length}`);
  return { created, fixed, skipped };
}

// ─── Auditoría de headers ──────────────────────────────────────────────────────

/**
 * Detecta hojas que existen pero tienen headers incorrectos o ausentes.
 * No modifica nada. Ejecutar para revisar estado de integridad.
 */
function sheetHeaderAudit() {
  const ss     = SpreadsheetApp.openById(getSpreadsheetId_());
  const report = { ok: [], missing: [], wrong: [], no_definition: [] };

  Logger.log('=== AUDITORÍA DE HEADERS ===');

  VALID_SHEETS.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return; // sheetAudit ya reporta las que no existen

    const expected = SHEET_HEADERS[name];
    if (!expected || !expected.length) {
      report.no_definition.push(name);
      Logger.log(`ℹ️  Sin definición: "${name}"`);
      return;
    }

    const lastCol  = Math.max(sheet.getLastColumn(), expected.length);
    const firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const isEmpty  = firstRow.every(cell => cell === '' || cell === null);

    if (isEmpty) {
      report.missing.push(name);
      Logger.log(`❌ HEADERS AUSENTES: "${name}" — esperaba: [${expected.join(', ')}]`);
      return;
    }

    const actual  = firstRow.slice(0, expected.length).map(String);
    const matches = expected.every((h, i) => actual[i] === h);

    if (matches) {
      report.ok.push(name);
      Logger.log(`✅ OK: "${name}"`);
    } else {
      report.wrong.push({ name, expected, actual });
      Logger.log(`⚠️  HEADERS DISTINTOS: "${name}"`);
      Logger.log(`   Esperado: [${expected.slice(0, 5).join(', ')}...]`);
      Logger.log(`   Actual:   [${actual.slice(0, 5).join(', ')}...]`);
    }
  });

  Logger.log(`\nOK: ${report.ok.length} | Ausentes: ${report.missing.length} | Distintos: ${report.wrong.length} | Sin def: ${report.no_definition.length}`);
  return report;
}
