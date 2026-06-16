/**
 * UpsetDetector.gs
 *
 * Detecta partidos donde el modelo ELO y las cuotas de mercado discrepan
 * en cuál equipo es favorito. Una alta divergencia puede indicar valor
 * estadístico en el underdog según el modelo.
 *
 * Comando bot: /upsets
 */

/**
 * Construye el texto de upsets para el comando /upsets del bot.
 * Lee EvOpportunities + Partidos; compara favorito ELO vs favorito de mercado.
 */
function buildUpsetRankingText_() {
  let evRows;
  try {
    evRows = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES);
  } catch (e) {
    return '📊 Sin datos de EV. Ejecuta cronEvCalculation o cronTomorrowPreview primero.';
  }

  if (!evRows.length) {
    return '🎯 Sin oportunidades EV calculadas para los próximos partidos.';
  }

  // Agrupar por fixture_id
  const byFixture = {};
  evRows.forEach(r => {
    const k = String(r.fixture_id || '');
    if (!k) return;
    if (!byFixture[k]) byFixture[k] = [];
    byFixture[k].push(r);
  });

  let partidos;
  try { partidos = readAll_(CONFIG.SHEETS.PARTIDOS); } catch (e) { partidos = []; }

  const upsets = [];

  Object.entries(byFixture).forEach(([fid, rows]) => {
    // Buscar el partido en Partidos
    const matchRow = partidos.find(r =>
      String(r.fixture_id_af || r.match_id || '') === fid
    );
    if (!matchRow) return;

    const home = matchRow.local     || '';
    const away = matchRow.visitante || '';
    if (!home || !away) return;

    // No analizar partidos ya terminados
    const status = String(matchRow.status || matchRow.estado || '').toUpperCase();
    if (['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD'].includes(status)) return;

    // ELO dice quién es favorito
    let eloProbs;
    try { eloProbs = getEloProbabilities_(home, away); } catch (e) { return; }
    if (!eloProbs) return;

    const eloFavorite = eloProbs.home > eloProbs.away ? home : away;

    // Mercado dice quién es favorito (usando prob implícita de cuotas)
    // La prob implícita = 1 / cuota. Si cuota < cuota_rival → favorito implícito
    const h1x2 = rows.filter(r => String(r.mercado || '').toUpperCase() === '1X2');

    // Buscar fila home y away por nombre de selección
    const homeRow = h1x2.find(r => {
      const sel = String(r.seleccion || '').toLowerCase();
      return sel.includes(home.toLowerCase().substring(0, 4)) ||
             sel.includes('home') || sel.includes('local');
    });
    const awayRow = h1x2.find(r => {
      const sel = String(r.seleccion || '').toLowerCase();
      return sel.includes(away.toLowerCase().substring(0, 4)) ||
             sel.includes('away') || sel.includes('visitante');
    });

    if (!homeRow || !awayRow) return;

    const cuotaHome = Number(homeRow.cuota || 0);
    const cuotaAway = Number(awayRow.cuota || 0);
    if (cuotaHome <= 0 || cuotaAway <= 0) return;

    const probImpHome = 1 / cuotaHome;
    const probImpAway = 1 / cuotaAway;
    const marketFavorite = probImpHome > probImpAway ? home : away;

    // Solo reportar divergencias
    if (eloFavorite === marketFavorite) return;

    const eloEdge   = Math.abs(eloProbs.home - eloProbs.away);
    const marketEdge = Math.abs(probImpHome - probImpAway);
    const evUnderdog = eloFavorite === home
      ? Number(homeRow.ev || 0)
      : Number(awayRow.ev || 0);

    upsets.push({
      home, away, fid,
      eloFavorite, marketFavorite,
      eloEdge, marketEdge, evUnderdog,
      fecha: matchRow.fecha || '', hora: matchRow.hora_chile || ''
    });
  });

  if (!upsets.length) {
    return [
      '🎯 <b>Upsets Probables — ELO vs Mercado</b>',
      '',
      'No hay divergencias entre el modelo ELO y las cuotas de mercado.',
      '',
      '<i>Cuando ELO y el mercado coinciden en el favorito, no hay señal de upset.</i>'
    ].join('\n');
  }

  // Ordenar por edge ELO (mayor discrepancia primero)
  upsets.sort((a, b) => b.eloEdge - a.eloEdge);

  let msg = `🎯 <b>Upsets Probables — ELO vs Mercado</b>\n`;
  msg    += `<i>Partidos donde el modelo y las cuotas favorecen equipos distintos</i>\n\n`;

  upsets.slice(0, 5).forEach(u => {
    const evStr = u.evUnderdog > 0
      ? ` | EV <code>+${(u.evUnderdog * 100).toFixed(1)}%</code>`
      : '';
    const fechaStr = u.fecha ? ` (${u.fecha}${u.hora ? ' ' + u.hora : ''})` : '';

    msg += `⚡ <b>${u.home} vs ${u.away}</b>${fechaStr}\n`;
    msg += `  📊 ELO favorece: <b>${u.eloFavorite}</b> (edge ${(u.eloEdge * 100).toFixed(0)}%)\n`;
    msg += `  💰 Mercado favorece: <b>${u.marketFavorite}</b>${evStr}\n\n`;
  });

  msg += `<i>⚠️ Alta divergencia ELO/mercado = posible valor en el underdog según el modelo.\n`;
  msg += `No es garantía — el mercado también tiene información valiosa.</i>`;

  return msg;
}
