function todayChile_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function tomorrowChile_() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function yesterdayChile_() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function nowChile_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function toChileDateTime_(isoDate) {
  if (!isoDate) return '';
  return Utilities.formatDate(new Date(isoDate), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function jsonString_(obj) {
  return JSON.stringify(obj, null, 2);
}

function safe_(value) {
  return value === null || value === undefined ? '' : value;
}

function hash_(text) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text));
  return raw.map(function(byte) {
    const v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function buildEventId_(fixtureId, event) {
  const minute = event.time ? event.time.elapsed : '';
  const extra = event.time ? event.time.extra : '';
  const teamId = event.team ? event.team.id : '';
  const playerId = event.player ? event.player.id : '';
  const type = event.type || '';
  const detail = event.detail || '';

  return `${fixtureId}_${minute}_${extra}_${teamId}_${playerId}_${type}_${detail}`.replace(/\s+/g, '_');
}

function addDaysToDateString_(dateString, days) {
  const parts = String(dateString).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days);

  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}