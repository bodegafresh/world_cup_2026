/**
 * TeamNameCanonical.gs
 *
 * Catalogo canonico de nombres de selecciones.
 * Objetivo: una misma seleccion debe resolver siempre al mismo team_key,
 * aunque venga con acentos, abreviaturas, idioma distinto o puntuacion rara.
 */

const TEAM_CANONICAL_DISPLAY_ES = {
  argentina: 'Argentina',
  australia: 'Australia',
  austria: 'Austria',
  belgium: 'Belgica',
  bolivia: 'Bolivia',
  bosniaherzegovina: 'Bosnia y Herzegovina',
  brazil: 'Brasil',
  cameroon: 'Camerun',
  canada: 'Canada',
  capeverde: 'Cabo Verde',
  chile: 'Chile',
  china: 'China',
  colombia: 'Colombia',
  congo: 'Congo',
  congodr: 'Congo DR',
  costarica: 'Costa Rica',
  cotedivoire: 'Costa de Marfil',
  croatia: 'Croacia',
  curacao: 'Curazao',
  czechia: 'Republica Checa',
  denmark: 'Dinamarca',
  ecuador: 'Ecuador',
  egypt: 'Egipto',
  elsalvador: 'El Salvador',
  england: 'Inglaterra',
  finland: 'Finlandia',
  france: 'Francia',
  georgia: 'Georgia',
  germany: 'Alemania',
  ghana: 'Ghana',
  greece: 'Grecia',
  haiti: 'Haiti',
  honduras: 'Honduras',
  hungary: 'Hungria',
  iceland: 'Islandia',
  indonesia: 'Indonesia',
  iran: 'Iran',
  iraq: 'Irak',
  italy: 'Italia',
  jamaica: 'Jamaica',
  japan: 'Japon',
  jordan: 'Jordania',
  mexico: 'Mexico',
  morocco: 'Marruecos',
  netherlands: 'Paises Bajos',
  newzealand: 'Nueva Zelanda',
  nigeria: 'Nigeria',
  northkorea: 'Corea del Norte',
  norway: 'Noruega',
  panama: 'Panama',
  paraguay: 'Paraguay',
  peru: 'Peru',
  poland: 'Polonia',
  portugal: 'Portugal',
  qatar: 'Catar',
  romania: 'Rumania',
  russia: 'Rusia',
  saudiarabia: 'Arabia Saudita',
  scotland: 'Escocia',
  senegal: 'Senegal',
  serbia: 'Serbia',
  slovakia: 'Eslovaquia',
  slovenia: 'Eslovenia',
  southafrica: 'Sudafrica',
  southkorea: 'Corea del Sur',
  spain: 'Espana',
  sweden: 'Suecia',
  switzerland: 'Suiza',
  thailand: 'Tailandia',
  tunisia: 'Tunez',
  turkey: 'Turquia',
  ukraine: 'Ucrania',
  unitedarabemirates: 'Emiratos Arabes Unidos',
  unitedstates: 'EE.UU.',
  uruguay: 'Uruguay',
  uzbekistan: 'Uzbekistan',
  venezuela: 'Venezuela',
  wales: 'Gales'
};

const TEAM_CANONICAL_ALIAS_GROUPS = {
  argentina: ['argentina', 'arg'],
  australia: ['australia', 'aus'],
  austria: ['austria', 'aut'],
  belgium: ['belgium', 'belgica', 'bélgica', 'bel'],
  bolivia: ['bolivia', 'bol'],
  bosniaherzegovina: ['bosnia and herzegovina', 'bosnia herzegovina', 'bosnia-herzegovina', 'bosnia & herzegovina', 'bosnia y herzegovina', 'bosnia', 'bih'],
  brazil: ['brazil', 'brasil', 'bra'],
  cameroon: ['cameroon', 'camerun', 'camerún', 'cmr'],
  canada: ['canada', 'canadá', 'can'],
  capeverde: ['cape verde', 'cape verde islands', 'cabo verde', 'cpv'],
  chile: ['chile', 'chi', 'chl'],
  china: ['china', 'chn'],
  colombia: ['colombia', 'col'],
  congo: ['congo', 'republic of congo', 'congo republic', 'cgo'],
  congodr: ['dr congo', 'congo dr', 'congo d r', 'democratic republic of congo', 'congo democratic republic', 'drc', 'cod', 'rd congo', 'republica democratica del congo', 'república democrática del congo'],
  costarica: ['costa rica', 'crc'],
  cotedivoire: ['cote d ivoire', "cote d'ivoire", 'côte d’ivoire', 'côte d ivoire', 'ivory coast', 'costa de marfil', 'civ'],
  croatia: ['croatia', 'croacia', 'hrv'],
  curacao: ['curacao', 'curaçao', 'curazao', 'cuw'],
  czechia: ['czechia', 'czech republic', 'republica checa', 'república checa', 'cze'],
  denmark: ['denmark', 'dinamarca', 'den'],
  ecuador: ['ecuador', 'ecu'],
  egypt: ['egypt', 'egipto', 'egy'],
  elsalvador: ['el salvador', 'salvador', 'slv'],
  england: ['england', 'inglaterra', 'eng'],
  finland: ['finland', 'finlandia', 'fin'],
  france: ['france', 'francia', 'fra'],
  georgia: ['georgia', 'geo'],
  germany: ['germany', 'alemania', 'deutschland', 'ger', 'deu'],
  ghana: ['ghana', 'gha'],
  greece: ['greece', 'grecia', 'gre', 'grc'],
  haiti: ['haiti', 'haití', 'hai', 'hti'],
  honduras: ['honduras', 'hon'],
  hungary: ['hungary', 'hungria', 'hungría', 'hun'],
  iceland: ['iceland', 'islandia', 'isl'],
  indonesia: ['indonesia', 'idn'],
  iran: ['iran', 'ir iran', 'iran islamic republic', 'iran islamic republic of', 'iran republica islamica', 'irn'],
  iraq: ['iraq', 'irak', 'irq'],
  italy: ['italy', 'italia', 'ita'],
  jamaica: ['jamaica', 'jam'],
  japan: ['japan', 'japon', 'japón', 'jpn'],
  jordan: ['jordan', 'jordania', 'jor'],
  mexico: ['mexico', 'méxico', 'mex'],
  morocco: ['morocco', 'marruecos', 'mar'],
  netherlands: ['netherlands', 'holanda', 'paises bajos', 'países bajos', 'ned', 'nld'],
  newzealand: ['new zealand', 'nueva zelanda', 'nzl'],
  nigeria: ['nigeria', 'nga'],
  northkorea: ['north korea', 'dpr korea', 'korea dpr', 'corea del norte', 'prk'],
  norway: ['norway', 'noruega', 'nor'],
  panama: ['panama', 'panamá', 'pan'],
  paraguay: ['paraguay', 'par'],
  peru: ['peru', 'perú', 'per'],
  poland: ['poland', 'polonia', 'pol'],
  portugal: ['portugal', 'por'],
  qatar: ['qatar', 'catar', 'qat'],
  romania: ['romania', 'rumania', 'rou', 'rom'],
  russia: ['russia', 'rusia', 'rus'],
  saudiarabia: ['saudi arabia', 'arabia saudita', 'ksa', 'sau'],
  scotland: ['scotland', 'escocia', 'sco'],
  senegal: ['senegal', 'sen'],
  serbia: ['serbia', 'srb'],
  slovakia: ['slovakia', 'eslovaquia', 'svk'],
  slovenia: ['slovenia', 'eslovenia', 'svn'],
  southafrica: ['south africa', 'sudafrica', 'sudáfrica', 'rsa', 'zaf'],
  southkorea: ['south korea', 'korea republic', 'republic of korea', 'corea del sur', 'kor'],
  spain: ['spain', 'espana', 'españa', 'esp'],
  sweden: ['sweden', 'suecia', 'swe'],
  switzerland: ['switzerland', 'suiza', 'sui', 'che'],
  thailand: ['thailand', 'tailandia', 'tha'],
  tunisia: ['tunisia', 'tunez', 'túnez', 'tun'],
  turkey: ['turkey', 'turkiye', 'türkiye', 'turquia', 'turquía', 'tur'],
  ukraine: ['ukraine', 'ucrania', 'ukr'],
  unitedarabemirates: ['united arab emirates', 'uae', 'u a e', 'emirates', 'emiratos arabes unidos', 'emiratos árabes unidos', 'are'],
  unitedstates: ['united states', 'united states of america', 'usa', 'u s a', 'u.s.a.', 'us', 'u s', 'eeuu', 'ee uu', 'ee.uu.', 'estados unidos'],
  uruguay: ['uruguay', 'uru'],
  uzbekistan: ['uzbekistan', 'uzbekistán', 'uzb'],
  venezuela: ['venezuela', 'ven'],
  wales: ['wales', 'gales', 'wal']
};

const TEAM_CANONICAL_ALIASES = (() => {
  const out = {};
  Object.entries(TEAM_CANONICAL_ALIAS_GROUPS).forEach(function(entry) {
    const teamKey = entry[0];
    entry[1].forEach(function(alias) {
      out[normalizeTeamAliasInput_(alias)] = teamKey;
    });
  });
  return out;
})();

function normalizeTeamAliasInput_(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' and ')
    .replace(/\b(national|team|seleccion|selección|fifa|fc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalTeamNameKey_(name) {
  const normalized = normalizeTeamAliasInput_(name);
  if (!normalized) return '';
  return TEAM_CANONICAL_ALIASES[normalized] || normalized.replace(/[^a-z0-9]/g, '');
}

function canonicalTeamDisplayName_(name) {
  const teamKey = canonicalTeamNameKey_(name);
  return TEAM_CANONICAL_DISPLAY_ES[teamKey] || String(name || '').trim();
}

function teamAliasVariantsFor_(name) {
  const teamKey = canonicalTeamNameKey_(name);
  const variants = new Set();
  if (name) variants.add(String(name).trim());
  if (TEAM_CANONICAL_DISPLAY_ES[teamKey]) variants.add(TEAM_CANONICAL_DISPLAY_ES[teamKey]);
  (TEAM_CANONICAL_ALIAS_GROUPS[teamKey] || []).forEach(function(alias) {
    variants.add(alias);
  });
  return Array.from(variants).filter(Boolean);
}
