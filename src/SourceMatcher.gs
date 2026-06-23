/**
 * SourceMatcher.gs
 *
 * Responsabilidad:
 * - Construir match_key estable.
 * - Normalizar nombres de selecciones.
 * - Match entre API-Football y football-data.org.
 */

function buildMatchKey_(homeName, awayName, dateUtc) {
  const date = String(dateUtc || '').substring(0, 10);
  const home = normalizeTeamNameStrong_(homeName);
  const away = normalizeTeamNameStrong_(awayName);

  return `${date}_${home}_${away}`;
}

function normalizeTeamNameStrong_(name) {
  return canonicalTeamNameKey_(name);
}

function matchSourcesByDate_(apiFixturesWrapped, fdMatchesWrapped) {
  const afNormalized = apiFixturesWrapped.map(item => {
    return normalizeApiFootballFixture_(item.fixture_raw, item.raw_file_url || '');
  });

  const fdNormalized = fdMatchesWrapped.map(item => {
    return normalizeFootballDataMatch_(item.match_raw, item.raw_file_url || '');
  });

  const mappings = [];

  afNormalized.forEach(af => {
    const afKey = buildMatchKey_(af.home_team_name, af.away_team_name, af.date_utc);

    let bestMatch = null;
    let bestScore = 0;

    fdNormalized.forEach(fd => {
      const score = calculateMatchSimilarity_(af, fd);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = fd;
      }
    });

    if (bestMatch && bestScore >= 0.75) {
      mappings.push({
        match_key: afKey,
        api_football: af,
        football_data: bestMatch,
        confidence: bestScore,
        mapping_method: 'date_home_away_similarity'
      });
    } else {
      mappings.push({
        match_key: afKey,
        api_football: af,
        football_data: null,
        confidence: bestScore,
        mapping_method: 'unmatched'
      });
    }
  });

  return mappings;
}

function calculateMatchSimilarity_(a, b) {
  let score = 0;

  const dateA = String(a.date_utc || '').substring(0, 10);
  const dateB = String(b.date_utc || '').substring(0, 10);

  if (dateA === dateB) score += 0.4;

  const homeA = normalizeTeamNameStrong_(a.home_team_name);
  const homeB = normalizeTeamNameStrong_(b.home_team_name);
  const awayA = normalizeTeamNameStrong_(a.away_team_name);
  const awayB = normalizeTeamNameStrong_(b.away_team_name);

  if (homeA === homeB) score += 0.3;
  else if (homeA.includes(homeB) || homeB.includes(homeA)) score += 0.2;

  if (awayA === awayB) score += 0.3;
  else if (awayA.includes(awayB) || awayB.includes(awayA)) score += 0.2;

  return score;
}
