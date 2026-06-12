const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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

require('./database/init');
const { loadConfig } = require('./lib/config');
const { runLibraryScan } = require('./lib/libraryScanner');

const app = express();
const appConfig = loadConfig();
const PORT = appConfig.server.port || 5000;
const HOST = appConfig.server.host || '0.0.0.0';

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 200,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true
});

app.use('/api/movies', limiter);
app.use('/api/upload', limiter);
app.use('/api/stream', limiter);
app.use('/api/library', limiter);
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
      console.log(`Created directory: ${dir}`);
    }
  });
}

function localNetworkUrls(port) {
  const urls = [`http://localhost:${port}`];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).flat().forEach((entry) => {
    if (entry && entry.family === 'IPv4' && !entry.internal) {
      urls.push(`http://${entry.address}:${port}`);
    }
  });
  return urls;
}

function scheduleStartupScan() {
  if (!appConfig.media.autoScanOnStart) {
    console.log('Media library startup scan disabled.');
    return;
  }

  const delay = appConfig.media.scanDelayMs || 2500;
  setTimeout(() => {
    console.log(`Scanning media library at ${appConfig.media.root}`);
    runLibraryScan({ trigger: 'startup', config: appConfig })
      .then((result) => {
        console.log('Media library scan complete:', result);
      })
      .catch((error) => {
        console.error('Media library scan failed:', error.message);
      });
  }, delay);
}

app.listen(PORT, HOST, () => {
  createDirectories();
  console.log(`MyFlix server running on ${HOST}:${PORT}`);
  console.log('Access MyFlix at:');
  localNetworkUrls(PORT).forEach((url) => console.log(`  ${url}`));
  if (process.env.NODE_ENV !== 'production') {
    console.log('Development mode - Frontend running at: http://localhost:3000');
  }
  scheduleStartupScan();
});

module.exports = app;
