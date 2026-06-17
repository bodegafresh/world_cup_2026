/**
 * VenueCatalog.gs
 *
 * Responsabilidad:
 * - Resolver país real del estadio, coordenadas y zona horaria.
 * - Evitar depender de que API-Football entregue país del venue.
 * - Preparar la base para clima, distancia, ciudad y análisis de sede.
 */

const VENUE_CATALOG = {
  'SoFi Stadium|Inglewood': {
    pais_estadio: 'United States',
    lat: 33.9535,
    lon: -118.3392,
    timezone_estadio: 'America/Los_Angeles'
  },

  "Levi's Stadium|Santa Clara": {
    pais_estadio: 'United States',
    lat: 37.4030,
    lon: -121.9700,
    timezone_estadio: 'America/Los_Angeles'
  },

  "Levi's Stadium|San Francisco Bay Area": {
    pais_estadio: 'United States',
    lat: 37.4030,
    lon: -121.9700,
    timezone_estadio: 'America/Los_Angeles'
  },

  'MetLife Stadium|East Rutherford': {
    pais_estadio: 'United States',
    lat: 40.8135,
    lon: -74.0745,
    timezone_estadio: 'America/New_York'
  },

  'Gillette Stadium|Foxborough': {
    pais_estadio: 'United States',
    lat: 42.0909,
    lon: -71.2643,
    timezone_estadio: 'America/New_York'
  },

  'Gillette Stadium|Boston': {
    pais_estadio: 'United States',
    lat: 42.0909,
    lon: -71.2643,
    timezone_estadio: 'America/New_York'
  },

  'NRG Stadium|Houston': {
    pais_estadio: 'United States',
    lat: 29.6847,
    lon: -95.4107,
    timezone_estadio: 'America/Chicago'
  },

  'AT&T Stadium|Arlington': {
    pais_estadio: 'United States',
    lat: 32.7473,
    lon: -97.0945,
    timezone_estadio: 'America/Chicago'
  },

  'Lincoln Financial Field|Philadelphia': {
    pais_estadio: 'United States',
    lat: 39.9008,
    lon: -75.1675,
    timezone_estadio: 'America/New_York'
  },

  'Mercedes-Benz Stadium|Atlanta': {
    pais_estadio: 'United States',
    lat: 33.7554,
    lon: -84.4008,
    timezone_estadio: 'America/New_York'
  },

  'Hard Rock Stadium|Miami Gardens': {
    pais_estadio: 'United States',
    lat: 25.9580,
    lon: -80.2389,
    timezone_estadio: 'America/New_York'
  },

  'Arrowhead Stadium|Kansas City': {
    pais_estadio: 'United States',
    lat: 39.0490,
    lon: -94.4839,
    timezone_estadio: 'America/Chicago'
  },

  'Lumen Field|Seattle': {
    pais_estadio: 'United States',
    lat: 47.5952,
    lon: -122.3316,
    timezone_estadio: 'America/Los_Angeles'
  },

  'BC Place|Vancouver': {
    pais_estadio: 'Canada',
    lat: 49.2768,
    lon: -123.1119,
    timezone_estadio: 'America/Vancouver'
  },

  'BMO Field|Toronto': {
    pais_estadio: 'Canada',
    lat: 43.6332,
    lon: -79.4186,
    timezone_estadio: 'America/Toronto'
  },

  'Estadio Akron|Guadalajara': {
    pais_estadio: 'Mexico',
    lat: 20.6817,
    lon: -103.4626,
    timezone_estadio: 'America/Mexico_City'
  },

  'Estadio Azteca|Mexico City': {
    pais_estadio: 'Mexico',
    lat: 19.3029,
    lon: -99.1505,
    timezone_estadio: 'America/Mexico_City'
  },

  'Estadio BBVA|Monterrey': {
    pais_estadio: 'Mexico',
    lat: 25.6682,
    lon: -100.2446,
    timezone_estadio: 'America/Monterrey'
  }
};

function getVenueInfo_(venueName, cityName) {
  const directKey = `${safe_(venueName)}|${safe_(cityName)}`;

  if (VENUE_CATALOG[directKey]) {
    return VENUE_CATALOG[directKey];
  }

  const normalizedVenue = normalizeVenueKey_(venueName);
  const normalizedCity = normalizeVenueKey_(cityName);

  const foundKey = Object.keys(VENUE_CATALOG).find(key => {
    const parts = key.split('|');
    const catalogVenue = normalizeVenueKey_(parts[0]);
    const catalogCity = normalizeVenueKey_(parts[1]);

    return catalogVenue === normalizedVenue && catalogCity === normalizedCity;
  });

  if (foundKey) {
    return VENUE_CATALOG[foundKey];
  }

  // Fallback 1: buscar solo por nombre de estadio, ignorando la ciudad.
  const venueOnlyKey = Object.keys(VENUE_CATALOG).find(key => {
    const catalogVenue = normalizeVenueKey_(key.split('|')[0]);
    return catalogVenue === normalizedVenue;
  });
  if (venueOnlyKey) return VENUE_CATALOG[venueOnlyKey];

  // Fallback 2: coincidencia parcial — el nombre ESPN puede ser abreviado o distinto
  // Ej: "AT&T Stadium" matchea "AT&T Stadium|Arlington"
  const partialKey = Object.keys(VENUE_CATALOG).find(key => {
    const catalogVenue = normalizeVenueKey_(key.split('|')[0]);
    return catalogVenue.includes(normalizedVenue) || normalizedVenue.includes(catalogVenue);
  });
  if (partialKey) return VENUE_CATALOG[partialKey];

  return {
    pais_estadio: '',
    lat: '',
    lon: '',
    timezone_estadio: ''
  };
}

function normalizeVenueKey_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}