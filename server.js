const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const movieRoutes = require('./routes/movies');
const streamRoutes = require('./routes/stream');
const uploadRoutes = require('./routes/upload');
const libraryRoutes = require('./routes/library');
const subtitleRoutes = require('./routes/subtitles');

const db = require('./database/init');
const { loadConfig } = require('./lib/config');
const logger = require('./lib/logger');
const { cleanupIdleSessions, cleanupIntervalMinutes } = require('./lib/sessions');
const { runLibraryScan } = require('./lib/libraryScanner');
const {
  cleanupPendingPromotedOriginals,
  queueBackgroundConversionsForLibrary,
  startBackgroundConversionQueue,
  stopAllTranscodeJobs
} = require('./lib/transcoder');

const app = express();
const appConfig = loadConfig();
const PORT = appConfig.server.port || 5000;
const HOST = appConfig.server.host || '0.0.0.0';
let server = null;
let redirectServer = null;
let startupScanTimer = null;
let sessionCleanupTimer = null;
let shuttingDown = false;
let startupWorkStarted = false;

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http://localhost:5000", "http://localhost:3000"],
      mediaSrc: ["'self'", "data:", "blob:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "http://localhost:5000", "http://localhost:3000"],
    },
  },
}));

app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));
app.use(logger.requestLogger);

const isProduction = process.env.NODE_ENV === 'production';

function createApiLimiter(maxProduction, maxDevelopment, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? maxProduction : maxDevelopment,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true
  });
}

const limiter = createApiLimiter(500, 3000, 'Too many requests from this IP, please try again later.');
const libraryLimiter = createApiLimiter(3000, 10000, 'Too many library requests. Please wait a moment and try again.');
const streamLimiter = createApiLimiter(20000, 50000, 'Too many streaming requests. Please wait a moment and try again.');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 20 : 200,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  skip: (req) => !(req.method === 'POST' && ['/login', '/register'].includes(req.path))
});

app.use('/api/movies', limiter);
app.use('/api/upload', limiter);
app.use('/api/stream', streamLimiter);
app.use('/api/subtitles', libraryLimiter);
app.use('/api/library', libraryLimiter);
app.use('/api/auth', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return next();
}, express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      res.header('Cache-Control', 'public, max-age=31536000');
      res.header('Content-Type', `image/${path.extname(filePath).slice(1)}`);
    }
  }
}));

app.use('/movies', express.static(path.join(__dirname, 'movies')));

app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/subtitles', subtitleRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/library', libraryRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'MyFlix server is running' });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/build')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
  });
}

app.use((err, req, res, next) => {
  logger.error('http.unhandled_error', {
    requestId: req.requestId,
    method: req.method,
    url: logger.redactUrl(req.originalUrl || req.url),
    error: err
  });
  console.error('Error:', err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

function createDirectories() {
  const dirs = ['uploads', 'movies', 'thumbnails'];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info('server.directory_created', { dir });
      console.log(`Created directory: ${dir}`);
    }
  });
}

function localNetworkUrls(port, protocol = 'http') {
  const urls = [`${protocol}://localhost:${port}`];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).flat().forEach((entry) => {
    if (entry && entry.family === 'IPv4' && !entry.internal) {
      urls.push(`${protocol}://${entry.address}:${port}`);
    }
  });
  return urls;
}

function resolveAppPath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.join(__dirname, value);
}

function readHttpsOptions() {
  const httpsConfig = appConfig.server.https || {};
  if (!httpsConfig.enabled) {
    return null;
  }

  const keyPath = resolveAppPath(httpsConfig.keyPath);
  const certPath = resolveAppPath(httpsConfig.certPath);
  const pfxPath = resolveAppPath(httpsConfig.pfxPath);
  const caPath = resolveAppPath(httpsConfig.caPath);
  const hasPfx = pfxPath && fs.existsSync(pfxPath);
  const hasPemPair = keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath);
  if (!hasPfx && !hasPemPair) {
    logger.error('https.certificate_missing', { keyPath, certPath, pfxPath });
    throw new Error('HTTPS is enabled but pfxPath or keyPath/certPath is missing or invalid.');
  }

  const options = hasPfx
    ? {
      pfx: fs.readFileSync(pfxPath),
      passphrase: httpsConfig.passphrase || undefined
    }
    : {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  if (caPath && fs.existsSync(caPath)) {
    options.ca = fs.readFileSync(caPath);
  }
  return {
    options,
    keyPath: hasPemPair ? keyPath : null,
    certPath: hasPemPair ? certPath : null,
    pfxPath: hasPfx ? pfxPath : null,
    caPath: caPath || null,
    port: Number(httpsConfig.port || PORT),
    redirectHttp: httpsConfig.redirectHttp !== false
  };
}

function redirectToHttpsServer(httpsPort) {
  return http.createServer((req, res) => {
    const hostHeader = String(req.headers.host || `localhost:${PORT}`).replace(/:\d+$/, '');
    const target = `https://${hostHeader}:${httpsPort}${req.url || '/'}`;
    res.writeHead(308, {
      Location: target,
      'Cache-Control': 'no-store'
    });
    res.end(`Redirecting to ${target}`);
  });
}

function scheduleStartupScan() {
  if (!appConfig.media.autoScanOnStart) {
    logger.info('library.startup_scan_disabled');
    console.log('Media library startup scan disabled.');
    return;
  }

  const delay = appConfig.media.scanDelayMs || 2500;
  logger.info('library.startup_scan_scheduled', {
    mediaRoot: appConfig.media.root,
    delayMs: delay
  });
  startupScanTimer = setTimeout(() => {
    logger.info('library.startup_scan_triggered', { mediaRoot: appConfig.media.root });
    console.log(`Scanning media library at ${appConfig.media.root}`);
    runLibraryScan({ trigger: 'startup', config: appConfig })
      .then((result) => {
        logger.info('library.startup_scan_complete', result);
        console.log('Media library scan complete:', result);
        cleanupPendingPromotedOriginals()
          .catch((error) => {
            logger.error('prepared.pending_delete_cleanup_failed', { error });
          });
        schedulePreparedMedia('startup');
      })
      .catch((error) => {
        logger.error('library.startup_scan_failed', { error });
        console.error('Media library scan failed:', error.message);
      });
  }, delay);
}

async function schedulePreparedMedia(trigger) {
  if (!appConfig.transcoding.prepareOnStartup) {
    logger.info('background_conversion.startup_disabled', { trigger });
    return;
  }

  try {
    const result = await queueBackgroundConversionsForLibrary({
      reason: trigger,
      maxJobs: Number(appConfig.transcoding.preparedMaxStartupJobs || 0)
    });
    await startBackgroundConversionQueue(trigger);
    logger.info('background_conversion.startup_queued', {
      trigger,
      ...result
    });
  } catch (error) {
    logger.error('background_conversion.startup_queue_failed', {
      trigger,
      error
    });
  }
}

function cleanupTranscodeJobs(reason) {
  const stopped = stopAllTranscodeJobs();
  logger.info('transcode.cleanup', { reason, stopped });
  if (stopped > 0) {
    console.log(`Stopped ${stopped} transcode job(s) during ${reason}.`);
  }
}

function startSessionCleanup() {
  if (sessionCleanupTimer) return;

  cleanupIdleSessions('startup')
    .catch((error) => logger.error('session.cleanup_failed', { trigger: 'startup', error }));

  sessionCleanupTimer = setInterval(() => {
    cleanupIdleSessions('interval')
      .catch((error) => logger.error('session.cleanup_failed', { trigger: 'interval', error }));
  }, cleanupIntervalMinutes * 60 * 1000);
  sessionCleanupTimer.unref();
  logger.info('session.cleanup_scheduled', { cleanupIntervalMinutes });
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.warn('server.shutdown_started', { reason, exitCode });

  if (startupScanTimer) {
    clearTimeout(startupScanTimer);
    startupScanTimer = null;
  }
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }

  cleanupTranscodeJobs(reason);

  if (!server) {
    process.exit(exitCode);
    return;
  }

  server.close(() => {
    if (!redirectServer) {
      logger.warn('server.shutdown_complete', { reason, exitCode });
      process.exit(exitCode);
      return;
    }

    redirectServer.close(() => {
      logger.warn('server.shutdown_complete', { reason, exitCode });
      process.exit(exitCode);
    });
  });

  setTimeout(() => {
    logger.error('server.shutdown_forced', { reason, exitCode });
    process.exit(exitCode);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('exit', (code) => {
  logger.warn('process.exit', { code });
  cleanupTranscodeJobs('process exit');
});
process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', { error });
  console.error('Uncaught exception:', error);
  shutdown('uncaught exception', 1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', { reason });
  console.error('Unhandled rejection:', reason);
  shutdown('unhandled rejection', 1);
});

function startStartupWork() {
  if (startupWorkStarted) return;
  startupWorkStarted = true;

  createDirectories();
  startBackgroundConversionQueue('startup')
    .catch((error) => {
      logger.error('background_conversion.startup_resume_failed', { error });
    });
  startSessionCleanup();
  scheduleStartupScan();
}

function onServerStarted(protocol, port, extra = {}) {
  const urls = localNetworkUrls(port, protocol);
  logger.info('server.started', {
    bindHost: HOST,
    port,
    protocol,
    nodeEnv: process.env.NODE_ENV,
    logFile: logger.LOG_FILE,
    mediaRoot: appConfig.media.root,
    autoScanOnStart: appConfig.media.autoScanOnStart,
    urls,
    ...extra
  });
  console.log(`MyFlix ${protocol.toUpperCase()} server running on ${HOST}:${port}`);
  console.log('Access MyFlix at:');
  urls.forEach((url) => console.log(`  ${url}`));
  if (process.env.NODE_ENV !== 'production') {
    console.log('Development mode - Frontend running at: http://localhost:3000');
  }
  startStartupWork();
}

const httpsRuntime = readHttpsOptions();
if (httpsRuntime) {
  server = https.createServer(httpsRuntime.options, app).listen(httpsRuntime.port, HOST, () => {
    onServerStarted('https', httpsRuntime.port, {
      keyPath: httpsRuntime.keyPath,
      certPath: httpsRuntime.certPath,
      pfxPath: httpsRuntime.pfxPath,
      caPath: httpsRuntime.caPath
    });
  });

  if (httpsRuntime.redirectHttp && httpsRuntime.port !== PORT) {
    redirectServer = redirectToHttpsServer(httpsRuntime.port).listen(PORT, HOST, () => {
      logger.info('server.http_redirect_started', {
        bindHost: HOST,
        port: PORT,
        httpsPort: httpsRuntime.port,
        urls: localNetworkUrls(PORT, 'http')
      });
      console.log(`MyFlix HTTP redirect running on ${HOST}:${PORT}`);
    });
  }
} else {
  server = app.listen(PORT, HOST, () => {
    onServerStarted('http', PORT);
  });
}

module.exports = app;
