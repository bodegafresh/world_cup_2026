function footballDataGet_(path, params) {
  const query = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = `${CONFIG.FOOTBALL_DATA.BASE_URL}${path}${query ? '?' + query : ''}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'X-Auth-Token': getFootballDataKey_()
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`football-data.org error ${status}: ${text}`);
  }

  return JSON.parse(text);
}

function fetchFootballDataMatch_(matchId) {
  return footballDataGet_(`/matches/${matchId}`, {});
}

function fetchFootballDataWorldCupMatches_() {
  return footballDataGet_(`/competitions/${CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE}/matches`, {
    season: CONFIG.FOOTBALL_DATA.SEASON
  });
}

function fetchFootballDataMatchesByDate_(dateFrom, dateTo) {
  const data = footballDataGet_('/matches', {
    dateFrom: dateFrom,
    dateTo: dateTo
  });

  const matches = (data.matches || []).filter(match => {
    return match.competition &&
      match.competition.code === CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE;
  });

  data.matches = matches;

  if (data.resultSet) {
    data.resultSet.count = matches.length;
    data.resultSet.competitions = CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE;
  }

  return data;
}

function fetchFootballDataMatchesByDateWithFallback_(date) {
  const dateTo = addDaysToDateString_(date, 1);

  const data = fetchFootballDataMatchesByDate_(date, dateTo);

  const matchesForDate = (data.matches || []).filter(match => {
    return String(match.utcDate || '').substring(0, 10) === date;
  });

  data.matches = matchesForDate;

  if (data.resultSet) {
    data.resultSet.count = matchesForDate.length;
  }

  if (data.matches && data.matches.length > 0) {
    data.source_status = 'OK_BY_DATE_WINDOW_PLUS_LOCAL_FILTER';
    return data;
  }

  const fallbackIds = getFootballDataFallbackMatchIdsByDate_(date);

  if (!fallbackIds.length) {
    data.source_status = 'EMPTY_BY_DATE_OR_FREE_PLAN_WINDOW';
    return data;
  }

  const matches = fallbackIds.map(id => fetchFootballDataMatch_(id));

  return {
    filters: {
      dateFrom: date,
      dateTo: dateTo,
      competitions: CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE,
      fallback: true
    },
    resultSet: {
      count: matches.length
    },
    matches: matches,
    source_status: 'OK_BY_MANUAL_FALLBACK_IDS'
  };
}

function getFootballDataFallbackMatchIdsByDate_(date) {
  const fallback = {
    '2026-06-12': [537328]
  };

  return fallback[date] || [];
}

function fetchFootballDataMatchesByDateWithFallback_(date) {
  const dateTo = addDaysToDateString_(date, 1);

  const data = fetchFootballDataMatchesByDate_(date, dateTo);

  const matchesForWindow = data.matches || [];
  data.matches = matchesForWindow;

  if (data.resultSet) {
    data.resultSet.count = matchesForWindow.length;
  }

  if (data.matches && data.matches.length > 0) {
    data.source_status = 'OK_BY_DATE_WINDOW_NO_DATE_FILTER';
    return data;
  }

  const fallbackIds = getFootballDataFallbackMatchIdsByDate_(date);

  if (!fallbackIds.length) {
    data.source_status = 'EMPTY_BY_DATE_OR_FREE_PLAN_WINDOW';
    return data;
  }

  const matches = fallbackIds.map(id => fetchFootballDataMatch_(id));

  return {
    filters: {
      dateFrom: date,
      dateTo: dateTo,
      competitions: CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE,
      fallback: true
    },
    resultSet: {
      count: matches.length
    },
    matches: matches,
    source_status: 'OK_BY_MANUAL_FALLBACK_IDS'
  };
}

function getFootballDataFallbackMatchIdsByDate_(date) {
  const fallback = {
    // Estos IDs son opcionales y solo sirven si ya los descubriste antes.
    // No dependas de esto para todos los partidos.
    '2026-06-12': [537328]
  };

  return fallback[date] || [];
}