/**
 * DataQualityAudit.gs
 *
 * Auditoria operacional diaria. No llama APIs externas.
 * Detecta inconsistencias antes de migrar/activar Supabase primary-read.
 */

function runDailyDataQualityAudit() {
  const findings = [];
  auditMatchesQuality_(findings);
  auditPlayerStatsQuality_(findings);
  auditEvQuality_(findings);
  auditModelOutputQuality_(findings);
  saveDailyDataQualityFindings_(findings);
  Logger.log('runDailyDataQualityAudit: ' + findings.length + ' hallazgo(s)');
  return {
    findings: findings.length,
    p1: findings.filter(function(f) { return f.severity === 'P1'; }).length,
    p2: findings.filter(function(f) { return f.severity === 'P2'; }).length,
    ok: findings.filter(function(f) { return f.severity === 'OK'; }).length
  };
}

function auditMatchesQuality_(findings) {
  const matches = readAllFromSheet_(CONFIG.SHEETS.PARTIDOS);
  const seenMatchIds = {};
  const seenLogical = {};

  matches.forEach(function(r) {
    const matchId = ensureMatchIdFromRow_(r);
    const logicalKey = buildCanonicalMatchId_(r.fecha || r.fecha_chile, r.local, r.visitante);
    const status = String(r.status || r.estado || '').toUpperCase();

    if (!matchId) {
      addDailyFinding_(findings, logicalKey || '', 'MATCH_ID_MISSING', 'match_id', '', '', '', 'P1', 0.2, 'Completar match_id canonico');
    } else if (seenMatchIds[matchId]) {
      addDailyFinding_(findings, matchId, 'MATCH_ID_DUPLICATED', 'match_id', matchId, '', '', 'P1', 0.2, 'Deduplicar Partidos por match_id');
    }
    if (matchId) seenMatchIds[matchId] = true;

    if (logicalKey && seenLogical[logicalKey]) {
      addDailyFinding_(findings, logicalKey, 'MATCH_LOGICAL_DUPLICATED', 'fecha_local_visitante', logicalKey, '', '', 'P1', 0.3, 'Deduplicar Partidos por fecha/local/visitante');
    }
    if (logicalKey) seenLogical[logicalKey] = true;

    if (['FT','AET','PEN'].indexOf(status) !== -1) {
      if (!hasScore_(r.goles_local) || !hasScore_(r.goles_visitante)) {
        addDailyFinding_(findings, matchId || logicalKey, 'FINAL_WITHOUT_SCORE', 'status_score', status, '', '', 'P1', 0.4, 'Completar marcador final antes de calcular standings/modelos');
      }
    }

    if (String(r.match_key || '').indexOf('objectobject') !== -1) {
      addDailyFinding_(findings, matchId || logicalKey, 'CORRUPT_MATCH_KEY', 'match_key', r.match_key, '', '', 'P1', 0.2, 'Regenerar match_key desde fecha/local/visitante');
    }
  });
}

function auditPlayerStatsQuality_(findings) {
  const matches = readAllFromSheet_(CONFIG.SHEETS.PARTIDOS);
  const stats = readAllFromSheet_(CONFIG.SHEETS.PLAYER_MATCH_STATS);
  const playedByTeam = {};
  const matchTeams = {};

  matches.forEach(function(r) {
    const status = String(r.status || r.estado || '').toUpperCase();
    if (['FT','AET','PEN'].indexOf(status) === -1) return;
    const matchId = ensureMatchIdFromRow_(r);
    const local = canonicalTeamKey_(r.local);
    const away = canonicalTeamKey_(r.visitante);
    if (local) playedByTeam[local] = (playedByTeam[local] || 0) + 1;
    if (away) playedByTeam[away] = (playedByTeam[away] || 0) + 1;
    if (matchId) matchTeams[matchId] = [local, away];
  });

  const playerMatches = {};
  stats.forEach(function(r) {
    const matchId = ensureMatchIdFromRow_(r);
    const team = canonicalTeamKey_(r.team_name || r.equipo);
    const player = canonicalPlayerKey_(r.player_name || r.jugador, r.team_name || r.equipo, r.player_id || r.jugador_id);
    if (!matchId || !player) return;
    const key = player + '|' + matchId;
    if (playerMatches[key]) {
      addDailyFinding_(findings, matchId, 'PLAYER_STATS_DUPLICATED', 'player_match', player, '', '', 'P1', 0.2, 'Deduplicar PlayerMatchStats por match_id + player_id');
    }
    playerMatches[key] = true;

    if (matchTeams[matchId] && team && matchTeams[matchId].indexOf(team) === -1) {
      addDailyFinding_(findings, matchId, 'PLAYER_STATS_TEAM_MISMATCH', 'team_name', team, matchTeams[matchId].join('|'), '', 'P1', 0.3, 'Revisar mapeo de fixture/team antes de agregar estadisticas');
    }
  });

  const summaryRows = readAllFromSheet_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);
  const playerCountByTeam = {};
  summaryRows.forEach(function(r) {
    const team = canonicalTeamKey_(r.equipo || r.team_name);
    const player = canonicalPlayerKey_(r.jugador || r.player_name, r.equipo || r.team_name, r.jugador_id || r.player_id);
    if (!team || !player) return;
    const key = team + '|' + player;
    playerCountByTeam[key] = (playerCountByTeam[key] || 0) + 1;
    if (playedByTeam[team] !== undefined && playerCountByTeam[key] > playedByTeam[team]) {
      addDailyFinding_(findings, key, 'PLAYER_APPEARANCES_GT_TEAM_MATCHES', 'pj', playerCountByTeam[key], playedByTeam[team], '', 'P1', 0.2, 'Recalcular resumen de jugador desde stats por partido');
    }
  });
}

function auditEvQuality_(findings) {
  const evRows = readAllFromSheet_(CONFIG.SHEETS.EV_OPPORTUNITIES);
  const matches = readAllFromSheet_(CONFIG.SHEETS.PARTIDOS);
  const today = todayChile_();

  evRows.forEach(function(r) {
    const match = findDataQualityMatchForEv_(r, matches);
    const fecha = normalizeFecha_(r.fecha || r.date || '');
    if (!match) {
      addDailyFinding_(findings, ensureMatchIdFromRow_(r), 'EV_MATCH_NOT_FOUND', 'fixture_id', r.fixture_id, '', '', 'P1', 0.2, 'No publicar EV sin partido canonico');
      return;
    }
    const status = String(match.status || match.estado || '').toUpperCase();
    if (fecha < today || ['FT','AET','PEN','LIVE','1H','2H','HT'].indexOf(status) !== -1 || (hasScore_(match.goles_local) && hasScore_(match.goles_visitante))) {
      addDailyFinding_(findings, ensureMatchIdFromRow_(match), 'EV_ACTIVE_FOR_CLOSED_MATCH', 'status', status, fecha, '', 'P1', 0.2, 'Ejecutar cleanupClosedEvOpportunities y resolver EvHistorico');
    }
    const ev = Number(r.ev || 0);
    if (ev <= 0 && String(r.ev_positivo || '').toUpperCase() === 'SI') {
      addDailyFinding_(findings, ensureMatchIdFromRow_(match), 'EV_FLAG_INCONSISTENT', 'ev_positivo', r.ev_positivo, ev, '', 'P2', 0.6, 'Normalizar EvOpportunities');
    }
  });
}

function auditModelOutputQuality_(findings) {
  const rows = []
    .concat(readAllFromSheet_(CONFIG.SHEETS.POISSON_ODDS))
    .concat(readAllFromSheet_(CONFIG.SHEETS.AI_ANALYSIS));

  const seenPatterns = {};
  rows.forEach(function(r) {
    const home = Number(r.prob_local || r.prob_home || 0);
    const draw = Number(r.prob_empate || r.prob_draw || 0);
    const away = Number(r.prob_visitante || r.prob_away || 0);
    if (!(home || draw || away)) return;
    const sum = home + draw + away;
    if (Math.abs(sum - 1) > CONFIG.BETTING.PROB_SUM_TOLERANCE) {
      addDailyFinding_(findings, ensureMatchIdFromRow_(r), 'MODEL_PROB_SUM_INVALID', 'prob_sum', sum, '', '', 'P1', 0.3, 'No usar salida de modelo hasta normalizar probabilidades');
    }
    const pattern = [Math.round(home * 1000), Math.round(draw * 1000), Math.round(away * 1000)].join('_');
    seenPatterns[pattern] = (seenPatterns[pattern] || 0) + 1;
    if (seenPatterns[pattern] >= 3 && (pattern === '920_40_40' || pattern === '348_305_348')) {
      addDailyFinding_(findings, pattern, 'MODEL_PATTERN_REPEATED', 'prob_pattern', pattern, seenPatterns[pattern], '', 'P2', 0.5, 'Marcar como fallback/saturacion y bloquear EV');
    }
  });
}

function saveDailyDataQualityFindings_(findings) {
  if (!findings.length) {
    findings.push({
      quality_id: hash_('daily_quality_ok_' + nowChile_()),
      match_key: '',
      check_type: 'DAILY_AUDIT',
      field_name: '',
      api_football_value: '',
      football_data_value: '',
      selected_value: '',
      severity: 'OK',
      confidence: 1,
      resolution: 'Sin hallazgos criticos',
      created_at: nowChile_()
    });
  }
  appendRows_(CONFIG.SHEETS.DATA_QUALITY_LOG, findings.map(function(f) {
    return [
      f.quality_id,
      f.match_key,
      f.check_type,
      f.field_name,
      f.api_football_value,
      f.football_data_value,
      f.selected_value,
      f.severity,
      f.confidence,
      f.resolution,
      f.created_at
    ];
  }));
}

function addDailyFinding_(findings, matchKey, checkType, fieldName, apiValue, fdValue, selectedValue, severity, confidence, resolution) {
  findings.push({
    quality_id: hash_([checkType, matchKey, fieldName, apiValue, fdValue, nowChile_()].join('|')),
    match_key: safe_(matchKey),
    check_type: checkType,
    field_name: fieldName,
    api_football_value: safe_(apiValue),
    football_data_value: safe_(fdValue),
    selected_value: safe_(selectedValue),
    severity: severity,
    confidence: confidence,
    resolution: resolution,
    created_at: nowChile_()
  });
}

function findDataQualityMatchForEv_(evRow, matches) {
  const evMatchId = ensureMatchIdFromRow_(evRow);
  if (evMatchId) {
    const byId = matches.find(function(m) { return ensureMatchIdFromRow_(m) === evMatchId; });
    if (byId) return byId;
  }
  const f = normalizeFecha_(evRow.fecha || evRow.date || '');
  const local = canonicalTeamKey_(evRow.local || evRow.home_team);
  const away = canonicalTeamKey_(evRow.visitante || evRow.away_team);
  return matches.find(function(m) {
    const mf = normalizeFecha_(m.fecha || m.fecha_chile || '');
    if (mf !== f) return false;
    const ml = canonicalTeamKey_(m.local);
    const ma = canonicalTeamKey_(m.visitante);
    return (ml === local && ma === away) || (ml === away && ma === local);
  }) || null;
}

function hasScore_(value) {
  return value !== '' && value !== null && value !== undefined && !isNaN(Number(value));
}
