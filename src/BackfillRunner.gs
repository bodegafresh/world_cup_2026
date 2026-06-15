/**
 * BackfillRunner.gs
 *
 * Responsabilidad:
 * - Ejecutar cargas manuales por rango de fechas.
 * - Cargar Golden Dataset por día UTC.
 * - Enriquecer partidos por fecha_chile.
 * - Tolerar restricciones de planes gratuitos.
 * - Registrar auditoría en PipelineRuns.
 */

function backfillWorldCupRange_(dateFrom, dateTo, options) {
  const config = Object.assign({
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  }, options || {});

  const run = createPipelineRun_({
    mode: 'BACKFILL',
    date_from: dateFrom,
    date_to: dateTo,
    step: 'backfillWorldCupRange_',
    notes: JSON.stringify(config)
  });

  const dates = buildDateRange_(dateFrom, dateTo);
  const results = [];

  let apiFootballCount = 0;
  let footballDataCount = 0;
  let goldenCount = 0;
  let enrichedCount = 0;
  let teamsCount = 0;
  let playersCount = 0;
  const errors = [];

  dates.forEach(date => {
    const dayResult = {
      date: date,
      golden: null,
      enrichChileDates: [],
      error: ''
    };

    try {
      Logger.log(`BACKFILL golden date=${date}`);

      const goldenResult = loadGoldenMatchesByDate_(date);
      dayResult.golden = goldenResult;

      apiFootballCount += Number(goldenResult.apiFootballCount || 0);
      footballDataCount += Number(goldenResult.footballDataCount || 0);
      goldenCount += Number(goldenResult.goldenCount || 0);

      if (config.enrichMatches) {
        const chileDates = getChileDatesToEnrichForUtcDate_(date);

        chileDates.forEach(chileDate => {
          try {
            Logger.log(`BACKFILL enrich fecha_chile=${chileDate}`);

            const enrichResult = enrichGoldenMatchesByDate_(chileDate);
            dayResult.enrichChileDates.push(enrichResult);

            enrichedCount += Number(enrichResult.matches || 0);

            Utilities.sleep(config.sleepMs);
          } catch (e) {
            const msg = `enrich ${chileDate}: ${e.message}`;
            errors.push(msg);

            dayResult.enrichChileDates.push({
              fecha_chile: chileDate,
              status: 'ERROR',
              error: e.message
            });
          }
        });
      }

      Utilities.sleep(config.sleepMs);
    } catch (e) {
      const msg = `golden ${date}: ${e.message}`;
      Logger.log(`Error backfill date=${date}: ${e.message}`);
      errors.push(msg);
      dayResult.error = e.message;
    }

    results.push(dayResult);
  });

  if (config.loadTeams) {
    try {
      Logger.log('BACKFILL loadTeamsFromCurrentData_');

      const teamsResult = loadTeamsFromCurrentData_();
      teamsCount += Number(teamsResult.teams || 0);

      results.push({
        step: 'loadTeamsFromCurrentData_',
        result: teamsResult
      });
    } catch (e) {
      errors.push(`loadTeamsFromCurrentData_: ${e.message}`);

      results.push({
        step: 'loadTeamsFromCurrentData_',
        error: e.message
      });
    }
  }

  if (config.loadSquads) {
    try {
      Logger.log('BACKFILL loadSquadsForKnownTeams_');

      const squadsResult = loadSquadsForKnownTeams_();
      playersCount += Number(squadsResult.players || 0);

      results.push({
        step: 'loadSquadsForKnownTeams_',
        result: squadsResult
      });
    } catch (e) {
      errors.push(`loadSquadsForKnownTeams_: ${e.message}`);

      results.push({
        step: 'loadSquadsForKnownTeams_',
        error: e.message
      });
    }
  }

  const health = validateGoldenDataset_();

  finishPipelineRun_(run, {
    status: errors.length ? 'PARTIAL_OK' : 'OK',
    api_football_count: apiFootballCount,
    football_data_count: footballDataCount,
    golden_count: goldenCount,
    enriched_count: enrichedCount,
    teams_count: teamsCount,
    players_count: playersCount,
    errors: errors.join(' | '),
    notes: JSON.stringify({
      health: health,
      config: config
    })
  });

  Logger.log(JSON.stringify(results, null, 2));
  Logger.log('HEALTH: ' + JSON.stringify(health, null, 2));

  return {
    results: results,
    health: health,
    errors: errors
  };
}

function buildDateRange_(dateFrom, dateTo) {
  const dates = [];

  const start = parseYyyyMmDdAsUtcDate_(dateFrom);
  const end = parseYyyyMmDdAsUtcDate_(dateTo);

  let cursor = new Date(start.getTime());

  while (cursor.getTime() <= end.getTime()) {
    dates.push(Utilities.formatDate(cursor, 'UTC', 'yyyy-MM-dd'));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function parseYyyyMmDdAsUtcDate_(dateString) {
  const parts = String(dateString).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function getChileDatesToEnrichForUtcDate_(dateUtc) {
  const d = parseYyyyMmDdAsUtcDate_(dateUtc);

  const previous = new Date(d.getTime());
  previous.setUTCDate(previous.getUTCDate() - 1);

  return [
    Utilities.formatDate(previous, 'UTC', 'yyyy-MM-dd'),
    Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')
  ];
}