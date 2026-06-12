const fs = require('fs');
const path = require('path');
const db = require('../database/init');
const { loadConfig } = require('./config');
const { fetchMetadata } = require('./metadata');
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

function shouldRefreshMetadata(existing, config, metadataCount) {
  if (!config.metadata.enabled || !config.metadata.omdbApiKey) return false;
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
  const parsed = parseMediaPath(item.fullPath, root);
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
      console.warn(`Metadata lookup failed for ${parsed.title}: ${error.message}`);
    }
  }

  const scannedAt = new Date().toISOString();
  const fileSize = fs.statSync(finalPath).size;
  const format = path.extname(finalPath).slice(1).toLowerCase();

  const params = [
    values.title,
    values.description,
    values.genre,
    values.release_year,
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
        release_year = COALESCE(?, release_year), rating = COALESCE(?, rating),
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
        title, description, genre, release_year, rating, director, "cast",
        video_path, file_size, format, poster_url, imdb_id, imdb_rating,
        plot, runtime, rated, country, language, awards, omdb_updated,
        media_type, series_title, season_number, episode_number, episode_title,
        library_root, library_source, original_path, suggested_path, last_scanned_at,
        metadata_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

async function removeStaleScannerRows(scannedPaths) {
  const existing = await db.all('SELECT id, video_path FROM movies WHERE library_source = ?', ['scanner']);
  const current = new Set(scannedPaths.map((item) => item.toLowerCase()));
  let removed = 0;
  for (const row of existing) {
    if (!current.has(String(row.video_path).toLowerCase())) {
      await db.run('DELETE FROM watch_history WHERE movie_id = ?', [row.id]);
      await db.run('DELETE FROM favorites WHERE movie_id = ?', [row.id]);
      await db.run('DELETE FROM movie_categories WHERE movie_id = ?', [row.id]);
      await db.run('DELETE FROM movies WHERE id = ?', [row.id]);
      removed += 1;
    }
  }
  return removed;
}

async function runLibraryScan(options = {}) {
  if (scanState.running) {
    return { alreadyRunning: true, ...scanState };
  }

  const config = options.config || loadConfig();
  const root = path.resolve(config.media.root);
  const minFileSizeBytes = Number(config.media.minFileSizeMB || 1) * 1024 * 1024;

  scanState.running = true;
  scanState.lastStartedAt = new Date().toISOString();
  scanState.lastError = null;

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
    metadataErrors: 0
  };

  try {
    await ensureLibrarySchema();

    if (!fs.existsSync(root)) {
      throw new Error(`Media root not found: ${root}`);
    }

    const files = walkMediaFiles(root, minFileSizeBytes);
    const scannedPaths = [];
    for (const file of files) {
      const finalPath = await upsertMediaItem(file, root, config, counters);
      scannedPaths.push(finalPath);
    }
    counters.removed = await removeStaleScannerRows(scannedPaths);

    const result = {
      success: true,
      mediaRoot: root,
      renameMode: config.media.renameMode,
      metadataEnabled: Boolean(config.metadata.enabled && config.metadata.omdbApiKey),
      ...counters
    };
    scanState.lastResult = result;
    scanState.lastFinishedAt = new Date().toISOString();
    return result;
  } catch (error) {
    scanState.lastError = error.message;
    scanState.lastFinishedAt = new Date().toISOString();
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
