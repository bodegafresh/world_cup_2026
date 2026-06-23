/**
 * FinalCanonicalLoaders.gs
 *
 * Carga final Sheets -> Supabase usando Sheets solo como input temporal.
 * No replica hojas ni guarda raw payload en tablas canonicas/analytics.
 */

function finalCanonicalBootstrapApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  return {
    catalog: seedCompetitionCatalogToSupabase(),
    runtime: supabaseStatus(),
    note: 'Final architecture bootstrap ready. Use final/load-* endpoints; do not use sheet-to-table legacy migration.'
  };
}

function finalCanonicalLoadAllMvpApply() {
  return {
    bootstrap: finalCanonicalBootstrapApply(),
    teams: finalCanonicalLoadTeamsApply(),
    players: finalCanonicalLoadPlayersApply(),
    matches: finalCanonicalLoadMatchesApply(),
    tournament_structure: finalCanonicalLoadTournamentStructureApply(),
    odds: finalCanonicalLoadOddsApply(),
    predictions: finalCanonicalLoadPoissonPredictionsApply(),
    betting: finalCanonicalLoadBettingHistoryApply()
  };
}

function finalCanonicalCleanupTournamentSlotsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = supabaseSelect_('teams', 'select=team_key,display_name,normalized_name&limit=10000');
  const slotKeys = (rows || [])
    .filter(function(row) {
      return isTournamentSlotName_(row.display_name) ||
        isTournamentSlotName_(row.normalized_name) ||
        isTournamentSlotName_(row.team_key);
    })
    .map(function(row) { return String(row.team_key || '').trim(); })
    .filter(Boolean);

  const uniqueKeys = Array.from(new Set(slotKeys));
  if (!uniqueKeys.length) {
    return { tournament_slots_found: 0, cleaned: false };
  }

  const deleted = finalDeleteTeamsByKeys_(uniqueKeys);
  return {
    tournament_slots_found: uniqueKeys.length,
    slot_team_keys: uniqueKeys,
    cleaned: true,
    deleted: deleted
  };
}

function finalCanonicalCleanupTeamDuplicatesApply(options) {
  options = options || {};
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = supabaseSelect_('teams', 'select=*&limit=10000') || [];
  const merges = [];

  rows.forEach(function(row) {
    const oldKey = String(row.team_key || '').trim();
    if (!oldKey || isTournamentSlotName_(oldKey) || isTournamentSlotName_(row.display_name)) return;
    const canonicalKey = canonicalTeamKey_(row.display_name || row.normalized_name || oldKey);
    if (!canonicalKey || oldKey === canonicalKey) return;
    merges.push({
      from_team_key: oldKey,
      to_team_key: canonicalKey,
      display_name: canonicalTeamDisplayName_(row.display_name || row.normalized_name || oldKey)
    });
  });

  const uniqueMerges = {};
  merges.forEach(function(m) {
    uniqueMerges[m.from_team_key + '>' + m.to_team_key] = m;
  });

  const result = {
    total_candidates: Object.values(uniqueMerges).length,
    batch_limit: Math.max(1, Math.min(10, Number(options.limit || 3))),
    candidates: [],
    merged: [],
    skipped: [],
    has_more: false
  };

  const batch = Object.values(uniqueMerges)
    .sort(function(a, b) { return a.from_team_key.localeCompare(b.from_team_key); })
    .slice(0, result.batch_limit);

  result.candidates = batch;
  result.has_more = Object.values(uniqueMerges).length > batch.length;

  batch.forEach(function(m) {
    try {
      result.merged.push(finalMergeTeamKey_(m.from_team_key, m.to_team_key, m.display_name));
    } catch (e_) {
      result.skipped.push({
        from_team_key: m.from_team_key,
        to_team_key: m.to_team_key,
        error: e_.message
      });
    }
  });

  return result;
}

function finalCanonicalAuditTeamsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = supabaseSelect_('teams', 'select=team_key,display_name,normalized_name,team_type&limit=10000') || [];
  const slots = [];
  const nonCanonical = [];
  const canonicalCounts = {};

  rows.forEach(function(row) {
    const oldKey = String(row.team_key || '').trim();
    const canonicalKey = canonicalTeamKey_(row.display_name || row.normalized_name || oldKey);
    if (isTournamentSlotName_(row.display_name) || isTournamentSlotName_(oldKey)) slots.push(row);
    if (oldKey && canonicalKey && oldKey !== canonicalKey) {
      nonCanonical.push({
        team_key: oldKey,
        display_name: row.display_name,
        canonical_team_key: canonicalKey
      });
    }
    if (canonicalKey) canonicalCounts[canonicalKey] = (canonicalCounts[canonicalKey] || 0) + 1;
  });

  const duplicatedCanonicalKeys = Object.keys(canonicalCounts)
    .filter(function(key) { return canonicalCounts[key] > 1; })
    .map(function(key) { return { canonical_team_key: key, rows: canonicalCounts[key] }; });

  return {
    teams_rows: rows.length,
    tournament_slots_rows: slots.length,
    non_canonical_rows: nonCanonical.length,
    duplicated_canonical_keys: duplicatedCanonicalKeys,
    non_canonical_examples: nonCanonical.slice(0, 50)
  };
}

function finalCanonicalLoadTeamsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  seedCompetitionCatalogToSupabase();

  const teams = {};
  const aliases = {};
  const sourceMappings = {};
  const competitionTeams = {};
  const externalRefs = {};
  const mediaAssets = {};

  function addTeam(name, row, options) {
    options = options || {};
    if (isTournamentSlotName_(name)) return null;
    const displayName = teamNameToSpanish_(name || '');
    if (isTournamentSlotName_(displayName)) return null;
    const teamKey = canonicalTeamKey_(displayName);
    if (!teamKey) return null;
    teams[teamKey] = finalMergeTeamProfile_(teams[teamKey], {
      team_key: teamKey,
      display_name: displayName,
      normalized_name: normalizeTeamNameStrong_(displayName),
      group_code: null,
      api_football_team_id: null,
      football_data_team_id: null,
      team_type: options.team_type || finalInferTeamType_(row),
      country_code: finalTeamCountryCode_(teamKey, row),
      gender: safe_(row && row.gender),
      metadata: finalTeamMetadata_(teamKey, row),
      payload: finalTeamMetadata_(teamKey, row),
      updated_at: nowIso_()
    });
    addTeamAlias_(aliases, teamKey, displayName, 'canonical');
    teamAliasVariantsFor_(name).forEach(function(alias) {
      addTeamAlias_(aliases, teamKey, alias, 'known_alias');
    });
    ['nombre', 'equipo', 'team', 'display_name', 'nombre_normalizado'].forEach(function(field) {
      if (row && row[field]) addTeamAlias_(aliases, teamKey, row[field], field);
    });
    addTeamSource_(sourceMappings, teamKey, 'api_football', row && (row.team_id_api_football || row.api_football_team_id), displayName);
    addTeamSource_(sourceMappings, teamKey, 'football_data', row && row.team_id_football_data, displayName);
    addEntityExternalRef_(externalRefs, 'TEAM', teamKey, 'api_football', 'team', row && (row.team_id_api_football || row.api_football_team_id), displayName, '');
    addEntityExternalRef_(externalRefs, 'TEAM', teamKey, 'football_data', 'team', row && row.team_id_football_data, displayName, '');
    addTeamMediaAssets_(mediaAssets, teamKey, row);
    return teamKey;
  }

  readAllFromSheet_(CONFIG.SHEETS.EQUIPOS).forEach(function(row) {
    const name = row.nombre || row.equipo || row.team || row.display_name;
    const teamKey = addTeam(name, row, {});
    const competitionSeasonId = row.competition_season_id || getActiveCompetitionSeasonId_();
    if (teamKey && competitionSeasonId) {
      competitionTeams[competitionSeasonId + '|' + teamKey] = {
        competition_season_id: competitionSeasonId,
        team_key: teamKey,
        group_code: safe_(row.grupo || row.group_code),
        status: 'ACTIVE',
        seed_rating: toNumberOrNull_(row.seed_rating || row.ranking_fifa),
        payload: {},
        updated_at: nowIso_()
      };
    }
  });

  readAllFromSheet_(CONFIG.SHEETS.CLASIFICACION).forEach(function(row) {
    const name = row.equipo || row.team;
    const competitionSeasonId = row.competition_season_id || getActiveCompetitionSeasonId_();
    const teamKey = addTeam(name, row, { team_type: 'NATIONAL_TEAM' });
    if (teamKey && competitionSeasonId) {
      competitionTeams[competitionSeasonId + '|' + teamKey] = {
        competition_season_id: competitionSeasonId,
        team_key: teamKey,
        group_code: safe_(row.grupo || row.group_code),
        status: 'ACTIVE',
        seed_rating: null,
        payload: {},
        updated_at: nowIso_()
      };
    }
  });

  readAllFromSheet_(CONFIG.SHEETS.PARTIDOS).forEach(function(row) {
    const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
    [
      { name: row.local || row.equipo_local || row.home_team, group_code: row.grupo || row.group },
      { name: row.visitante || row.equipo_visitante || row.away_team, group_code: row.grupo || row.group }
    ].forEach(function(item) {
      const teamKey = addTeam(item.name, row, { team_type: 'NATIONAL_TEAM' });
      if (!teamKey || !competitionSeasonId) return;
      const key = competitionSeasonId + '|' + teamKey;
      if (!competitionTeams[key]) {
        competitionTeams[key] = {
          competition_season_id: competitionSeasonId,
          team_key: teamKey,
          group_code: safe_(item.group_code),
          status: 'ACTIVE',
          seed_rating: null,
          payload: {},
          updated_at: nowIso_()
        };
      }
    });
  });

  const teamRows = Object.values(teams);
  const aliasRows = Object.values(aliases);
  const sourceRows = Object.values(sourceMappings);
  const competitionRows = Object.values(competitionTeams);
  const externalRefRows = Object.values(externalRefs);
  const mediaRows = Object.values(mediaAssets);

  if (teamRows.length) supabaseUpsert_('teams', teamRows, 'team_key');
  if (aliasRows.length) supabaseUpsert_('team_aliases', aliasRows, 'normalized_alias,source');
  if (sourceRows.length) supabaseUpsert_('source_team_mapping', sourceRows, 'source,source_team_id');
  if (externalRefRows.length) finalTryUpsert_('entity_external_refs', externalRefRows, 'entity_type,source,source_id');
  if (mediaRows.length) finalTryUpsert_('entity_media_assets', mediaRows, 'entity_type,entity_id,media_type,source');
  if (competitionRows.length) supabaseUpsert_('competition_team_mapping', competitionRows, 'competition_season_id,team_key');
  finalClearLegacyTeamGroupCode_();

  return {
    teams: teamRows.length,
    team_aliases: aliasRows.length,
    source_team_mapping: sourceRows.length,
    entity_external_refs: externalRefRows.length,
    entity_media_assets: mediaRows.length,
    competition_team_mapping: competitionRows.length
  };
}

function finalCanonicalLoadTournamentStructureApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  seedCompetitionCatalogToSupabase();

  const competitionSeasonId = getActiveCompetitionSeasonId_();
  const stages = finalBuildTournamentStages_(competitionSeasonId);
  const stagesByCode = {};
  stages.forEach(function(stage) { stagesByCode[stage.stage_code] = stage; });

  const groups = {};
  const participants = {};
  const groupMemberships = {};
  const rules = finalBuildWc2026QualificationRules_(competitionSeasonId, stagesByCode);

  readAllFromSheet_(CONFIG.SHEETS.CLASIFICACION).forEach(function(row) {
    const teamKey = canonicalTeamKey_(row.equipo || row.team || '');
    const groupCode = finalNormalizeGroupCode_(row.grupo || row.group_code);
    if (!teamKey) return;

    participants[competitionSeasonId + '|' + teamKey] = {
      competition_season_id: competitionSeasonId,
      team_key: teamKey,
      participant_type: 'NATIONAL_TEAM',
      participant_status: 'ACTIVE',
      seed_rating: null,
      source: 'sheet_clasificacion',
      payload: {},
      updated_at: nowIso_()
    };

    if (groupCode) {
      const groupId = finalGroupId_(competitionSeasonId, stagesByCode.GROUP_STAGE.stage_code, groupCode);
      groups[groupId] = {
        group_id: groupId,
        competition_season_id: competitionSeasonId,
        stage_id: stagesByCode.GROUP_STAGE.stage_id,
        group_code: groupCode,
        group_name: 'Grupo ' + groupCode,
        group_order: finalGroupOrder_(groupCode),
        payload: {},
        updated_at: nowIso_()
      };
      groupMemberships[groupId + '|' + teamKey] = {
        group_id: groupId,
        team_key: teamKey,
        competition_season_id: competitionSeasonId,
        membership_status: 'ACTIVE',
        seed_position: toNumberOrNull_(row.posicion),
        payload: {},
        updated_at: nowIso_()
      };
    }
  });

  const slotBuild = finalBuildSlotsFromMatches_(competitionSeasonId, stagesByCode, groups);

  if (stages.length) supabaseUpsert_('competition_stages', stages, 'competition_season_id,stage_code');
  const groupRows = Object.values(groups);
  if (groupRows.length) supabaseUpsert_('competition_groups', groupRows, 'competition_season_id,stage_id,group_code');
  const participantRows = Object.values(participants);
  if (participantRows.length) supabaseUpsert_('competition_participants', participantRows, 'competition_season_id,team_key');
  const membershipRows = Object.values(groupMemberships);
  if (membershipRows.length) supabaseUpsert_('competition_group_memberships', membershipRows, 'group_id,team_key');
  if (rules.length) supabaseUpsert_('qualification_rules', rules, 'competition_season_id,rule_code');
  if (slotBuild.slots.length) supabaseUpsert_('tournament_slots', slotBuild.slots, 'competition_season_id,slot_code');
  if (slotBuild.matchSlots.length) supabaseUpsert_('match_team_slots', slotBuild.matchSlots, 'match_id,side');

  finalClearLegacyTeamGroupCode_();

  return {
    competition_season_id: competitionSeasonId,
    stages: stages.length,
    groups: groupRows.length,
    participants: participantRows.length,
    group_memberships: membershipRows.length,
    qualification_rules: rules.length,
    tournament_slots: slotBuild.slots.length,
    match_team_slots: slotBuild.matchSlots.length,
    note: 'Canonical tournament structure loaded. teams.group_code is deprecated and cleared.'
  };
}

function finalMergeTeamProfile_(current, next) {
  if (!current) return next;
  const out = Object.assign({}, current);
  Object.keys(next || {}).forEach(function(key) {
    const value = next[key];
    const currentValue = out[key];
    if (key === 'updated_at') {
      out[key] = value || currentValue;
      return;
    }
    if (key === 'payload') {
      out[key] = Object.assign({}, currentValue || {}, value || {});
      return;
    }
    if (finalHasValue_(value) || !finalHasValue_(currentValue)) {
      out[key] = value;
    }
  });
  return out;
}

function finalHasValue_(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s !== '' && s.toUpperCase() !== 'NULL' && s.toUpperCase() !== 'EMPTY';
}

function finalTeamMetadata_(teamKey, row) {
  row = row || {};
  const countryCode = finalTeamCountryCode_(teamKey, row);
  const metadata = {
    entity_domain: 'football_team',
    team_key: teamKey,
    country_code: countryCode,
    country_name: safe_(row.pais || row.country || row.country_name),
    federation_code: safe_(row.codigo || row.federation_code),
    source_quality: {
      confidence_score: toNumberOrNull_(row.confidence_score),
      sources_used: safe_(row.sources_used),
      last_updated: safe_(row.last_updated || row.updated_at)
    }
  };
  Object.keys(metadata).forEach(function(key) {
    if (metadata[key] === '' || metadata[key] === null || metadata[key] === undefined) delete metadata[key];
  });
  return metadata;
}

function finalTeamCountryCode_(teamKey, row) {
  row = row || {};
  const explicit = safe_(row.country_code || row.codigo_pais || row.pais_codigo || row.iso2 || row.iso_code);
  if (explicit) return explicit.toUpperCase();
  return (TEAM_COUNTRY_ISO2[teamKey] || '').toUpperCase();
}

const TEAM_COUNTRY_ISO2 = {
  algeria: 'DZ',
  argentina: 'AR',
  australia: 'AU',
  austria: 'AT',
  belgium: 'BE',
  bosniaherzegovina: 'BA',
  brazil: 'BR',
  cameroon: 'CM',
  canada: 'CA',
  capeverde: 'CV',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  congo: 'CG',
  congodr: 'CD',
  costarica: 'CR',
  cotedivoire: 'CI',
  croatia: 'HR',
  curacao: 'CW',
  czechia: 'CZ',
  denmark: 'DK',
  ecuador: 'EC',
  egypt: 'EG',
  elsalvador: 'SV',
  england: 'GB-ENG',
  finland: 'FI',
  france: 'FR',
  georgia: 'GE',
  germany: 'DE',
  ghana: 'GH',
  greece: 'GR',
  haiti: 'HT',
  honduras: 'HN',
  hungary: 'HU',
  iceland: 'IS',
  indonesia: 'ID',
  iran: 'IR',
  iraq: 'IQ',
  italy: 'IT',
  jamaica: 'JM',
  japan: 'JP',
  jordan: 'JO',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  newzealand: 'NZ',
  nigeria: 'NG',
  northkorea: 'KP',
  norway: 'NO',
  panama: 'PA',
  paraguay: 'PY',
  peru: 'PE',
  poland: 'PL',
  portugal: 'PT',
  qatar: 'QA',
  romania: 'RO',
  russia: 'RU',
  saudiarabia: 'SA',
  scotland: 'GB-SCT',
  senegal: 'SN',
  serbia: 'RS',
  slovakia: 'SK',
  slovenia: 'SI',
  southafrica: 'ZA',
  southkorea: 'KR',
  spain: 'ES',
  sweden: 'SE',
  switzerland: 'CH',
  thailand: 'TH',
  tunisia: 'TN',
  turkey: 'TR',
  ukraine: 'UA',
  unitedarabemirates: 'AE',
  unitedstates: 'US',
  uruguay: 'UY',
  uzbekistan: 'UZ',
  venezuela: 'VE',
  wales: 'GB-WLS'
};

function addTeamMediaAssets_(target, teamKey, row) {
  row = row || {};
  const countryCode = finalTeamCountryCode_(teamKey, row);
  const flagUrl = finalFlagUrlForCountryCode_(countryCode);
  addEntityMediaAsset_(target, 'TEAM', teamKey, 'FLAG', 'flagcdn', flagUrl, true, {
    country_code: countryCode
  });

  const logoUrl = safe_(row.logo || row.logo_url || row.crest_url || row.team_logo);
  if (logoUrl) {
    addEntityMediaAsset_(target, 'TEAM', teamKey, 'LOGO', safe_(row.fuente || 'sheet_seed'), logoUrl, false, {});
  }

  const apiFootballId = safe_(row.team_id_api_football || row.api_football_team_id);
  if (apiFootballId) {
    addEntityMediaAsset_(target, 'TEAM', teamKey, 'LOGO', 'api_football', 'https://media.api-sports.io/football/teams/' + apiFootballId + '.png', false, {
      source_id: apiFootballId
    });
  }
}

function finalFlagUrlForCountryCode_(countryCode) {
  const code = String(countryCode || '').toLowerCase();
  if (!code || code.indexOf('gb-') === 0) return '';
  return 'https://flagcdn.com/w320/' + code + '.png';
}

function finalBuildTournamentStages_(competitionSeasonId) {
  return [
    finalStageRow_(competitionSeasonId, 'GROUP_STAGE', 'Fase de grupos', 1, 'GROUP_STAGE', '2026-06-11', '2026-06-27', {
      groups: 12,
      teams_per_group: 4
    }),
    finalStageRow_(competitionSeasonId, 'ROUND_OF_32', 'Dieciseisavos de final', 2, 'KNOCKOUT', '2026-06-28', '2026-07-03', {}),
    finalStageRow_(competitionSeasonId, 'ROUND_OF_16', 'Octavos de final', 3, 'KNOCKOUT', '2026-07-04', '2026-07-07', {}),
    finalStageRow_(competitionSeasonId, 'QUARTERFINAL', 'Cuartos de final', 4, 'KNOCKOUT', '2026-07-09', '2026-07-11', {}),
    finalStageRow_(competitionSeasonId, 'SEMIFINAL', 'Semifinales', 5, 'KNOCKOUT', '2026-07-14', '2026-07-15', {}),
    finalStageRow_(competitionSeasonId, 'THIRD_PLACE', 'Tercer puesto', 6, 'THIRD_PLACE', '2026-07-18', '2026-07-18', {}),
    finalStageRow_(competitionSeasonId, 'FINAL', 'Final', 7, 'FINAL', '2026-07-19', '2026-07-19', {})
  ];
}

function finalStageRow_(competitionSeasonId, code, name, order, type, startsOn, endsOn, rules) {
  return {
    stage_id: finalStageId_(competitionSeasonId, code),
    competition_season_id: competitionSeasonId,
    stage_code: code,
    stage_name: name,
    stage_order: order,
    stage_type: type,
    starts_on: startsOn,
    ends_on: endsOn,
    rules: rules || {},
    payload: {},
    updated_at: nowIso_()
  };
}

function finalBuildWc2026QualificationRules_(competitionSeasonId, stagesByCode) {
  return [
    finalQualificationRule_(competitionSeasonId, 'GROUP_TOP_2_TO_R32', 'Top 2 de cada grupo a dieciseisavos', stagesByCode.GROUP_STAGE, stagesByCode.ROUND_OF_32, 'GROUP', 1, 2, 24),
    finalQualificationRule_(competitionSeasonId, 'BEST_8_THIRD_TO_R32', 'Mejores 8 terceros a dieciseisavos', stagesByCode.GROUP_STAGE, stagesByCode.ROUND_OF_32, 'CROSS_GROUP', 3, 3, 8),
    finalQualificationRule_(competitionSeasonId, 'R32_WINNERS_TO_R16', 'Ganadores de dieciseisavos a octavos', stagesByCode.ROUND_OF_32, stagesByCode.ROUND_OF_16, 'BRACKET_MATCH', 1, 1, 16),
    finalQualificationRule_(competitionSeasonId, 'R16_WINNERS_TO_QF', 'Ganadores de octavos a cuartos', stagesByCode.ROUND_OF_16, stagesByCode.QUARTERFINAL, 'BRACKET_MATCH', 1, 1, 8),
    finalQualificationRule_(competitionSeasonId, 'QF_WINNERS_TO_SF', 'Ganadores de cuartos a semifinales', stagesByCode.QUARTERFINAL, stagesByCode.SEMIFINAL, 'BRACKET_MATCH', 1, 1, 4),
    finalQualificationRule_(competitionSeasonId, 'SF_WINNERS_TO_FINAL', 'Ganadores de semifinales a final', stagesByCode.SEMIFINAL, stagesByCode.FINAL, 'BRACKET_MATCH', 1, 1, 2),
    finalQualificationRule_(competitionSeasonId, 'SF_LOSERS_TO_THIRD_PLACE', 'Perdedores de semifinales a tercer puesto', stagesByCode.SEMIFINAL, stagesByCode.THIRD_PLACE, 'BRACKET_MATCH', 2, 2, 2)
  ];
}

function finalQualificationRule_(competitionSeasonId, code, name, fromStage, toStage, scope, rankFrom, rankTo, slotsAwarded) {
  return {
    qualification_rule_id: hash_([competitionSeasonId, code].join('|')),
    competition_season_id: competitionSeasonId,
    from_stage_id: fromStage && fromStage.stage_id,
    to_stage_id: toStage && toStage.stage_id,
    rule_code: code,
    rule_name: name,
    ranking_scope: scope,
    rank_from: rankFrom,
    rank_to: rankTo,
    slots_awarded: slotsAwarded,
    tie_breakers: [],
    payload: {},
    updated_at: nowIso_()
  };
}

function finalBuildSlotsFromMatches_(competitionSeasonId, stagesByCode, groupsById) {
  const slots = {};
  const matchSlots = [];

  readAllFromSheet_(CONFIG.SHEETS.PARTIDOS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    if (!matchId) return;
    const stage = finalStageForFixture_(row, stagesByCode);
    ['HOME', 'AWAY'].forEach(function(side) {
      const raw = side === 'HOME'
        ? (row.local || row.equipo_local || row.home_team || '')
        : (row.visitante || row.equipo_visitante || row.away_team || '');
      const isSlot = isTournamentSlotName_(raw);
      const teamKey = isSlot ? null : canonicalTeamKey_(raw);
      const slot = isSlot ? finalTournamentSlotFromRaw_(competitionSeasonId, raw, stage, stagesByCode, groupsById) : null;
      if (slot) slots[slot.slot_id] = slot;
      matchSlots.push({
        match_id: matchId,
        side: side,
        competition_season_id: competitionSeasonId,
        stage_id: stage && stage.stage_id,
        slot_id: slot && slot.slot_id,
        team_key: teamKey,
        raw_label: safe_(raw),
        resolved_at: teamKey ? nowIso_() : null,
        payload: {},
        updated_at: nowIso_()
      });
    });
  });

  return {
    slots: Object.values(slots),
    matchSlots: matchSlots
  };
}

function finalTournamentSlotFromRaw_(competitionSeasonId, raw, currentStage, stagesByCode, groupsById) {
  const label = tournamentSlotLabel_(raw);
  const text = normalizeTournamentSlotText_(raw);
  const slotCode = text.replace(/[^a-z0-9]+/g, '_');
  const slotType = finalSlotTypeFromText_(text);
  const sourceStage = finalSourceStageForSlot_(text, stagesByCode);
  const groupCode = finalGroupCodeFromSlotText_(text);
  const sourceGroupId = slotType === 'BEST_THIRD'
    ? null
    : (groupCode ? finalGroupId_(competitionSeasonId, stagesByCode.GROUP_STAGE.stage_code, groupCode) : null);
  const rank = finalSourceRankFromSlotText_(text);
  return {
    slot_id: finalSlotId_(competitionSeasonId, slotCode),
    competition_season_id: competitionSeasonId,
    stage_id: currentStage.stage_id,
    slot_code: slotCode,
    slot_label: label,
    slot_type: slotType,
    source_stage_id: sourceStage && sourceStage.stage_id,
    source_group_id: sourceGroupId && groupsById[sourceGroupId] ? sourceGroupId : null,
    source_match_id: null,
    source_rank: rank,
    resolved_team_key: null,
    status: 'UNRESOLVED',
    payload: { raw_label: raw },
    updated_at: nowIso_()
  };
}

function finalStageForFixture_(row, stagesByCode) {
  const date = normalizeFecha_(row.fecha || row.date || row.fecha_chile);
  const local = row.local || row.equipo_local || row.home_team || '';
  const away = row.visitante || row.equipo_visitante || row.away_team || '';
  const text = [row.fase, row.ronda, row.stage, local, away].join(' ').toLowerCase();
  if (text.indexOf('semifinal') !== -1 && text.indexOf('loser') !== -1) return stagesByCode.THIRD_PLACE;
  if (text.indexOf('semifinal') !== -1 && text.indexOf('winner') !== -1) return stagesByCode.FINAL;
  if (text.indexOf('quarterfinal') !== -1) return stagesByCode.SEMIFINAL;
  if (text.indexOf('round of 16') !== -1) return stagesByCode.QUARTERFINAL;
  if (text.indexOf('round of 32') !== -1) return stagesByCode.ROUND_OF_16;
  if (isTournamentSlotName_(local) || isTournamentSlotName_(away)) return stagesByCode.ROUND_OF_32;
  if (date && date >= '2026-06-28' && date <= '2026-07-03') return stagesByCode.ROUND_OF_32;
  return stagesByCode.GROUP_STAGE;
}

function finalSlotTypeFromText_(text) {
  if (text.indexOf('third place group') === 0 || text.indexOf('best third') === 0) return 'BEST_THIRD';
  if (text.indexOf('winner') !== -1 && text.indexOf('round of') !== -1) return 'MATCH_WINNER';
  if (text.indexOf('loser') !== -1) return 'MATCH_LOSER';
  if (text.indexOf('group') === 0) return 'GROUP_RANK';
  return 'UNKNOWN';
}

function finalSourceStageForSlot_(text, stagesByCode) {
  if (text.indexOf('round of 32') !== -1) return stagesByCode.ROUND_OF_32;
  if (text.indexOf('round of 16') !== -1) return stagesByCode.ROUND_OF_16;
  if (text.indexOf('quarterfinal') !== -1) return stagesByCode.QUARTERFINAL;
  if (text.indexOf('semifinal') !== -1) return stagesByCode.SEMIFINAL;
  if (text.indexOf('group') !== -1) return stagesByCode.GROUP_STAGE;
  return null;
}

function finalGroupCodeFromSlotText_(text) {
  const m = String(text || '').match(/group ([a-z0-9]+)/);
  return m ? String(m[1]).toUpperCase() : '';
}

function finalSourceRankFromSlotText_(text) {
  if (text.indexOf('winner') !== -1) return 1;
  if (text.indexOf('2nd place') !== -1 || text.indexOf('second place') !== -1 || text.indexOf('runner up') !== -1) return 2;
  if (text.indexOf('third place') !== -1 || text.indexOf('best third') !== -1) return 3;
  return null;
}

function finalNormalizeGroupCode_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/(?:grupo|group)?\s*([A-Z0-9]+)$/i);
  return m ? String(m[1]).toUpperCase() : raw.toUpperCase();
}

function finalGroupOrder_(groupCode) {
  const code = String(groupCode || '').toUpperCase();
  if (/^[A-Z]$/.test(code)) return code.charCodeAt(0) - 64;
  const n = Number(code);
  return isNaN(n) ? null : n;
}

function finalStageId_(competitionSeasonId, stageCode) {
  return [competitionSeasonId, stageCode].join('__').toLowerCase();
}

function finalGroupId_(competitionSeasonId, stageCode, groupCode) {
  return [competitionSeasonId, stageCode, groupCode].join('__').toLowerCase();
}

function finalSlotId_(competitionSeasonId, slotCode) {
  return [competitionSeasonId, slotCode].join('__').toLowerCase();
}

function finalClearLegacyTeamGroupCode_() {
  try {
    supabaseRequest_('patch', 'teams', { group_code: null }, {
      query: 'group_code=not.is.null',
      prefer: 'return=minimal'
    });
  } catch (e_) {}
}

function addTeamAlias_(target, teamKey, alias, source) {
  const raw = String(alias || '').trim();
  const normalized = normalizeTeamNameStrong_(raw);
  if (!teamKey || !normalized) return;
  const key = normalized + '|' + source;
  target[key] = {
    alias_key: hash_([source, normalized].join('|')),
    team_key: teamKey,
    alias: raw,
    normalized_alias: normalized,
    language: '',
    source: source,
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function addTeamSource_(target, teamKey, source, sourceId, sourceName) {
  const id = String(sourceId || '').trim();
  if (!teamKey || !id) return;
  target[source + '|' + id] = {
    source: source,
    source_team_id: id,
    team_key: teamKey,
    competition_season_id: null,
    source_team_name: safe_(sourceName),
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function addEntityExternalRef_(target, entityType, entityId, source, sourceEntityType, sourceId, sourceName, sourceUrl) {
  const id = String(sourceId || '').trim();
  if (!entityType || !entityId || !source || !id) return;
  const key = [entityType, source, id].join('|');
  target[key] = {
    entity_type: entityType,
    entity_id: entityId,
    source: source,
    source_entity_type: sourceEntityType || '',
    source_id: id,
    source_name: safe_(sourceName),
    source_url: safe_(sourceUrl),
    confidence: 1,
    is_primary: false,
    metadata: {},
    updated_at: nowIso_()
  };
}

function addEntityMediaAsset_(target, entityType, entityId, mediaType, source, url, isPrimary, metadata) {
  const mediaUrl = String(url || '').trim();
  if (!entityType || !entityId || !mediaType || !source || !mediaUrl) return;
  const key = [entityType, entityId, mediaType, source].join('|');
  target[key] = {
    entity_type: entityType,
    entity_id: entityId,
    media_type: mediaType,
    source: source,
    url: mediaUrl,
    is_primary: isPrimary === true,
    metadata: metadata || {},
    updated_at: nowIso_()
  };
}

function finalTryUpsert_(table, rows, conflictColumns) {
  try {
    if (rows && rows.length) supabaseUpsert_(table, rows, conflictColumns);
    return rows ? rows.length : 0;
  } catch (e_) {
    return 0;
  }
}

function finalInferTeamType_(row) {
  const raw = String((row && (row.team_type || row.tipo || row.type)) || '').toUpperCase();
  if (raw.indexOf('CLUB') !== -1) return 'CLUB';
  if (raw.indexOf('NATIONAL') !== -1 || raw.indexOf('SELE') !== -1) return 'NATIONAL_TEAM';
  return 'NATIONAL_TEAM';
}

function finalCanonicalLoadPlayersApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');

  const players = {};
  const aliases = {};
  const sourceMappings = {};
  const memberships = {};
  const rosters = {};
  const competitionSeasonId = getActiveCompetitionSeasonId_();

  function addPlayer(row) {
    const name = row.jugador || row.nombre || row.player_name;
    const teamName = row.equipo || row.team_name || row.team;
    const playerKey = canonicalPlayerKey_(name, '', row.player_id_api_football || row.player_id || row.jugador_id);
    if (!name || !playerKey) return null;
    players[playerKey] = {
      player_key: playerKey,
      display_name: safe_(name),
      normalized_name: normalizeTeamNameStrong_(name),
      birth_date: toDateOrNull_(row.birth_date || row.fecha_nacimiento),
      nationality_country_code: safe_(row.nationality_country_code || row.nacionalidad_codigo),
      primary_position: safe_(row.posicion || row.position),
      photo_url: safe_(row.foto || row.photo || row.photo_url),
      payload: {},
      updated_at: nowIso_()
    };
    addPlayerAlias_(aliases, playerKey, name, 'canonical');
    addPlayerSource_(sourceMappings, playerKey, 'api_football', row.player_id_api_football || row.player_id || row.jugador_id, name);
    addPlayerSource_(sourceMappings, playerKey, 'football_data', row.player_id_football_data, name);
    if (teamName) {
      const teamKey = canonicalTeamKey_(teamName);
      if (teamKey) {
        const membershipKey = playerKey + '|' + teamKey + '|NATIONAL_TEAM';
        memberships[membershipKey] = {
          player_key: playerKey,
          team_key: teamKey,
          membership_type: 'NATIONAL_TEAM',
          valid_from: null,
          valid_to: null,
          source: 'sheet_seed',
          confidence: 0.7,
          payload: {},
          updated_at: nowIso_()
        };
        rosters[competitionSeasonId + '|' + teamKey + '|' + playerKey] = {
          competition_season_id: competitionSeasonId,
          team_key: teamKey,
          player_key: playerKey,
          shirt_number: toNumberOrNull_(row.numero || row.shirt_number),
          position: safe_(row.posicion || row.position),
          roster_status: 'ACTIVE',
          source: 'sheet_seed',
          payload: {},
          updated_at: nowIso_()
        };
      }
    }
    return playerKey;
  }

  readAllFromSheet_(CONFIG.SHEETS.JUGADORES).forEach(addPlayer);
  readAllFromSheet_(CONFIG.SHEETS.PLANTELES).forEach(addPlayer);

  const playerRows = Object.values(players);
  const aliasRows = Object.values(aliases);
  const sourceRows = Object.values(sourceMappings);
  const membershipRows = Object.values(memberships);
  const rosterRows = Object.values(rosters);

  if (playerRows.length) supabaseUpsert_('players', playerRows, 'player_key');
  if (aliasRows.length) supabaseUpsert_('player_aliases', aliasRows, 'normalized_alias,source');
  if (sourceRows.length) supabaseUpsert_('source_player_mapping', sourceRows, 'source,source_player_id');
  if (membershipRows.length) supabaseRequest_('post', 'team_memberships', membershipRows, { prefer: 'return=minimal' });
  if (rosterRows.length) supabaseUpsert_('competition_rosters', rosterRows, 'competition_season_id,team_key,player_key');

  return {
    players: playerRows.length,
    player_aliases: aliasRows.length,
    source_player_mapping: sourceRows.length,
    team_memberships: membershipRows.length,
    competition_rosters: rosterRows.length
  };
}

function addPlayerAlias_(target, playerKey, alias, source) {
  const raw = String(alias || '').trim();
  const normalized = normalizeTeamNameStrong_(raw);
  if (!playerKey || !normalized) return;
  target[normalized + '|' + source] = {
    alias_key: hash_([source, normalized].join('|')),
    player_key: playerKey,
    alias: raw,
    normalized_alias: normalized,
    language: '',
    source: source,
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function addPlayerSource_(target, playerKey, source, sourceId, sourceName) {
  const id = String(sourceId || '').trim();
  if (!playerKey || !id) return;
  target[source + '|' + id] = {
    source: source,
    source_player_id: id,
    player_key: playerKey,
    source_player_name: safe_(sourceName),
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function finalCanonicalLoadMatchesApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const matchRows = [];
  const sourceRows = [];
  const missingTeams = {};
  readAllFromSheet_(CONFIG.SHEETS.PARTIDOS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    if (!matchId) return;
    const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
    const homeRaw = row.local || row.equipo_local || row.home_team || '';
    const awayRaw = row.visitante || row.equipo_visitante || row.away_team || '';
    const homeIsSlot = isTournamentSlotName_(homeRaw);
    const awayIsSlot = isTournamentSlotName_(awayRaw);
    const homeName = homeIsSlot ? tournamentSlotLabel_(homeRaw) : teamNameToSpanish_(homeRaw);
    const awayName = awayIsSlot ? tournamentSlotLabel_(awayRaw) : teamNameToSpanish_(awayRaw);
    const homeTeamKey = homeIsSlot ? null : canonicalTeamKey_(homeName);
    const awayTeamKey = awayIsSlot ? null : canonicalTeamKey_(awayName);
    if (!homeIsSlot) finalCollectMinimalTeam_(missingTeams, homeTeamKey, homeName, competitionSeasonId, row.grupo || row.group);
    if (!awayIsSlot) finalCollectMinimalTeam_(missingTeams, awayTeamKey, awayName, competitionSeasonId, row.grupo || row.group);
    matchRows.push({
      match_id: matchId,
      competition_id: competitionSeasonId,
      competition_season_id: competitionSeasonId,
      season: toNumberOrNull_(row.season) || getActiveLeague_().season || null,
      match_key: safe_(row.match_key || matchId),
      date: normalizeFecha_(row.fecha || row.fecha_chile || row.date || ''),
      kickoff_chile: safeHoraChile_(row.hora_chile || row.hora || ''),
      kickoff_utc: toIsoOrNull_(row.hora_utc || row.kickoff_utc),
      stage: safe_(row.fase || row.ronda || ''),
      match_type: getMatchTypeFromFixture_(row),
      group_code: safe_(row.grupo || row.group || ''),
      home_team_key: homeTeamKey,
      home_team_name: homeName,
      away_team_key: awayTeamKey,
      away_team_name: awayName,
      venue_name: safe_(row.estadio),
      venue_city: safe_(row.ciudad),
      venue_country: safe_(row.pais_estadio || row.pais || row.pais_torneo),
      venue_id: safe_(row.venue_id),
      lat: toNumberOrNull_(row.lat),
      lon: toNumberOrNull_(row.lon),
      home_score: toNumberOrNull_(row.goles_local),
      away_score: toNumberOrNull_(row.goles_visitante),
      status: safe_(row.status || row.estado || 'NS'),
      winner: safe_(row.winner),
      source: safe_(row.fuente || 'sheet_seed'),
      sources_used: safe_(row.sources_used),
      confidence_score: toNumberOrNull_(row.confidence_score),
      has_conflict: toBool_(row.has_conflict),
      conflict_detail: safe_(row.conflict_detail),
      data_quality_notes: safe_(row.data_quality_notes),
      payload: {},
      updated_at: nowIso_()
    });
    addMatchSource_(sourceRows, matchId, 'api_football', row.fixture_id_api_football || row.fixture_id_af, 1);
    addMatchSource_(sourceRows, matchId, 'football_data', row.match_id_football_data || row.fixture_id_fd, 1);
    addMatchSource_(sourceRows, matchId, 'espn', row.espn_event_id || row.espn_id, 1);
  });
  const teamSeed = finalBuildMinimalTeamSeed_(missingTeams);
  if (teamSeed.teams.length) supabaseUpsert_('teams', teamSeed.teams, 'team_key');
  if (teamSeed.aliases.length) supabaseUpsert_('team_aliases', teamSeed.aliases, 'normalized_alias,source');
  if (teamSeed.competitionTeams.length) supabaseUpsert_('competition_team_mapping', teamSeed.competitionTeams, 'competition_season_id,team_key');
  const dedupedMatches = finalDedupeRowsByKey_(matchRows, ['match_id']);
  const dedupedSources = finalDedupeRowsByKey_(sourceRows, ['source', 'source_match_id']);
  if (dedupedMatches.length) supabaseUpsert_('matches', dedupedMatches, 'match_id');
  if (dedupedSources.length) supabaseUpsert_('match_source_ids', dedupedSources, 'source,source_match_id');
  return {
    matches: dedupedMatches.length,
    match_source_ids: dedupedSources.length,
    minimal_teams_seeded: teamSeed.teams.length,
    source_rows: matchRows.length,
    duplicate_matches_removed: matchRows.length - dedupedMatches.length
  };
}

function finalCollectMinimalTeam_(target, teamKey, displayName, competitionSeasonId, groupCode) {
  if (!teamKey || !displayName) return;
  const key = competitionSeasonId + '|' + teamKey;
  target[key] = {
    competition_season_id: competitionSeasonId,
    team_key: teamKey,
    display_name: displayName,
    group_code: safe_(groupCode)
  };
}

function finalBuildMinimalTeamSeed_(teamsByCompetition) {
  const teams = {};
  const aliases = {};
  const competitionTeams = {};
  Object.keys(teamsByCompetition || {}).forEach(function(key) {
    const item = teamsByCompetition[key];
    teams[item.team_key] = {
      team_key: item.team_key,
      display_name: item.display_name,
      normalized_name: normalizeTeamNameStrong_(item.display_name),
      team_type: 'NATIONAL_TEAM',
      country_code: '',
      gender: '',
      payload: {},
      updated_at: nowIso_()
    };
    addTeamAlias_(aliases, item.team_key, item.display_name, 'canonical');
    competitionTeams[key] = {
      competition_season_id: item.competition_season_id,
      team_key: item.team_key,
      group_code: item.group_code,
      status: 'ACTIVE',
      seed_rating: null,
      payload: {},
      updated_at: nowIso_()
    };
  });
  return {
    teams: Object.values(teams),
    aliases: Object.values(aliases),
    competitionTeams: Object.values(competitionTeams)
  };
}

function finalDeleteTeamsByKeys_(teamKeys) {
  const result = {
    matches_home_cleared: 0,
    matches_away_cleared: 0,
    team_aliases_deleted: 0,
    source_team_mapping_deleted: 0,
    competition_team_mapping_deleted: 0,
    teams_deleted: 0
  };
  finalChunk_(teamKeys, 50).forEach(function(keys) {
    const filter = 'team_key=in.(' + keys.join(',') + ')';
    const homeFilter = 'home_team_key=in.(' + keys.join(',') + ')';
    const awayFilter = 'away_team_key=in.(' + keys.join(',') + ')';

    result.matches_home_cleared += finalCountResponse_(supabaseRequest_('patch', 'matches', { home_team_key: null }, {
      query: homeFilter,
      prefer: 'return=representation'
    }));
    result.matches_away_cleared += finalCountResponse_(supabaseRequest_('patch', 'matches', { away_team_key: null }, {
      query: awayFilter,
      prefer: 'return=representation'
    }));
    result.team_aliases_deleted += finalCountResponse_(supabaseRequest_('delete', 'team_aliases', null, {
      query: filter,
      prefer: 'return=representation'
    }));
    result.rating_snapshots_deleted = (result.rating_snapshots_deleted || 0) + finalTryDeleteByFilter_('rating_snapshots', filter);
    result.team_memberships_deleted = (result.team_memberships_deleted || 0) + finalTryDeleteByFilter_('team_memberships', filter);
    result.competition_rosters_deleted = (result.competition_rosters_deleted || 0) + finalTryDeleteByFilter_('competition_rosters', filter);
    result.match_lineups_deleted = (result.match_lineups_deleted || 0) + finalTryDeleteByFilter_('match_lineups', filter);
    result.match_events_cleared = (result.match_events_cleared || 0) + finalTryPatchByFilter_('match_events', filter, { team_key: null });
    result.source_team_mapping_deleted += finalCountResponse_(supabaseRequest_('delete', 'source_team_mapping', null, {
      query: filter,
      prefer: 'return=representation'
    }));
    result.competition_team_mapping_deleted += finalCountResponse_(supabaseRequest_('delete', 'competition_team_mapping', null, {
      query: filter,
      prefer: 'return=representation'
    }));
    result.teams_deleted += finalCountResponse_(supabaseRequest_('delete', 'teams', null, {
      query: filter,
      prefer: 'return=representation'
    }));
  });
  return result;
}

function finalMergeTeamKey_(fromKey, toKey, displayName) {
  if (!fromKey || !toKey || fromKey === toKey) return { from_team_key: fromKey, to_team_key: toKey, noop: true };

  supabaseUpsert_('teams', [{
    team_key: toKey,
    display_name: displayName || canonicalTeamDisplayName_(toKey),
    normalized_name: normalizeTeamNameStrong_(displayName || toKey),
    team_type: 'NATIONAL_TEAM',
    payload: {},
    updated_at: nowIso_()
  }], 'team_key');

  const result = {
    from_team_key: fromKey,
    to_team_key: toKey,
    matches_home_updated: finalTryPatchByFilter_('matches', 'home_team_key=eq.' + fromKey, { home_team_key: toKey }),
    matches_away_updated: finalTryPatchByFilter_('matches', 'away_team_key=eq.' + fromKey, { away_team_key: toKey }),
    source_team_mapping_updated: finalTryPatchByFilter_('source_team_mapping', 'team_key=eq.' + fromKey, { team_key: toKey }),
    team_memberships_updated: finalTryPatchByFilter_('team_memberships', 'team_key=eq.' + fromKey, { team_key: toKey }),
    match_events_updated: finalTryPatchByFilter_('match_events', 'team_key=eq.' + fromKey, { team_key: toKey }),
    competition_team_mapping_merged: finalMergeCompetitionTeamMapping_(fromKey, toKey),
    competition_rosters_merged: finalMergeTableRowsByTeamKey_('competition_rosters', fromKey, toKey, 'competition_season_id,team_key,player_key'),
    match_lineups_merged: finalMergeTableRowsByTeamKey_('match_lineups', fromKey, toKey, 'match_id,team_key,player_key,source'),
    rating_snapshots_deleted: finalTryDeleteByFilter_('rating_snapshots', 'team_key=eq.' + fromKey)
  };

  finalTryDeleteByFilter_('team_aliases', 'team_key=eq.' + fromKey);
  supabaseUpsert_('team_aliases', [{
    alias_key: hash_(['legacy_team_key', normalizeTeamNameStrong_(fromKey)].join('|')),
    team_key: toKey,
    alias: fromKey,
    normalized_alias: normalizeTeamNameStrong_(fromKey),
    language: '',
    source: 'legacy_team_key',
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  }], 'normalized_alias,source');

  result.team_deleted = finalTryDeleteByFilter_('teams', 'team_key=eq.' + fromKey);
  return result;
}

function finalMergeCompetitionTeamMapping_(fromKey, toKey) {
  const rows = supabaseSelect_('competition_team_mapping', 'select=*&team_key=eq.' + fromKey) || [];
  const mapped = rows.map(function(row) {
    row.team_key = toKey;
    row.updated_at = nowIso_();
    return row;
  });
  finalTryDeleteByFilter_('competition_team_mapping', 'team_key=eq.' + fromKey);
  if (mapped.length) supabaseUpsert_('competition_team_mapping', mapped, 'competition_season_id,team_key');
  return mapped.length;
}

function finalMergeTableRowsByTeamKey_(table, fromKey, toKey, conflictColumns) {
  try {
    const rows = supabaseSelect_(table, 'select=*&team_key=eq.' + fromKey) || [];
    const mapped = rows.map(function(row) {
      row.team_key = toKey;
      if ('updated_at' in row) row.updated_at = nowIso_();
      return row;
    });
    finalTryDeleteByFilter_(table, 'team_key=eq.' + fromKey);
    if (mapped.length) supabaseUpsert_(table, mapped, conflictColumns);
    return mapped.length;
  } catch (e_) {
    return 0;
  }
}

function finalTryDeleteByFilter_(table, query) {
  try {
    return finalCountResponse_(supabaseRequest_('delete', table, null, {
      query: query,
      prefer: 'return=representation'
    }));
  } catch (e_) {
    return 0;
  }
}

function finalTryPatchByFilter_(table, query, payload) {
  try {
    return finalCountResponse_(supabaseRequest_('patch', table, payload, {
      query: query,
      prefer: 'return=representation'
    }));
  } catch (e_) {
    return 0;
  }
}

function finalCountResponse_(response) {
  return Array.isArray(response) ? response.length : 0;
}

function finalChunk_(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function addMatchSource_(target, matchId, source, sourceId, confidence) {
  const id = String(sourceId || '').trim();
  if (!matchId || !id) return;
  target.push({
    match_id: matchId,
    source: source,
    source_match_id: id,
    confidence: confidence || 1,
    mapping_method: 'sheet_seed',
    payload: {},
    updated_at: nowIso_()
  });
}

function finalCanonicalLoadOddsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = [];
  readAllFromSheet_(CONFIG.SHEETS.ODDS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    const market = safe_(row.mercado || row.market);
    const selection = safe_(row.seleccion || row.selection);
    if (!matchId || !market || !selection) return;
    rows.push({
      match_id: matchId,
      competition_season_id: getCompetitionSeasonIdFromFixture_(row),
      bookmaker: safe_(row.fuente || row.bookmaker || 'unknown'),
      market: market,
      selection: selection,
      line: toNumberOrNull_(row.linea || row.line),
      decimal_odds: toNumberOrNull_(row.cuota || row.cuota_real || row.odds),
      implied_probability: toNumberOrNull_(row.probabilidad_implicita || row.probabilidad_mercado || row.implied_probability),
      bookmaker_count: toNumberOrNull_(row.bookmakers_count || row.bookmaker_count),
      market_quality_score: toNumberOrNull_(row.market_quality_score),
      liquidity_tier: safe_(row.liquidity_tier),
      odds_volatility: toNumberOrNull_(row.odds_volatility),
      captured_at: toIsoOrNull_(row.timestamp || row.captured_at) || nowIso_(),
      is_closing: toBool_(row.is_closing) === true,
      payload: {}
    });
  });
  const deduped = finalDedupeRowsByKey_(rows, ['match_id', 'bookmaker', 'market', 'selection', 'captured_at']);
  if (deduped.length) supabaseUpsert_('odds_snapshots', deduped, 'match_id,bookmaker,market,selection,captured_at');
  return { odds_snapshots: deduped.length, source_rows: rows.length, duplicates_removed: rows.length - deduped.length };
}

function finalCanonicalLoadPoissonPredictionsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const run = finalCreateModelRun_('POISSON_DC', 'v1', '1X2');
  const predictions = [];
  readAllFromSheet_(CONFIG.SHEETS.POISSON_ODDS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    if (!matchId) return;
    const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
    const asOf = toIsoOrNull_(row.updated_at || row.timestamp || row.run_at) || nowIso_();
    [
      { selection: 'HOME', p: row.prob_local || row.prob_home || row.home_prob },
      { selection: 'DRAW', p: row.prob_empate || row.prob_draw || row.draw_prob },
      { selection: 'AWAY', p: row.prob_visitante || row.prob_away || row.away_prob }
    ].forEach(function(item) {
      const p = toNumberOrNull_(item.p);
      if (p === null) return;
      predictions.push({
        model_run_id: run.model_run_id,
        competition_season_id: competitionSeasonId,
        match_id: matchId,
        match_type: getMatchTypeFromFixture_(row),
        market: '1X2',
        selection: item.selection,
        raw_probability: p,
        calibrated_probability: p,
        fair_odds: p > 0 ? 1 / p : null,
        as_of: asOf,
        flags: [],
        payload: {}
      });
    });
  });
  const deduped = finalDedupeRowsByKey_(predictions, ['model_run_id', 'match_id', 'market', 'selection', 'as_of']);
  if (deduped.length) supabaseUpsert_('model_predictions', deduped, 'model_run_id,match_id,market,selection,as_of');
  return {
    model_run_id: run.model_run_id,
    model_predictions: deduped.length,
    source_rows: predictions.length,
    duplicates_removed: predictions.length - deduped.length
  };
}

function finalCreateModelRun_(modelName, modelVersion, market) {
  const rows = supabaseRequest_('post', 'model_runs', [{
    model_name: modelName,
    model_version: modelVersion,
    competition_season_id: getActiveCompetitionSeasonId_(),
    market: market,
    feature_set_version: (typeof FEATURE_SET_VERSION_DEFAULT !== 'undefined' ? FEATURE_SET_VERSION_DEFAULT : 'v1'),
    calibration_method: 'none_seed',
    git_sha: '',
    params: {}
  }], { prefer: 'return=representation' });
  return rows && rows[0] ? rows[0] : {};
}

function finalCanonicalLoadBettingHistoryApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = [];
  readAllFromSheet_(CONFIG.SHEETS.BETTING_HISTORY).forEach(function(row) {
    const betId = safe_(row.bet_id) || hash_(JSON.stringify([
      row.fecha, row.local, row.visitante, row.mercado, row.seleccion, row.cuota, row.stake
    ]));
    rows.push({
      bet_id: betId,
      betting_decision_id: null,
      bet_mode: String(row.bet_mode || row.modo || 'PAPER').toUpperCase() === 'REAL' ? 'REAL' : 'PAPER',
      pick_key: safe_(row.pick_key),
      match_id: ensureMatchIdFromRow_(row),
      market: safe_(row.mercado || row.market),
      selection: safe_(row.seleccion || row.selection),
      decimal_odds: toNumberOrNull_(row.cuota || row.decimal_odds),
      decimal_odds_taken: toNumberOrNull_(row.cuota || row.decimal_odds_taken),
      model_probability: toNumberOrNull_(row.prob_modelo || row.model_probability),
      ev: toNumberOrNull_(row.ev),
      kelly_fraction: toNumberOrNull_(row.kelly || row.kelly_fraction),
      stake: toNumberOrNull_(row.stake),
      result: safe_(row.resultado || row.result),
      profit_loss: toNumberOrNull_(row.profit_loss),
      roi_accumulated: toNumberOrNull_(row.roi_acum),
      notes: safe_(row.notas || row.notes),
      taken_at: toIsoOrNull_(row.fecha || row.taken_at) || nowIso_(),
      placed_at: toIsoOrNull_(row.placed_at || row.fecha) || null,
      settled_at: toIsoOrNull_(row.settled_at || row.resolved_at) || null,
      payload: {}
    });
  });
  if (rows.length) supabaseUpsert_('bets', rows, 'bet_id');
  return { bets: rows.length };
}

function toDateOrNull_(value) {
  const iso = toIsoOrNull_(value);
  return iso ? iso.substring(0, 10) : null;
}

function finalDedupeRowsByKey_(rows, keyColumns) {
  const byKey = {};
  const ordered = [];
  (rows || []).forEach(function(row) {
    const key = (keyColumns || []).map(function(col) {
      return row[col] === null || row[col] === undefined ? '' : String(row[col]);
    }).join('|');
    if (!key || key.replace(/\|/g, '') === '') return;
    if (!byKey[key]) ordered.push(key);
    byKey[key] = row;
  });
  return ordered.map(function(key) { return byKey[key]; });
}
