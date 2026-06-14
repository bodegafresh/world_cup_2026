function buildAiPreviewInput_(fixture, weather, news, baseOdds) {
  return {
    fixture_id: fixture.fixture.id,
    match: {
      home: fixture.teams.home.name,
      away: fixture.teams.away.name,
      date_utc: fixture.fixture.date,
      date_chile: toChileDateTime_(fixture.fixture.date),
      venue: fixture.fixture.venue
    },
    league: fixture.league,
    weather,
    news: news.slice(0, 10),
    base_model: baseOdds
  };
}

function analyzeFixtureWithAi_(input) {
  const prompt = buildFixturePreviewPrompt_(input);

  const payload = {
    model: CONFIG.OPENAI.MODEL,
    input: prompt,
    temperature: 0.2,
    text: {
      format: {
        type: 'json_object'
      }
    }
  };

  const response = UrlFetchApp.fetch(CONFIG.OPENAI.BASE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${getOpenAiKey_()}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`OpenAI error ${status}: ${text}`);
  }

  const data = JSON.parse(text);

  const outputText = extractOpenAiText_(data);
  return JSON.parse(outputText);
}

function extractOpenAiText_(data) {
  if (data.output_text) return data.output_text;

  if (data.output && data.output.length) {
    const message = data.output.find(o => o.type === 'message');
    if (message && message.content && message.content.length) {
      const textPart = message.content.find(c => c.type === 'output_text');
      if (textPart) return textPart.text;
    }
  }

  throw new Error('No se pudo extraer texto de respuesta OpenAI');
}

function saveAiAnalysis_(fixture, aiResult) {
  appendRows_(CONFIG.SHEETS.AI_ANALYSIS, [[
    fixture.fixture.id,
    safe_(fixture.teams.home.name),
    safe_(fixture.teams.away.name),
    toChileDateTime_(fixture.fixture.date),
    JSON.stringify(aiResult.probabilidades_basicas || {}),
    safe_(aiResult.confianza_modelo),
    safe_(aiResult.resumen_previa),
    safe_(aiResult.mensaje_telegram),
    JSON.stringify(aiResult.factores_clave || []),
    JSON.stringify(aiResult.alertas || []),
    nowChile_(),
    'OpenAI'
  ]]);
}