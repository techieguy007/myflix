const axios = require('axios');

const OMDB_BASE_URL = 'https://www.omdbapi.com/';

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

async function fetchOmdbMetadata(parsed, config) {
  const apiKey = config.metadata.omdbApiKey;
  if (!config.metadata.enabled || !apiKey) {
    return null;
  }

  const params = {
    apikey: apiKey,
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

  const response = await axios.get(OMDB_BASE_URL, { params, timeout: 10000 });
  return normalizeOmdbMovie(response.data);
}

async function fetchMetadata(parsed, config) {
  if ((config.metadata.provider || 'omdb').toLowerCase() !== 'omdb') {
    return null;
  }
  return fetchOmdbMetadata(parsed, config);
}

module.exports = {
  fetchMetadata
};
