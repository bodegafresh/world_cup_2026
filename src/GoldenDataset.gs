/**
 * GoldenDataset.gs
 *
 * Responsabilidad:
 * - Orquestar la construcción del Golden Dataset de partidos.
 * - Tomar datos desde API-Football y football-data.org.
 * - Guardar raw JSON en Drive.
 * - Guardar staging normalizado en SourceFixtures.
 * - Crear mapping entre fuentes.
 * - Evaluar calidad/conflictos.
 * - Escribir/actualizar la hoja Partidos como dataset final curado.
 */

function loadGoldenMatchesByDate_(date) {
  const apiFootballData = fetchWorldCupFixturesByDate_(date);

  if (apiFootballData.errors && Object.keys(apiFootballData.errors).length > 0) {
    throw new Error('API-Football devolvió errores: ' + JSON.stringify(apiFootballData.errors));
  }

  const apiFootballRawUrl = saveRawJson_(
    `raw/api-football/fixtures/${date}`,
    `api-football-worldcup-fixtures-${date}.json`,
    apiFootballData
  );

  const footballData = fetchFootballDataMatchesByDateWithFallback_(date);

  Logger.log(`football-data.org status para ${date}: ${footballData.source_status || 'SIN_STATUS'}`);
  Logger.log(`football-data.org matches para ${date}: ${(footballData.matches || []).length}`);

  const footballDataRawUrl = saveRawJson_(
    `raw/football-data/matches/${date}`,
    `football-data-worldcup-matches-${date}.json`,
    footballData
  );

  const apiFixturesWrapped = (apiFootballData.response || []).map(fixture => ({
    fixture_raw: fixture,
    raw_file_url: apiFootballRawUrl
  }));

  const fdMatchesWrapped = (footballData.matches || []).map(match => ({
    match_raw: match,
    raw_file_url: footballDataRawUrl
  }));

  const mappings = matchSourcesByDate_(apiFixturesWrapped, fdMatchesWrapped);
  const qualityResults = mappings.map(evaluateMatchQuality_);

  saveSourceFixtures_(apiFixturesWrapped, fdMatchesWrapped);
  saveMatchMappings_(mappings);
  saveDataQualityChecks_(qualityResults);

  const goldenRows = mappings.map((mapping, index) => {
    const quality = qualityResults[index];
    return buildGoldenMatchObject_(mapping, quality);
  });

  upsertGoldenMatches_(goldenRows);

  return {
    date: date,
    apiFootballCount: apiFixturesWrapped.length,
    footballDataCount: fdMatchesWrapped.length,
    footballDataStatus: footballData.source_status || '',
    goldenCount: goldenRows.length,
    conflicts: qualityResults.filter(q => q.has_conflict).length
  };
}

function buildGoldenMatchObject_(mapping, quality) {
  const af = mapping.api_football;
  const fd = mapping.football_data;

  const venueName = af.venue_name || (fd && fd.venue_name) || '';
  const venueCity = af.venue_city || (fd && fd.venue_city) || '';
  const venueInfo = getVenueInfo_(venueName, venueCity);

  const homeScore = selectScore_(af.home_score, fd && fd.home_score);
  const awayScore = selectScore_(af.away_score, fd && fd.away_score);

  const status = selectStatus_(af.status, fd && fd.status);
  const winner = selectWinner_(af.winner, fd && fd.winner);

  const sourcesUsed = fd ? 'API_FOOTBALL,FOOTBALL_DATA' : 'API_FOOTBALL';
  const sourcesCount = fd ? 2 : 1;

  const dataQualityNotes = buildDataQualityNotes_(mapping, quality, venueInfo);

  return {
    match_id: af.source_match_id,

    fecha: String(af.date_utc || '').substring(0, 10),
    fecha_chile: String(af.date_chile || '').substring(0, 10),
    hora_chile: af.date_chile,

    fase: af.stage || (fd && fd.stage) || '',
    local: af.home_team_name || (fd && fd.home_team_name) || '',
    visitante: af.away_team_name || (fd && fd.away_team_name) || '',

    estadio: venueName,
    ciudad: venueCity,

    // pais ahora representa el país real del estadio.
    pais: venueInfo.pais_estadio || '',

    // país de la competición.
    pais_torneo: 'World',

    // datos reales de sede.
    pais_estadio: venueInfo.pais_estadio || '',
    venue_id: af.venue_id || '',
    lat: venueInfo.lat,
    lon: venueInfo.lon,
    timezone_estadio: venueInfo.timezone_estadio,

    goles_local: homeScore,
    goles_visitante: awayScore,

    posesion_local: '',
    posesion_visitante: '',
    tiros_local: '',
    tiros_visitante: '',
    xg_local: '',
    xg_visitante: '',
    corners_local: '',
    corners_visitante: '',
    faltas_local: '',
    faltas_visitante: '',
    amarillas_local: '',
    amarillas_visitante: '',
    rojas_local: '',
    rojas_visitante: '',

    fuente: sourcesUsed,

    match_key: mapping.match_key,
    fixture_id_api_football: af.source_match_id,
    match_id_football_data: fd ? fd.source_match_id : '',

    sources_used: sourcesUsed,
    sources_count: sourcesCount,
    confidence_score: quality.confidence_score,
    has_conflict: quality.has_conflict,
    conflict_detail: quality.conflict_detail,

    golden_source_score: buildGoldenSourceScore_(fd),
    last_validated_at: nowChile_(),

    status: status,
    winner: winner,
    data_quality_notes: dataQualityNotes
  };
}

function upsertGoldenMatches_(goldenRows) {
  if (!goldenRows || goldenRows.length === 0) return;

  const sheet = getSheet_(CONFIG.SHEETS.PARTIDOS);
  const values = sheet.getDataRange().getValues();

  if (values.length === 0) {
    throw new Error('La hoja Partidos no tiene headers');
  }

  const headers = values[0];
  const matchKeyIndex = headers.indexOf('match_key');

  if (matchKeyIndex === -1) {
    throw new Error('La hoja Partidos necesita columna match_key');
  }

  const existingRowByMatchKey = {};

  values.slice(1).forEach((row, i) => {
    const key = row[matchKeyIndex];
    if (key) existingRowByMatchKey[String(key)] = i + 2;
  });

  goldenRows.forEach(goldenObject => {
    const row = headers.map(header => safe_(goldenObject[header]));

    if (existingRowByMatchKey[goldenObject.match_key]) {
      sheet
        .getRange(existingRowByMatchKey[goldenObject.match_key], 1, 1, row.length)
        .setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

function buildDataQualityNotes_(mapping, quality, venueInfo) {
  const notes = [];
  const fd = mapping.football_data;

  if (!fd) {
    notes.push('Dato construido solo con API-Football. football-data.org no disponible o no matcheado para esta fecha/partido. Usar con confianza media.');
  } else if (quality.has_conflict) {
    notes.push(`Dato con doble fuente, pero existen diferencias: ${quality.conflict_detail}`);
  } else {
    notes.push('Dato validado con API-Football y football-data.org sin conflictos relevantes.');
  }

  if (!venueInfo || !venueInfo.pais_estadio) {
    notes.push('Venue no encontrado en VenueCatalog. Falta completar país/coordenadas/timezone.');
  } else {
    notes.push('Venue enriquecido desde VenueCatalog.');
  }

  return notes.join(' | ');
}

function buildGoldenSourceScore_(hasFootballData) {
  if (hasFootballData) {
    return [
      'score: API_FOOTBALL validado con FOOTBALL_DATA',
      'venue: API_FOOTBALL + VenueCatalog',
      'status: API_FOOTBALL fallback FOOTBALL_DATA',
      'teams: API_FOOTBALL validado con FOOTBALL_DATA'
    ].join(' | ');
  }

  return [
    'score: API_FOOTBALL',
    'venue: API_FOOTBALL + VenueCatalog',
    'status: API_FOOTBALL',
    'teams: API_FOOTBALL',
    'validation: sin fuente secundaria'
  ].join(' | ');
}

function selectWinner_(apiFootballWinner, footballDataWinner) {
  if (apiFootballWinner) return apiFootballWinner;
  if (footballDataWinner) return footballDataWinner;
  return '';
}