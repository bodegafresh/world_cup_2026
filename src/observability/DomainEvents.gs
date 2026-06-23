/**
 * observability/DomainEvents.gs
 *
 * Registro liviano de eventos de dominio. Si la tabla domain_events no existe
 * todavia, el evento se degrada a Logger sin romper el pipeline.
 */

function domainEventRecord_(eventType, aggregateType, aggregateId, competitionSeasonId, payload, idempotencyKey) {
  const event = {
    event_type: String(eventType || ''),
    aggregate_type: String(aggregateType || ''),
    aggregate_id: String(aggregateId || ''),
    competition_season_id: competitionSeasonId || '',
    idempotency_key: idempotencyKey || coreIdempotencyKey_(eventType, aggregateId, payload && payload.version),
    payload: payload || {},
    created_at: nowIso_()
  };
  if (!event.event_type || !event.aggregate_type || !event.aggregate_id) {
    Logger.log('domainEventRecord_: invalid event ' + JSON.stringify(event));
    return { recorded: false, reason: 'INVALID_EVENT', event: event };
  }
  if (!isSupabaseConfigured_()) {
    Logger.log('domain_event ' + JSON.stringify(event));
    return { recorded: false, reason: 'SUPABASE_NOT_CONFIGURED', event: event };
  }
  try {
    supabaseUpsert_('domain_events', [event], 'idempotency_key');
    return { recorded: true, event: event };
  } catch (e) {
    Logger.log('domainEventRecord_ fallback: ' + e.message);
    return { recorded: false, reason: e.message, event: event };
  }
}

function domainEventMatchNormalized_(matchId, competitionSeasonId, payload) {
  return domainEventRecord_('MATCH_NORMALIZED', 'match', matchId, competitionSeasonId, payload || {}, null);
}

function domainEventFeatureSnapshotCreated_(snapshotId, competitionSeasonId, payload) {
  return domainEventRecord_('FEATURE_SNAPSHOT_CREATED', 'feature_snapshot', snapshotId, competitionSeasonId, payload || {}, null);
}

function domainEventEvDecisionCreated_(decisionId, competitionSeasonId, payload) {
  return domainEventRecord_('EV_DECISION_CREATED', 'betting_decision', decisionId, competitionSeasonId, payload || {}, null);
}
