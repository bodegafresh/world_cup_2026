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

/**
 * Normaliza un valor fecha leído de Google Sheets a 'yyyy-MM-dd'.
 * getValues() devuelve un Date object cuando la celda tiene formato fecha;
 * también acepta strings ISO ya bien formateados.
 */
function normalizeFecha_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  // String ISO "2026-06-13T..." o "2026-06-13" → tomar primeros 10 chars
  return String(val).substring(0, 10);
}

/**
 * Normaliza un valor hora leído de Google Sheets a 'HH:mm'.
 * GAS devuelve Date objects con fecha 1899-12-30 cuando la celda tiene solo hora.
 */
function normalizeHora_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, 'HH:mm');
  }
  return String(val).substring(0, 5);
}

/**
 * Diccionario de nombres de selecciones EN → ES y ES → EN.
 * Permite buscar equipos con nombres en español aunque estén guardados en inglés.
 */
const TEAM_NAMES_ES = {
  // EN → ES
  'brazil':         'Brasil',
  'france':         'Francia',
  'germany':        'Alemania',
  'spain':          'España',
  'italy':          'Italia',
  'england':        'Inglaterra',
  'netherlands':    'Países Bajos',
  'belgium':        'Bélgica',
  'portugal':       'Portugal',
  'argentina':      'Argentina',
  'uruguay':        'Uruguay',
  'mexico':         'México',
  'colombia':       'Colombia',
  'chile':          'Chile',
  'peru':           'Perú',
  'ecuador':        'Ecuador',
  'paraguay':       'Paraguay',
  'bolivia':        'Bolivia',
  'venezuela':      'Venezuela',
  'united states':  'EE.UU.',
  'usa':            'EE.UU.',
  'canada':         'Canadá',
  'haiti':          'Haití',
  'honduras':       'Honduras',
  'costa rica':     'Costa Rica',
  'panama':         'Panamá',
  'jamaica':        'Jamaica',
  'el salvador':    'El Salvador',
  'curaçao':        'Curazao',
  'switzerland':    'Suiza',
  'denmark':        'Dinamarca',
  'sweden':         'Suecia',
  'norway':         'Noruega',
  'finland':        'Finlandia',
  'austria':        'Austria',
  'poland':         'Polonia',
  'croatia':        'Croacia',
  'serbia':         'Serbia',
  'scotland':       'Escocia',
  'wales':          'Gales',
  'romania':        'Rumania',
  'hungary':        'Hungría',
  'slovakia':       'Eslovaquia',
  'slovenia':       'Eslovenia',
  'albania':        'Albania',
  'turkey':         'Turquía',
  'türkiye':        'Turquía',
  'ukraine':        'Ucrania',
  'czech republic': 'República Checa',
  'greece':         'Grecia',
  'iceland':        'Islandia',
  'georgia':        'Georgia',
  'russia':         'Rusia',
  'japan':          'Japón',
  'south korea':    'Corea del Sur',
  'korea republic': 'Corea del Sur',
  'china':          'China',
  'iran':           'Irán',
  'saudi arabia':   'Arabia Saudita',
  'australia':      'Australia',
  'new zealand':    'Nueva Zelanda',
  'indonesia':      'Indonesia',
  'thailand':       'Tailandia',
  'iraq':           'Irak',
  'qatar':          'Catar',
  'morocco':        'Marruecos',
  'senegal':        'Senegal',
  'nigeria':        'Nigeria',
  'egypt':          'Egipto',
  'algeria':        'Argelia',
  'tunisia':        'Túnez',
  'cameroon':       'Camerún',
  'ghana':          'Ghana',
  "ivory coast":    'Costa de Marfil',
  'dr congo':       'Congo DR',
  'mali':           'Mali',
};

// ES → EN (inverso automático + aliases manuales)
const TEAM_NAMES_EN = (() => {
  const inv = {};
  Object.entries(TEAM_NAMES_ES).forEach(([en, es]) => {
    inv[es.toLowerCase()] = en;
  });
  // aliases adicionales
  const extra = {
    'brasil':           'brazil',
    'alemania':         'germany',
    'españa':           'spain',
    'francia':          'france',
    'holanda':          'netherlands',
    'paises bajos':     'netherlands',
    'países bajos':     'netherlands',
    'belgica':          'belgium',
    'bélgica':          'belgium',
    'corea':            'south korea',
    'corea del sur':    'south korea',
    'turquia':          'turkey',
    'turquía':          'turkey',
    'suiza':            'switzerland',
    'noruega':          'norway',
    'suecia':           'sweden',
    'dinamarca':        'denmark',
    'polonia':          'poland',
    'croacia':          'croatia',
    'escocia':          'scotland',
    'gales':            'wales',
    'rumania':          'romania',
    'hungria':          'hungary',
    'eslovaquia':       'slovakia',
    'eslovenia':        'slovenia',
    'grecia':           'greece',
    'islandia':         'iceland',
    'ucrania':          'ukraine',
    'republica checa':  'czech republic',
    'república checa':  'czech republic',
    'japon':            'japan',
    'japón':            'japan',
    'iran':             'iran',
    'irak':             'iraq',
    'arabe saudita':    'saudi arabia',
    'arabia saudita':   'saudi arabia',
    'arabia saudí':     'saudi arabia',
    'nueva zelanda':    'new zealand',
    'tailandia':        'thailand',
    'catar':            'qatar',
    'marruecos':        'morocco',
    'argelia':          'algeria',
    'tunez':            'tunisia',
    'túnez':            'tunisia',
    'camerun':          'cameroon',
    'camerún':          'cameroon',
    'costa de marfil':  'ivory coast',
    'eeuu':             'united states',
    'ee.uu.':           'united states',
    'estados unidos':   'united states',
    'usa':              'united states',
    'canada':           'canada',
    'haití':            'haiti',
    'haiti':            'haiti',
    'panamá':           'panama',
    'panama':           'panama',
    'méxico':           'mexico',
    'perú':             'peru',
    'peru':             'peru',
  };
  return { ...inv, ...extra };
})();

/**
 * Traduce nombre de selección al español para mostrar.
 * Si no hay traducción conocida, devuelve el nombre original.
 */
function teamNameToSpanish_(name) {
  if (!name) return '';
  const key = String(name).toLowerCase().trim();
  return TEAM_NAMES_ES[key] || name;
}

/**
 * Convierte un nombre de búsqueda (posiblemente en español) al inglés
 * usado en las hojas de datos. Útil para búsquedas desde el bot.
 * Devuelve array con todas las variantes a buscar.
 */
function teamSearchTerms_(query) {
  const q = String(query || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').trim();

  const terms = new Set([q]);

  // Si hay traducción ES→EN, agregar la versión en inglés
  if (TEAM_NAMES_EN[q]) terms.add(TEAM_NAMES_EN[q]);

  // Si hay traducción EN→ES, agregar la versión en español
  const esName = (TEAM_NAMES_ES[q] || '').toLowerCase();
  if (esName) terms.add(esName);

  return [...terms];
}

function addDaysToDateString_(dateString, days) {
  const parts = String(dateString).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days);

  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}