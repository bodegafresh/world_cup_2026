function fetchNewsForFixture_(fixture) {
  // Chequear si ya hay noticias en la hoja para este fixture
  const fixtureId = String(fixture.fixture.id || '');
  if (fixtureId) {
    const existing = readAll_(CONFIG.SHEETS.NOTICIAS).filter(r =>
      String(r.fixture_id || '') === fixtureId
    );
    if (existing.length >= 3) {
      return existing.map(r => ({
        query:   r.query   || '',
        title:   r.titulo  || r.title || '',
        link:    r.link    || r.url   || '',
        pubDate: r.fecha   || r.published_at || '',
        source:  r.fuente  || r.source || 'cache'
      }));
    }
  }

  const home = fixture.teams.home.name;
  const away = fixture.teams.away.name;

  const queries = [
    `world cup 2026 ${home}`,
    `world cup 2026 ${away}`,
    `mundial 2026 ${home}`,
    `mundial 2026 ${away}`
  ];

  let items = [];

  queries.forEach(q => {
    const url = 'https://news.google.com/rss/search?q=' +
      encodeURIComponent(q) +
      '&hl=es-419&gl=CL&ceid=CL:es-419';

    try {
      const xml = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
      const parsed = XmlService.parse(xml);
      const channel = parsed.getRootElement().getChild('channel');
      const newsItems = channel.getChildren('item').slice(0, 5).map(item => ({
        query: q,
        title: item.getChildText('title'),
        link: item.getChildText('link'),
        pubDate: item.getChildText('pubDate'),
        source: 'Google News RSS'
      }));

      items = items.concat(newsItems);
    } catch (e) {
      console.warn(`Error RSS ${q}: ${e.message}`);
    }
  });

  return dedupeNews_(items);
}

function dedupeNews_(items) {
  const seen = {};
  return items.filter(item => {
    const key = hash_(item.title + item.link);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function saveNewsForFixture_(fixture, news) {
  // Dedup: no insertar noticias cuyo hash ya existe en la hoja
  let existingHashes = {};
  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(CONFIG.SHEETS.NOTICIAS);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
        .forEach(r => { if (r[0]) existingHashes[String(r[0])] = true; });
    }
  } catch (e) { /* hoja aún no existe */ }

  const rows = news
    .map(item => [
      hash_(item.title + item.link),
      safe_(item.pubDate),
      nowChile_(),
      '',
      '',
      safe_(item.title),
      'previa',
      'PENDIENTE_CLASIFICAR',
      safe_(item.link),
      safe_(item.source),
      fixture.fixture.id,
      safe_(fixture.teams.home.name),
      safe_(fixture.teams.away.name)
    ])
    .filter(row => !existingHashes[String(row[0])]);

  if (rows.length) appendRows_(CONFIG.SHEETS.NOTICIAS, rows);
}