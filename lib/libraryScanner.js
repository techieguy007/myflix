const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const db = require('../database/init');
const { loadConfig } = require('./config');
const logger = require('./logger');
const { fetchMetadata, isMetadataTemporarilyUnavailable } = require('./metadata');
const { isVideoFile, parseMediaPath } = require('./mediaParser');

const scanState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastResult: null,
  lastError: null
};

const LIBRARY_COLUMNS = [
  "media_type TEXT DEFAULT 'movie'",
  'series_title TEXT',
  'season_number INTEGER',
  'episode_number INTEGER',
  'episode_title TEXT',
  'library_root TEXT',
  "library_source TEXT DEFAULT 'manual'",
  'original_path TEXT',
  'suggested_path TEXT',
  'last_scanned_at DATETIME',
  'metadata_source TEXT'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveFfprobePath() {
  const chocolateyPath = 'C:\\ProgramData\\chocolatey\\bin\\ffprobe.exe';
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  if (fs.existsSync(chocolateyPath)) return chocolateyPath;
  return 'ffprobe';
}

function probeDurationSeconds(filePath) {
  return new Promise((resolve) => {
    execFile(
      resolveFfprobePath(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const duration = Number(String(stdout || '').trim());
        resolve(Number.isFinite(duration) ? duration : null);
      }
    );
  });
}

function normalizeIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scanIdentityKey(parsed) {
  if (parsed.mediaType === 'episode') {
    return [
      'episode',
      normalizeIdentity(parsed.seriesTitle),
      parsed.seasonNumber || '',
      parsed.episodeNumber || ''
    ].join(':');
  }

  return [
    'movie',
    normalizeIdentity(parsed.title),
    parsed.releaseYear || ''
  ].join(':');
}

function isKnownExtraClip(filePath, root, parsed) {
  const relative = path.relative(root, filePath);
  const parts = relative.split(path.sep).map(normalizeIdentity);
  const folderParts = parts.slice(0, -1);
  const title = normalizeIdentity(parsed.title || path.basename(filePath, path.extname(filePath)));
  const extraFolders = [
    'audition footage',
    'behind the scenes',
    'bonus',
    'bonus features',
    'deleted scenes',
    'extras',
    'featurettes',
    'interviews',
    'samples',
    'special features',
    'trailers'
  ];
  const extraTitlePatterns = [
    /\baudition footage\b/,
    /\bblooper(s)?\b/,
    /\bdeleted scene(s)?\b/,
    /\bfeaturette(s)?\b/,
    /\bgag reel\b/,
    /\bsample\b/,
    /\bteaser\b/,
    /\btrailer\b/
  ];

  return folderParts.some((part) => extraFolders.includes(part))
    || extraTitlePatterns.some((pattern) => pattern.test(title));
}

function dbIdentityKey(row) {
  if (row.media_type === 'episode') {
    return [
      'episode',
      normalizeIdentity(row.series_title || row.title),
      row.season_number || '',
      row.episode_number || ''
    ].join(':');
  }

  if (row.imdb_id) {
    return `movie-imdb:${String(row.imdb_id).toLowerCase()}`;
  }

  return [
    'movie',
    normalizeIdentity(row.title),
    row.release_year || ''
  ].join(':');
}

function isBetterCandidate(candidate, incumbent) {
  if (!incumbent) return true;

  const candidateDuration = Number(candidate.durationSeconds || 0);
  const incumbentDuration = Number(incumbent.durationSeconds || 0);
  if (candidateDuration !== incumbentDuration) {
    return candidateDuration > incumbentDuration;
  }

  const candidateSize = Number(candidate.stat?.size || 0);
  const incumbentSize = Number(incumbent.stat?.size || 0);
  if (candidateSize !== incumbentSize) {
    return candidateSize > incumbentSize;
  }

  return candidate.fullPath.localeCompare(incumbent.fullPath) < 0;
}

async function ensureLibrarySchema() {
  for (const column of LIBRARY_COLUMNS) {
    const columnName = column.split(' ')[0];
    try {
      await db.run(`ALTER TABLE movies ADD COLUMN ${column}`);
    } catch (error) {
      if (!String(error.message || '').includes('duplicate column name')) {
        throw error;
      }
    }
  }
}

function walkMediaFiles(root, minFileSizeBytes) {
  const files = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      console.warn(`Skipping unreadable directory ${current}: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !isVideoFile(fullPath)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size >= minFileSizeBytes) {
          files.push({ fullPath, stat });
        }
      } catch (error) {
        console.warn(`Skipping unreadable file ${fullPath}: ${error.message}`);
      }
    }
  }

  return files.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

async function prepareScanCandidates(files, root, config, counters) {
  const minDurationSeconds = Number(config.media.minDurationMinutes || 15) * 60;
  const candidates = new Map();

  for (const file of files) {
    const parsed = parseMediaPath(file.fullPath, root);
    if (isKnownExtraClip(file.fullPath, root, parsed)) {
      counters.skippedExtras += 1;
      continue;
    }

    const durationSeconds = await probeDurationSeconds(file.fullPath);

    if (durationSeconds === null) {
      counters.durationProbeErrors += 1;
    } else if (durationSeconds < minDurationSeconds) {
      counters.skippedShort += 1;
      continue;
    }

    const candidate = {
      ...file,
      parsed,
      durationSeconds
    };
    const key = scanIdentityKey(parsed);
    const incumbent = candidates.get(key);

    if (isBetterCandidate(candidate, incumbent)) {
      if (incumbent) counters.skippedDuplicate += 1;
      candidates.set(key, candidate);
    } else {
      counters.skippedDuplicate += 1;
    }
  }

  return Array.from(candidates.values())
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

function shouldRefreshMetadata(existing, config, metadataCount) {
  if (!config.metadata.enabled || !config.metadata.omdbApiKey) return false;
  if (isMetadataTemporarilyUnavailable(config)) return false;
  if (metadataCount >= config.metadata.maxRequestsPerScan) return false;
  if (!existing) return true;
  return !existing.omdb_updated || !existing.metadata_source;
}

function metadataValues(parsed, metadata) {
  if (!metadata) {
    return {
      title: parsed.title,
      description: null,
      genre: null,
      release_year: parsed.releaseYear || null,
      rating: null,
      director: null,
      cast: null,
      poster_url: null,
      imdb_id: null,
      imdb_rating: null,
      plot: null,
      runtime: null,
      rated: null,
      country: null,
      language: null,
      awards: null,
      omdb_updated: null,
      metadata_source: null
    };
  }

  return {
    title: parsed.mediaType === 'episode'
      ? `${parsed.seriesTitle} - S${String(parsed.seasonNumber).padStart(2, '0')}E${String(parsed.episodeNumber).padStart(2, '0')} - ${metadata.title || parsed.episodeTitle}`
      : metadata.title || parsed.title,
    description: metadata.plot,
    genre: metadata.genre,
    release_year: metadata.year || parsed.releaseYear || null,
    rating: metadata.imdbRating,
    director: metadata.director,
    cast: metadata.actors,
    poster_url: metadata.poster,
    imdb_id: metadata.imdbID,
    imdb_rating: metadata.imdbRating,
    plot: metadata.plot,
    runtime: metadata.runtime,
    rated: metadata.rated,
    country: metadata.country,
    language: metadata.language,
    awards: metadata.awards,
    omdb_updated: new Date().toISOString(),
    metadata_source: metadata.source
  };
}

function buildFallbackValues(parsed) {
  return metadataValues(parsed, null);
}

function canRename(currentPath, suggestedPath) {
  return currentPath.toLowerCase() !== suggestedPath.toLowerCase() && !fs.existsSync(suggestedPath);
}

function applyRenameIfConfigured(filePath, suggestedPath, config) {
  if ((config.media.renameMode || 'suggest').toLowerCase() !== 'apply') {
    return { finalPath: filePath, applied: false, skipped: false };
  }

  if (!canRename(filePath, suggestedPath)) {
    return { finalPath: filePath, applied: false, skipped: true };
  }

  fs.mkdirSync(path.dirname(suggestedPath), { recursive: true });
  fs.renameSync(filePath, suggestedPath);
  return { finalPath: suggestedPath, applied: true, skipped: false };
}

async function upsertMediaItem(item, root, config, counters) {
  const parsed = item.parsed || parseMediaPath(item.fullPath, root);
  const rename = applyRenameIfConfigured(item.fullPath, parsed.suggestedPath, config);
  const finalPath = rename.finalPath;
  const existing = await db.get('SELECT id, omdb_updated, metadata_source FROM movies WHERE video_path = ?', [finalPath])
    || await db.get('SELECT id, omdb_updated, metadata_source FROM movies WHERE original_path = ?', [item.fullPath]);

  let values = buildFallbackValues(parsed);
  if (shouldRefreshMetadata(existing, config, counters.metadataRequests)) {
    try {
      const metadata = await fetchMetadata(parsed, config);
      counters.metadataRequests += 1;
      if (metadata) {
        values = metadataValues(parsed, metadata);
        counters.metadataUpdated += 1;
      }
      await sleep(150);
    } catch (error) {
      counters.metadataErrors += 1;
      logger.warn('library.metadata_lookup_failed', {
        title: parsed.title,
        mediaType: parsed.mediaType,
        releaseYear: parsed.releaseYear || null,
        error
      });
      console.warn(`Metadata lookup failed for ${parsed.title}: ${error.message}`);
    }
  }

  const scannedAt = new Date().toISOString();
  const fileSize = fs.statSync(finalPath).size;
  const format = path.extname(finalPath).slice(1).toLowerCase();
  const duration = Number.isFinite(item.durationSeconds) ? Math.round(item.durationSeconds) : null;

  const params = [
    values.title,
    values.description,
    values.genre,
    values.release_year,
    duration,
    values.rating,
    values.director,
    values.cast,
    finalPath,
    fileSize,
    format,
    values.poster_url,
    values.imdb_id,
    values.imdb_rating,
    values.plot,
    values.runtime,
    values.rated,
    values.country,
    values.language,
    values.awards,
    values.omdb_updated,
    parsed.mediaType,
    parsed.seriesTitle || null,
    parsed.seasonNumber || null,
    parsed.episodeNumber || null,
    parsed.episodeTitle || null,
    root,
    'scanner',
    item.fullPath,
    parsed.suggestedPath,
    scannedAt,
    values.metadata_source
  ];

  if (existing) {
    await db.run(`
      UPDATE movies SET
        title = ?, description = COALESCE(?, description), genre = COALESCE(?, genre),
        release_year = COALESCE(?, release_year), duration = COALESCE(?, duration),
        rating = COALESCE(?, rating),
        director = COALESCE(?, director), "cast" = COALESCE(?, "cast"),
        video_path = ?, file_size = ?, format = ?,
        poster_url = COALESCE(?, poster_url), imdb_id = COALESCE(?, imdb_id),
        imdb_rating = COALESCE(?, imdb_rating), plot = COALESCE(?, plot),
        runtime = COALESCE(?, runtime), rated = COALESCE(?, rated),
        country = COALESCE(?, country), language = COALESCE(?, language),
        awards = COALESCE(?, awards), omdb_updated = COALESCE(?, omdb_updated),
        media_type = ?, series_title = ?, season_number = ?, episode_number = ?,
        episode_title = ?, library_root = ?, library_source = ?, original_path = ?,
        suggested_path = ?, last_scanned_at = ?, metadata_source = COALESCE(?, metadata_source),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [...params, existing.id]);
    counters.updated += 1;
  } else {
    await db.run(`
      INSERT INTO movies (
        title, description, genre, release_year, duration, rating, director, "cast",
        video_path, file_size, format, poster_url, imdb_id, imdb_rating,
        plot, runtime, rated, country, language, awards, omdb_updated,
        media_type, series_title, season_number, episode_number, episode_title,
        library_root, library_source, original_path, suggested_path, last_scanned_at,
        metadata_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, params);
    counters.added += 1;
  }

  counters.scanned += 1;
  if (parsed.mediaType === 'episode') counters.episodes += 1;
  if (parsed.mediaType === 'movie') counters.movies += 1;
  if (rename.applied) counters.renamed += 1;
  if (finalPath.toLowerCase() !== parsed.suggestedPath.toLowerCase()) counters.renameSuggestions += 1;

  return finalPath;
}

async function deleteMovieRow(row) {
  await db.run('DELETE FROM watch_history WHERE movie_id = ?', [row.id]);
  await db.run('DELETE FROM favorites WHERE movie_id = ?', [row.id]);
  await db.run('DELETE FROM movie_categories WHERE movie_id = ?', [row.id]);
  await db.run('DELETE FROM movies WHERE id = ?', [row.id]);
}

async function removeStaleScannerRows(scannedPaths) {
  const existing = await db.all('SELECT id, video_path FROM movies WHERE library_source = ?', ['scanner']);
  const current = new Set(scannedPaths.map((item) => item.toLowerCase()));
  let removed = 0;
  for (const row of existing) {
    if (!current.has(String(row.video_path).toLowerCase())) {
      await deleteMovieRow(row);
      removed += 1;
    }
  }
  return removed;
}

async function removeDuplicateScannerRows() {
  const rows = await db.all(`
    SELECT id, title, release_year, media_type, series_title, season_number,
      episode_number, imdb_id, duration, file_size, video_path
    FROM movies
    WHERE library_source = ?
  `, ['scanner']);
  const keepers = new Map();
  const duplicates = [];

  for (const row of rows) {
    const key = dbIdentityKey(row);
    const incumbent = keepers.get(key);
    if (isBetterCandidate({
      fullPath: row.video_path || '',
      durationSeconds: row.duration,
      stat: { size: row.file_size || 0 }
    }, incumbent && {
      fullPath: incumbent.video_path || '',
      durationSeconds: incumbent.duration,
      stat: { size: incumbent.file_size || 0 }
    })) {
      if (incumbent) duplicates.push(incumbent);
      keepers.set(key, row);
    } else {
      duplicates.push(row);
    }
  }

  for (const row of duplicates) {
    await deleteMovieRow(row);
  }

  return duplicates.length;
}

async function runLibraryScan(options = {}) {
  if (scanState.running) {
    logger.warn('library.scan_already_running', {
      trigger: options.trigger || 'unknown',
      lastStartedAt: scanState.lastStartedAt
    });
    return { alreadyRunning: true, ...scanState };
  }

  const config = options.config || loadConfig();
  const root = path.resolve(config.media.root);
  const minFileSizeBytes = Number(config.media.minFileSizeMB || 1) * 1024 * 1024;
  const minDurationMinutes = Number(config.media.minDurationMinutes || 15);
  const startedAtMs = Date.now();
  const trigger = options.trigger || 'unknown';

  scanState.running = true;
  scanState.lastStartedAt = new Date().toISOString();
  scanState.lastError = null;
  logger.info('library.scan_start', {
    trigger,
    root,
    minFileSizeMB: config.media.minFileSizeMB,
    minDurationMinutes,
    renameMode: config.media.renameMode,
    metadataEnabled: Boolean(config.metadata.enabled && config.metadata.omdbApiKey),
    maxMetadataRequests: config.metadata.maxRequestsPerScan
  });

  const counters = {
    scanned: 0,
    added: 0,
    updated: 0,
    removed: 0,
    movies: 0,
    episodes: 0,
    renamed: 0,
    renameSuggestions: 0,
    metadataRequests: 0,
    metadataUpdated: 0,
    metadataErrors: 0,
    skippedShort: 0,
    skippedExtras: 0,
    skippedDuplicate: 0,
    removedDuplicates: 0,
    durationProbeErrors: 0
  };

  try {
    await ensureLibrarySchema();

    if (!fs.existsSync(root)) {
      throw new Error(`Media root not found: ${root}`);
    }

    const files = walkMediaFiles(root, minFileSizeBytes);
    logger.info('library.scan_files_discovered', {
      trigger,
      root,
      fileCount: files.length
    });
    const candidates = await prepareScanCandidates(files, root, config, counters);
    logger.info('library.scan_candidates_prepared', {
      trigger,
      candidateCount: candidates.length,
      skippedShort: counters.skippedShort,
      skippedExtras: counters.skippedExtras,
      skippedDuplicate: counters.skippedDuplicate,
      durationProbeErrors: counters.durationProbeErrors
    });
    const scannedPaths = [];
    for (const [index, file] of candidates.entries()) {
      const finalPath = await upsertMediaItem(file, root, config, counters);
      scannedPaths.push(finalPath);
      if ((index + 1) % 50 === 0 || index + 1 === candidates.length) {
        logger.info('library.scan_progress', {
          trigger,
          processed: index + 1,
          total: candidates.length,
          added: counters.added,
          updated: counters.updated,
          movies: counters.movies,
          episodes: counters.episodes,
          metadataRequests: counters.metadataRequests,
          metadataErrors: counters.metadataErrors
        });
      }
    }
    counters.removed = await removeStaleScannerRows(scannedPaths);
    logger.info('library.scan_stale_rows_removed', {
      trigger,
      removed: counters.removed
    });
    counters.removedDuplicates = await removeDuplicateScannerRows();
    logger.info('library.scan_duplicates_removed', {
      trigger,
      removedDuplicates: counters.removedDuplicates
    });

    const result = {
      success: true,
      mediaRoot: root,
      renameMode: config.media.renameMode,
      minDurationMinutes,
      metadataEnabled: Boolean(config.metadata.enabled && config.metadata.omdbApiKey),
      durationMs: Date.now() - startedAtMs,
      ...counters
    };
    scanState.lastResult = result;
    scanState.lastFinishedAt = new Date().toISOString();
    logger.info('library.scan_complete', {
      trigger,
      ...result
    });
    return result;
  } catch (error) {
    scanState.lastError = error.message;
    scanState.lastFinishedAt = new Date().toISOString();
    logger.error('library.scan_failed', {
      trigger,
      root,
      durationMs: Date.now() - startedAtMs,
      error
    });
    throw error;
  } finally {
    scanState.running = false;
  }
}

function getScanState() {
  return { ...scanState };
}

module.exports = {
  ensureLibrarySchema,
  getScanState,
  runLibraryScan
};
