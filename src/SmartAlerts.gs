/**
 * SmartAlerts.gs
 *
 * Alertas inteligentes basadas en umbrales para el Mundial 2026.
 *
 * Detecta automáticamente:
 * 1. Jugadores con tarjetas amarillas acumuladas (riesgo de suspensión)
 * 2. Clima extremo en el estadio del próximo partido
 * 3. Movimiento de cuotas > 10% entre el día anterior y hoy
 *
 * Se llama desde cronTomorrowPreview() para cada fixture del día siguiente.
 */

const YELLOW_SUSPENSION_THRESHOLD = 2;
const ODDS_MOVEMENT_THRESHOLD     = 0.10;
const RAIN_ALERT_THRESHOLD        = 60;
const HEAT_ALERT_THRESHOLD        = 34;
const WIND_ALERT_THRESHOLD        = 45;

/**
 * Evalúa todas las alertas inteligentes para los fixtures de mañana.
 * Envía un mensaje consolidado si hay algo relevante.
 */
function runSmartAlertsForTomorrow_() {
  const date   = tomorrowChile_();
  const allRows = readAll_(CONFIG.SHEETS.PARTIDOS);
  const tomorrow = allRows.filter(r => String(r.fecha) === date);

  if (!tomorrow.length) return;

  const alertMessages = [];

  tomorrow.forEach(fixture => {
    const fixtureId = fixture.fixture_id_af || fixture.match_id || '';
    const home = fixture.local || '';
    const away = fixture.visitante || '';
    const label = `${home} vs ${away}`;

    const yellowAlerts = checkYellowCardAccumulation_(home, away);
    if (yellowAlerts.length) {
      alertMessages.push(`🟨 <b>Riesgo suspensión (${label})</b>`);
      yellowAlerts.forEach(a => alertMessages.push(`  • ${a}`));
    }

    const weatherAlert = checkWeatherAlert_(fixtureId, fixture.ciudad || '');
    if (weatherAlert) {
      alertMessages.push(`🌦 <b>Clima extremo (${label})</b>`);
      alertMessages.push(`  • ${weatherAlert}`);
    }

    const oddsAlert = checkOddsMovement_(fixtureId);
    if (oddsAlert) {
      alertMessages.push(`📈 <b>Movimiento de cuotas (${label})</b>`);
      alertMessages.push(`  • ${oddsAlert}`);
    }

    // EV+ — requiere cuotas reales ya cargadas en OddsApuestas
    try {
      const fixtureObj = buildFixtureFromSheetRow_(fixture);
      if (fixtureObj.fixture.id) {
        const evOpps    = calculateEvForFixture_(fixtureObj);
        const positivas = evOpps.filter(o => o.es_positivo && o.confianza !== 'BAJA');
        if (positivas.length) {
          alertMessages.push(`📊 <b>EV+ detectado (${label})</b>`);
          positivas.slice(0, 2).forEach(o =>
            alertMessages.push(
              `  • ${o.seleccion} @ ${o.cuota.toFixed(2)} — EV +${(o.ev * 100).toFixed(1)}% | Kelly ${(o.kelly * 100).toFixed(1)}%`
            )
          );
        }
      }
    } catch (e_) { console.warn(`EV check ${label}:`, e_.message); }
  });

  if (alertMessages.length) {
    const msg = ['⚡ <b>Alertas Inteligentes — Mañana</b>', ''].concat(alertMessages).join('\n');
    try {
      sendTelegramMessage_(msg);
    } catch (e) {
      console.warn('SmartAlerts Telegram error:', e.message);
    }
  }
}

// ─── 1. Tarjetas amarillas acumuladas ─────────────────────────────────────────

function checkYellowCardAccumulation_(homeTeam, awayTeam) {
  const alerts = [];

  try {
    const playerRows = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

    const yellowsByPlayer = {};

    playerRows.forEach(r => {
      const equipo = String(r.team_name || r.equipo || '').toLowerCase();
      if (!equipo.includes(homeTeam.toLowerCase()) &&
          !equipo.includes(awayTeam.toLowerCase())) return;

      const key = String(r.player_id || r.player_name || '');
      if (!key) return;

      if (!yellowsByPlayer[key]) {
        yellowsByPlayer[key] = {
          nombre: r.player_name || r.jugador || key,
          equipo: r.team_name || r.equipo || '',
          amarillas: 0
        };
      }

      yellowsByPlayer[key].amarillas += Number(r.yellow_cards || r.amarillas || 0);
    });

    Object.values(yellowsByPlayer)
      .filter(p => p.amarillas >= YELLOW_SUSPENSION_THRESHOLD)
      .forEach(p => {
        alerts.push(`${p.nombre} (${p.equipo}) — ${p.amarillas} amarillas acumuladas`);
      });
  } catch (e) {
    console.warn('checkYellowCardAccumulation_ error:', e.message);
  }

  return alerts;
}

// ─── 2. Clima extremo ─────────────────────────────────────────────────────────

function checkWeatherAlert_(fixtureId, ciudad) {
  try {
    const weatherRows = readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA);

    const row = weatherRows
      .filter(r => String(r.fixture_id || '') === String(fixtureId) ||
                   String(r.ciudad || '').toLowerCase() === (ciudad || '').toLowerCase())
      .slice(-1)[0];

    if (!row) return null;

    const temp = Number(row.temperatura_c);
    const rain = Number(row.prob_lluvia);
    const wind = Number(row.viento_kmh);
    const cond = String(row.condicion || '');

    if (rain >= RAIN_ALERT_THRESHOLD) {
      return `Lluvia probable: ${rain}% — condición: ${cond}`;
    }
    if (temp >= HEAT_ALERT_THRESHOLD) {
      return `Calor extremo: ${temp}°C — puede afectar el ritmo del partido`;
    }
    if (wind >= WIND_ALERT_THRESHOLD) {
      return `Viento fuerte: ${wind} km/h — puede afectar juego aéreo`;
    }
  } catch (e) {
    console.warn('checkWeatherAlert_ error:', e.message);
  }

  return null;
}

// ─── 3. Movimiento de cuotas ──────────────────────────────────────────────────

function checkOddsMovement_(fixtureId) {
  try {
    const oddsRows = readAll_(CONFIG.SHEETS.ODDS)
      .filter(r => String(r.fixture_id || '') === String(fixtureId) &&
                   String(r.mercado || '') === '1X2' &&
                   String(r.fuente || '') !== 'MODELO_INTERNO');

    if (oddsRows.length < 2) return null;

    const sorted = oddsRows.sort((a, b) =>
      String(a.timestamp || '').localeCompare(String(b.timestamp || ''))
    );

    const first = sorted[0];
    const last  = sorted[sorted.length - 1];

    const firstProb = Number(first.probabilidad_modelo);
    const lastProb  = Number(last.probabilidad_modelo);

    if (!firstProb || !lastProb) return null;

    const movement = Math.abs(lastProb - firstProb) / firstProb;

    if (movement >= ODDS_MOVEMENT_THRESHOLD) {
      const dir = lastProb > firstProb ? '↑' : '↓';
      const sel = first.seleccion || '';
      return `${sel}: ${pct_(firstProb)} → ${pct_(lastProb)} ${dir} (${Math.round(movement * 100)}% movimiento)`;
    }
  } catch (e) {
    console.warn('checkOddsMovement_ error:', e.message);
  }

  return null;
}
