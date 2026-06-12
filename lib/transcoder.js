const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const TRANSCODE_ROOT = path.join(__dirname, '..', 'transcodes');
const runningJobs = new Map();

function commandPath(name, envName) {
  return process.env[envName] || name;
}

function sourceSignature(filePath) {
  const stat = fs.statSync(filePath);
  return crypto
    .createHash('sha1')
    .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
}

function hlsDirectory(movieId, filePath) {
  return path.join(TRANSCODE_ROOT, String(movieId), sourceSignature(filePath));
}

function variantKey(options = {}) {
  const audio = Number.isInteger(options.audioStreamIndex) ? options.audioStreamIndex : 'auto';
  return `audio-${audio}`;
}

function optionsFromVariant(variant) {
  const match = String(variant || '').match(/^audio-(auto|\d+)$/);
  if (!match || match[1] === 'auto') {
    return {};
  }
  return { audioStreamIndex: Number(match[1]) };
}

function hlsVariantDirectory(movieId, filePath, options = {}) {
  return path.join(hlsDirectory(movieId, filePath), variantKey(options));
}

function manifestPath(movieId, filePath, options = {}) {
  return path.join(hlsVariantDirectory(movieId, filePath, options), 'index.m3u8');
}

function safeRmDir(dirPath) {
  const resolvedRoot = path.resolve(TRANSCODE_ROOT);
  const resolvedDir = path.resolve(dirPath);
  if (!resolvedDir.startsWith(resolvedRoot)) {
    throw new Error(`Refusing to clear path outside transcode cache: ${resolvedDir}`);
  }
  fs.rmSync(resolvedDir, { recursive: true, force: true });
}

function probeMedia(filePath) {
  return new Promise((resolve) => {
    execFile(
      commandPath('ffprobe', 'FFPROBE_PATH'),
      [
        '-v', 'error',
        '-show_streams',
        '-of', 'json',
        filePath
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ error: error.message, streams: [] });
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          resolve({ error: parseError.message, streams: [] });
        }
      }
    );
  });
}

function codecsFromProbe(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  return {
    videoCodec: video ? video.codec_name : null,
    audioCodec: audio ? audio.codec_name : null
  };
}

function streamLanguage(stream) {
  return (stream.tags && (stream.tags.language || stream.tags.LANGUAGE)) || 'und';
}

function streamTitle(stream) {
  return (stream.tags && (stream.tags.title || stream.tags.TITLE)) || '';
}

function trackLabel(stream, fallback) {
  const language = streamLanguage(stream);
  const title = streamTitle(stream);
  const parts = [];
  if (language && language !== 'und') parts.push(language.toUpperCase());
  if (title) parts.push(title);
  if (stream.codec_name) parts.push(stream.codec_name);
  return parts.length ? parts.join(' - ') : fallback;
}

function canExtractSubtitle(codec) {
  return ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(String(codec || '').toLowerCase());
}

function tracksFromProbe(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const audioTracks = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, index) => ({
      index,
      streamIndex: stream.index,
      codec: stream.codec_name || 'unknown',
      language: streamLanguage(stream),
      title: streamTitle(stream),
      channels: stream.channels || null,
      default: Boolean(stream.disposition && stream.disposition.default),
      label: trackLabel(stream, `Audio ${index + 1}`)
    }));

  const subtitleTracks = streams
    .filter((stream) => stream.codec_type === 'subtitle')
    .map((stream, index) => ({
      index,
      streamIndex: stream.index,
      codec: stream.codec_name || 'unknown',
      language: streamLanguage(stream),
      title: streamTitle(stream),
      default: Boolean(stream.disposition && stream.disposition.default),
      forced: Boolean(stream.disposition && stream.disposition.forced),
      extractable: canExtractSubtitle(stream.codec_name),
      label: trackLabel(stream, `Subtitle ${index + 1}`)
    }));

  return { audioTracks, subtitleTracks };
}

function selectedAudioIndex(probe, requestedAudioStreamIndex) {
  const { audioTracks } = tracksFromProbe(probe);
  if (Number.isInteger(requestedAudioStreamIndex)
    && audioTracks.some((track) => track.streamIndex === requestedAudioStreamIndex)) {
    return requestedAudioStreamIndex;
  }
  const defaultTrack = audioTracks.find((track) => track.default);
  return defaultTrack ? defaultTrack.streamIndex : (audioTracks[0] ? audioTracks[0].streamIndex : null);
}

function isDirectPlayable(filePath, probe) {
  const ext = path.extname(filePath).toLowerCase();
  const { videoCodec, audioCodec } = codecsFromProbe(probe);

  if (ext === '.mp4' || ext === '.m4v') {
    const videoOk = !videoCodec || ['h264', 'avc1'].includes(videoCodec);
    const audioOk = !audioCodec || ['aac', 'mp3', 'alac'].includes(audioCodec);
    return videoOk && audioOk;
  }

  if (ext === '.webm') {
    const videoOk = !videoCodec || ['vp8', 'vp9', 'av1'].includes(videoCodec);
    const audioOk = !audioCodec || ['opus', 'vorbis'].includes(audioCodec);
    return videoOk && audioOk;
  }

  if (ext === '.ogg' || ext === '.ogv') {
    const videoOk = !videoCodec || ['theora', 'vp8', 'vp9'].includes(videoCodec);
    const audioOk = !audioCodec || ['vorbis', 'opus'].includes(audioCodec);
    return videoOk && audioOk;
  }

  return false;
}

async function getPlaybackProfile(movie, options = {}) {
  const probe = await probeMedia(movie.video_path);
  const codecs = codecsFromProbe(probe);
  const tracks = tracksFromProbe(probe);
  const directPlayable = isDirectPlayable(movie.video_path, probe);
  const selectedAudioStreamIndex = selectedAudioIndex(probe, options.audioStreamIndex);
  const needsTrackAwarePlayback = tracks.audioTracks.length > 1;
  const streamMode = directPlayable && !needsTrackAwarePlayback ? 'direct' : 'hls';
  return {
    directPlayable,
    streamMode,
    format: path.extname(movie.video_path).replace('.', '').toLowerCase(),
    selectedAudioStreamIndex,
    hlsVariant: variantKey({ audioStreamIndex: selectedAudioStreamIndex }),
    audioTracks: tracks.audioTracks,
    subtitleTracks: tracks.subtitleTracks,
    ...codecs,
    probeError: probe.error || null
  };
}

function manifestComplete(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  return fs.readFileSync(filePath, 'utf8').includes('#EXT-X-ENDLIST');
}

function ensureHlsTranscode(movie, options = {}) {
  const outputDir = hlsVariantDirectory(movie.id, movie.video_path, options);
  const manifest = path.join(outputDir, 'index.m3u8');
  const jobKey = `${movie.id}:${sourceSignature(movie.video_path)}:${variantKey(options)}`;

  fs.mkdirSync(outputDir, { recursive: true });

  if (manifestComplete(manifest)) {
    return { ready: true, running: false, manifestPath: manifest };
  }

  const existingJob = runningJobs.get(jobKey);
  if (existingJob && !existingJob.killed) {
    return { ready: fs.existsSync(manifest), running: true, manifestPath: manifest };
  }

  const args = [
    '-hide_banner',
    '-y',
    '-i', movie.video_path,
    '-map', '0:v:0',
    '-map', Number.isInteger(options.audioStreamIndex) ? `0:${options.audioStreamIndex}` : '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-hls_time', '6',
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outputDir, 'segment_%05d.ts'),
    manifest
  ];

  const ffmpeg = spawn(commandPath('ffmpeg', 'FFMPEG_PATH'), args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  });

  runningJobs.set(jobKey, ffmpeg);

  ffmpeg.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (/error|invalid|failed/i.test(text)) {
      console.warn(`ffmpeg ${movie.id}: ${text.trim()}`);
    }
  });

  ffmpeg.on('error', (error) => {
    console.error(`ffmpeg ${movie.id} failed to start:`, error.message);
    runningJobs.delete(jobKey);
  });

  ffmpeg.on('close', () => {
    runningJobs.delete(jobKey);
  });

  return { ready: fs.existsSync(manifest), running: true, manifestPath: manifest };
}

async function waitForFile(filePath, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function hlsAssetPath(movieId, videoPath, variant, fileName) {
  if (!/^audio-(auto|\d+)$/.test(String(variant || ''))) {
    return null;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) {
    return null;
  }
  const outputDir = hlsVariantDirectory(movieId, videoPath, optionsFromVariant(variant));
  const assetPath = path.join(outputDir, fileName);
  const resolvedDir = path.resolve(outputDir);
  const resolvedAsset = path.resolve(assetPath);
  if (!resolvedAsset.startsWith(resolvedDir)) {
    return null;
  }
  return assetPath;
}

function subtitleDirectory(movieId, filePath) {
  return path.join(hlsDirectory(movieId, filePath), 'subtitles');
}

function subtitleTrackPath(movieId, filePath, streamIndex) {
  return path.join(subtitleDirectory(movieId, filePath), `stream-${streamIndex}.vtt`);
}

async function ensureSubtitleTrack(movie, streamIndex) {
  const requested = Number(streamIndex);
  const profile = await getPlaybackProfile(movie);
  const track = profile.subtitleTracks.find((item) => item.streamIndex === requested);

  if (!track) {
    const error = new Error('Subtitle track not found');
    error.statusCode = 404;
    throw error;
  }

  if (!track.extractable) {
    const error = new Error(`Subtitle codec ${track.codec} cannot be converted to WebVTT`);
    error.statusCode = 415;
    throw error;
  }

  const outputDir = subtitleDirectory(movie.id, movie.video_path);
  const outputPath = subtitleTrackPath(movie.id, movie.video_path, requested);
  fs.mkdirSync(outputDir, { recursive: true });

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return outputPath;
  }

  return new Promise((resolve, reject) => {
    execFile(
      commandPath('ffmpeg', 'FFMPEG_PATH'),
      [
        '-hide_banner',
        '-y',
        '-i', movie.video_path,
        '-map', `0:${requested}`,
        '-f', 'webvtt',
        outputPath
      ],
      { windowsHide: true },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(outputPath);
      }
    );
  });
}

function hlsContentType(fileName) {
  if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (fileName.endsWith('.ts')) return 'video/mp2t';
  return 'application/octet-stream';
}

module.exports = {
  ensureHlsTranscode,
  ensureSubtitleTrack,
  getPlaybackProfile,
  hlsAssetPath,
  hlsContentType,
  manifestPath,
  optionsFromVariant,
  probeMedia,
  tracksFromProbe,
  variantKey,
  waitForFile
};
