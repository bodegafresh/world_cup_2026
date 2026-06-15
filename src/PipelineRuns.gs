/**
 * PipelineRuns.gs
 *
 * Responsabilidad:
 * - Registrar corridas del pipeline en la hoja PipelineRuns.
 * - Permitir auditoría: qué corrió, cuándo, qué falló y cuántos registros cargó.
 */

function createPipelineRun_(input) {
  const startedAt = nowChile_();

  return {
    run_id: hash_(`${input.mode}_${input.date_from}_${input.date_to}_${startedAt}`),
    started_at: startedAt,
    finished_at: '',
    mode: input.mode || '',
    date_from: input.date_from || '',
    date_to: input.date_to || '',
    step: input.step || '',
    status: 'STARTED',
    api_football_count: '',
    football_data_count: '',
    golden_count: '',
    enriched_count: '',
    teams_count: '',
    players_count: '',
    errors: '',
    notes: input.notes || ''
  };
}

function finishPipelineRun_(run, patch) {
  const finalRun = Object.assign({}, run, patch || {}, {
    finished_at: nowChile_()
  });

  appendPipelineRun_(finalRun);

  return finalRun;
}

function appendPipelineRun_(run) {
  appendRows_(CONFIG.SHEETS.PIPELINE_RUNS, [[
    safe_(run.run_id),
    safe_(run.started_at),
    safe_(run.finished_at),
    safe_(run.mode),
    safe_(run.date_from),
    safe_(run.date_to),
    safe_(run.step),
    safe_(run.status),
    safe_(run.api_football_count),
    safe_(run.football_data_count),
    safe_(run.golden_count),
    safe_(run.enriched_count),
    safe_(run.teams_count),
    safe_(run.players_count),
    safe_(run.errors),
    safe_(run.notes)
  ]]);
}