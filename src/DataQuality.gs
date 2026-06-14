function evaluateMatchQuality_(mapping) {
  const af = mapping.api_football;
  const fd = mapping.football_data;

  const checks = [];

  if (!fd) {
    checks.push({
        check_type: 'SOURCE_UNAVAILABLE',
        field_name: 'football_data_match',
        api_football_value: af.source_match_id,
        football_data_value: '',
        selected_value: af.source_match_id,
        severity: 'INFO',
        confidence: 0.7,
        resolution: 'football-data.org no entregó match para esta fecha; probablemente por ventana del plan gratis o falta de cobertura por rango'
  });

  return {
    match_key: mapping.match_key,
    checks,
    confidence_score: 0.7,
    has_conflict: false,
    conflict_detail: ''
  };
}

  compareField_(checks, 'home_team_name', af.home_team_name, fd.home_team_name, af.home_team_name);
  compareField_(checks, 'away_team_name', af.away_team_name, fd.away_team_name, af.away_team_name);
  compareField_(checks, 'status', af.status, fd.status, selectStatus_(af.status, fd.status));
  compareField_(checks, 'home_score', af.home_score, fd.home_score, selectScore_(af.home_score, fd.home_score));
  compareField_(checks, 'away_score', af.away_score, fd.away_score, selectScore_(af.away_score, fd.away_score));
  compareField_(checks, 'date_utc', af.date_utc, fd.date_utc, selectDate_(af.date_utc, fd.date_utc));

  const conflicts = checks.filter(c => c.severity !== 'OK');

  return {
    match_key: mapping.match_key,
    checks,
    confidence_score: calculateConfidenceScore_(mapping, conflicts),
    has_conflict: conflicts.length > 0,
    conflict_detail: conflicts.map(c => `${c.field_name}: ${c.api_football_value} vs ${c.football_data_value}`).join(' | ')
  };
}

function compareField_(checks, fieldName, afValue, fdValue, selectedValue) {
  const normalizedAf = String(afValue || '').trim();
  const normalizedFd = String(fdValue || '').trim();

  const same = normalizedAf === normalizedFd ||
    normalizeTeamNameStrong_(normalizedAf) === normalizeTeamNameStrong_(normalizedFd);

  checks.push({
    check_type: same ? 'MATCH' : 'CONFLICT',
    field_name: fieldName,
    api_football_value: afValue,
    football_data_value: fdValue,
    selected_value: selectedValue,
    severity: same ? 'OK' : 'LOW',
    confidence: same ? 1 : 0.75,
    resolution: same ? 'Coincide entre fuentes' : 'Se seleccionó valor por regla de prioridad'
  });
}

function selectStatus_(apiFootballStatus, footballDataStatus) {
  if (apiFootballStatus) return apiFootballStatus;
  return footballDataStatus || '';
}

function selectScore_(apiFootballScore, footballDataScore) {
  if (apiFootballScore !== '' && apiFootballScore !== null && apiFootballScore !== undefined) {
    return apiFootballScore;
  }

  return footballDataScore;
}

function selectDate_(apiFootballDate, footballDataDate) {
  return apiFootballDate || footballDataDate || '';
}

function calculateConfidenceScore_(mapping, conflicts) {
  let score = mapping.confidence || 0.75;

  conflicts.forEach(c => {
    if (String(c.field_name).includes('score')) score -= 0.15;
    else if (c.field_name === 'status') score -= 0.08;
    else score -= 0.05;
  });

  return Math.max(0.1, Math.min(1, score));
}

function saveDataQualityChecks_(qualityResults) {
  const rows = [];

  qualityResults.forEach(q => {
    q.checks.forEach(c => {
      rows.push([
        hash_(`${q.match_key}_${c.field_name}_${nowChile_()}`),
        q.match_key,
        c.check_type,
        c.field_name,
        safe_(c.api_football_value),
        safe_(c.football_data_value),
        safe_(c.selected_value),
        c.severity,
        c.confidence,
        c.resolution,
        nowChile_()
      ]);
    });
  });

  appendRows_(CONFIG.SHEETS.DATA_QUALITY_LOG, rows);
}