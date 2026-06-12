const axios = require('axios');
const logger = require('./logger');

const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const omdbKeyCooldowns = new Map();

function normalizeOmdbMovie(data) {
  if (!data || data.Response !== 'True') return null;
  return {
    title: data.Title || null,
    year: data.Year && data.Year !== 'N/A' ? Number(String(data.Year).slice(0, 4)) : null,
    genre: data.Genre && data.Genre !== 'N/A' ? data.Genre : null,
    director: data.Director && data.Director !== 'N/A' ? data.Director : null,
    actors: data.Actors && data.Actors !== 'N/A' ? data.Actors : null,
    plot: data.Plot && data.Plot !== 'N/A' ? data.Plot : null,
    poster: data.Poster && data.Poster !== 'N/A' ? data.Poster : null,
    imdbRating: data.imdbRating && data.imdbRating !== 'N/A' ? Number(data.imdbRating) : null,
    imdbID: data.imdbID || null,
    runtime: data.Runtime && data.Runtime !== 'N/A' ? data.Runtime : null,
    rated: data.Rated && data.Rated !== 'N/A' ? data.Rated : null,
    country: data.Country && data.Country !== 'N/A' ? data.Country : null,
    language: data.Language && data.Language !== 'N/A' ? data.Language : null,
    awards: data.Awards && data.Awards !== 'N/A' ? data.Awards : null,
    source: 'omdb'
  };
}

function omdbKeys(config) {
  return Array.from(new Set([
    ...(config.metadata.omdbApiKeys || []),
    config.metadata.omdbApiKey
  ].filter(Boolean)));
}

function shouldTryNextKey(errorMessage) {
  return /api key|limit|account|unauthorized|invalid|disabled/i.test(errorMessage || '');
}

function nextDailyReset() {
  const reset = new Date();
  reset.setHours(24, 10, 0, 0);
  return reset;
}

function isKeyCoolingDown(key) {
  const disabledUntil = omdbKeyCooldowns.get(key);
  if (!disabledUntil) return false;

  if (disabledUntil <= Date.now()) {
    omdbKeyCooldowns.delete(key);
    return false;
  }

  return true;
}

function activeOmdbKeys(config) {
  return omdbKeys(config)
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !isKeyCoolingDown(key));
}

function isKeyUnavailable(errorMessage, statusCode) {
  return statusCode === 401
    || /api key|limit|account|unauthorized|invalid|disabled/i.test(errorMessage || '');
}

function temporarilyDisableKey(key, index, reason, statusCode = null) {
  if (isKeyCoolingDown(key)) return;

  const disabledUntil = nextDailyReset();
  omdbKeyCooldowns.set(key, disabledUntil.getTime());
  logger.warn('metadata.omdb_key_temporarily_disabled', {
    keyIndex: index + 1,
    disabledUntil: disabledUntil.toISOString(),
    statusCode,
    reason
  });
}

function isMetadataTemporarilyUnavailable(config) {
  if (!config.metadata.enabled || omdbKeys(config).length === 0) {
    return false;
  }

  return activeOmdbKeys(config).length === 0;
}

function buildOmdbParams(parsed) {
  const params = {
    plot: 'full'
  };

  if (parsed.mediaType === 'episode') {
    params.t = parsed.seriesTitle;
    params.Season = parsed.seasonNumber;
    params.Episode = parsed.episodeNumber;
    params.type = 'episode';
  } else {
    params.t = parsed.title;
    params.type = 'movie';
    if (parsed.releaseYear) {
      params.y = parsed.releaseYear;
    }
  }

  return params;
}

async function fetchOmdbMetadata(parsed, config) {
  const keys = activeOmdbKeys(config);
  if (!config.metadata.enabled || omdbKeys(config).length === 0) {
    return null;
  }

  if (keys.length === 0) {
    return null;
  }

  const baseParams = buildOmdbParams(parsed);
  let lastKeyError = null;

  for (let index = 0; index < keys.length; index += 1) {
    const keyInfo = keys[index];
    try {
      const response = await axios.get(OMDB_BASE_URL, {
        params: { ...baseParams, apikey: keyInfo.key },
        timeout: 10000
      });

      if (response.data && response.data.Response === 'True') {
        return normalizeOmdbMovie(response.data);
      }

      const errorMessage = response.data && response.data.Error ? response.data.Error : '';
      if (!shouldTryNextKey(errorMessage)) {
        return null;
      }

      if (isKeyUnavailable(errorMessage, response.status)) {
        temporarilyDisableKey(keyInfo.key, keyInfo.index, errorMessage, response.status);
      }
      lastKeyError = new Error(`OMDb key ${keyInfo.index + 1} failed: ${errorMessage}`);
    } catch (error) {
      const statusCode = error.response && error.response.status;
      const responseError = error.response && error.response.data && error.response.data.Error;
      const errorMessage = responseError || error.message;
      if (isKeyUnavailable(errorMessage, statusCode)) {
        temporarilyDisableKey(keyInfo.key, keyInfo.index, errorMessage, statusCode || null);
      }
      lastKeyError = new Error(`OMDb key ${keyInfo.index + 1} request failed: ${errorMessage}`);
    }
  }

  if (lastKeyError) {
    throw lastKeyError;
  }
  return null;
}

async function fetchMetadata(parsed, config) {
  if ((config.metadata.provider || 'omdb').toLowerCase() !== 'omdb') {
    return null;
  }
  return fetchOmdbMetadata(parsed, config);
}

module.exports = {
  fetchMetadata,
  isMetadataTemporarilyUnavailable
};
