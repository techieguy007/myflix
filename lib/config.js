const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'myflix.config.json');

const defaults = {
  taskName: 'MyFlixLocalStreaming',
  server: {
    host: '0.0.0.0',
    port: 5000,
    nodeEnv: 'production'
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
  transcoding: {
    ffmpegPath: '',
    ffprobePath: '',
    ffmpegThreads: 2,
    ffmpegPreset: 'ultrafast',
    realtime: true,
    prepareOnStartup: false,
    preparedMaxStartupJobs: 0
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
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

  return config;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadConfig
};
