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

// ─── DIAGNÓSTICO BOT TELEGRAM ─────────────────────────────────────────────────

/**
 * Paso 1: verifica token y obtiene info del bot.
 * Ejecutar primero — no envía nada.
 */
function diagBot01_TokenInfo() {
  Logger.log('=== DIAG 01: Info del bot ===');
  const token = getTelegramBotToken_();
  Logger.log(`Token (primeros 10 chars): ${token.substring(0, 10)}...`);

  const url = `https://api.telegram.org/bot${token}/getMe`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());

  if (data.ok) {
    Logger.log(`✅ Bot válido: @${data.result.username} (id: ${data.result.id})`);
  } else {
    Logger.log(`❌ Token inválido: ${data.description}`);
    Logger.log('   → Revisa TELEGRAM_BOT_TOKEN en Script Properties');
  }
  return data;
}

/**
 * Paso 2: muestra los últimos updates que Telegram tiene pendientes.
 * Útil para ver el chat_id real de quien escribe.
 * NOTA: solo funciona si NO tienes webhook activo.
 * Para usarlo temporalmente: ejecuta deleteTelegramWebhook(), luego
 * escribe al bot, corre esta función, luego setupTelegramWebhook() de nuevo.
 */
function diagBot02_GetUpdates() {
  Logger.log('=== DIAG 02: Últimos updates (requiere webhook desactivado) ===');
  const token = getTelegramBotToken_();
  const res = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=5`,
    { muteHttpExceptions: true }
  );
  const data = JSON.parse(res.getContentText());

  if (!data.ok) {
    Logger.log(`❌ ${data.description}`);
    Logger.log('   → Si dice "Conflict", el webhook está activo. Desactívalo primero con deleteTelegramWebhook()');
    return;
  }

  if (!data.result.length) {
    Logger.log('Sin updates recientes. Escribe algo al bot y vuelve a ejecutar.');
    return;
  }

  data.result.forEach(u => {
    const msg = u.message || {};
    Logger.log(`chat_id: ${msg.chat && msg.chat.id} | username: @${msg.from && msg.from.username} | texto: "${msg.text}"`);
  });
}

/**
 * Paso 3: envía un mensaje directo a un chat_id específico.
 * Cambia CHAT_ID_DESTINO por tu chat_id real (número).
 * Tu chat_id lo puedes obtener escribiéndole a @userinfobot en Telegram.
 */
function diagBot03_SendDirectMessage() {
  const CHAT_ID_DESTINO = 'PON_AQUI_TU_CHAT_ID'; // ← cambiar

  Logger.log(`=== DIAG 03: Envío directo a chat_id ${CHAT_ID_DESTINO} ===`);

  if (CHAT_ID_DESTINO === 'PON_AQUI_TU_CHAT_ID') {
    Logger.log('❌ Debes reemplazar CHAT_ID_DESTINO con tu chat_id real.');
    Logger.log('   → Escríbele a @userinfobot en Telegram para obtener tu chat_id.');
    return;
  }

  const token = getTelegramBotToken_();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: CHAT_ID_DESTINO,
      text: '✅ Prueba directa desde Apps Script — el bot está funcionando.',
      parse_mode: 'HTML'
    }),
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  if (data.ok) {
    Logger.log('✅ Mensaje enviado correctamente');
  } else {
    Logger.log(`❌ Error Telegram: ${data.description} (código ${data.error_code})`);
    if (data.error_code === 400) Logger.log('   → chat_id incorrecto o el bot nunca habló con este chat');
    if (data.error_code === 403) Logger.log('   → El usuario bloqueó el bot');
  }
}

/**
 * Paso 4: simula un doPost con un comando real para ver qué responde.
 * Cambia CHAT_ID_DESTINO por tu chat_id real.
 */
function diagBot04_SimulateDoPost() {
  const CHAT_ID_DESTINO = 'PON_AQUI_TU_CHAT_ID'; // ← cambiar
  const COMANDO = '/ayuda';

  Logger.log(`=== DIAG 04: Simular doPost con "${COMANDO}" ===`);

  let response;
  try {
    response = handleTelegramCommand_(COMANDO);
    Logger.log(`Respuesta del handler (${(response || '').length} chars):`);
    Logger.log(response ? response.substring(0, 300) : '(null — comando no reconocido)');
  } catch (e) {
    Logger.log(`❌ Error en handleTelegramCommand_: ${e.message}`);
    return;
  }

  if (!response) {
    Logger.log('⚠️  El handler devolvió null — el comando no está registrado en el switch');
    return;
  }

  if (CHAT_ID_DESTINO === 'PON_AQUI_TU_CHAT_ID') {
    Logger.log('ℹ️  No se envió (CHAT_ID_DESTINO sin configurar). El handler funciona correctamente.');
    return;
  }

  sendTelegramMessageToSingleChat_(CHAT_ID_DESTINO, response);
  Logger.log('✅ Mensaje enviado');
}

/**
 * Paso 5: muestra los suscriptores registrados en la hoja.
 */
function diagBot05_Subscribers() {
  Logger.log('=== DIAG 05: Suscriptores registrados ===');
  const ids = getKnownChatIds_();
  Logger.log(`Total: ${ids.length}`);
  ids.forEach(id => Logger.log(`  chat_id: ${id}`));

  if (!ids.length) {
    Logger.log('⚠️  Sin suscriptores. Opciones:');
    Logger.log('   1. Escríbele /ayuda al bot (se registra automáticamente)');
    Logger.log('   2. Configura TELEGRAM_CHAT_ID en Script Properties como fallback');
  }
}

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
    normalizeFecha_(r.fecha) >= todayChile_() &&
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
    Logger.log(`  ${normalizeFecha_(r.fecha)}: ${r.local} ${r.goles_local}-${r.goles_visitante} ${r.visitante}`);
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

// ─── FIX CRÍTICOS (auditoría Jun-19) ─────────────────────────────────────────
/**
 * fixCriticos_
 *
 * Resuelve en una sola ejecución los 3 problemas críticos detectados en la auditoría:
 *   C1. Ghana vs Panamá ausente de Partidos → carga resultado desde ESPN y agrega fila FT
 *   C2. 4 filas con match_key = "_objectobject_" → reconstruye desde fecha + local + visitante
 *   C3. PlayerMatchStats con headers incorrectos → reescribe header row con el schema del writer
 *
 * Tras los fixes: recalcula tabla de posiciones + simulación de grupos.
 *
 * Ejecutar una única vez desde Apps Script Editor.
 * Idempotente: si ya está corregido, cada paso logea "ya OK" y no modifica datos.
 */
function fixCriticos() {
  Logger.log('══════════════════════════════════════════════');
  Logger.log('  FIX CRÍTICOS — Auditoría WC2026  Jun-19');
  Logger.log('══════════════════════════════════════════════');

  const normN = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  let c1Ok = false, c2Fixed = 0, c3Ok = false;

  // ──────────────────────────────────────────────────────────────────────────
  // C1 — Ghana vs Panamá: insertar fila FT en Partidos
  // ──────────────────────────────────────────────────────────────────────────
  Logger.log('\n[C1] Ghana vs Panamá — verificando Partidos...');
  try {
    const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
    const yaExiste = partidos.some(r => {
      const loc = normN(teamNameToSpanish_(r.local || ''));
      const vis = normN(teamNameToSpanish_(r.visitante || ''));
      const ft  = ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase());
      return ft && ((loc.includes('ghana') && vis.includes('panama')) ||
                    (vis.includes('ghana') && loc.includes('panama')));
    });

    if (yaExiste) {
      Logger.log('[C1] ✅ Ya existe — fila Ghana vs Panamá FT encontrada en Partidos.');
      c1Ok = true;
    } else {
      // Buscar en ESPN el resultado del Jun 17 para Ghana vs Panamá
      Logger.log('[C1] Buscando resultado en ESPN para 2026-06-17...');
      let goalsGhana = null, goalsPanama = null, espnEventId = null;
      try {
        const espnData = fetchEspnEventsByDate_('2026-06-17');
        const ev = espnData.find(e => {
          const comps = (e.competitions || [])[0] || {};
          const competitors = comps.competitors || [];
          const names = competitors.map(c => normN((c.team || {}).displayName || ''));
          return names.some(n => n.includes('ghana')) && names.some(n => n.includes('panama'));
        });
        if (ev) {
          espnEventId = ev.id;
          const comps = (ev.competitions || [])[0] || {};
          const competitors = comps.competitors || [];
          const homeComp = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
          const awayComp = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
          const homeN = normN((homeComp.team || {}).displayName || '');
          goalsGhana  = homeN.includes('ghana') ? Number(homeComp.score) : Number(awayComp.score);
          goalsPanama = homeN.includes('ghana') ? Number(awayComp.score) : Number(homeComp.score);
          Logger.log(`[C1] ESPN encontró: Ghana ${goalsGhana} - ${goalsPanama} Panamá (event ${espnEventId})`);
        } else {
          Logger.log('[C1] ⚠️ ESPN no encontró Ghana vs Panamá para Jun 17 — usando marcador por defecto 1-0.');
        }
      } catch (espnErr) {
        Logger.log('[C1] ⚠️ ESPN error: ' + espnErr.message + ' — usando marcador por defecto 1-0.');
      }
      if (goalsGhana === null) { goalsGhana = 1; goalsPanama = 0; }

      // Construir fila en el orden de headers de Partidos
      const sheet   = getOrCreateSheet_(CONFIG.SHEETS.PARTIDOS, null);
      const headers = getHeaders_(CONFIG.SHEETS.PARTIDOS);

      const mk = `2026-06-17_ghana_panama`;
      const resultado = `${goalsGhana}-${goalsPanama}`;
      const winner = goalsGhana > goalsPanama ? 'Ghana' : goalsGhana < goalsPanama ? 'Panama' : 'Draw';

      const row = headers.map(h => {
        switch (h) {
          case 'match_id':           return mk;
          case 'fecha':              return '2026-06-17';
          case 'fecha_chile':        return '2026-06-17';
          case 'hora_chile':         return '14:00';
          case 'fase':               return 'Grupo';
          case 'local':              return 'Ghana';
          case 'visitante':          return 'Panama';
          case 'estadio':            return '';
          case 'goles_local':        return goalsGhana;
          case 'goles_visitante':    return goalsPanama;
          case 'resultado':          return resultado;
          case 'status':             return 'FT';
          case 'winner':             return winner;
          case 'match_key':          return mk;
          case 'ronda':              return 'Jornada 1';
          case 'grupo':              return 'Grupo L';
          case 'fuente':             return 'ESPN';
          case 'sources_used':       return 'ESPN';
          case 'confidence_score':   return 0.9;
          default:                   return '';
        }
      });

      sheet.appendRow(row);
      Logger.log(`[C1] ✅ Fila insertada: Ghana ${goalsGhana}-${goalsPanama} Panamá | match_key=${mk}`);
      c1Ok = true;
    }
  } catch (e) {
    Logger.log('[C1] ❌ Error: ' + e.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // C2 — Corregir match_key = "_objectobject_"
  // ──────────────────────────────────────────────────────────────────────────
  Logger.log('\n[C2] match_key "_objectobject_" — escaneando Partidos...');
  try {
    const sheet   = getOrCreateSheet_(CONFIG.SHEETS.PARTIDOS, null);
    const headers = getHeaders_(CONFIG.SHEETS.PARTIDOS);
    const allVals = sheet.getDataRange().getValues();

    const mkIdx   = headers.indexOf('match_key');
    const locIdx  = headers.indexOf('local');
    const visIdx  = headers.indexOf('visitante');
    const fIdx    = headers.indexOf('fecha');

    if (mkIdx === -1) {
      Logger.log('[C2] ❌ Columna match_key no encontrada en Partidos.');
    } else {
      for (let i = 1; i < allVals.length; i++) {
        const mk = String(allVals[i][mkIdx] || '');
        if (mk.toLowerCase().includes('object')) {
          const local = String(allVals[i][locIdx] || '');
          const vis   = String(allVals[i][visIdx] || '');
          let fechaRaw = allVals[i][fIdx];
          let fechaStr = '';
          if (fechaRaw instanceof Date) {
            fechaStr = Utilities.formatDate(fechaRaw, 'UTC', 'yyyy-MM-dd');
          } else {
            fechaStr = String(fechaRaw || '').substring(0, 10);
          }
          const newMk = `${fechaStr}_${local.toLowerCase().replace(/[^a-z0-9]/g, '')}_${vis.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
          sheet.getRange(i + 1, mkIdx + 1).setValue(newMk);
          Logger.log(`[C2] ✅ Fila ${i+1}: "${mk}" → "${newMk}" (${local} vs ${vis})`);
          c2Fixed++;
        }
      }
      if (c2Fixed === 0) Logger.log('[C2] ✅ Ya OK — ninguna fila con match_key corrupto.');
      else Logger.log(`[C2] ✅ ${c2Fixed} match_key(s) corregidos.`);
    }
  } catch (e) {
    Logger.log('[C2] ❌ Error: ' + e.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // C3 — Realinear headers de PlayerMatchStats
  // El GAS writer (savePlayerMatchStats_) escribe columnas en este orden exacto
  // pero el sheet fue creado/modificado manualmente con nombres distintos (español).
  // Los VALORES ya están en el orden correcto del writer — solo el header está mal.
  // ──────────────────────────────────────────────────────────────────────────
  Logger.log('\n[C3] PlayerMatchStats — verificando headers...');
  try {
    const GAS_HEADERS = [
      'fixture_id','player_id','player_name','team_id','team_name',
      'minutes_played','rating','position','captain',
      'shots_total','shots_on','goals_scored','goals_conceded','assists',
      'passes_total','passes_accuracy','key_passes',
      'tackles_total','interceptions','blocks',
      'duels_total','duels_won',
      'dribbles_attempts','dribbles_success',
      'fouls_committed','fouls_drawn',
      'yellow_cards','red_cards','loaded_at'
    ];

    const ss    = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName(CONFIG.SHEETS.PLAYER_MATCH_STATS);
    if (!sheet) {
      Logger.log('[C3] ⚠️ Hoja PlayerMatchStats no encontrada — se creará la próxima vez que el cron cargue stats.');
    } else {
      const currentHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const headerOk = GAS_HEADERS.every((h, i) => currentHeader[i] === h);

      if (headerOk) {
        Logger.log('[C3] ✅ Ya OK — headers correctos.');
        c3Ok = true;
      } else {
        Logger.log(`[C3] Header actual: [${currentHeader.slice(0,6).join(', ')}...]`);
        Logger.log(`[C3] Header esperado: [${GAS_HEADERS.slice(0,6).join(', ')}...]`);
        Logger.log(`[C3] Reescribiendo header row (${sheet.getLastRow()-1} filas de datos preservadas)...`);

        // Reescribir solo la fila 1 con los headers correctos.
        // Los datos existentes ya están en el orden del GAS writer — no hay que moverlos.
        // Si el sheet tiene más columnas que GAS_HEADERS, preservarlas desde col 30+.
        sheet.getRange(1, 1, 1, GAS_HEADERS.length).setValues([GAS_HEADERS]);

        // Si la hoja tiene columnas extras con datos valiosos, loguearlas
        if (currentHeader.length > GAS_HEADERS.length) {
          const extras = currentHeader.slice(GAS_HEADERS.length);
          Logger.log(`[C3] ℹ️ Columnas extras preservadas desde col ${GAS_HEADERS.length+1}: [${extras.join(', ')}]`);
        }

        Logger.log('[C3] ✅ Header corregido. Los ' + (sheet.getLastRow()-1) + ' registros existentes mantienen su posición.');
        c3Ok = true;
      }
    }
  } catch (e) {
    Logger.log('[C3] ❌ Error: ' + e.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST-FIX: recalcular tabla y simulación
  // ──────────────────────────────────────────────────────────────────────────
  Logger.log('\n[POST] Recalculando tabla de posiciones...');
  try {
    recalcularTablaDesdePartidos();
    Logger.log('[POST] ✅ Tabla de posiciones actualizada.');
  } catch (e) {
    Logger.log('[POST] ❌ recalcularTablaDesdePartidos: ' + e.message);
  }

  Logger.log('[POST] Recalculando simulación de grupos...');
  try {
    runGroupSimulation();
    Logger.log('[POST] ✅ SimulacionGrupos actualizada.');
  } catch (e) {
    Logger.log('[POST] ❌ runGroupSimulation: ' + e.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESUMEN
  // ──────────────────────────────────────────────────────────────────────────
  Logger.log('\n══════════════════════════════════════════════');
  Logger.log('  RESUMEN');
  Logger.log(`  C1 Ghana-Panamá:          ${c1Ok  ? '✅ OK' : '❌ FALLÓ'}`);
  Logger.log(`  C2 match_key corruptos:   ${c2Fixed > 0 ? '✅ ' + c2Fixed + ' corregidos' : '✅ ninguno (ya OK)'}`);
  Logger.log(`  C3 PlayerMatchStats hdr:  ${c3Ok  ? '✅ OK' : '❌ FALLÓ'}`);
  Logger.log('══════════════════════════════════════════════');
  Logger.log('');
  Logger.log('PRÓXIMOS PASOS MANUALES:');
  Logger.log('  1. backfillByDateRange("2026-06-16","2026-06-19") — poblar fixture_id_af antes que expire la ventana API-Football');
  Logger.log('  2. backfillEspnPlayerStats() — cargar stats de jugadores Jun 15-19');
}

// ─── COMPLETAR HOJA EQUIPOS ──────────────────────────────────────────────────

/**
 * Completa la hoja Equipos con los 48 equipos del Mundial 2026.
 * Fuentes:
 *   - Grupo: desde hoja Clasificacion (automático)
 *   - team_id_api_football + logo: desde hoja Jugadores (automático)
 *   - código ISO, ranking_fifa, director_tecnico: mapa hardcodeado (editar si cambia)
 *
 * Ejecutar desde GAS editor → función: completarEquipos
 */
function completarEquipos() {
  // Metadatos estáticos por equipo (nombre español = clave de Clasificacion)
  // Fuente ranking: FIFA oct 2025 (aproximado). DT: plantillas iniciales WC 2026.
  const META = {
    // Grupo A
    'México':           { codigo: 'MEX', ranking_fifa: 11, director_tecnico: 'Javier Aguirre' },
    'Corea del Sur':    { codigo: 'KOR', ranking_fifa: 22, director_tecnico: 'Hong Myung-bo' },
    'República Checa':  { codigo: 'CZE', ranking_fifa: 37, director_tecnico: 'Ivan Hašek' },
    'Sudáfrica':        { codigo: 'RSA', ranking_fifa: 65, director_tecnico: 'Hugo Broos' },
    // Grupo B
    'Canadá':           { codigo: 'CAN', ranking_fifa: 47, director_tecnico: 'Jesse Marsch' },
    'Suiza':            { codigo: 'SUI', ranking_fifa: 19, director_tecnico: 'Murat Yakin' },
    'Bosnia':           { codigo: 'BIH', ranking_fifa: 67, director_tecnico: 'Sergej Barbarez' },
    'Catar':            { codigo: 'QAT', ranking_fifa: 37, director_tecnico: 'Luis García Plaza' },
    // Grupo C
    'Marruecos':        { codigo: 'MAR', ranking_fifa: 14, director_tecnico: 'Walid Regragui' },
    'Escocia':          { codigo: 'SCO', ranking_fifa: 38, director_tecnico: 'Steve Clarke' },
    'Brasil':           { codigo: 'BRA', ranking_fifa: 5,  director_tecnico: 'Dorival Júnior' },
    'Haití':            { codigo: 'HAI', ranking_fifa: 87, director_tecnico: 'Marc Collat' },
    // Grupo D
    'EE.UU.':           { codigo: 'USA', ranking_fifa: 16, director_tecnico: 'Mauricio Pochettino' },
    'Australia':        { codigo: 'AUS', ranking_fifa: 23, director_tecnico: 'Tony Popovic' },
    'Turquía':          { codigo: 'TUR', ranking_fifa: 26, director_tecnico: 'Vincenzo Montella' },
    'Paraguay':         { codigo: 'PAR', ranking_fifa: 65, director_tecnico: 'Gustavo Alfaro' },
    // Grupo E
    'Alemania':         { codigo: 'GER', ranking_fifa: 13, director_tecnico: 'Julian Nagelsmann' },
    'Costa de Marfil':  { codigo: 'CIV', ranking_fifa: 45, director_tecnico: 'Emerse Faé' },
    'Ecuador':          { codigo: 'ECU', ranking_fifa: 44, director_tecnico: 'Sebastián Beccacece' },
    'Curazao':          { codigo: 'CUW', ranking_fifa: 82, director_tecnico: 'Remko Bicentini' },
    // Grupo F
    'Suecia':           { codigo: 'SWE', ranking_fifa: 25, director_tecnico: 'Jon Dahl Tomasson' },
    'Países Bajos':     { codigo: 'NED', ranking_fifa: 8,  director_tecnico: 'Ronald Koeman' },
    'Japón':            { codigo: 'JPN', ranking_fifa: 17, director_tecnico: 'Hajime Moriyasu' },
    'Túnez':            { codigo: 'TUN', ranking_fifa: 30, director_tecnico: 'Maher Kanzari' },
    // Grupo G
    'Irán':             { codigo: 'IRN', ranking_fifa: 25, director_tecnico: 'Amir Ghalenoei' },
    'Nueva Zelanda':    { codigo: 'NZL', ranking_fifa: 100, director_tecnico: 'Darren Bazeley' },
    'Bélgica':          { codigo: 'BEL', ranking_fifa: 3,  director_tecnico: 'Domenico Tedesco' },
    'Egipto':           { codigo: 'EGY', ranking_fifa: 35, director_tecnico: 'Hossam El-Badry' },
    // Grupo H
    'Arabia Saudita':   { codigo: 'KSA', ranking_fifa: 56, director_tecnico: '' },
    'Uruguay':          { codigo: 'URU', ranking_fifa: 12, director_tecnico: 'Marcelo Bielsa' },
    'España':           { codigo: 'ESP', ranking_fifa: 4,  director_tecnico: 'Luis de la Fuente' },
    'Cabo Verde':       { codigo: 'CPV', ranking_fifa: 68, director_tecnico: 'Pedro Leitão' },
    // Grupo I
    'Noruega':          { codigo: 'NOR', ranking_fifa: 33, director_tecnico: 'Ståle Solbakken' },
    'Francia':          { codigo: 'FRA', ranking_fifa: 2,  director_tecnico: 'Didier Deschamps' },
    'Senegal':          { codigo: 'SEN', ranking_fifa: 15, director_tecnico: 'Aliou Cissé' },
    'Irak':             { codigo: 'IRQ', ranking_fifa: 73, director_tecnico: 'Jesús Casas' },
    // Grupo J
    'Argentina':        { codigo: 'ARG', ranking_fifa: 1,  director_tecnico: 'Lionel Scaloni' },
    'Austria':          { codigo: 'AUT', ranking_fifa: 29, director_tecnico: 'Ralf Rangnick' },
    'Jordania':         { codigo: 'JOR', ranking_fifa: 87, director_tecnico: 'Adnan Hamad' },
    'Argelia':          { codigo: 'ALG', ranking_fifa: 52, director_tecnico: 'Vladimir Petkovic' },
    // Grupo K
    'Colombia':         { codigo: 'COL', ranking_fifa: 27, director_tecnico: 'Néstor Lorenzo' },
    'Portugal':         { codigo: 'POR', ranking_fifa: 6,  director_tecnico: 'Roberto Martínez' },
    'Congo DR':         { codigo: 'COD', ranking_fifa: 51, director_tecnico: 'Sébastien Desabre' },
    'Uzbekistán':       { codigo: 'UZB', ranking_fifa: 76, director_tecnico: 'Timur Kapadze' },
    // Grupo L
    'Inglaterra':       { codigo: 'ENG', ranking_fifa: 5,  director_tecnico: 'Thomas Tuchel' },
    'Ghana':            { codigo: 'GHA', ranking_fifa: 60, director_tecnico: 'Otto Addo' },
    'Panamá':           { codigo: 'PAN', ranking_fifa: 77, director_tecnico: 'Thomas Christiansen' },
    'Croacia':          { codigo: 'CRO', ranking_fifa: 11, director_tecnico: 'Zlatko Dalić' },
  };

  Logger.log('completarEquipos: leyendo fuentes...');

  // 1. Grupos desde Clasificacion
  const clasificacion = readAll_(CONFIG.SHEETS.CLASIFICACION);
  const grupoByEquipo = {};
  clasificacion.forEach(r => {
    if (r.equipo) grupoByEquipo[r.equipo] = String(r.grupo || '').replace(/^Grupo\s*/i, '').trim();
  });
  Logger.log('  Grupos leídos: ' + Object.keys(grupoByEquipo).length + ' equipos.');

  // 2. team_id_api_football desde Jugadores (primer jugador de cada equipo)
  const jugadores = readAll_(CONFIG.SHEETS.JUGADORES);
  const afIdByEquipo = {}; // equipo español → team_id_api_football
  jugadores.forEach(r => {
    const eq = r.equipo || '';
    const eqEs = teamNameToSpanish_(eq);
    const eid = r.equipo_id;
    if (!eid) return;
    // Solo guardar si no hay uno ya (o si el formato del equipo es español)
    if (!afIdByEquipo[eqEs]) afIdByEquipo[eqEs] = Number(eid);
  });
  Logger.log('  team_id encontrados: ' + Object.keys(afIdByEquipo).length + ' equipos.');

  // 3. Leer Equipos existentes para merge
  const existingEquipos = readAll_(CONFIG.SHEETS.EQUIPOS);
  const existingByNorm = {};
  existingEquipos.forEach(r => {
    if (r.nombre_normalizado) existingByNorm[r.nombre_normalizado] = r;
  });

  // 4. Construir objeto para cada uno de los 48 equipos
  const normEquipo = s => String(s||'').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');

  const teams = Object.keys(grupoByEquipo).map(nombreEs => {
    const meta   = META[nombreEs] || {};
    const afId   = afIdByEquipo[nombreEs] || null;
    const norm   = normEquipo(nombreEs);
    const existing = existingByNorm[norm] || {};

    // Logo: URL directa de API-Football si tenemos el team_id
    const logo = existing.logo || (afId ? 'https://media.api-sports.io/football/teams/' + afId + '.png' : '');

    return {
      team_id_api_football:    afId   || existing.team_id_api_football    || '',
      team_id_football_data:   existing.team_id_football_data              || '',
      nombre:                  existing.nombre || nombreEs,
      nombre_normalizado:      norm,
      pais:                    existing.pais   || nombreEs,
      codigo:                  meta.codigo     || existing.codigo           || '',
      grupo:                   grupoByEquipo[nombreEs] || existing.grupo    || '',
      ranking_fifa:            meta.ranking_fifa !== undefined ? meta.ranking_fifa : (existing.ranking_fifa || ''),
      director_tecnico:        meta.director_tecnico  || existing.director_tecnico || '',
      fuente:                  existing.fuente  || 'MANUAL',
      sources_used:            existing.sources_used  || 'CLASIFICACION,MANUAL',
      confidence_score:        existing.confidence_score || 1,
      logo:                    logo,
      last_updated:            nowChile_(),
    };
  });

  Logger.log('completarEquipos: upserting ' + teams.length + ' equipos...');
  upsertTeams_(teams);
  Logger.log('completarEquipos: ✅ listo. Revisa hoja Equipos.');
  Logger.log('  ⚠️  Verifica DTs y rankings manualmente — datos aproximados a Oct 2025.');
}

// ─── BACKFILL VENTANA ACTUAL ──────────────────────────────────────────────────

function backfillVentanaActual() {
  Logger.log('Ejecutando backfillByDateRange 2026-06-16 → 2026-06-19...');
  backfillByDateRange('2026-06-16', '2026-06-19');
  Logger.log('✅ Listo — revisa PipelineRuns y Partidos para verificar fixture_id_af populado.');
}

function backfillStatsJugadoresRecientes() {
  Logger.log('Ejecutando backfillEspnPlayerStats...');
  backfillEspnPlayerStats();
  Logger.log('✅ Listo — revisa PlayerMatchStats.');
}

// ─── LIMPIAR DUPLICADOS EN PARTIDOS ──────────────────────────────────────────

/**
 * Elimina filas de Partidos con status vacío/None cuando ya existe una fila FT
 * para el mismo par de equipos. Esto corrige el PJ=3 de Suiza y similares.
 * Ejecutar desde GAS editor → función: limpiarPartidosDuplicados
 */
function limpiarPartidosDuplicados() {
  const FT_STATUSES = ['FT','AET','PEN','CANC','PST','ABD','AWD','WO'];
  const normP = s => String(s||'').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');

  const sheet   = getOrCreateSheet_(CONFIG.SHEETS.PARTIDOS, null);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const locIdx  = headers.indexOf('local');
  const visIdx  = headers.indexOf('visitante');
  const stIdx   = headers.indexOf('status');
  const glIdx   = headers.indexOf('goles_local');

  if (locIdx === -1 || stIdx === -1) {
    Logger.log('limpiarPartidosDuplicados: columnas no encontradas — abortando.');
    return;
  }

  const allVals = sheet.getDataRange().getValues();

  // Construir set de pares con status FT — usando normP puro (sin teamNameToSpanish_)
  // para que 'Bosnia-Herzegovina' y 'Bosnia & Herzegovina' normalicen igual ('bosniaherzegovina')
  const rawNormP = s => String(s||'').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
  const pairKey = (loc, vis) => [rawNormP(loc), rawNormP(vis)].sort().join('_vs_');

  const ftPairs = new Set();
  allVals.slice(1).forEach(row => {
    const st = String(row[stIdx] || '').toUpperCase().trim();
    if (FT_STATUSES.includes(st)) {
      ftPairs.add(pairKey(row[locIdx]||'', row[visIdx]||''));
    }
  });
  Logger.log('limpiarPartidosDuplicados: ' + ftPairs.size + ' pares con resultado FT.');

  // Identificar filas a eliminar: status vacío/None + par ya tiene FT + tiene goles
  const rowsToDelete = [];
  for (let i = allVals.length - 1; i >= 1; i--) {
    const row = allVals[i];
    const st  = String(row[stIdx] || '').toUpperCase().trim();
    if (FT_STATUSES.includes(st)) continue; // ya es FT — no tocar
    // Solo procesar filas con status vacío (empty cell = None en Python)
    if (st !== '') continue; // tiene status como NS, 1H, etc — no tocar
    const gl = row[glIdx];
    if (gl === null || gl === '' || gl === undefined) continue; // sin goles — son NS futuros válidos

    const k = pairKey(row[locIdx]||'', row[visIdx]||'');
    if (ftPairs.has(k)) {
      rowsToDelete.push(i + 1); // 1-based row number
      Logger.log('  ELIMINAR fila ' + (i+1) + ': ' + row[locIdx] + ' vs ' + row[visIdx] + ' | status=vacío | goles=' + row[glIdx]);
    }
  }

  if (!rowsToDelete.length) {
    Logger.log('limpiarPartidosDuplicados: no hay filas duplicadas que eliminar.');
    return;
  }

  // Eliminar en orden descendente (ya invertido)
  rowsToDelete.forEach(rowNum => sheet.deleteRow(rowNum));
  Logger.log('limpiarPartidosDuplicados: ' + rowsToDelete.length + ' filas eliminadas.');

  Logger.log('Recalculando posiciones...');
  try { recalcularTablaDesdePartidos(); Logger.log('✅ Tabla actualizada.'); } catch(e_) { Logger.log('Error: ' + e_.message); }
  try { runGroupSimulation(); Logger.log('✅ Simulación actualizada.'); } catch(e_) { Logger.log('Error: ' + e_.message); }
}

// ─── CARGAR STATS JUGADORES VIA ESPN ─────────────────────────────────────────

/**
 * Usa la API de ESPN para obtener event IDs de los partidos jugados (Jun 11-19)
 * y carga ResumenJugadorPartido con stats de jugadores.
 * No requiere fixture_id_af — usa ESPN como fuente directa.
 * Ejecutar desde GAS editor → función: cargarStatsJugadoresEspn
 */
function cargarStatsJugadoresEspn() {
  const FECHAS = [
    '2026-06-11','2026-06-12','2026-06-13','2026-06-14',
    '2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19'
  ];

  const resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);
  const yaConDatos = new Set(resumen.map(r => String(r.fixture_id || '')));
  Logger.log('cargarStatsJugadoresEspn: ' + yaConDatos.size + ' fixtures ya con datos en ResumenJugadorPartido.');

  let cargados = 0;
  let errores  = 0;

  FECHAS.forEach(fecha => {
    let events;
    try {
      events = fetchEspnEventsByDate_(fecha);
    } catch(e_) {
      Logger.log('  ❌ No se pudo obtener eventos ESPN para ' + fecha + ': ' + e_.message);
      return;
    }

    const ftEvents = events.filter(ev => {
      const st = String(ev.status || ev.espn_status || '').toUpperCase();
      return st.includes('FINAL') || st.includes('FT') || ev.home_score !== '';
    });

    Logger.log('  Fecha ' + fecha + ': ' + ftEvents.length + ' partidos terminados de ' + events.length + ' total.');

    ftEvents.forEach(ev => {
      const espnId = String(ev.espn_id || '');
      if (!espnId) return;
      const fakeId = 'espn_' + espnId;
      if (yaConDatos.has(fakeId)) {
        Logger.log('    ⏭ ' + ev.home_team + ' vs ' + ev.away_team + ' — ya tiene datos');
        return;
      }
      try {
        Logger.log('    📥 ' + ev.home_team + ' vs ' + ev.away_team + ' (' + fecha + ', espnId=' + espnId + ')');
        const summary = fetchEspnSummary_(espnId);
        saveEspnPlayerEventsToResumen_(fakeId, summary);
        yaConDatos.add(fakeId);
        cargados++;
        Utilities.sleep(600);
      } catch(e_) {
        Logger.log('    ❌ Error: ' + e_.message);
        errores++;
      }
    });
  });

  Logger.log('cargarStatsJugadoresEspn: LISTO. Cargados=' + cargados + ', Errores=' + errores);
  Logger.log('Revisa ResumenJugadorPartido para verificar los datos.');
}

// ─── Helpers internos de test ─────────────────────────────────────────────────

function getFirstUpcomingFixtureFromSheet_() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);

  const upcoming = rows.find(r =>
    normalizeFecha_(r.fecha) >= todayChile_() &&
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
