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
    renameMode: 'suggest'
  },
  metadata: {
    provider: 'omdb',
    enabled: true,
    omdbApiKey: '',
    maxRequestsPerScan: 25
  },
  service: {
    nodeExe: 'node',
    logDirectory: 'logs',
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

function loadConfig(configPath = process.env.MYFLIX_CONFIG || DEFAULT_CONFIG_PATH) {
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const config = mergeConfig(defaults, fileConfig);

  config.server.host = process.env.HOST || process.env.MYFLIX_HOST || config.server.host;
  config.server.port = Number(process.env.PORT || process.env.MYFLIX_PORT || config.server.port);
  config.server.nodeEnv = process.env.NODE_ENV || config.server.nodeEnv;

  config.media.root = process.env.MYFLIX_MEDIA_ROOT || config.media.root;
  if (process.env.MYFLIX_AUTO_SCAN !== undefined) {
    config.media.autoScanOnStart = process.env.MYFLIX_AUTO_SCAN === 'true';
  }
  config.media.renameMode = process.env.MYFLIX_RENAME_MODE || config.media.renameMode;
  config.media.minFileSizeMB = Number(process.env.MYFLIX_MIN_FILE_SIZE_MB || config.media.minFileSizeMB || 1);
  config.media.scanDelayMs = Number(process.env.MYFLIX_SCAN_DELAY_MS || config.media.scanDelayMs || 2500);

  config.metadata.omdbApiKey = process.env.OMDB_API_KEY || config.metadata.omdbApiKey || '';
  if (process.env.MYFLIX_METADATA_ENABLED !== undefined) {
    config.metadata.enabled = process.env.MYFLIX_METADATA_ENABLED === 'true';
  }
  config.metadata.maxRequestsPerScan = Number(
    process.env.MYFLIX_METADATA_MAX_REQUESTS || config.metadata.maxRequestsPerScan || 25
  );

  return config;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadConfig
};
