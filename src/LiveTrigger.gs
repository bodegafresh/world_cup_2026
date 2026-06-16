/**
 * LiveTrigger.gs
 *
 * Gestión del trigger de live polling para días de partido.
 *
 * Apps Script no puede activar triggers automáticamente desde código según condiciones;
 * el usuario debe ejecutar setupMatchDayLiveTrigger() manualmente antes de cada
 * jornada de partidos y teardownMatchDayLiveTrigger() al terminar.
 *
 * El trigger llama a cronLiveEventsMonitor() en LiveEvents.gs cada 5 minutos.
 * Eso genera hasta: 4 fixtures × 12 polls/h × 2h = ~96 llamadas API por jornada.
 * Con el límite de 100 req/día de API-Football free tier, activar solo durante
 * el período de partidos (aprox 4h por jornada).
 *
 * FUNCIONES DE ENTRADA (ejecutar manualmente en Apps Script):
 *   setupMatchDayLiveTrigger()  — crea trigger cada 5 min
 *   teardownMatchDayLiveTrigger() — elimina el trigger
 *   checkLiveTriggerStatus()    — muestra estado actual
 */

const LIVE_TRIGGER_PROP   = 'LIVE_TRIGGER_ID';
const LIVE_TRIGGER_FN     = 'cronLiveEventsMonitor';
const LIVE_TRIGGER_MINS   = 5;

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Crea un trigger time-driven que llama a cronLiveEventsMonitor() cada 5 minutos.
 * Si ya existe un trigger activo, no crea uno duplicado.
 *
 * Ejecutar manualmente ~15 minutos antes del primer partido de la jornada.
 */
function setupMatchDayLiveTrigger() {
  const props = PropertiesService.getScriptProperties();

  // Verificar si ya existe
  const existingId = props.getProperty(LIVE_TRIGGER_PROP);
  if (existingId) {
    const allTriggers = ScriptApp.getProjectTriggers();
    const exists = allTriggers.some(t => t.getUniqueId() === existingId);
    if (exists) {
      Logger.log(`⚠️  Ya existe un trigger live activo (ID: ${existingId}). Usa checkLiveTriggerStatus() para verlo.`);
      return existingId;
    }
    // El ID guardado ya no existe — limpiar
    props.deleteProperty(LIVE_TRIGGER_PROP);
  }

  const trigger = ScriptApp.newTrigger(LIVE_TRIGGER_FN)
    .timeBased()
    .everyMinutes(LIVE_TRIGGER_MINS)
    .create();

  const triggerId = trigger.getUniqueId();
  props.setProperty(LIVE_TRIGGER_PROP, triggerId);

  Logger.log(`✅ Trigger live creado: ${LIVE_TRIGGER_FN} cada ${LIVE_TRIGGER_MINS} minutos`);
  Logger.log(`   ID: ${triggerId}`);
  Logger.log(`   ⚠️  Recuerda ejecutar teardownMatchDayLiveTrigger() al terminar la jornada.`);
  Logger.log(`   💡 Tip: consume ~${LIVE_TRIGGER_MINS * 12} req/h de API-Football. Actívalo solo durante los partidos.`);

  return triggerId;
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

/**
 * Elimina el trigger de live polling.
 * Ejecutar manualmente al terminar la jornada (cuando terminó el último partido).
 */
function teardownMatchDayLiveTrigger() {
  const props = PropertiesService.getScriptProperties();
  const id    = props.getProperty(LIVE_TRIGGER_PROP);

  if (!id) {
    Logger.log('ℹ️  No hay trigger live guardado en Script Properties.');

    // Buscar por nombre de función por si acaso
    const byName = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === LIVE_TRIGGER_FN);
    if (byName.length) {
      byName.forEach(t => { ScriptApp.deleteTrigger(t); Logger.log(`🗑️  Eliminado trigger por nombre: ${t.getUniqueId()}`); });
    } else {
      Logger.log('   No se encontró ningún trigger activo para cronLiveEventsMonitor.');
    }
    return;
  }

  const allTriggers = ScriptApp.getProjectTriggers();
  const target = allTriggers.find(t => t.getUniqueId() === id);

  if (target) {
    ScriptApp.deleteTrigger(target);
    Logger.log(`✅ Trigger live eliminado (ID: ${id})`);
  } else {
    Logger.log(`⚠️  Trigger ID ${id} ya no existe (puede haberse eliminado manualmente).`);
  }

  props.deleteProperty(LIVE_TRIGGER_PROP);
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Muestra el estado de todos los triggers del proyecto.
 * Indica si cronLiveEventsMonitor está activo y cuándo fue su última ejecución.
 */
function checkLiveTriggerStatus() {
  const props      = PropertiesService.getScriptProperties();
  const savedId    = props.getProperty(LIVE_TRIGGER_PROP);
  const allTriggers = ScriptApp.getProjectTriggers();

  Logger.log('=== ESTADO DE TRIGGERS ===');
  Logger.log(`Total triggers en el proyecto: ${allTriggers.length}\n`);

  allTriggers.forEach(t => {
    const fn   = t.getHandlerFunction();
    const id   = t.getUniqueId();
    const type = t.getTriggerSource();
    const isLive = fn === LIVE_TRIGGER_FN;
    const mark = isLive ? '🔴 LIVE' : '📅';

    Logger.log(`${mark} ${fn}`);
    Logger.log(`   ID: ${id}`);
    Logger.log(`   Tipo: ${type}`);
    if (isLive) Logger.log(`   Intervalo: ${LIVE_TRIGGER_MINS} min`);
    Logger.log('');
  });

  const liveTrigger = allTriggers.find(t => t.getHandlerFunction() === LIVE_TRIGGER_FN);

  if (liveTrigger) {
    Logger.log(`✅ Polling en vivo ACTIVO — ${LIVE_TRIGGER_FN} corriendo cada ${LIVE_TRIGGER_MINS} min`);
    Logger.log(`   Ejecuta teardownMatchDayLiveTrigger() cuando terminen los partidos.`);
  } else {
    Logger.log(`⭕ Polling en vivo INACTIVO`);
    Logger.log(`   Ejecuta setupMatchDayLiveTrigger() antes del próximo partido.`);
  }

  if (savedId && !liveTrigger) {
    Logger.log(`⚠️  Hay un ID guardado (${savedId}) pero el trigger ya no existe. Limpiando...`);
    props.deleteProperty(LIVE_TRIGGER_PROP);
  }

  Logger.log('===========================');
  return { active: !!liveTrigger, triggers: allTriggers.length };
}
