/**
 * ManualTest.gs
 *
 * Funciones de prueba para ejecutar manualmente en Apps Script.
 * Cada función está aislada y loguea su resultado con Logger.log().
 *
 * ORDEN RECOMENDADO DE EJECUCIÓN (de menor a mayor riesgo):
 *
 *  1. test01_Config              — verifica Script Properties (sin API calls)
 *  2. test02_SheetAudit          — lista hojas válidas y desconocidas (sin API calls)
 *  3. test03_SheetCleanup        — elimina hojas vacías desconocidas (sin API calls)
 *  4. test04_PreviewContextLocal — contexto de previa solo desde Sheets (sin API calls)
 *  5. test05_Weather             — prueba Open-Meteo con estadio real (gratis, sin cuota)
 *  6. test06_News                — prueba Google News RSS (gratis, sin cuota)
 *  7. test07_Standings           — carga tabla de posiciones desde API-Football (1 req)
 *  8. test08_Odds                — prueba The Odds API (1 req del mes)
 *  9. test09_H2H                 — historial H2H de un fixture próximo (1 req)
 * 10. test10_FullPreviewDryRun   — contexto completo sin llamar a OpenAI (~3 req API-Football)
 * 11. test11_FullPreviewWithAI   — contexto + análisis OpenAI para 1 fixture (~3 req + 1 OpenAI)
 * 12. test12_CronTodayPreview    — cron completo del día (todos los fixtures de hoy, con IA)
 * 13. test13_BackfillStatus      — estado del backfill sin llamadas a la API
 * 14. test14_BackfillResume      — retoma backfill desde primer día incompleto
 * 15. test15_Dashboard           — refresca el Dashboard consolidado (sin API calls)
 */

// ─── 1. Configuración ──────────────────────────────────────────────────────────

function test01_Config() {
  Logger.log('=== TEST 01: Configuración ===');

  const checks = {
    SPREADSHEET_ID:    getSpreadsheetId_(),
    RAW_FOLDER_ID:     getRawFolderId_(),
    API_FOOTBALL_KEY:  maskKey_(getApiFootballKey_()),
    FOOTBALL_DATA_KEY: maskKey_(getFootballDataKey_()),
    OPENAI_KEY:        maskKey_(getOpenAiKey_()),
    TELEGRAM_TOKEN:    maskKey_(getTelegramBotToken_()),
    TELEGRAM_CHAT_ID:  getTelegramChatId_(),
    TIMEZONE:          CONFIG.TIMEZONE,
    HOY_CHILE:         todayChile_(),
    MANANA_CHILE:      tomorrowChile_(),
    AYER_CHILE:        yesterdayChile_()
  };

  Object.entries(checks).forEach(([k, v]) => Logger.log(`  ${k}: ${v}`));
  Logger.log('✅ Config OK si no hay errores arriba');
}

// ─── 2. Auditoría de hojas ─────────────────────────────────────────────────────

function test02_SheetAudit() {
  Logger.log('=== TEST 02: Auditoría de hojas ===');
  const result = sheetAudit();
  Logger.log(`Válidas: ${result.valid.length} | Desconocidas: ${result.unknown.length}`);
}

// ─── 3. Limpieza de hojas ─────────────────────────────────────────────────────

function test03_SheetCleanup() {
  Logger.log('=== TEST 03: Limpieza de hojas vacías desconocidas ===');
  Logger.log('Ejecutando sheetCleanup() — solo borra hojas desconocidas VACÍAS...');
  const result = sheetCleanup();
  Logger.log(`Eliminadas: ${result.deleted.join(', ') || 'ninguna'}`);
  Logger.log(`Saltadas (tienen datos): ${result.skipped.join(', ') || 'ninguna'}`);
}

// ─── 4. Contexto de previa solo desde Sheets ──────────────────────────────────

function test04_PreviewContextLocal() {
  Logger.log('=== TEST 04: Contexto de previa (solo Sheets, sin API calls) ===');

  const fixture = getFirstUpcomingFixtureFromSheet_();
  if (!fixture) return;

  Logger.log(`Partido: ${fixture.home} vs ${fixture.away} (${fixture.fecha})`);
  Logger.log('');

  Logger.log('--- Contexto del grupo ---');
  const group = buildGroupContext_(fixture.home, fixture.away);
  Logger.log(group ? JSON.stringify(group, null, 2) : 'Sin datos (Clasificacion vacía)');

  Logger.log('--- Riesgo de suspensión ---');
  const susp = buildSuspensionRisks_(fixture.home, fixture.away);
  Logger.log(JSON.stringify(susp, null, 2));

  Logger.log('--- Qué se juega cada equipo ---');
  const stakes = buildStandingsStakes_(fixture.home, fixture.away);
  Logger.log(stakes ? JSON.stringify(stakes, null, 2) : 'Sin datos de clasificación');

  Logger.log('--- Jugadores en forma (último partido) ---');
  const form = buildPlayerFormContext_(fixture.home, fixture.away);
  Logger.log(JSON.stringify(form, null, 2));

  Logger.log('✅ Contexto local OK');
}

// ─── 5. Clima (Open-Meteo, gratis) ────────────────────────────────────────────

function test05_Weather() {
  Logger.log('=== TEST 05: Clima con Open-Meteo ===');

  const fakeFixture = buildFakeFixture_('MetLife Stadium', 'East Rutherford', 'New York');
  const weather = fetchWeatherForFixture_(fakeFixture);

  Logger.log(JSON.stringify(weather, null, 2));

  if (weather.temperature_c !== null) {
    Logger.log(`✅ Clima OK — ${weather.temperature_c}°C, ${weather.condition}`);
  } else {
    Logger.log(`⚠️  Temperatura null — revisar coordenadas en VenueCatalog o la fecha del fixture`);
  }
}

// ─── 6. Noticias (Google News RSS, gratis) ────────────────────────────────────

function test06_News() {
  Logger.log('=== TEST 06: Noticias Google News RSS ===');

  const fakeFixture = buildFakeFixtureTeams_('Argentina', 'Brasil');
  const news = fetchNewsForFixture_(fakeFixture);

  Logger.log(`Artículos obtenidos: ${news.length}`);
  news.slice(0, 3).forEach((n, i) => {
    Logger.log(`  [${i + 1}] ${n.title}`);
    Logger.log(`       Fuente: ${n.source} | Fecha: ${n.pubDate}`);
  });

  const injuries = extractInjuryMentions_(news, 'Argentina', 'Brasil');
  Logger.log(`Menciones de lesión detectadas: ${injuries.length}`);
  injuries.forEach(m => Logger.log(`  → ${m.equipo}: "${m.titular}"`));

  Logger.log(`✅ Noticias OK`);
}

// ─── 7. Tabla de posiciones (API-Football, 1 req) ─────────────────────────────

function test07_Standings() {
  Logger.log('=== TEST 07: Tabla de posiciones ===');
  loadWorldCupStandings();

  const rows = readAll_('Clasificacion');
  Logger.log(`Equipos en Clasificacion: ${rows.length}`);

  const grupos = [...new Set(rows.map(r => r.grupo))].sort();
  grupos.forEach(g => {
    const gr = rows.filter(r => r.grupo === g).sort((a, b) => Number(a.posicion) - Number(b.posicion));
    Logger.log(`\n${g}`);
    gr.forEach(r => Logger.log(`  ${r.posicion}. ${r.equipo} — ${r.puntos} pts (GD ${r.gd})`));
  });

  Logger.log('\n✅ Standings OK');
}

// ─── 8. Cuotas (The Odds API, 1 req del mes) ──────────────────────────────────

function test08_Odds() {
  Logger.log('=== TEST 08: Cuotas The Odds API ===');

  const fixture = getFirstUpcomingFixtureFromSheet_();
  const home = fixture ? fixture.home : 'Argentina';
  const away = fixture ? fixture.away : 'México';

  Logger.log(`Buscando cuotas para: ${home} vs ${away}`);

  const odds = fetchOddsForMatch_(home, away);

  if (odds) {
    Logger.log(`Fuente: ${odds.source} | Bookmakers: ${odds.bookmakers_count}`);
    Logger.log(`1X2 → Local: ${pct_(odds.prob_local)} | Empate: ${pct_(odds.prob_empate)} | Visitante: ${pct_(odds.prob_visitante)}`);
    Logger.log(`Over 2.5: ${pct_(odds.over25_prob)} | BTTS: ${pct_(odds.btts_prob)}`);
    Logger.log('✅ Odds OK');
  } else {
    Logger.log('ℹ️  Sin cuotas disponibles (puede que el torneo no esté en The Odds API todavía)');
    Logger.log('   Verificar config: SPORT_KEY = ' + CONFIG.THE_ODDS_API.SPORT_KEY);
  }
}

// ─── 9. H2H (API-Football, 1 req) ────────────────────────────────────────────

function test09_H2H() {
  Logger.log('=== TEST 09: Historial H2H ===');

  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const upcoming = partidos.find(r =>
    String(r.fecha || '').substring(0, 10) >= todayChile_() &&
    ['NS', 'TBD', ''].includes(String(r.estado || 'NS').toUpperCase())
  );

  if (!upcoming) {
    Logger.log('No hay partidos próximos en la hoja Partidos. Corre el backfill primero.');
    return;
  }

  Logger.log(`Partido: ${upcoming.local} vs ${upcoming.visitante}`);

  const fakeFixture = {
    fixture: { id: upcoming.fixture_id_af || 0, date: upcoming.hora_utc || '' },
    teams: {
      home: { id: '', name: upcoming.local },
      away: { id: '', name: upcoming.visitante }
    },
    league: { round: upcoming.ronda || '' }
  };

  loadHeadToHeadForFixture_(fakeFixture);

  const h2hRows = readAll_('HistorialH2H').filter(r =>
    String(r.fixture_ref_id || '') === String(upcoming.fixture_id_af || '')
  );

  Logger.log(`Partidos H2H guardados: ${h2hRows.length}`);
  h2hRows.slice(0, 3).forEach(r => {
    Logger.log(`  ${String(r.fecha || '').substring(0, 10)}: ${r.local} ${r.goles_local}-${r.goles_visitante} ${r.visitante}`);
  });

  Logger.log('✅ H2H OK');
}

// ─── 10. Preview completo sin IA ──────────────────────────────────────────────

function test10_FullPreviewDryRun() {
  Logger.log('=== TEST 10: Preview completo (sin OpenAI) ===');

  const date = tomorrowChile_();
  Logger.log(`Buscando fixtures para mañana: ${date}`);

  const fixturesData = fetchWorldCupFixturesByDate_(date);
  const fixtures = fixturesData.response || [];

  if (!fixtures.length) {
    Logger.log(`Sin fixtures del Mundial para ${date}. Probando con hoy...`);
    const todayData = fetchWorldCupFixturesByDate_(todayChile_());
    fixtures.push(...(todayData.response || []));
  }

  if (!fixtures.length) {
    Logger.log('Sin fixtures disponibles. Verifica que la hoja Partidos tenga datos futuros.');
    return;
  }

  const fixture = fixtures[0];
  Logger.log(`Fixture: ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);

  const weather = fetchWeatherForFixture_(fixture);
  Logger.log(`Clima: ${weather.temperature_c}°C | ${weather.condition}`);

  const news = fetchNewsForFixture_(fixture);
  Logger.log(`Noticias: ${news.length} artículos`);

  const odds = calculateBasicOddsSignals_(fixture);
  Logger.log(`Odds confianza: ${odds.markets[0].confidence}`);

  const input = buildEnrichedPreviewInput_(fixture, weather, news, odds);

  Logger.log('\n--- SECCIONES DEL INPUT ---');
  Logger.log(`match:             ${input.match.home} vs ${input.match.away} | etapa: ${input.match.stage}`);
  Logger.log(`weather:           ${input.weather.temperature_c}°C ${input.weather.condition}`);
  Logger.log(`news:              ${(input.news || []).length} artículos`);
  Logger.log(`group_context:     ${input.group_context ? input.group_context.grupo : 'sin datos'}`);
  Logger.log(`suspension_risks:  home=${input.suspension_risks.home.length} | away=${input.suspension_risks.away.length}`);
  Logger.log(`injury_mentions:   ${input.injury_mentions.length}`);
  Logger.log(`player_form:       home=${input.player_form.home.length} | away=${input.player_form.away.length}`);
  Logger.log(`h2h_summary:       ${input.h2h_summary ? input.h2h_summary.partidos.length + ' partidos' : 'sin datos'}`);
  Logger.log(`standings_stakes:  ${JSON.stringify(input.standings_stakes)}`);

  Logger.log('\n--- PROMPT (primeros 600 chars) ---');
  Logger.log(buildFixturePreviewPrompt_(input).substring(0, 600));

  Logger.log('\n✅ DryRun OK — el contexto está completo');
}

// ─── 11. Preview completo con IA ──────────────────────────────────────────────

function test11_FullPreviewWithAI() {
  Logger.log('=== TEST 11: Preview completo CON OpenAI ===');

  const date = tomorrowChile_();
  const fixturesData = fetchWorldCupFixturesByDate_(date);
  let fixtures = fixturesData.response || [];

  if (!fixtures.length) {
    const todayData = fetchWorldCupFixturesByDate_(todayChile_());
    fixtures = todayData.response || [];
  }

  if (!fixtures.length) {
    Logger.log('Sin fixtures disponibles.');
    return;
  }

  const fixture = fixtures[0];
  Logger.log(`Fixture: ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
  Logger.log('Llamando a OpenAI...');

  const weather = fetchWeatherForFixture_(fixture);
  const news    = fetchNewsForFixture_(fixture);
  const odds    = calculateBasicOddsSignals_(fixture);
  const input   = buildAiPreviewInput_(fixture, weather, news, odds);
  const result  = analyzeFixtureWithAi_(input);

  Logger.log('\n--- RESULTADO IA ---');
  Logger.log(`resumen_previa:     ${result.resumen_previa}`);
  Logger.log(`confianza_modelo:   ${result.confianza_modelo}`);
  Logger.log(`mensaje_telegram:   ${result.mensaje_telegram}`);

  const probs = result.probabilidades || result.probabilidades_basicas || {};
  Logger.log(`probabilidades:     local=${probs.home_win} | empate=${probs.draw} | visitante=${probs.away_win}`);

  const bajas = result.bajas_y_suspensiones || [];
  Logger.log(`bajas/suspensiones: ${bajas.length}`);
  bajas.forEach(b => Logger.log(`  → ${b.tipo}: ${b.jugador} (${b.equipo}) — ${b.detalle}`));

  const alertas = result.alertas || [];
  Logger.log(`alertas:            ${alertas.length}`);
  alertas.filter(a => a.prioridad === 'alta').forEach(a =>
    Logger.log(`  🔴 ${a.tipo}: ${a.mensaje}`)
  );

  Logger.log('\n¿Guardar en AnalisisIA? Descomenta la línea de abajo:');
  // saveAiAnalysis_(fixture, result);

  Logger.log('✅ Preview con IA OK');
}

// ─── 12. Cron completo del día ────────────────────────────────────────────────

function test12_CronTodayPreview() {
  Logger.log('=== TEST 12: cronTodayPreviewRefresh (flujo completo día de hoy) ===');
  Logger.log('Nota: esto gasta cuota de API-Football y OpenAI para TODOS los fixtures de hoy.');
  cronTodayPreviewRefresh();
  Logger.log('✅ cronTodayPreviewRefresh finalizado');
}

// ─── 13. Estado del backfill ──────────────────────────────────────────────────

function test13_BackfillStatus() {
  Logger.log('=== TEST 13: Estado del backfill (sin API calls) ===');
  backfillStatus();
}

// ─── 14. Reanudar backfill ────────────────────────────────────────────────────

function test14_BackfillResume() {
  Logger.log('=== TEST 14: Reanudar backfill desde primer día incompleto ===');
  const result = backfillResume();
  if (result) {
    Logger.log(`Fechas procesadas: ${result.dates.length}`);
    Logger.log(`Fixtures cargados: ${result.totalFixtures}`);
    Logger.log(`API calls usados:  ${result.apiCalls}`);
    if (result.errors.length) {
      Logger.log(`Errores: ${result.errors.join(' | ')}`);
    }
  }
}

// ─── 15. Dashboard ───────────────────────────────────────────────────────────

function test15_Dashboard() {
  Logger.log('=== TEST 15: Refrescar Dashboard (sin API calls) ===');
  refreshDashboard();
  Logger.log('✅ Dashboard actualizado — abre la hoja Dashboard en Google Sheets');
}

// ─── Helpers internos de test ─────────────────────────────────────────────────

function getFirstUpcomingFixtureFromSheet_() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);

  const upcoming = rows.find(r =>
    String(r.fecha || '').substring(0, 10) >= todayChile_() &&
    ['NS', 'TBD', '', 'PST'].includes(String(r.estado || 'NS').toUpperCase())
  );

  if (!upcoming) {
    Logger.log('⚠️  No hay partidos próximos en Partidos. Corre backfillWorldCupOpeningWeek() primero.');
    return null;
  }

  return {
    home:  upcoming.local,
    away:  upcoming.visitante,
    fecha: upcoming.fecha,
    id:    upcoming.fixture_id_af
  };
}

function buildFakeFixture_(stadium, city, country) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);

  return {
    fixture: {
      id:   99999,
      date: d.toISOString(),
      venue: { id: 0, name: stadium, city }
    },
    league: { id: 1, name: 'World Cup', country: 'World', season: 2026, round: 'Group Stage - 1' },
    teams:  { home: { id: 0, name: 'Test Home' }, away: { id: 0, name: 'Test Away' } }
  };
}

function buildFakeFixtureTeams_(home, away) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);

  return {
    fixture: {
      id:   99998,
      date: d.toISOString(),
      venue: { id: 0, name: 'MetLife Stadium', city: 'East Rutherford' }
    },
    league: { id: 1, name: 'World Cup', country: 'World', season: 2026, round: 'Group Stage - 2' },
    teams:  { home: { id: 0, name: home }, away: { id: 0, name: away } }
  };
}

function maskKey_(key) {
  if (!key) return '(vacío)';
  return key.substring(0, 4) + '...' + key.slice(-4);
}
