function savePlayerSummaryFromEvents_(fixtureId, fixture, events) {
  const map = {};

  events.forEach(event => {
    const player = event.player || {};
    const assist = event.assist || {};
    const team = event.team || {};

    if (player.id) {
      const key = `${fixtureId}_${player.id}`;
      if (!map[key]) {
        map[key] = createPlayerSummary_(fixtureId, player, team);
      }

      if (event.type === 'Goal') {
        map[key].goles++;
        map[key].minuto_gol.push(event.time.elapsed);
      }

      if (event.type === 'Card' && event.detail === 'Yellow Card') {
        map[key].tarjetas_amarillas++;
      }

      if (event.type === 'Card' && event.detail === 'Red Card') {
        map[key].tarjetas_rojas++;
      }

      if (event.type === 'subst') {
        map[key].salio_minuto = event.time.elapsed;
      }
    }

    if (assist.id && event.type === 'Goal') {
      const assistKey = `${fixtureId}_${assist.id}`;
      if (!map[assistKey]) {
        map[assistKey] = createPlayerSummary_(fixtureId, assist, team);
      }

      map[assistKey].asistencias++;
      map[assistKey].minuto_asistencia.push(event.time.elapsed);
    }

    if (assist.id && event.type === 'subst') {
      const enterKey = `${fixtureId}_${assist.id}`;
      if (!map[enterKey]) {
        map[enterKey] = createPlayerSummary_(fixtureId, assist, team);
      }

      map[enterKey].entro_minuto = event.time.elapsed;
    }
  });

  const rows = Object.values(map).map(p => [
    fixtureId,
    fixtureId,
    p.jugador_id,
    p.jugador,
    p.equipo_id,
    p.equipo,
    p.goles,
    p.asistencias,
    p.tarjetas_amarillas,
    p.tarjetas_rojas,
    p.minuto_gol.join(','),
    p.minuto_asistencia.join(','),
    p.salio_minuto,
    p.entro_minuto,
    calculatePlayerImpact_(p),
    p.observacion,
    'API-Football fixtures/events',
    nowChile_()
  ]);

  appendRows_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO, rows);
}

function createPlayerSummary_(fixtureId, player, team) {
  return {
    fixture_id: fixtureId,
    jugador_id: player.id,
    jugador: player.name,
    equipo_id: team.id,
    equipo: team.name,
    goles: 0,
    asistencias: 0,
    tarjetas_amarillas: 0,
    tarjetas_rojas: 0,
    minuto_gol: [],
    minuto_asistencia: [],
    salio_minuto: '',
    entro_minuto: '',
    observacion: ''
  };
}

function calculatePlayerImpact_(p) {
  const score = p.goles * 3 + p.asistencias * 2 - p.tarjetas_rojas * 3 - p.tarjetas_amarillas;

  if (score >= 4) return 'MUY_ALTO';
  if (score >= 2) return 'ALTO';
  if (score >= 1) return 'MEDIO';
  if (score < 0) return 'NEGATIVO';
  return 'BAJO';
}

function cronLiveEventsMonitor() {
  const liveFixtures = getFixturesLikelyLive_();

  liveFixtures.forEach(fixture => {
    try {
      const fixtureId = fixture.match_id || fixture.fixture_id;

      const eventsData = fetchEventsByFixture_(fixtureId);
      const events = eventsData.response || [];

      const newImportantEvents = detectNewImportantEvents_(fixtureId, events);

      if (newImportantEvents.length) {
        saveEvents_(fixtureId, events, 'API-Football fixtures/events live');

        newImportantEvents.forEach(event => {
          sendTelegramMessage_(formatImportantEventMessage_(fixture, event));
          markEventAsAlerted_(fixtureId, event);
        });
      }

      Utilities.sleep(800);
    } catch (e) {
      console.warn(`Live monitor error: ${e.message}`);
    }
  });
}

function getFixturesLikelyLive_() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);
  const now = new Date();

  return rows.filter(r => {
    if (!r.hora_chile) return false;

    const kickoff = new Date(r.hora_chile);
    const diffMinutes = (now.getTime() - kickoff.getTime()) / 60000;

    return diffMinutes >= -15 && diffMinutes <= 140;
  });
}

function detectNewImportantEvents_(fixtureId, events) {
  const alerted = getAlertedEventIds_();

  return events.filter(event => {
    const eventId = buildEventId_(fixtureId, event);
    if (alerted[eventId]) return false;

    return isImportantEvent_(event);
  });
}

function isImportantEvent_(event) {
  if (event.type === 'Goal') return true;
  if (event.type === 'Card' && event.detail === 'Red Card') return true;
  if (event.type === 'Var') return true;
  if (event.type === 'subst' && event.time && event.time.elapsed >= 75) return true;
  if (event.type === 'Card' && event.detail === 'Yellow Card' && event.time && event.time.elapsed >= 85) return true;

  return false;
}

function getAlertedEventIds_() {
  const rows = readAll_(CONFIG.SHEETS.ALERTAS);
  const map = {};

  rows.forEach(r => {
    if (r.evento_id) map[String(r.evento_id)] = true;
  });

  return map;
}

function markEventAsAlerted_(fixtureId, event) {
  const eventId = buildEventId_(fixtureId, event);

  appendRows_(CONFIG.SHEETS.ALERTAS, [[
    eventId,
    fixtureId,
    safe_(event.type),
    safe_(event.detail),
    safe_(event.team && event.team.name),
    safe_(event.player && event.player.name),
    safe_(event.time && event.time.elapsed),
    safe_(event.time && event.time.extra),
    nowChile_(),
    'TELEGRAM'
  ]]);
}

function formatImportantEventMessage_(fixture, event) {
  const minute = event.time.extra
    ? `${event.time.elapsed}+${event.time.extra}`
    : `${event.time.elapsed}`;

  if (event.type === 'Goal') {
    return `⚽ <b>GOL</b> ${minute}'\n${event.team.name}\n${event.player.name}\nAsistencia: ${safe_(event.assist && event.assist.name)}`;
  }

  if (event.type === 'Card' && event.detail === 'Red Card') {
    return `🟥 <b>ROJA</b> ${minute}'\n${event.team.name}\n${event.player.name}`;
  }

  if (event.type === 'Card' && event.detail === 'Yellow Card') {
    return `🟨 Amarilla ${minute}'\n${event.team.name}\n${event.player.name}`;
  }

  return `📌 Evento ${minute}'\n${safe_(event.type)} - ${safe_(event.detail)}\n${safe_(event.team && event.team.name)}\n${safe_(event.player && event.player.name)}`;
}