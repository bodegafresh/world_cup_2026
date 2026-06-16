/**
 * OddsModel.gs
 *
 * Calcula señales de probabilidad para cada fixture.
 * Fuente primaria: The Odds API (cuotas de mercado reales, con vig removal).
 * Fallback: modelo base uniforme con confidence=BAJA cuando no hay datos.
 */

function calculateBasicOddsSignals_(fixture) {
  const homeTeam = fixture.teams.home.name;
  const awayTeam = fixture.teams.away.name;

  const realOdds = fetchOddsForMatch_(homeTeam, awayTeam);

  if (realOdds && realOdds.prob_local !== null) {
    return buildOddsSignalsFromReal_(fixture, realOdds);
  }

  console.warn(`Sin cuotas reales para ${homeTeam} vs ${awayTeam}. Usando modelo base.`);
  return buildFallbackOddsSignals_(fixture);
}

function buildOddsSignalsFromReal_(fixture, odds) {
  const homeTeam = fixture.teams.home.name;
  const awayTeam = fixture.teams.away.name;
  const bkCount = odds.bookmakers_count || 1;
  const confidence = bkCount >= 3 ? 'ALTA' : bkCount >= 1 ? 'MEDIA' : 'BAJA';
  const reasonSuffix = `(${bkCount} bookmakers, vig removal aplicado)`;

  return {
    fixture_id: fixture.fixture.id,
    home: homeTeam,
    away: awayTeam,
    markets: [
      {
        market: '1X2',
        selection: homeTeam,
        odd: odds.odd_local,
        model_probability: odds.prob_local,
        confidence,
        reason: `Cuota mercado ${odds.odd_local ? odds.odd_local.toFixed(2) : 'N/A'} → prob ${pct_(odds.prob_local)} ${reasonSuffix}`
      },
      {
        market: '1X2',
        selection: 'Empate',
        odd: odds.odd_empate,
        model_probability: odds.prob_empate,
        confidence,
        reason: `Cuota mercado ${odds.odd_empate ? odds.odd_empate.toFixed(2) : 'N/A'} → prob ${pct_(odds.prob_empate)} ${reasonSuffix}`
      },
      {
        market: '1X2',
        selection: awayTeam,
        odd: odds.odd_visitante,
        model_probability: odds.prob_visitante,
        confidence,
        reason: `Cuota mercado ${odds.odd_visitante ? odds.odd_visitante.toFixed(2) : 'N/A'} → prob ${pct_(odds.prob_visitante)} ${reasonSuffix}`
      },
      {
        market: 'Over/Under 2.5',
        selection: 'Over 2.5',
        odd: null,
        model_probability: odds.over25_prob,
        confidence: odds.over25_prob !== null ? confidence : 'BAJA',
        reason: odds.over25_prob !== null
          ? `Mercado totals → prob over ${pct_(odds.over25_prob)} ${reasonSuffix}`
          : 'Sin datos de totals en mercado'
      },
      {
        market: 'Ambos anotan',
        selection: 'Sí',
        odd: null,
        model_probability: odds.btts_prob,
        confidence: odds.btts_prob !== null ? confidence : 'BAJA',
        reason: odds.btts_prob !== null
          ? `Mercado btts → prob ${pct_(odds.btts_prob)} ${reasonSuffix}`
          : 'Sin datos de btts en mercado'
      }
    ]
  };
}

function buildFallbackOddsSignals_(fixture) {
  const homeTeam = fixture.teams.home.name;
  const awayTeam = fixture.teams.away.name;

  return {
    fixture_id: fixture.fixture.id,
    home: homeTeam,
    away: awayTeam,
    markets: [
      {
        market: '1X2',
        selection: homeTeam,
        odd: null,
        model_probability: 0.33,
        confidence: 'BAJA',
        reason: 'Modelo base inicial sin datos de mercado'
      },
      {
        market: '1X2',
        selection: 'Empate',
        odd: null,
        model_probability: 0.34,
        confidence: 'BAJA',
        reason: 'Modelo base inicial sin datos de mercado'
      },
      {
        market: '1X2',
        selection: awayTeam,
        odd: null,
        model_probability: 0.33,
        confidence: 'BAJA',
        reason: 'Modelo base inicial sin datos de mercado'
      },
      {
        market: 'Over/Under 2.5',
        selection: 'Over 2.5',
        odd: null,
        model_probability: 0.50,
        confidence: 'BAJA',
        reason: 'Sin datos suficientes'
      },
      {
        market: 'Ambos anotan',
        selection: 'Sí',
        odd: null,
        model_probability: 0.50,
        confidence: 'BAJA',
        reason: 'Sin datos suficientes'
      }
    ]
  };
}

function saveOddsSignals_(fixture, baseOdds) {
  const rows = baseOdds.markets.map(m => [
    fixture.fixture.id,
    m.odd ? 'THE_ODDS_API' : 'MODELO_INTERNO',
    m.market,
    m.selection,
    safe_(m.odd),
    safe_(m.model_probability),
    '',
    nowChile_(),
    m.confidence,
    m.reason
  ]);

  appendRows_(CONFIG.SHEETS.ODDS, rows);
}

function pct_(prob) {
  if (prob === null || prob === undefined) return 'N/A';
  return `${Math.round(prob * 100)}%`;
}
