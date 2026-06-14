function saveFixtures_(fixtures, rawUrl) {
  const existing = getExistingIds_(CONFIG.SHEETS.PARTIDOS, 'match_id');

  const rows = fixtures
    .filter(f => !existing[String(f.fixture.id)])
    .map(f => [
      f.fixture.id,
      safe_(f.fixture.date ? f.fixture.date.substring(0, 10) : ''),
      toChileDateTime_(f.fixture.date),
      safe_(f.league.round),
      safe_(f.teams.home.name),
      safe_(f.teams.away.name),
      safe_(f.fixture.venue ? f.fixture.venue.name : ''),
      safe_(f.fixture.venue ? f.fixture.venue.city : ''),
      safe_(f.league.country),
      safe_(f.goals.home),
      safe_(f.goals.away),
      '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      rawUrl
    ]);

  appendRows_(CONFIG.SHEETS.PARTIDOS, rows);
}

function saveEvents_(fixtureId, events, rawUrl) {
  const existing = getExistingIds_(CONFIG.SHEETS.EVENTOS_LIVE, 'evento_id');

  let scoreHome = 0;
  let scoreAway = 0;

  const rows = [];

  events.forEach(event => {
    const eventId = buildEventId_(fixtureId, event);
    if (existing[eventId]) return;

    if (event.type === 'Goal') {
      if (event.team && Number(event.team.id) === 17) scoreHome++;
      else scoreAway++;
    }

    rows.push([
      eventId,
      fixtureId,
      fixtureId,
      safe_(event.time && event.time.elapsed),
      safe_(event.time && event.time.extra),
      safe_(event.type),
      safe_(event.detail),
      safe_(event.team && event.team.id),
      safe_(event.team && event.team.name),
      safe_(event.player && event.player.id),
      safe_(event.player && event.player.name),
      safe_(event.assist && event.assist.id),
      safe_(event.assist && event.assist.name),
      safe_(event.comments),
      scoreHome,
      scoreAway,
      calculateEventImpact_(event),
      nowChile_(),
      rawUrl
    ]);
  });

  appendRows_(CONFIG.SHEETS.EVENTOS_LIVE, rows);
}

function calculateEventImpact_(event) {
  if (event.type === 'Goal') return 'ALTO';
  if (event.type === 'Card' && event.detail === 'Red Card') return 'ALTO';
  if (event.type === 'Card' && event.detail === 'Yellow Card') return 'MEDIO';
  if (event.type === 'subst') return 'MEDIO';
  return 'BAJO';
}