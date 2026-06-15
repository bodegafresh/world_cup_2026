/**
 * PipelineHealth.gs
 *
 * Responsabilidad:
 * - Validar salud del Golden Dataset.
 * - Detectar datos incompletos antes de IA, Telegram o dashboards.
 */

function validateGoldenDataset_() {
  const matches = readAll_(CONFIG.SHEETS.PARTIDOS);

  const report = {
    matches: matches.length,
    missingVenue: 0,
    missingCoordinates: 0,
    missingStats: 0,
    singleSource: 0,
    statusConflicts: 0,
    liveOrUnfinished: 0,
    readyForAI: true,
    issues: []
  };

  matches.forEach(match => {
    if (!match.estadio || !match.ciudad || !match.pais_estadio) {
      report.missingVenue += 1;
      report.issues.push(`Venue incompleto: ${match.local} vs ${match.visitante} (${match.match_key})`);
    }

    if (!match.lat || !match.lon || !match.timezone_estadio) {
      report.missingCoordinates += 1;
      report.issues.push(`Coordenadas/timezone faltantes: ${match.local} vs ${match.visitante} (${match.match_key})`);
    }

    if (isFinishedStatus_(match.status) && hasMissingCoreStats_(match)) {
      report.missingStats += 1;
      report.issues.push(`Stats incompletas: ${match.local} vs ${match.visitante} (${match.match_key})`);
    }

    if (Number(match.sources_count || 0) < 2) {
      report.singleSource += 1;
      report.issues.push(`Una sola fuente: ${match.local} vs ${match.visitante} (${match.match_key})`);
    }

    if (String(match.conflict_detail || '').toLowerCase().includes('status')) {
      report.statusConflicts += 1;
      report.issues.push(`Conflicto de status: ${match.local} vs ${match.visitante} (${match.match_key})`);
    }

    if (!isFinishedStatus_(match.status)) {
      report.liveOrUnfinished += 1;
    }
  });

  report.readyForAI =
    report.missingVenue === 0 &&
    report.missingCoordinates === 0 &&
    report.missingStats === 0 &&
    report.statusConflicts === 0;

  return report;
}

function hasMissingCoreStats_(match) {
  const required = [
    'posesion_local',
    'posesion_visitante',
    'tiros_local',
    'tiros_visitante',
    'corners_local',
    'corners_visitante',
    'faltas_local',
    'faltas_visitante',
    'amarillas_local',
    'amarillas_visitante',
    'rojas_local',
    'rojas_visitante'
  ];

  return required.some(field => {
    return match[field] === '' || match[field] === null || match[field] === undefined;
  });
}

function isFinishedStatus_(status) {
  return ['FT', 'AET', 'PEN'].includes(String(status || '').toUpperCase());
}

function manualValidateGoldenDataset() {
  const report = validateGoldenDataset_();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}