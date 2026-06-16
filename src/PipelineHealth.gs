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

/**
 * Ejecuta una función de cron envuelta en manejo de errores.
 * Si falla, registra en PipelineRuns y envía alerta a Telegram.
 *
 * @param {string} jobName - Nombre del job para el log
 * @param {Function} fn - Función a ejecutar
 */
function runWithHealthCheck_(jobName, fn) {
  const runId = Utilities.getUuid();
  const startedAt = nowChile_();
  let status = 'OK';
  let errorMsg = '';
  let recordsProcessed = 0;

  try {
    const result = fn();
    if (result && result.records) recordsProcessed = result.records;
  } catch (e) {
    status = 'ERROR';
    errorMsg = e.message;
    console.error(`[${jobName}] ERROR: ${e.message}`);

    try {
      sendPipelineAlert_(jobName, e.message);
    } catch (alertErr) {
      console.warn('No se pudo enviar alerta Telegram:', alertErr.message);
    }
  }

  try {
    appendRows_(CONFIG.SHEETS.PIPELINE_RUNS, [[
      runId,
      jobName,
      startedAt,
      nowChile_(),
      status,
      recordsProcessed,
      errorMsg ? 1 : 0,
      errorMsg
    ]]);
  } catch (logErr) {
    console.warn('No se pudo guardar en PipelineRuns:', logErr.message);
  }

  return status;
}

/**
 * Envía alerta de fallo de pipeline al chat de Telegram.
 */
function sendPipelineAlert_(jobName, errorMessage) {
  const token = getTelegramBotToken_();
  const chatId = getTelegramChatId_();
  const url = `${CONFIG.TELEGRAM.BASE_URL}${token}/sendMessage`;

  const text = [
    `⚠️ <b>Pipeline Error — Mundial 2026</b>`,
    `Job: <code>${jobName}</code>`,
    `Hora: ${nowChile_()}`,
    `Error: <code>${String(errorMessage).substring(0, 300)}</code>`
  ].join('\n');

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    }),
    muteHttpExceptions: true
  });
}

/**
 * Verifica que los jobs clave se ejecutaron hoy.
 * Llama desde un trigger manual o desde el cron de mañana.
 */
function checkDailyJobsRanToday_() {
  const today = todayChile_();
  const runs = readAll_(CONFIG.SHEETS.PIPELINE_RUNS);

  const todayRuns = runs.filter(r => String(r.started_at || '').startsWith(today));
  const jobNames = todayRuns.map(r => r.job_name);

  const required = ['cronDailyLoadTodayStats', 'cronTomorrowPreview'];
  const missing = required.filter(j => !jobNames.includes(j));

  if (missing.length) {
    try {
      sendPipelineAlert_('checkDailyJobsRanToday_', `Jobs no ejecutados hoy: ${missing.join(', ')}`);
    } catch (e) {
      console.warn('checkDailyJobsRanToday_ alert failed:', e.message);
    }
  }

  return { missing, today };
}