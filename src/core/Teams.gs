/**
 * core/Teams.gs
 *
 * Identidad canonica de equipos. Nuevos modulos deben depender de estos
 * wrappers, no de normalizadores locales duplicados.
 */

function coreTeamDisplayName_(name) {
  return teamNameToSpanish_(name || '');
}

function coreTeamKey_(name) {
  return canonicalTeamKey_(name || '');
}

function coreTeamAliasKey_(teamKey, source, alias) {
  return hash_([teamKey, source || 'manual', normalizeTeamNameStrong_(alias || '')].join('|'));
}

function coreTeamsMatch_(a, b) {
  return teamNameMatches_(a || '', b || '');
}
