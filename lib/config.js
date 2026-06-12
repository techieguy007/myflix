const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'myflix.config.json');

const defaults = {
  taskName: 'MyFlixLocalStreaming',
  server: {
    host: '0.0.0.0',
    port: 5000,
    nodeEnv: 'production',
    https: {
      enabled: false,
      port: 5443,
      keyPath: '',
      certPath: '',
      pfxPath: '',
      passphrase: '',
      caPath: '',
      redirectHttp: false
    }
  },
  auth: {
    sessionDays: 180
  },
  media: {
    root: 'D:\\movies',
    autoScanOnStart: true,
    scanDelayMs: 2500,
    minFileSizeMB: 1,
    minDurationMinutes: 15,
    renameMode: 'suggest'
  },
  metadata: {
    provider: 'omdb',
    enabled: true,
    omdbApiKey: '',
    omdbApiKeys: [],
    maxRequestsPerScan: 25
  },
  subtitles: {
    provider: 'opensubtitles',
    languages: ['en', 'hi'],
    opensubtitles: {
      apiKey: '',
      username: '',
      password: '',
      userAgent: 'MyFlix v1.0.0',
      baseUrl: 'https://api.opensubtitles.com/api/v1',
      downloadFormat: 'webvtt'
    }
  },
  transcoding: {
    ffmpegPath: '',
    ffprobePath: '',
    ffmpegThreads: 2,
    ffmpegPreset: 'ultrafast',
    realtime: true,
    prepareOnStartup: false,
    preparedMaxStartupJobs: 0,
    deleteOriginalAfterPrepare: false,
    deleteOriginalWithMultipleAudio: false,
    deleteOriginalWithEmbeddedSubtitles: false
  },
  service: {
    nodeExe: 'node',
    logDirectory: 'logs',
    logLevel: 'info',
    openBrowserOnStart: false,
    stopExistingOnPort: false
  }
};

function mergeConfig(base, override) {
  const next = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeConfig(base[key] || {}, value);
    } else if (value !== undefined && value !== null && value !== '') {
      next[key] = value;
    }
  });
  return next;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function localConfigPathFor(configPath) {
  const ext = path.extname(configPath) || '.json';
  const baseName = path.basename(configPath, ext).replace(/\.config$/i, '');
  return path.join(path.dirname(configPath), `${baseName}.local${ext}`);
}

function splitKeys(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(splitKeys);
  }
  return String(value)
    .split(/[,\s;]+/)
    .map((key) => key.trim())
    .filter(Boolean);
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function loadConfig(configPath = process.env.MYFLIX_CONFIG || DEFAULT_CONFIG_PATH) {
  const fileConfig = readJsonIfExists(configPath);
  const localConfig = readJsonIfExists(localConfigPathFor(configPath));

  let config = mergeConfig(defaults, fileConfig);
  config = mergeConfig(config, localConfig);

  config.server.host = process.env.HOST || process.env.MYFLIX_HOST || config.server.host;
  config.server.port = Number(process.env.PORT || process.env.MYFLIX_PORT || config.server.port);
  config.server.nodeEnv = process.env.NODE_ENV || config.server.nodeEnv;
  if (process.env.MYFLIX_HTTPS_ENABLED !== undefined) {
    config.server.https.enabled = process.env.MYFLIX_HTTPS_ENABLED === 'true';
  }
  config.server.https.port = Number(process.env.MYFLIX_HTTPS_PORT || config.server.https.port || 5443);
  config.server.https.keyPath = process.env.MYFLIX_HTTPS_KEY_PATH || config.server.https.keyPath;
  config.server.https.certPath = process.env.MYFLIX_HTTPS_CERT_PATH || config.server.https.certPath;
  config.server.https.pfxPath = process.env.MYFLIX_HTTPS_PFX_PATH || config.server.https.pfxPath;
  config.server.https.passphrase = process.env.MYFLIX_HTTPS_PASSPHRASE || config.server.https.passphrase;
  config.server.https.caPath = process.env.MYFLIX_HTTPS_CA_PATH || config.server.https.caPath;
  if (process.env.MYFLIX_HTTPS_REDIRECT_HTTP !== undefined) {
    config.server.https.redirectHttp = process.env.MYFLIX_HTTPS_REDIRECT_HTTP === 'true';
  }

  config.auth.sessionDays = Number(process.env.MYFLIX_SESSION_DAYS || config.auth.sessionDays || 180);

  config.subtitles.languages = splitKeys(process.env.MYFLIX_SUBTITLE_LANGUAGES || config.subtitles.languages);
  config.subtitles.opensubtitles.apiKey = process.env.OPENSUBTITLES_API_KEY
    || process.env.MYFLIX_OPENSUBTITLES_API_KEY
    || config.subtitles.opensubtitles.apiKey;
  config.subtitles.opensubtitles.username = process.env.OPENSUBTITLES_USERNAME
    || process.env.MYFLIX_OPENSUBTITLES_USERNAME
    || config.subtitles.opensubtitles.username;
  config.subtitles.opensubtitles.password = process.env.OPENSUBTITLES_PASSWORD
    || process.env.MYFLIX_OPENSUBTITLES_PASSWORD
    || config.subtitles.opensubtitles.password;
  config.subtitles.opensubtitles.userAgent = process.env.OPENSUBTITLES_USER_AGENT
    || process.env.MYFLIX_OPENSUBTITLES_USER_AGENT
    || config.subtitles.opensubtitles.userAgent;
  config.subtitles.opensubtitles.baseUrl = process.env.OPENSUBTITLES_BASE_URL
    || process.env.MYFLIX_OPENSUBTITLES_BASE_URL
    || config.subtitles.opensubtitles.baseUrl;
  config.subtitles.opensubtitles.downloadFormat = process.env.MYFLIX_SUBTITLE_DOWNLOAD_FORMAT
    || config.subtitles.opensubtitles.downloadFormat
    || 'webvtt';

  config.media.root = process.env.MYFLIX_MEDIA_ROOT || config.media.root;
  if (process.env.MYFLIX_AUTO_SCAN !== undefined) {
    config.media.autoScanOnStart = process.env.MYFLIX_AUTO_SCAN === 'true';
  }
  config.media.renameMode = process.env.MYFLIX_RENAME_MODE || config.media.renameMode;
  config.media.minFileSizeMB = Number(process.env.MYFLIX_MIN_FILE_SIZE_MB || config.media.minFileSizeMB || 1);
  config.media.minDurationMinutes = Number(
    process.env.MYFLIX_MIN_DURATION_MINUTES || config.media.minDurationMinutes || 15
  );
  config.media.scanDelayMs = Number(process.env.MYFLIX_SCAN_DELAY_MS || config.media.scanDelayMs || 2500);

  config.metadata.omdbApiKeys = uniqueValues([
    ...splitKeys(process.env.OMDB_API_KEYS || process.env.MYFLIX_OMDB_API_KEYS),
    ...splitKeys(process.env.OMDB_API_KEY),
    ...splitKeys(config.metadata.omdbApiKeys),
    ...splitKeys(config.metadata.omdbApiKey)
  ]);
  config.metadata.omdbApiKey = config.metadata.omdbApiKeys[0] || '';
  if (process.env.MYFLIX_METADATA_ENABLED !== undefined) {
    config.metadata.enabled = process.env.MYFLIX_METADATA_ENABLED === 'true';
  }
  config.metadata.maxRequestsPerScan = Number(
    process.env.MYFLIX_METADATA_MAX_REQUESTS || config.metadata.maxRequestsPerScan || 25
  );

  if (process.env.MYFLIX_PREPARE_ON_STARTUP !== undefined) {
    config.transcoding.prepareOnStartup = process.env.MYFLIX_PREPARE_ON_STARTUP === 'true';
  }
  config.transcoding.preparedMaxStartupJobs = Number(
    process.env.MYFLIX_PREPARED_MAX_STARTUP_JOBS || config.transcoding.preparedMaxStartupJobs || 0
  );
  if (process.env.MYFLIX_DELETE_ORIGINAL_AFTER_PREPARE !== undefined) {
    config.transcoding.deleteOriginalAfterPrepare = process.env.MYFLIX_DELETE_ORIGINAL_AFTER_PREPARE === 'true';
  }
  if (process.env.MYFLIX_DELETE_ORIGINAL_WITH_MULTIPLE_AUDIO !== undefined) {
    config.transcoding.deleteOriginalWithMultipleAudio =
      process.env.MYFLIX_DELETE_ORIGINAL_WITH_MULTIPLE_AUDIO === 'true';
  }
  if (process.env.MYFLIX_DELETE_ORIGINAL_WITH_EMBEDDED_SUBTITLES !== undefined) {
    config.transcoding.deleteOriginalWithEmbeddedSubtitles =
      process.env.MYFLIX_DELETE_ORIGINAL_WITH_EMBEDDED_SUBTITLES === 'true';
  }

  return config;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadConfig
};
