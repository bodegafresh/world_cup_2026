function fetchNewsForFixture_(fixture) {
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
  const rows = news.map(item => [
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
  ]);

  appendRows_(CONFIG.SHEETS.NOTICIAS, rows);
}