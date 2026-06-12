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

function manifestPath(movieId, filePath) {
  return path.join(hlsDirectory(movieId, filePath), 'index.m3u8');
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
        '-show_entries', 'stream=index,codec_type,codec_name',
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

async function getPlaybackProfile(movie) {
  const probe = await probeMedia(movie.video_path);
  const codecs = codecsFromProbe(probe);
  const directPlayable = isDirectPlayable(movie.video_path, probe);
  return {
    directPlayable,
    streamMode: directPlayable ? 'direct' : 'hls',
    format: path.extname(movie.video_path).replace('.', '').toLowerCase(),
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

function clearOldTranscodes(movieId, keepDir) {
  const movieRoot = path.join(TRANSCODE_ROOT, String(movieId));
  if (!fs.existsSync(movieRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(movieRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(movieRoot, entry.name);
    if (path.resolve(fullPath) !== path.resolve(keepDir)) {
      safeRmDir(fullPath);
    }
  }
}

function ensureHlsTranscode(movie) {
  const outputDir = hlsDirectory(movie.id, movie.video_path);
  const manifest = path.join(outputDir, 'index.m3u8');
  const jobKey = `${movie.id}:${sourceSignature(movie.video_path)}`;

  fs.mkdirSync(outputDir, { recursive: true });
  clearOldTranscodes(movie.id, outputDir);

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
    '-map', '0:a:0?',
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

function hlsAssetPath(movieId, videoPath, fileName) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) {
    return null;
  }
  const outputDir = hlsDirectory(movieId, videoPath);
  const assetPath = path.join(outputDir, fileName);
  const resolvedDir = path.resolve(outputDir);
  const resolvedAsset = path.resolve(assetPath);
  if (!resolvedAsset.startsWith(resolvedDir)) {
    return null;
  }
  return assetPath;
}

function hlsContentType(fileName) {
  if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (fileName.endsWith('.ts')) return 'video/mp2t';
  return 'application/octet-stream';
}

module.exports = {
  ensureHlsTranscode,
  getPlaybackProfile,
  hlsAssetPath,
  hlsContentType,
  manifestPath,
  waitForFile
};
