/**
 * AiAnalysis.gs
 *
 * Integración con OpenAI para análisis de previa de partidos.
 * Usa buildEnrichedPreviewInput_ (MatchPreview.gs) para contexto completo:
 * clima, cuotas, noticias, suspensiones, lesiones, tabla del grupo, H2H, forma.
 */

function buildAiPreviewInput_(fixture, weather, news, baseOdds) {
  return buildEnrichedPreviewInput_(fixture, weather, news, baseOdds);
}

function getAiAnalysisFromCache_(fixtureId) {
  if (!fixtureId) return null;
  const rows = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
  const row = rows.find(r => String(r.fixture_id) === String(fixtureId));
  if (!row || !row.resumen_previa) return null;

  const probs = parseSafeJson_(row.prob_local ? JSON.stringify({
    home_win: row.prob_local, draw: row.prob_empate, away_win: row.prob_visitante,
    over_2_5: row.over_2_5, btts_yes: row.btts
  }) : '{}', {});

  return {
    probabilidades:        probs,
    probabilidades_basicas: probs,
    confianza_modelo:      row.confianza      || '',
    resumen_previa:        row.resumen_previa || '',
    mensaje_telegram:      row.mensaje_telegram || '',
    factores_clave:        parseSafeJson_(row.factores_clave, []),
    bajas_y_suspensiones:  parseSafeJson_(row.bajas_suspensiones || row.bajas_y_suspensiones, []),
    jugadores_en_forma:    parseSafeJson_(row.jugadores_forma || row.jugadores_en_forma, []),
    contexto_grupo:        parseSafeJson_(row.contexto_grupo, {}),
    alertas:               parseSafeJson_(row.alertas, []),
    _from_cache:           true
  };
}

function analyzeFixtureWithAi_(input) {
  // Retornar análisis guardado si existe — no volver a llamar a OpenAI
  const fixtureId = input.fixture_id || (input.match && input.match.fixture_id);
  if (fixtureId) {
    const cached = getAiAnalysisFromCache_(fixtureId);
    if (cached) {
      Logger.log(`AnalisisIA: usando cache para fixture ${fixtureId}`);
      return cached;
    }
  }

  const prompt = buildFixturePreviewPrompt_(input);

  const payload = {
    model: CONFIG.OPENAI.MODEL,
    input: prompt,
    temperature: 0.2,
    text: {
      format: { type: 'json_object' }
    }
  };

  const response = UrlFetchApp.fetch(CONFIG.OPENAI.BASE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${getOpenAiKey_()}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text   = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`OpenAI error ${status}: ${text}`);
  }

  const data       = JSON.parse(text);
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

  if (data.choices && data.choices.length) {
    const msg = data.choices[0].message;
    if (msg && msg.content) return msg.content;
  }

  throw new Error('No se pudo extraer texto de respuesta OpenAI: ' + JSON.stringify(data).substring(0, 300));
}

function saveAiAnalysis_(fixture, aiResult) {
  const existing = getExistingIds_(CONFIG.SHEETS.AI_ANALYSIS, 'fixture_id');
  if (existing[String(fixture.fixture.id)]) {
    updateAiAnalysis_(fixture.fixture.id, aiResult);
    return;
  }

  const probs = aiResult.probabilidades || aiResult.probabilidades_basicas || {};

  appendRows_(CONFIG.SHEETS.AI_ANALYSIS, [[
    fixture.fixture.id,
    safe_(fixture.teams.home.name),
    safe_(fixture.teams.away.name),
    toChileDateTime_(fixture.fixture.date),
    safe_(probs.home_win),
    safe_(probs.draw),
    safe_(probs.away_win),
    safe_(probs.over_2_5),
    safe_(probs.btts_yes),
    safe_(aiResult.confianza_modelo),
    safe_(aiResult.resumen_previa),
    safe_(aiResult.mensaje_telegram),
    JSON.stringify(aiResult.factores_clave      || []),
    JSON.stringify(aiResult.bajas_y_suspensiones|| []),
    JSON.stringify(aiResult.jugadores_en_forma  || []),
    JSON.stringify(aiResult.contexto_grupo      || {}),
    JSON.stringify(aiResult.alertas             || []),
    nowChile_(),
    'OpenAI'
  ]]);
}

function updateAiAnalysis_(fixtureId, aiResult) {
  const sheet  = getSheet_(CONFIG.SHEETS.AI_ANALYSIS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const fidIdx  = headers.indexOf('fixture_id');

  const rowIdx = values.slice(1).findIndex(r => String(r[fidIdx]) === String(fixtureId));
  if (rowIdx === -1) return;

  const probs = aiResult.probabilidades || aiResult.probabilidades_basicas || {};
  const row   = rowIdx + 2;

  const update = {
    prob_local:              probs.home_win,
    prob_empate:             probs.draw,
    prob_visitante:          probs.away_win,
    over_2_5:                probs.over_2_5,
    btts:                    probs.btts_yes,
    confianza:               aiResult.confianza_modelo,
    resumen_previa:          aiResult.resumen_previa,
    mensaje_telegram:        aiResult.mensaje_telegram,
    factores_clave:          JSON.stringify(aiResult.factores_clave       || []),
    bajas_suspensiones:      JSON.stringify(aiResult.bajas_y_suspensiones || []),
    jugadores_forma:         JSON.stringify(aiResult.jugadores_en_forma   || []),
    contexto_grupo:          JSON.stringify(aiResult.contexto_grupo       || {}),
    alertas:                 JSON.stringify(aiResult.alertas              || []),
    updated_at:              nowChile_()
  };

  Object.keys(update).forEach(field => {
    const colIdx = headers.indexOf(field);
    if (colIdx !== -1) {
      sheet.getRange(row, colIdx + 1).setValue(safe_(update[field]));
    }
  });
}
