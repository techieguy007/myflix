const axios = require('axios');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { loadConfig } = require('./config');
const logger = require('./logger');

const HASH_CHUNK_SIZE = 64 * 1024;
const UINT64_MASK = (1n << 64n) - 1n;
const DEFAULT_BASE_URL = 'https://api.opensubtitles.com/api/v1';
const DEFAULT_RETRY_DELAYS_MS = [800, 1800, 3500];
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EHOSTUNREACH'
]);
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const requestAgents = {
  httpAgent: new http.Agent({ keepAlive: false }),
  httpsAgent: new https.Agent({ keepAlive: false })
};

let authState = {
  token: null,
  baseUrl: null,
  loginAt: 0
};

class OpenSubtitlesError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'OpenSubtitlesError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function currentSubtitleConfig() {
  const config = loadConfig();
  return {
    languages: normalizeLanguages(config.subtitles?.languages),
    opensubtitles: config.subtitles?.opensubtitles || {}
  };
}

function normalizeLanguages(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,\s;]+/);
  return values
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  const input = String(value || DEFAULT_BASE_URL).trim();
  if (!input) return DEFAULT_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return withProtocol.replace(/\/+$/, '').replace(/\/api\/v1$/i, '') + '/api/v1';
}

function apiHeaders(osConfig, token = null) {
  const headers = {
    'Api-Key': osConfig.apiKey,
    'User-Agent': osConfig.userAgent || 'MyFlix v1.0.0',
    Accept: 'application/json'
  };
  if (token) {
    headers.Authorization = token;
  }
  return headers;
}

function assertConfigured(osConfig) {
  if (!osConfig.apiKey) {
    throw new OpenSubtitlesError(
      'OpenSubtitles API key is not configured. Add subtitles.opensubtitles.apiKey to config/myflix.local.json.',
      400
    );
  }
}

function sanitizeRequestUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).split('?')[0].slice(0, 200);
  }
}

function errorMessageFromResponse(data) {
  if (!data) return null;
  if (typeof data === 'string') return data.slice(0, 300);
  return data.message || data.error || null;
}

function sanitizedApiError(error) {
  const data = error.response?.data;
  return {
    status: error.response?.status || error.statusCode || null,
    code: error.code || null,
    errno: error.errno || null,
    syscall: error.syscall || null,
    hostname: error.hostname || null,
    message: errorMessageFromResponse(data) || error.message,
    errors: data && typeof data === 'object' ? data.errors || null : null,
    url: sanitizeRequestUrl(error.config?.url)
  };
}

function isRetryableApiError(error) {
  const status = error.response?.status;
  if (status && RETRYABLE_STATUS_CODES.has(Number(status))) return true;
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('socket hang up')
    || message.includes('connection reset')
    || message.includes('network error')
    || message.includes('timeout');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestWithRetries(operation, meta = {}) {
  const {
    label = 'opensubtitles.request',
    endpoint = null,
    method = null,
    retries = DEFAULT_RETRY_DELAYS_MS.length,
    retryDelays = DEFAULT_RETRY_DELAYS_MS
  } = meta;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry = attempt <= retries && isRetryableApiError(error);
      const details = sanitizedApiError(error);
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)] || 1000;
      logger.warn('opensubtitles.request_retry', {
        label,
        endpoint,
        method,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts: retries + 1,
        delayMs,
        error: details
      });
      await delay(delayMs);
    }
  }

  throw new OpenSubtitlesError('OpenSubtitles request failed after retries.', 502);
}

async function ensureLogin(osConfig) {
  if (!osConfig.username || !osConfig.password) {
    return null;
  }

  const ageMs = Date.now() - authState.loginAt;
  if (authState.token && ageMs < 6 * 60 * 60 * 1000) {
    return authState;
  }

  const baseUrl = normalizeBaseUrl(osConfig.baseUrl);
  try {
    const response = await requestWithRetries(
      () => axios.post(
        `${baseUrl}/login`,
        {
          username: osConfig.username,
          password: osConfig.password
        },
        {
          headers: {
            ...apiHeaders(osConfig),
            'Content-Type': 'application/json'
          },
          timeout: 30000,
          ...requestAgents
        }
      ),
      {
        label: 'opensubtitles.login',
        endpoint: '/login',
        method: 'POST',
        retries: 2
      }
    );

    const token = response.data?.token;
    if (!token) {
      throw new OpenSubtitlesError('OpenSubtitles login did not return a token.', 502);
    }

    authState = {
      token,
      baseUrl: normalizeBaseUrl(response.data?.base_url || osConfig.baseUrl || baseUrl),
      loginAt: Date.now()
    };
    logger.info('opensubtitles.login_success', {
      level: response.data?.user?.level || null,
      allowedDownloads: response.data?.user?.allowed_downloads || null,
      baseUrl: authState.baseUrl
    });
    return authState;
  } catch (error) {
    const details = sanitizedApiError(error);
    logger.error('opensubtitles.login_failed', { error: details });
    throw new OpenSubtitlesError(
      details.message || 'OpenSubtitles login failed.',
      details.status || 502,
      details
    );
  }
}

function buildApiUrl(baseUrl, endpoint, params = {}) {
  const url = new URL(endpoint.replace(/^\//, ''), `${normalizeBaseUrl(baseUrl)}/`);
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

async function apiGet(osConfig, endpoint, params = {}, token = null) {
  const baseUrl = authState.baseUrl || osConfig.baseUrl || DEFAULT_BASE_URL;
  try {
    const response = await requestWithRetries(
      () => axios.get(buildApiUrl(baseUrl, endpoint, params), {
        headers: apiHeaders(osConfig, token),
        timeout: 30000,
        maxRedirects: 5,
        ...requestAgents
      }),
      {
        label: 'opensubtitles.api_get',
        endpoint,
        method: 'GET'
      }
    );
    return response.data;
  } catch (error) {
    const details = sanitizedApiError(error);
    logger.error('opensubtitles.get_failed', {
      endpoint,
      params: { ...params, apiKey: undefined },
      error: details
    });
    throw new OpenSubtitlesError(
      details.message || 'OpenSubtitles request failed.',
      details.status || 502,
      details
    );
  }
}

async function apiPost(osConfig, endpoint, body = {}, token = null) {
  const baseUrl = authState.baseUrl || osConfig.baseUrl || DEFAULT_BASE_URL;
  try {
    const response = await requestWithRetries(
      () => axios.post(`${normalizeBaseUrl(baseUrl)}${endpoint}`, body, {
        headers: {
          ...apiHeaders(osConfig, token),
          'Content-Type': 'application/json'
        },
        timeout: 30000,
        maxRedirects: 5,
        ...requestAgents
      }),
      {
        label: 'opensubtitles.api_post',
        endpoint,
        method: 'POST',
        retries: endpoint === '/download' ? 1 : 2
      },
    );
    return response.data;
  } catch (error) {
    const details = sanitizedApiError(error);
    logger.error('opensubtitles.post_failed', {
      endpoint,
      body: { ...body, file_id: body.file_id || null },
      error: details
    });
    throw new OpenSubtitlesError(
      details.message || 'OpenSubtitles request failed.',
      details.status || 502,
      details
    );
  }
}

async function calculateMovieHash(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (stat.size < HASH_CHUNK_SIZE * 2) {
    throw new OpenSubtitlesError('Video file is too small for OpenSubtitles hash lookup.', 400);
  }

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const first = Buffer.alloc(HASH_CHUNK_SIZE);
    const last = Buffer.alloc(HASH_CHUNK_SIZE);
    const firstRead = await handle.read(first, 0, HASH_CHUNK_SIZE, 0);
    const lastRead = await handle.read(last, 0, HASH_CHUNK_SIZE, stat.size - HASH_CHUNK_SIZE);
    let hash = BigInt(stat.size);

    const addChunk = (buffer, bytesRead) => {
      for (let offset = 0; offset + 8 <= bytesRead; offset += 8) {
        hash = (hash + buffer.readBigUInt64LE(offset)) & UINT64_MASK;
      }
    };

    addChunk(first, firstRead.bytesRead);
    addChunk(last, lastRead.bytesRead);
    return {
      movieHash: hash.toString(16).padStart(16, '0'),
      movieByteSize: stat.size
    };
  } finally {
    await handle.close();
  }
}

function normalizeImdbId(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^tt/, '');
  const trimmed = raw.replace(/^0+/, '');
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function movieQuery(movie, overrideQuery = '') {
  if (overrideQuery) return overrideQuery;
  if (movie.media_type === 'episode') {
    return movie.series_title || movie.title;
  }
  return movie.title || path.basename(movie.video_path || '');
}

function searchPlansForMovie(movie, hashInfo, languages, overrideQuery = '') {
  const plans = [];
  const languageText = languages.join(',');
  const fileName = path.basename(movie.video_path || '');
  const imdbId = normalizeImdbId(movie.imdb_id);
  const query = movieQuery(movie, overrideQuery);

  if (hashInfo?.movieHash) {
    plans.push({
      name: 'moviehash-filename',
      params: {
        languages: languageText,
        moviehash: hashInfo.movieHash,
        query: fileName
      }
    });
  }

  if (imdbId) {
    const params = {
      imdb_id: imdbId,
      languages: languageText
    };
    if (movie.media_type === 'episode') {
      if (movie.season_number) params.season_number = movie.season_number;
      if (movie.episode_number) params.episode_number = movie.episode_number;
    }
    plans.push({ name: 'imdb', params });
  }

  if (query) {
    const params = {
      languages: languageText,
      query
    };
    if (movie.release_year) params.year = movie.release_year;
    if (movie.media_type === 'episode') {
      if (movie.season_number) params.season_number = movie.season_number;
      if (movie.episode_number) params.episode_number = movie.episode_number;
      params.type = 'episode';
    }
    plans.push({ name: 'title', params });
  }

  return plans;
}

function flattenSubtitleResults(data, sourcePlan) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.flatMap((row) => {
    const attrs = row.attributes || {};
    const files = Array.isArray(attrs.files) ? attrs.files : [];
    return files.map((file) => ({
      id: `${attrs.subtitle_id || row.id}-${file.file_id}`,
      subtitleId: attrs.subtitle_id || row.id,
      fileId: file.file_id,
      fileName: file.file_name,
      language: attrs.language || 'und',
      release: attrs.release || file.file_name || '',
      fps: attrs.fps || null,
      votes: attrs.votes || 0,
      ratings: attrs.ratings || 0,
      downloadCount: attrs.download_count || attrs.new_download_count || 0,
      hearingImpaired: Boolean(attrs.hearing_impaired),
      hd: Boolean(attrs.hd),
      foreignPartsOnly: Boolean(attrs.foreign_parts_only),
      trusted: Boolean(attrs.from_trusted),
      machineTranslated: Boolean(attrs.machine_translated || attrs.ai_translated),
      movieHashMatch: Boolean(attrs.moviehash_match),
      featureTitle: attrs.feature_details?.title || '',
      featureYear: attrs.feature_details?.year || null,
      sourcePlan
    }));
  });
}

function rankSubtitleResult(result) {
  let score = 0;
  if (result.movieHashMatch) score += 10000;
  if (result.trusted) score += 500;
  if (result.hd) score += 100;
  if (!result.hearingImpaired) score += 50;
  if (!result.machineTranslated) score += 25;
  score += Number(result.ratings || 0) * 10;
  score += Math.min(100, Number(result.downloadCount || 0) / 100);
  return score;
}

async function searchSubtitlesForMovie(movie, options = {}) {
  const { languages: defaultLanguages, opensubtitles } = currentSubtitleConfig();
  const osConfig = opensubtitles;
  assertConfigured(osConfig);

  const languages = normalizeLanguages(options.languages || defaultLanguages);
  if (languages.length === 0) {
    throw new OpenSubtitlesError('At least one subtitle language is required.', 400);
  }

  const login = await ensureLogin(osConfig);
  const hashInfo = await calculateMovieHash(movie.video_path);
  const plans = searchPlansForMovie(movie, hashInfo, languages, options.query);
  const seen = new Set();
  const results = [];
  const usedPlans = [];

  for (const plan of plans) {
    const data = await apiGet(osConfig, '/subtitles', plan.params, login?.token || null);
    usedPlans.push(plan.name);
    for (const result of flattenSubtitleResults(data, plan.name)) {
      if (!result.fileId || seen.has(String(result.fileId))) continue;
      seen.add(String(result.fileId));
      results.push(result);
    }
    if (results.some((item) => item.movieHashMatch) || results.length >= 12) {
      break;
    }
  }

  results.sort((a, b) => rankSubtitleResult(b) - rankSubtitleResult(a));
  logger.info('opensubtitles.search_complete', {
    movieId: movie.id,
    title: movie.title,
    languages,
    movieHash: hashInfo.movieHash,
    resultCount: results.length,
    usedPlans
  });

  return {
    languages,
    movieHash: hashInfo.movieHash,
    movieByteSize: hashInfo.movieByteSize,
    usedPlans,
    results: results.slice(0, 30)
  };
}

function safeFileToken(value, fallback = 'subtitle') {
  const token = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || fallback;
}

function subtitleSidecarPath(videoPath, details) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const language = safeFileToken(details.language, 'und');
  const fileId = safeFileToken(details.fileId, 'file');
  return path.join(dir, `${base}.${language}.opensubtitles-${fileId}.vtt`);
}

function decodeSubtitleBuffer(buffer) {
  let output = buffer;
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    output = zlib.gunzipSync(buffer);
  }
  return output.toString('utf8').replace(/^\uFEFF/, '');
}

function toWebVtt(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimStart();
  if (/^WEBVTT\b/i.test(normalized)) {
    return normalized;
  }
  return `WEBVTT\n\n${normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}\n`;
}

async function downloadSubtitleForMovie(movie, options = {}) {
  const { opensubtitles } = currentSubtitleConfig();
  const osConfig = opensubtitles;
  assertConfigured(osConfig);

  const fileId = Number(options.fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw new OpenSubtitlesError('A valid OpenSubtitles fileId is required.', 400);
  }

  const login = await ensureLogin(osConfig);
  const downloadData = await apiPost(osConfig, '/download', {
    file_id: fileId,
    sub_format: osConfig.downloadFormat || 'webvtt',
    file_name: options.fileName || undefined
  }, login?.token || null);

  if (!downloadData?.link) {
    throw new OpenSubtitlesError('OpenSubtitles did not return a subtitle download link.', 502);
  }

  let response;
  try {
    response = await requestWithRetries(
      () => axios.get(downloadData.link, {
        responseType: 'arraybuffer',
        timeout: 90000,
        maxRedirects: 5,
        headers: {
          Accept: 'text/vtt,text/plain,application/octet-stream,*/*',
          'User-Agent': osConfig.userAgent || 'MyFlix v1.0.0'
        },
        ...requestAgents
      }),
      {
        label: 'opensubtitles.subtitle_file_download',
        endpoint: sanitizeRequestUrl(downloadData.link),
        method: 'GET'
      }
    );
  } catch (error) {
    const details = sanitizedApiError(error);
    logger.error('opensubtitles.download_file_failed', {
      movieId: movie.id,
      title: movie.title,
      fileId,
      language: options.language || 'und',
      error: details
    });
    throw new OpenSubtitlesError(
      details.message || 'Subtitle file download failed after retries.',
      details.status || 502,
      details
    );
  }

  const text = decodeSubtitleBuffer(Buffer.from(response.data));
  const vtt = toWebVtt(text);
  const outputPath = subtitleSidecarPath(movie.video_path, {
    language: options.language || 'und',
    fileId
  });

  await fs.promises.writeFile(outputPath, vtt, 'utf8');
  logger.info('opensubtitles.download_complete', {
    movieId: movie.id,
    title: movie.title,
    fileId,
    language: options.language || 'und',
    outputPath,
    requests: downloadData.requests || null,
    remaining: downloadData.remaining || null
  });

  return {
    fileId,
    language: options.language || 'und',
    fileName: path.basename(outputPath),
    path: outputPath,
    bytes: Buffer.byteLength(vtt, 'utf8'),
    requests: downloadData.requests || null,
    remaining: downloadData.remaining || null
  };
}

module.exports = {
  OpenSubtitlesError,
  calculateMovieHash,
  downloadSubtitleForMovie,
  normalizeLanguages,
  searchSubtitlesForMovie
};
