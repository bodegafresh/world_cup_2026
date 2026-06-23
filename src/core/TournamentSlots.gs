/**
 * TournamentSlots.gs
 *
 * Un slot de torneo es una referencia estructural del calendario
 * ("Group A Winner", "Semifinal 1 Winner", etc.), no una entidad equipo.
 * Debe poder aparecer en matches como etiqueta, pero nunca en teams.
 */

function isTournamentSlotName_(name) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  const s = normalizeTournamentSlotText_(raw);
  if (!s) return false;

  return /^group [a-z0-9]+ (winner|runner up|2nd place|second place|third place|3rd place)$/.test(s) ||
    /^winner group [a-z0-9]+$/.test(s) ||
    /^runner up group [a-z0-9]+$/.test(s) ||
    /^best third/.test(s) ||
    /^third place group/.test(s) ||
    /^round of [0-9]+ [0-9]+ (winner|loser)$/.test(s) ||
    /^round of [0-9]+ (winner|loser) [0-9]+$/.test(s) ||
    /^round of [0-9]+.*(winner|loser)$/.test(s) ||
    /^quarter ?final [0-9]+ (winner|loser)$/.test(s) ||
    /^semi ?final [0-9]+ (winner|loser)$/.test(s) ||
    /^semifinal [0-9]+ (winner|loser)$/.test(s) ||
    /^finalist [0-9]+$/.test(s) ||
    /^winner match [0-9]+$/.test(s) ||
    /^loser match [0-9]+$/.test(s) ||
    /^ganador/.test(s) ||
    /^perdedor/.test(s) ||
    /^mejor 3/.test(s) ||
    /^grupo [a-z0-9]+/.test(s) && /(ganador|primero|1|segundo|2|tercero|3)/.test(s);
}

function normalizeTournamentSlotText_(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tournamentSlotLabel_(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^Group ([A-Z0-9]+) Winner$/i, 'Grupo $1 - 1');
  s = s.replace(/^Group ([A-Z0-9]+) 2nd Place$/i, 'Grupo $1 - 2');
  s = s.replace(/^Group ([A-Z0-9]+) Runner[- ]?up$/i, 'Grupo $1 - 2');
  s = s.replace(/^Third Place Group ([A-Z0-9/]+)$/i, 'Mejor 3 - Grupos $1');
  s = s.replace(/^Round of 32 ([0-9]+) Winner$/i, 'Ganador 16avos $1');
  s = s.replace(/^Round of 16 ([0-9]+) Winner$/i, 'Ganador octavos $1');
  s = s.replace(/^Quarterfinal ([0-9]+) Winner$/i, 'Ganador cuartos $1');
  s = s.replace(/^Semifinal ([0-9]+) Winner$/i, 'Ganador semifinal $1');
  s = s.replace(/^Semifinal ([0-9]+) Loser$/i, 'Perdedor semifinal $1');
  return s;
}
