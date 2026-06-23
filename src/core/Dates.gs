/**
 * core/Dates.gs
 *
 * Helpers canonicos de fecha/hora. Mantiene wrappers sobre Utils.gs para
 * centralizar nuevos usos sin romper llamadas legacy.
 */

function coreToday_() {
  return todayChile_();
}

function coreNowIso_() {
  return nowIso_();
}

function coreNormalizeDate_(value) {
  return normalizeFecha_(value);
}

function coreNormalizeTime_(value) {
  return normalizeHora_(value);
}

function coreMatchAsOf_(value) {
  return toIsoOrNull_(value) || nowIso_();
}
