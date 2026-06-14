function calculateBasicOddsSignals_(fixture) {
  return {
    fixture_id: fixture.fixture.id,
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    markets: [
      {
        market: '1X2',
        selection: fixture.teams.home.name,
        model_probability: 0.33,
        confidence: 'BAJA',
        reason: 'Modelo base inicial sin suficiente data histórica'
      },
      {
        market: '1X2',
        selection: 'Empate',
        model_probability: 0.34,
        confidence: 'BAJA',
        reason: 'Modelo base inicial sin suficiente data histórica'
      },
      {
        market: '1X2',
        selection: fixture.teams.away.name,
        model_probability: 0.33,
        confidence: 'BAJA',
        reason: 'Modelo base inicial sin suficiente data histórica'
      },
      {
        market: 'Over/Under 2.5',
        selection: 'Over 2.5',
        model_probability: 0.50,
        confidence: 'BAJA',
        reason: 'Sin datos suficientes'
      },
      {
        market: 'Ambos anotan',
        selection: 'Sí',
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
    'MODELO_INTERNO',
    m.market,
    m.selection,
    '',
    m.model_probability,
    '',
    nowChile_(),
    m.confidence,
    m.reason
  ]);

  appendRows_(CONFIG.SHEETS.ODDS, rows);
}