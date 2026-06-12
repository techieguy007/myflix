const path = require('path');

const VIDEO_EXTENSIONS = [
  '.mp4', '.m4v', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m2ts', '.ts', '.vob'
];

const RELEASE_TOKENS = [
  '4320p', '2160p', '1080p', '720p', '480p', '4k', 'uhd', 'hdr', 'hdr10', 'dv', 'sdr',
  'bluray', 'blu-ray', 'blu ray', 'brrip', 'bdrip', 'web-dl', 'web dl', 'webdl', 'webrip', 'web rip', 'hdtv',
  'amzn', 'nf', 'ddp5', 'dd5', 'eac3', 'atmos', 'aac', 'ac3', 'dts', 'truehd',
  'x264', 'x265', 'h264', 'h265', 'hevc', '10bit', '8bit', 'yts', 'galaxyrg',
  'tgx', 'rarbg', 'bone', 'multi', 'subs', 'eng', 'hindi'
];

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bIi\b/g, 'II')
    .replace(/\bIii\b/g, 'III')
    .replace(/\bIv\b/g, 'IV')
    .replace(/\bVi\b/g, 'VI')
    .replace(/\bVii\b/g, 'VII');
}

function stripInvalidPathChars(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim();
}

function cleanName(value) {
  if (!value) return '';
  let cleaned = value
    .replace(/[._]+/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\([^)]*(?:1080p|720p|2160p|webrip|bluray|x265|x264|hevc|aac|eac3)[^)]*\)/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\bS\d{1,2}\s*-\s*S\d{1,2}\b/gi, ' ')
    .replace(/\bSeason\s*S?\d{1,2}\b/gi, ' ')
    .replace(/\b(?:4320|2160|1080|720|480)p?\b/gi, ' ')
    .replace(/\b(?:5|6|7)\s*[\s.]\s*1\b/g, ' ')
    .replace(/\b(?:aac|ddp|dd|eac3|ac3|dts|truehd)\s*\d?\s*(?:1|0)?\b/gi, ' ')
    .replace(/\bx26[45]\s*-\s*[a-z0-9]+$/gi, ' ');

  RELEASE_TOKENS.forEach((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  });

  cleaned = cleaned
    .replace(/\b\d{3,4}MB\b/gi, ' ')
    .replace(/\b5\.1\b/g, ' ')
    .replace(/\b7\.1\b/g, ' ')
    .replace(/\b(?:5|6|7)\s+1\b/g, ' ')
    .replace(/\s+-\s*[a-z0-9]+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return titleCase(stripInvalidPathChars(cleaned));
}

function extractYear(value) {
  const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function removeYear(value) {
  return String(value || '')
    .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectEpisode(fileBase, relativeParts) {
  const joined = [...relativeParts, fileBase].join(' ');
  const patterns = [
    /(?:^|[^\w])S(\d{1,2})\s*E(\d{1,3})(?:[^\w]|$)/i,
    /(?:^|[^\w])(\d{1,2})x(\d{1,3})(?:[^\w]|$)/i,
    /Season\s*(\d{1,2}).*?Episode\s*(\d{1,3})/i
  ];

  for (const pattern of patterns) {
    const match = joined.match(pattern);
    if (match) {
      return {
        season: Number(match[1]),
        episode: Number(match[2]),
        matchText: match[0]
      };
    }
  }

  const seasonFolder = relativeParts.find((part) => /Season\s*S?\d{1,2}/i.test(part));
  const episodeOnly = fileBase.match(/(?:^|[^\w])E(\d{1,3})(?:[^\w]|$)/i)
    || fileBase.match(/Episode\s*(\d{1,3})/i);
  if (seasonFolder && episodeOnly) {
    const season = seasonFolder.match(/S?(\d{1,2})/i);
    return {
      season: season ? Number(season[1]) : 1,
      episode: Number(episodeOnly[1]),
      matchText: episodeOnly[0]
    };
  }

  return null;
}

function seriesTitleFrom(fileBase, relativeParts, episode) {
  const sxe = /S\d{1,2}\s*E\d{1,3}/i;
  if (sxe.test(fileBase)) {
    return cleanName(fileBase.split(sxe)[0]);
  }

  const oneX = /\d{1,2}x\d{1,3}/i;
  if (oneX.test(fileBase)) {
    return cleanName(fileBase.split(oneX)[0]);
  }

  const seasonIndex = relativeParts.findIndex((part) => /Season\s*S?\d{1,2}/i.test(part));
  if (seasonIndex > 0) {
    return cleanName(removeYear(relativeParts[seasonIndex - 1]));
  }

  const folderWithSeasonRange = relativeParts.find((part) => /S\d{1,2}\s*-\s*S\d{1,2}/i.test(part));
  if (folderWithSeasonRange) {
    return cleanName(removeYear(folderWithSeasonRange));
  }

  return cleanName(removeYear(relativeParts[0] || fileBase));
}

function episodeTitleFrom(fileBase, episode) {
  const normalized = fileBase.replace(/[._]+/g, ' ');
  const patterns = [
    /S\d{1,2}\s*E\d{1,3}\s*[- ]*(.*)$/i,
    /\d{1,2}x\d{1,3}\s*[- ]*(.*)$/i,
    /Episode\s*\d{1,3}\s*[- ]*(.*)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanName(removeYear(match[1]));
      if (cleaned) return cleaned;
    }
  }

  return `Episode ${episode.episode}`;
}

function parseMovie(fileBase, relativeParts) {
  const folderCandidate = relativeParts.length > 1 ? relativeParts[relativeParts.length - 2] : fileBase;
  const source = extractYear(folderCandidate) ? folderCandidate : fileBase;
  const year = extractYear(source);
  const withoutYear = removeYear(source);
  return {
    mediaType: 'movie',
    title: cleanName(withoutYear),
    releaseYear: year
  };
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function canonicalPath(root, parsed, ext) {
  if (parsed.mediaType === 'episode') {
    const series = stripInvalidPathChars(parsed.seriesTitle || 'Unknown Series');
    const episodeTitle = parsed.episodeTitle ? ` - ${stripInvalidPathChars(parsed.episodeTitle)}` : '';
    return path.join(
      root,
      'TV Shows',
      series,
      `Season ${pad(parsed.seasonNumber)}`,
      `${series} - S${pad(parsed.seasonNumber)}E${pad(parsed.episodeNumber)}${episodeTitle}${ext}`
    );
  }

  const title = stripInvalidPathChars(parsed.title || 'Unknown Movie');
  const titleWithYear = parsed.releaseYear ? `${title} (${parsed.releaseYear})` : title;
  return path.join(root, 'Movies', titleWithYear, `${titleWithYear}${ext}`);
}

function parseMediaPath(filePath, root) {
  const ext = path.extname(filePath);
  const fileBase = path.basename(filePath, ext);
  const relative = path.relative(root, filePath);
  const relativeParts = relative.split(path.sep);
  const episode = detectEpisode(fileBase, relativeParts);

  if (episode) {
    const seriesTitle = seriesTitleFrom(fileBase, relativeParts, episode);
    const episodeTitle = episodeTitleFrom(fileBase, episode);
    const parsed = {
      mediaType: 'episode',
      title: `${seriesTitle} - S${pad(episode.season)}E${pad(episode.episode)} - ${episodeTitle}`,
      releaseYear: extractYear(relativeParts.join(' ')),
      seriesTitle,
      seasonNumber: episode.season,
      episodeNumber: episode.episode,
      episodeTitle
    };
    parsed.suggestedPath = canonicalPath(root, parsed, ext);
    return parsed;
  }

  const parsed = parseMovie(fileBase, relativeParts);
  parsed.suggestedPath = canonicalPath(root, parsed, ext);
  return parsed;
}

module.exports = {
  VIDEO_EXTENSIONS,
  cleanName,
  isVideoFile,
  parseMediaPath,
  stripInvalidPathChars
};
