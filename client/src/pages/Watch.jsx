import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { FiArrowLeft, FiDownload, FiPlay, FiPause, FiMaximize2, FiSearch, FiType, FiVolume2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import Hls from 'hls.js';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';

function shouldPreferCompatiblePlayback() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Android|iPhone|iPad|iPod|Mobile|EdgA|CriOS|FxiOS/i.test(navigator.userAgent || '');
}

const Container = styled.div`
  min-height: 100vh;
  background: #000;
  display: flex;
  flex-direction: column;
`;

const VideoContainer = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
`;

const Video = styled.video`
  width: 100%;
  height: 100%;
  max-height: 80vh;
  outline: none;

  /* Style embedded subtitles */
  ::cue {
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    font-size: 1.2rem;
    font-family: Arial, sans-serif;
    text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
    padding: 0.2em 0.4em;
    border-radius: 2px;
  }

  ::cue(.yellow) {
    color: yellow;
  }

  ::cue(.cyan) {
    color: cyan;
  }
`;

const BackButton = styled.button`
  position: absolute;
  top: 2rem;
  left: 2rem;
  z-index: 10;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  color: white;
  padding: 1rem;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.9);
  }

  svg {
    font-size: 1.5rem;
  }
`;

const Controls = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  padding: 2rem;
  opacity: ${({ visible }) => visible ? 1 : 0};
  transition: opacity 0.3s ease;
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  margin-bottom: 1rem;
  cursor: pointer;
`;

const Progress = styled.div`
  height: 100%;
  background: ${({ theme }) => theme.colors.primary};
  border-radius: 2px;
  width: ${({ progress }) => progress}%;
  transition: width 0.1s ease;
`;

const ControlButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const ControlButton = styled.button`
  background: none;
  border: none;
  color: white;
  padding: 0.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 0.8;
  }

  svg {
    font-size: 1.5rem;
  }
`;

const TimeDisplay = styled.span`
  color: white;
  font-size: 0.9rem;
  margin-left: auto;
`;

const SubtitleMenu = styled.div`
  position: fixed;
  left: ${({ $position }) => ($position ? `${$position.left}px` : '1rem')};
  bottom: ${({ $position }) => ($position ? `${$position.bottom}px` : '5rem')};
  width: ${({ $position }) => ($position ? `${$position.width}px` : '240px')};
  background: rgba(0, 0, 0, 0.9);
  border-radius: 4px;
  padding: 0.5rem 0;
  max-height: ${({ $position }) => ($position ? `${$position.maxHeight}px` : '300px')};
  overflow-y: auto;
  overflow-x: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  z-index: 30;
  display: ${({ $visible }) => $visible ? 'block' : 'none'};
`;

const SubtitleOption = styled.button`
  width: 100%;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: white;
  text-align: left;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  transition: background-color 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  &.active {
    background: rgba(229, 9, 20, 0.3);
    color: ${({ theme }) => theme.colors.primary};
  }

  &:disabled {
    color: rgba(255, 255, 255, 0.35);
    cursor: not-allowed;
  }
`;

const SubtitleMenuSection = styled.div`
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  margin-top: 0.35rem;
  padding: 0.75rem 0.8rem 0.4rem;
`;

const SubtitleSectionLabel = styled.div`
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.5rem;
`;

const SubtitleSearchRow = styled.div`
  display: flex;
  gap: 0.4rem;
  align-items: center;
`;

const SubtitleLanguageInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 2.1rem;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: white;
  padding: 0 0.6rem;
  font-size: 0.85rem;

  &::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }
`;

const SubtitleSearchButton = styled.button`
  width: 2.25rem;
  height: 2.1rem;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  flex: 0 0 auto;

  &:disabled {
    opacity: 0.55;
    cursor: wait;
  }
`;

const SubtitleStatusText = styled.div`
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.78rem;
  line-height: 1.35;
  margin-top: 0.55rem;
`;

const SubtitleResultButton = styled.button`
  width: 100%;
  border: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: white;
  text-align: left;
  padding: 0.65rem;
  margin-top: 0.45rem;
  display: block;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  &:disabled {
    cursor: wait;
    opacity: 0.6;
  }
`;

const SubtitleResultTitle = styled.div`
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
`;

const SubtitleResultMeta = styled.div`
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.74rem;
  line-height: 1.35;
  margin-top: 0.25rem;
`;

const SubtitleContainer = styled.div`
  position: relative;
  display: inline-block;
`;

const MovieInfo = styled.div`
  padding: 2rem;
  max-width: 800px;
`;

const MovieTitle = styled.h1`
  color: ${({ theme }) => theme.colors.text};
  font-size: 2rem;
  font-weight: bold;
  margin-bottom: 1rem;
`;

const MovieMeta = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 2rem;
  margin-bottom: 1rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ContentRatingBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 3px;
  color: ${({ theme }) => theme.colors.text};
  background: rgba(255, 255, 255, 0.14);
  padding: 0.12rem 0.44rem;
  font-size: 0.82rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0;
`;

const SeriesNavigation = styled.div`
  display: flex;
  gap: 0.85rem;
  align-items: flex-end;
  flex-wrap: wrap;
  margin: 0.5rem 0 1.25rem;
`;

const SeriesSelectGroup = styled.label`
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: ${({ $wide }) => ($wide ? '280px' : '150px')};
  flex: ${({ $wide }) => ($wide ? '1 1 280px' : '0 1 150px')};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;

  @media (max-width: 640px) {
    min-width: 100%;
  }
`;

const SeriesSelect = styled.select`
  appearance: none;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: ${({ theme }) => theme.colors.text};
  padding: 0.75rem 2.25rem 0.75rem 0.85rem;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  outline: none;
  background-image:
    linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position:
    calc(100% - 18px) 50%,
    calc(100% - 13px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;

  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
    box-shadow: 0 0 0 2px rgba(229, 9, 20, 0.28);
  }

  option {
    color: #111827;
  }
`;

const MovieDescription = styled.p`
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.6;
  font-size: 1.1rem;
`;

const ErrorMessage = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.error};
  padding: 2rem;
`;

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
};

const episodeHeading = (movie) => {
  if (movie.media_type !== 'episode') return movie.title;
  const season = String(movie.season_number || 1).padStart(2, '0');
  const episode = String(movie.episode_number || 1).padStart(2, '0');
  return `${movie.series_title || 'TV Show'} - S${season}E${episode} - ${movie.episode_title || movie.title}`;
};

const normalizeTitle = (value) => String(value || '').trim().toLowerCase();

const episodeOptionLabel = (episode) => {
  const episodeNumber = episode.episode_number
    ? `E${String(episode.episode_number).padStart(2, '0')}`
    : 'Episode';
  return `${episodeNumber} - ${episode.episode_title || episode.title || 'Untitled'}`;
};

const subtitleResultMeta = (result) => {
  const parts = [];
  if (result.movieHashMatch) parts.push('hash match');
  if (result.fps) parts.push(`${result.fps} fps`);
  if (result.ratings) parts.push(`${result.ratings}/10`);
  if (result.downloadCount) parts.push(`${result.downloadCount} downloads`);
  if (result.hearingImpaired) parts.push('HI');
  if (result.trusted) parts.push('trusted');
  return parts.join(' | ');
};

const Watch = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [videoRef, setVideoRef] = useState(null);
  const resumeTimeRef = useRef(0);
  const shouldResumeRef = useRef(false);
  const pendingAutoResumeRef = useRef(false);
  const [audioTracks, setAudioTracks] = useState([]);
  const [activeAudio, setActiveAudio] = useState(null);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState(null);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [subtitleLanguageQuery, setSubtitleLanguageQuery] = useState('en,hi');
  const [subtitleSearchResults, setSubtitleSearchResults] = useState([]);
  const [subtitleSearchLoading, setSubtitleSearchLoading] = useState(false);
  const [subtitleSearchError, setSubtitleSearchError] = useState('');
  const [subtitleDownloadId, setSubtitleDownloadId] = useState(null);
  const [trackMenuPosition, setTrackMenuPosition] = useState(null);
  const [videoError, setVideoError] = useState(null);
  const [videoSrc, setVideoSrc] = useState('');
  const [streamMode, setStreamMode] = useState('direct');
  const [playbackInfo, setPlaybackInfo] = useState(null);
  const [seriesNavigation, setSeriesNavigation] = useState(null);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState('');
  const hlsRef = useRef(null);
  const hlsRecoveryRef = useRef({ network: 0, media: 0, native: 0 });
  const hlsRetryTimerRef = useRef(null);
  const hlsReloadRef = useRef({ count: 0, timer: null });
  const currentTimeRef = useRef(0);
  const streamOffsetRef = useRef(0);
  const playbackRequestRef = useRef(0);
  const pendingSubtitleFileRef = useRef(null);

  const reservePlaybackRequest = useCallback(() => {
    playbackRequestRef.current += 1;
    return playbackRequestRef.current;
  }, []);

  const clearHlsRetryTimer = useCallback(() => {
    if (hlsRetryTimerRef.current) {
      clearTimeout(hlsRetryTimerRef.current);
      hlsRetryTimerRef.current = null;
    }
  }, []);

  const clearHlsReloadTimer = useCallback(() => {
    if (hlsReloadRef.current.timer) {
      clearTimeout(hlsReloadRef.current.timer);
      hlsReloadRef.current.timer = null;
    }
  }, []);

  const cancelPendingHlsRecovery = useCallback(() => {
    clearHlsRetryTimer();
    clearHlsReloadTimer();
  }, [clearHlsReloadTimer, clearHlsRetryTimer]);

  const markPlaybackAutoResume = useCallback((shouldResume) => {
    const nextShouldResume = Boolean(shouldResume);
    pendingAutoResumeRef.current = nextShouldResume;
    shouldResumeRef.current = nextShouldResume;
  }, []);

  const tryResumePlayback = useCallback((reason) => {
    if (!videoRef || (!pendingAutoResumeRef.current && !shouldResumeRef.current)) {
      return false;
    }

    if (videoRef.readyState < 2) {
      return false;
    }

    pendingAutoResumeRef.current = false;
    shouldResumeRef.current = false;
    setVideoError(null);
    videoRef.play().catch((error) => {
      pendingAutoResumeRef.current = true;
      shouldResumeRef.current = true;
      console.warn(`Unable to resume playback after ${reason}:`, error);
    });
    return true;
  }, [videoRef]);

  const getKnownDuration = useCallback(() => {
    if (videoRef && Number.isFinite(videoRef.duration) && videoRef.duration > 0) {
      return videoRef.duration;
    }

    const movieDuration = Number(movie?.duration);
    if (Number.isFinite(movieDuration) && movieDuration > 0) {
      return movieDuration;
    }

    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }, [duration, movie?.duration, videoRef]);

  useEffect(() => {
    fetchMovie();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isPlaying && !showAudioMenu && !showSubtitleMenu) {
        setShowControls(false);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [showControls, isPlaying, showAudioMenu, showSubtitleMenu]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if ((showSubtitleMenu || showAudioMenu) && !event.target.closest('.track-menu')) {
        setShowSubtitleMenu(false);
        setShowAudioMenu(false);
        setTrackMenuPosition(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showAudioMenu, showSubtitleMenu]);

  useEffect(() => {
    const closeTrackMenus = () => {
      setShowSubtitleMenu(false);
      setShowAudioMenu(false);
      setTrackMenuPosition(null);
    };

    window.addEventListener('resize', closeTrackMenus);
    return () => window.removeEventListener('resize', closeTrackMenus);
  }, []);

  useEffect(() => () => {
    cancelPendingHlsRecovery();
  }, [cancelPendingHlsRecovery]);

  const scheduleHlsRecovery = useCallback((reason, retryPlayback = false) => {
    if (!videoRef || streamMode !== 'hls') {
      return false;
    }

    const hls = hlsRef.current;
    if (!hls) {
      return false;
    }

    const resumeAt = Number.isFinite(videoRef.currentTime) ? videoRef.currentTime : currentTimeRef.current;
    setVideoError(null);
    console.warn(`Recovering HLS playback after ${reason}`, { resumeAt, retryPlayback });

    clearHlsRetryTimer();

    hlsRetryTimerRef.current = setTimeout(() => {
      try {
        hls.startLoad(Math.max(0, resumeAt - 2));
        if (Number.isFinite(resumeAt) && resumeAt > 0 && Math.abs(videoRef.currentTime - resumeAt) > 1) {
          videoRef.currentTime = resumeAt;
        }
        if (retryPlayback) {
          videoRef.play().catch((error) => {
            console.warn('HLS recovery play retry was blocked:', error);
          });
        }
      } catch (error) {
        console.warn('HLS recovery failed:', error);
      }
    }, 800);

    return true;
  }, [clearHlsRetryTimer, videoRef, streamMode]);

  useEffect(() => {
    if (!videoRef || !videoSrc || streamMode !== 'hls') {
      return undefined;
    }

    if (videoRef.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.src = videoSrc;
      videoRef.load();
      return undefined;
    }

    if (!Hls.isSupported()) {
      setVideoError({
        message: 'Browser-compatible stream not supported',
        details: 'This browser cannot play HLS streams. Try Chrome, Edge, or another modern browser.'
      });
      return undefined;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startPosition: 0,
      maxBufferLength: 60,
      backBufferLength: 30,
      manifestLoadingMaxRetry: 12,
      manifestLoadingRetryDelay: 1000,
      manifestLoadingMaxRetryTimeout: 12000,
      levelLoadingMaxRetry: 12,
      levelLoadingRetryDelay: 1000,
      levelLoadingMaxRetryTimeout: 12000,
      fragLoadingMaxRetry: 12,
      fragLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 12000
    });

    hlsRef.current = hls;
    hlsRecoveryRef.current = { network: 0, media: 0, native: 0 };
    hls.loadSource(videoSrc);
    hls.attachMedia(videoRef);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      hlsRecoveryRef.current = { network: 0, media: 0, native: 0 };
      hlsReloadRef.current.count = 0;
      setVideoError(null);
      tryResumePlayback('HLS manifest parsed');
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal) {
        return;
      }

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hlsRecoveryRef.current.network += 1;
        if (hlsRecoveryRef.current.network <= 12) {
          scheduleHlsRecovery(data.details || 'network error', !videoRef.paused);
          return;
        }
        setVideoError({
          message: 'Browser-compatible stream failed',
          details: 'The transcoded stream could not be loaded after several retries.'
        });
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
        hls.destroy();
        return;
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hlsRecoveryRef.current.media += 1;
        if (hlsRecoveryRef.current.media <= 4) {
          hls.recoverMediaError();
          scheduleHlsRecovery(data.details || 'media error', !videoRef.paused);
          return;
        }
        setVideoError({
          message: 'Browser-compatible stream failed',
          details: data.details || 'The transcoded stream could not be played.'
        });
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
        hls.destroy();
        return;
      }

      setVideoError({
        message: 'Browser-compatible stream failed',
        details: data.details || 'The transcoded stream could not be played.'
      });
      if (hlsRef.current === hls) {
        hlsRef.current = null;
      }
      hls.destroy();
    });

    return () => {
      if (hlsRetryTimerRef.current) {
        clearTimeout(hlsRetryTimerRef.current);
        hlsRetryTimerRef.current = null;
      }
      if (hlsRef.current === hls) {
        hlsRef.current = null;
      }
      hls.destroy();
    };
  }, [videoRef, videoSrc, streamMode, scheduleHlsRecovery, tryResumePlayback]);

  const baseUrl = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000';

  const tokenParam = useCallback(() => {
    const token = localStorage.getItem('authToken');
    return token ? `?token=${encodeURIComponent(token)}` : '';
  }, []);

  const toAbsoluteUrl = useCallback((pathOrUrl) => (
    pathOrUrl && pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`
  ), [baseUrl]);

  const addCacheBust = useCallback((url) => (
    `${url}${url.includes('?') ? '&' : '?'}r=${Date.now()}`
  ), []);

  const applyPlayback = useCallback((playback, cacheBust = false) => {
    const tracks = playback.compatibility || {};
    const audio = tracks.audioTracks || [];
    const subtitles = tracks.subtitleTracks || [];
    const selectedAudio = tracks.selectedAudioStreamIndex ?? (audio[0] ? audio[0].streamIndex : null);
    const nextStreamOffset = playback.streamMode === 'hls' ? Number(playback.startSeconds || 0) : 0;

    setPlaybackInfo(playback);
    setStreamMode(playback.streamMode || 'direct');
    streamOffsetRef.current = nextStreamOffset;
    setAudioTracks(audio);
    setActiveAudio(selectedAudio);
    setSubtitleTracks(subtitles);
    setActiveSubtitle((current) => {
      const pendingFileName = pendingSubtitleFileRef.current;
      if (pendingFileName) {
        const downloadedTrack = subtitles.find((track) => track.fileName === pendingFileName && track.extractable);
        if (downloadedTrack) {
          pendingSubtitleFileRef.current = null;
          return downloadedTrack.streamIndex;
        }
      }
      return subtitles.some((track) => track.streamIndex === current && track.extractable) ? current : null;
    });

    const sourcePath = playback.streamMode === 'hls' ? playback.hlsUrl : playback.directUrl;
    const sourceUrl = toAbsoluteUrl(sourcePath);
    setVideoSrc(cacheBust ? addCacheBust(sourceUrl) : sourceUrl);
  }, [addCacheBust, toAbsoluteUrl]);

  const loadPlayback = useCallback(async (movieId, audioStreamIndex = null, startSeconds = 0, options = {}) => {
    const requestId = options.requestId ?? reservePlaybackRequest();
    const params = new URLSearchParams();
    const token = localStorage.getItem('authToken');
    if (token) params.set('token', token);
    if (Number.isInteger(audioStreamIndex)) params.set('audio', String(audioStreamIndex));
    if (shouldPreferCompatiblePlayback()) params.set('compatible', '1');
    if (Number.isFinite(startSeconds) && startSeconds > 0) {
      params.set('start', String(Math.floor(startSeconds)));
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const playbackResponse = await api.get(`/api/stream/${movieId}/playback${query}`);
    if (requestId !== playbackRequestRef.current) {
      console.info('Ignoring stale playback profile response', {
        movieId,
        startSeconds,
        requestId,
        latestRequestId: playbackRequestRef.current
      });
      return false;
    }

    applyPlayback(playbackResponse.data, Boolean(options.cacheBust));
    return true;
  }, [applyPlayback, reservePlaybackRequest]);

  const recoverHlsByReload = (reason, retryPlayback = false) => {
    if (!movie || streamMode !== 'hls') {
      return false;
    }

    const localTime = videoRef && Number.isFinite(videoRef.currentTime) ? videoRef.currentTime : 0;
    const absoluteTime = Number.isFinite(currentTimeRef.current) && currentTimeRef.current > 0
      ? currentTimeRef.current
      : streamOffsetRef.current + localTime;
    const startAt = Math.max(0, absoluteTime - 2);
    const shouldResume = retryPlayback || Boolean(videoRef && !videoRef.paused) || isPlaying;

    hlsReloadRef.current.count += 1;
    if (hlsReloadRef.current.count > 30) {
      return false;
    }

    clearHlsRetryTimer();
    clearHlsReloadTimer();
    const requestId = reservePlaybackRequest();

    setVideoError(null);
    if (videoRef) {
      videoRef.pause();
    }
    markPlaybackAutoResume(shouldResume);
    console.warn('Reloading HLS stream after playback hiccup', {
      reason,
      startAt,
      retry: hlsReloadRef.current.count,
      requestId
    });

    const delay = Math.min(5000, 500 + hlsReloadRef.current.count * 250);
    hlsReloadRef.current.timer = setTimeout(() => {
      hlsReloadRef.current.timer = null;
      if (requestId !== playbackRequestRef.current) {
        console.info('Skipping stale HLS stream reload', {
          reason,
          startAt,
          requestId,
          latestRequestId: playbackRequestRef.current
        });
        return;
      }

      loadPlayback(movie.id, activeAudio, startAt, { cacheBust: true, requestId }).catch((error) => {
        if (requestId !== playbackRequestRef.current) {
          return;
        }

        console.error('HLS stream reload failed:', error);
        setVideoError({
          message: 'Browser-compatible stream failed',
          details: 'MyFlix could not reload the stream at the current timestamp.'
        });
      });
    }, delay);

    return true;
  };

  const subtitleUrl = (track) => (
    toAbsoluteUrl(`/api/stream/${id}/subtitle/${track.streamIndex}.vtt${tokenParam()}`)
  );

  const extractableSubtitleTracks = subtitleTracks.filter((track) => track.extractable);

  const applySubtitleSelection = () => {
    if (!videoRef) return;

    for (let i = 0; i < videoRef.textTracks.length; i++) {
      const track = extractableSubtitleTracks[i];
      videoRef.textTracks[i].mode = track && track.streamIndex === activeSubtitle ? 'showing' : 'disabled';
    }
  };

  useEffect(() => {
    applySubtitleSelection();
  }, [videoRef, activeSubtitle, subtitleTracks, videoSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSeriesNavigation = async (currentMovie) => {
    if (currentMovie.media_type !== 'episode') {
      setSeriesNavigation(null);
      setSelectedSeasonNumber('');
      return;
    }

    try {
      const libraryResponse = await api.get('/api/library');
      const shows = libraryResponse.data.series || [];
      const currentMovieId = Number(currentMovie.id);
      const currentSeriesTitle = normalizeTitle(currentMovie.series_title);

      const matchingShow = shows.find((show) => (
        (show.seasons || []).some((season) => (
          (season.episodes || []).some((episode) => Number(episode.id) === currentMovieId)
        ))
      )) || shows.find((show) => normalizeTitle(show.title) === currentSeriesTitle);

      if (!matchingShow) {
        setSeriesNavigation(null);
        setSelectedSeasonNumber('');
        return;
      }

      setSeriesNavigation(matchingShow);
      setSelectedSeasonNumber(String(currentMovie.season_number || matchingShow.seasons?.[0]?.seasonNumber || 1));
    } catch (seriesError) {
      console.warn('Failed to load series navigation:', seriesError);
      setSeriesNavigation(null);
      setSelectedSeasonNumber('');
    }
  };

  const fetchMovie = async () => {
    try {
      setLoading(true);
      setError(null);
      setVideoError(null);
      setPlaybackInfo(null);
      setStreamMode('direct');
      streamOffsetRef.current = 0;
      setAudioTracks([]);
      setSubtitleTracks([]);
      setActiveAudio(null);
      setActiveSubtitle(null);
      setSubtitleSearchResults([]);
      setSubtitleSearchError('');
      setSubtitleDownloadId(null);
      pendingSubtitleFileRef.current = null;
      setSeriesNavigation(null);
      setSelectedSeasonNumber('');

      const movieResponse = await api.get(`/api/movies/${id}`);
      setMovie(movieResponse.data);
      await loadSeriesNavigation(movieResponse.data);

      try {
        await loadPlayback(movieResponse.data.id);
      } catch (playbackError) {
        console.warn('Playback profile failed:', playbackError);
        setPlaybackInfo(null);
        setVideoSrc('');
        setVideoError({
          message: 'Video source unavailable',
          details: playbackError.response?.data?.error
            || 'MyFlix could not prepare a browser-compatible stream for this file.'
        });
      }
    } catch (err) {
      console.error('Failed to fetch movie:', err);
      setError('Failed to load movie');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayPause = () => {
    if (!videoRef) return;
    
    if (isPlaying) {
      videoRef.pause();
    } else {
      setVideoError(null);
      videoRef.play().catch((error) => {
        console.warn('Unable to start playback:', error);
        if (streamMode === 'hls' && Hls.isSupported() && scheduleHlsRecovery('play request failed', true)) {
          return;
        }
        setVideoError({
          message: 'Playback could not start',
          details: error.message || 'The browser blocked or failed the play request.'
        });
      });
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef) {
      const absoluteTime = streamMode === 'hls'
        ? streamOffsetRef.current + videoRef.currentTime
        : videoRef.currentTime;
      currentTimeRef.current = absoluteTime;
      setCurrentTime(absoluteTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef) {
      setDuration(getKnownDuration());

      if (resumeTimeRef.current > 0) {
        videoRef.currentTime = streamMode === 'hls'
          ? Math.max(0, resumeTimeRef.current - streamOffsetRef.current)
          : resumeTimeRef.current;
        resumeTimeRef.current = 0;
      }

      applySubtitleSelection();

      tryResumePlayback('metadata loaded');
    }
  };

  const handleProgressClick = (e) => {
    const knownDuration = getKnownDuration();
    if (!videoRef || !knownDuration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * knownDuration;
    seekTo(newTime, 'progress');
  };

  const seekTo = useCallback((targetTime, reason = 'seek') => {
    if (!videoRef) return;

    const videoDuration = getKnownDuration();
    const nextTime = Math.min(
      videoDuration || Number.MAX_SAFE_INTEGER,
      Math.max(0, targetTime)
    );
    const wasPlaying = isPlaying || !videoRef.paused || pendingAutoResumeRef.current || shouldResumeRef.current;

    console.info('Video seek requested', {
      reason,
      from: currentTimeRef.current,
      to: nextTime,
      duration: videoDuration || null,
      streamMode
    });

    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    setShowControls(true);
    setVideoError(null);

    if (streamMode === 'hls' && movie) {
      cancelPendingHlsRecovery();
      hlsReloadRef.current.count = 0;
      resumeTimeRef.current = 0;
      const requestId = reservePlaybackRequest();
      markPlaybackAutoResume(wasPlaying);
      videoRef.pause();
      loadPlayback(movie.id, activeAudio, nextTime, { cacheBust: true, requestId }).catch((error) => {
        if (requestId !== playbackRequestRef.current) {
          return;
        }

        console.error('Failed to seek HLS stream:', error);
        setVideoError({
          message: 'Seek failed',
          details: 'MyFlix could not prepare the stream at that timestamp. Try again in a few seconds.'
        });
      });
      return;
    }

    const hls = streamMode === 'hls' ? hlsRef.current : null;
    if (hls) {
      try {
        hls.stopLoad();
      } catch (error) {
        console.warn('Unable to pause HLS loading before seek:', error);
      }
    }

    videoRef.currentTime = nextTime;

    if (hls) {
      try {
        hls.startLoad(nextTime);
      } catch (error) {
        console.warn('Unable to restart HLS loading after seek:', error);
      }
    }

    if (wasPlaying) {
      videoRef.play().catch((error) => {
        console.warn('Unable to resume playback after seek:', error);
      });
    }
  }, [
    activeAudio,
    cancelPendingHlsRecovery,
    getKnownDuration,
    isPlaying,
    loadPlayback,
    markPlaybackAutoResume,
    movie,
    reservePlaybackRequest,
    streamMode,
    videoRef
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const seekBy = useCallback((seconds) => {
    seekTo(currentTimeRef.current + seconds, seconds > 0 ? 'keyboard-forward' : 'keyboard-back');
  }, [seekTo]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );

      if (isTyping) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === 'ArrowRight' || event.code === 'ArrowRight' || event.key === 'Right') {
        event.preventDefault();
        event.stopPropagation();
        seekBy(30);
      } else if (event.key === 'ArrowLeft' || event.code === 'ArrowLeft' || event.key === 'Left') {
        event.preventDefault();
        event.stopPropagation();
        seekBy(-10);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [seekBy]);

  const handleMouseMove = () => {
    setShowControls(true);
  };

  const handleFullscreen = () => {
    if (videoRef) {
      if (videoRef.requestFullscreen) {
        videoRef.requestFullscreen();
      } else if (videoRef.webkitRequestFullscreen) {
        videoRef.webkitRequestFullscreen();
      } else if (videoRef.msRequestFullscreen) {
        videoRef.msRequestFullscreen();
      }
    }
  };

  const getTrackMenuPosition = (button, menuName) => {
    const rect = button.getBoundingClientRect();
    const margin = 12;
    const targetWidth = menuName === 'subtitles' ? 380 : 280;
    const minWidth = menuName === 'subtitles' ? 270 : 200;
    const width = Math.min(targetWidth, Math.max(minWidth, window.innerWidth - margin * 2));
    const idealLeft = rect.left + (rect.width / 2) - (width / 2);
    const left = Math.min(
      Math.max(idealLeft, margin),
      Math.max(margin, window.innerWidth - width - margin)
    );
    const bottom = Math.max(margin, window.innerHeight - rect.top + 8);
    const maxHeight = Math.max(140, Math.min(320, window.innerHeight - bottom - margin));

    return {
      left: Math.round(left),
      bottom: Math.round(bottom),
      width: Math.round(width),
      maxHeight: Math.round(maxHeight)
    };
  };

  const toggleTrackMenu = (event, menuName) => {
    event.stopPropagation();
    const shouldOpen = menuName === 'audio' ? !showAudioMenu : !showSubtitleMenu;

    setTrackMenuPosition(shouldOpen ? getTrackMenuPosition(event.currentTarget, menuName) : null);
    setShowAudioMenu(menuName === 'audio' ? shouldOpen : false);
    setShowSubtitleMenu(menuName === 'subtitles' ? shouldOpen : false);
  };

  const handleAudioSelect = async (streamIndex) => {
    if (!movie || streamIndex === activeAudio) {
      setShowAudioMenu(false);
      return;
    }

    try {
      resumeTimeRef.current = streamMode === 'hls'
        ? currentTimeRef.current
        : (videoRef ? videoRef.currentTime : 0);
      const shouldResume = isPlaying || Boolean(videoRef && !videoRef.paused);
      const requestId = reservePlaybackRequest();
      markPlaybackAutoResume(shouldResume);
      setVideoError(null);
      setShowAudioMenu(false);
      setTrackMenuPosition(null);
      if (videoRef) videoRef.pause();
      await loadPlayback(movie.id, streamIndex, streamMode === 'hls' ? resumeTimeRef.current : 0, {
        cacheBust: streamMode === 'hls',
        requestId
      });
    } catch (trackError) {
      console.error('Failed to switch audio track:', trackError);
      setVideoError({
        message: 'Audio track switch failed',
        details: 'MyFlix could not prepare that audio track. Try another track.'
      });
    }
  };

  const handleSubtitleSelect = (streamIndex) => {
    setActiveSubtitle(Number.isInteger(streamIndex) ? streamIndex : null);
    setShowSubtitleMenu(false);
    setTrackMenuPosition(null);
  };

  const handleSubtitleSearch = async () => {
    if (!movie || subtitleSearchLoading) return;

    try {
      setSubtitleSearchLoading(true);
      setSubtitleSearchError('');
      const response = await api.get(`/api/subtitles/${movie.id}/search`, {
        params: { languages: subtitleLanguageQuery }
      });
      setSubtitleSearchResults(response.data.results || []);
      if (!response.data.results || response.data.results.length === 0) {
        setSubtitleSearchError('No matching subtitles found.');
      }
    } catch (searchError) {
      const message = searchError.response?.data?.error || 'Subtitle search failed.';
      setSubtitleSearchError(message);
      setSubtitleSearchResults([]);
    } finally {
      setSubtitleSearchLoading(false);
    }
  };

  const handleSubtitleDownload = async (result) => {
    if (!movie || !result?.fileId || subtitleDownloadId) return;

    try {
      setSubtitleDownloadId(result.fileId);
      setSubtitleSearchError('');
      const shouldResume = Boolean(videoRef && !videoRef.paused) || isPlaying;
      markPlaybackAutoResume(shouldResume);

      const response = await api.post(`/api/subtitles/${movie.id}/download`, {
        fileId: result.fileId,
        language: result.language,
        fileName: result.fileName
      });
      pendingSubtitleFileRef.current = response.data.subtitle?.fileName || null;
      toast.success('Subtitle downloaded');
      await loadPlayback(movie.id, activeAudio, streamMode === 'hls' ? currentTimeRef.current : 0, {
        cacheBust: streamMode === 'hls'
      });
    } catch (downloadError) {
      const message = downloadError.response?.data?.error || 'Subtitle download failed.';
      setSubtitleSearchError(message);
    } finally {
      setSubtitleDownloadId(null);
    }
  };

  const handleSeasonChange = (event) => {
    setSelectedSeasonNumber(event.target.value);
  };

  const handleEpisodeChange = (event) => {
    const nextEpisodeId = Number(event.target.value);
    if (!nextEpisodeId || nextEpisodeId === Number(id)) return;
    navigate(`/watch/${nextEpisodeId}`);
  };

  if (loading) {
    return <LoadingSpinner fullScreen text="Loading movie..." />;
  }

  if (error || !movie) {
    return (
      <Container>
        <BackButton onClick={() => navigate('/browse')}>
          <FiArrowLeft />
        </BackButton>
        <ErrorMessage>
          <h2>Movie not found</h2>
          <p>{error || 'The requested movie could not be loaded.'}</p>
        </ErrorMessage>
      </Container>
    );
  }

  const seriesSeasons = seriesNavigation?.seasons || [];
  const selectedSeason = seriesSeasons.find(
    (season) => String(season.seasonNumber) === String(selectedSeasonNumber)
  ) || seriesSeasons[0];
  const selectedSeasonEpisodes = selectedSeason?.episodes || [];
  const selectedSeasonHasCurrentEpisode = selectedSeasonEpisodes.some(
    (episode) => Number(episode.id) === Number(movie.id)
  );
  const selectedEpisodeValue = selectedSeasonHasCurrentEpisode ? String(movie.id) : '';
  const displayDuration = getKnownDuration();
  const progress = displayDuration ? (currentTime / displayDuration) * 100 : 0;
  const videoElementSrc = streamMode === 'hls' && Hls.isSupported() ? undefined : videoSrc;

  return (
    <Container onMouseMove={handleMouseMove}>
      <VideoContainer>
        <BackButton onClick={() => navigate('/browse')}>
          <FiArrowLeft />
        </BackButton>
        
                 {videoError && (
           <div style={{
             position: 'absolute',
             top: '50%',
             left: '50%',
             transform: 'translate(-50%, -50%)',
             background: 'rgba(0,0,0,0.9)',
             padding: '2rem',
             borderRadius: '8px',
             color: 'white',
             textAlign: 'center',
             zIndex: 10,
             maxWidth: '400px'
           }}>
             <h3 style={{ color: '#e50914', marginBottom: '1rem' }}>Playback Error</h3>
             <p style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>
               {typeof videoError === 'string' ? videoError : videoError.message}
             </p>
             {typeof videoError === 'object' && videoError.details && (
               <p style={{ marginBottom: '1rem', fontSize: '0.9em', color: '#ccc' }}>
                 {videoError.details}
               </p>
             )}
             <button 
               onClick={() => {
                 setVideoError(null);
                 if (streamMode === 'hls' && Hls.isSupported() && recoverHlsByReload('manual retry', true)) {
                   return;
                 }
                 if (streamMode === 'hls' && Hls.isSupported() && scheduleHlsRecovery('manual retry', true)) {
                   return;
                 }
                 if (videoRef) {
                   videoRef.load();
                 }
               }}
               style={{
                 marginTop: '1rem',
                 padding: '0.5rem 1rem',
                 background: '#e50914',
                 border: 'none',
                 borderRadius: '4px',
                 color: 'white',
                 cursor: 'pointer'
               }}
             >
               Retry
             </button>
           </div>
         )}
        
        <Video
          ref={setVideoRef}
          src={videoElementSrc}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={() => {
            tryResumePlayback('data loaded');
          }}
          onPlay={() => {
            pendingAutoResumeRef.current = false;
            shouldResumeRef.current = false;
            setIsPlaying(true);
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={(e) => {
            console.error('Video error:', e);
            const errorDetails = {
              error: e.target.error,
              networkState: e.target.networkState,
              readyState: e.target.readyState,
              src: e.target.src
            };
            console.error('Video error details:', errorDetails);
            
            if (e.target.error) {
              if (streamMode === 'hls' && Hls.isSupported()) {
                hlsRecoveryRef.current.native += 1;
                const reason = `native video error ${e.target.error.code}`;
                const retryPlayback = !e.target.paused || isPlaying;
                if (recoverHlsByReload(reason, retryPlayback)) {
                  return;
                }
                if (hlsRecoveryRef.current.native <= 12
                  && scheduleHlsRecovery(reason, retryPlayback)) {
                  return;
                }
              }

              let errorMessage = 'Video playback error';
              let errorDetails = '';
              
              switch(e.target.error.code) {
                case e.target.error.MEDIA_ERR_ABORTED:
                  errorMessage = 'Video playback aborted';
                  errorDetails = 'The video download was cancelled.';
                  break;
                case e.target.error.MEDIA_ERR_NETWORK:
                  errorMessage = 'Network error while loading video';
                  errorDetails = 'A network error occurred while downloading the video.';
                  break;
                case e.target.error.MEDIA_ERR_DECODE:
                  errorMessage = 'Video format not supported or corrupted';
                  errorDetails = streamMode === 'hls'
                    ? 'The browser-compatible stream could not be decoded.'
                    : 'The original file may use an unsupported codec. MyFlix will use browser-compatible streaming when available.';
                  break;
                case e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                  errorMessage = 'Video source not supported';
                  errorDetails = streamMode === 'hls'
                    ? 'The browser-compatible stream could not be loaded yet. Retry in a few seconds.'
                    : 'This original file is not supported by your browser.';
                  break;
                default:
                  errorMessage = 'Unknown video error';
                  errorDetails = 'An unexpected error occurred while playing the video. Try refreshing the page.';
                  break;
              }
              setVideoError({ message: errorMessage, details: errorDetails });
            }
          }}
          onLoadStart={() => {
            setVideoError(null); // Clear any previous errors
          }}
          onCanPlay={() => {
            hlsRecoveryRef.current = { network: 0, media: 0, native: 0 };
            hlsReloadRef.current.count = 0;
            setVideoError(null);
            tryResumePlayback('can play');
          }}
          onCanPlayThrough={() => {
            hlsRecoveryRef.current = { network: 0, media: 0, native: 0 };
            hlsReloadRef.current.count = 0;
            setVideoError(null);
            tryResumePlayback('can play through');
          }}
          onProgress={() => {
            // Track buffering progress if needed in the future
            // Buffering progress tracking can be implemented here when needed
          }}
          controls={false}
          crossOrigin="anonymous"
          preload="metadata"
          tabIndex="0"
        >
          {extractableSubtitleTracks.map((track) => (
            <track
              key={track.streamIndex}
              kind={track.forced ? 'captions' : 'subtitles'}
              src={subtitleUrl(track)}
              srcLang={track.language && track.language !== 'und' ? track.language : 'en'}
              label={track.label}
            />
          ))}
          {false && (
            <>
          {/* Sample subtitle tracks for testing */}
          <track 
            kind="subtitles" 
            src="data:text/vtt,WEBVTT%0A%0A00:00:00.000 --> 00:00:05.000%0ASample English subtitle text%0A%0A00:00:05.000 --> 00:00:10.000%0AThis is a test subtitle in English"
            srclang="en" 
            label="English"
          />
          <track 
            kind="subtitles" 
            src="data:text/vtt,WEBVTT%0A%0A00:00:00.000 --> 00:00:05.000%0ATexto de subtítulo en español%0A%0A00:00:05.000 --> 00:00:10.000%0AEsto es un subtítulo de prueba en español"
            srclang="es" 
            label="Español"
          />
          <track 
            kind="subtitles" 
            src="data:text/vtt,WEBVTT%0A%0A00:00:00.000 --> 00:00:05.000%0ATexte de sous-titre français%0A%0A00:00:05.000 --> 00:00:10.000%0ACeci est un sous-titre de test en français"
            srclang="fr" 
            label="Français"
          />
            </>
          )}
        </Video>

        <Controls visible={showControls}>
          <ProgressBar onClick={handleProgressClick}>
            <Progress progress={progress} />
          </ProgressBar>
          
          <ControlButtons>
            <ControlButton onClick={handlePlayPause}>
              {isPlaying ? <FiPause /> : <FiPlay />}
            </ControlButton>

            {audioTracks.length > 1 && (
              <SubtitleContainer className="track-menu">
                <ControlButton
                  onClick={(event) => toggleTrackMenu(event, 'audio')}
                  title="Audio track"
                >
                  <FiVolume2 />
                </ControlButton>
                <SubtitleMenu $visible={showAudioMenu} $position={trackMenuPosition}>
                  {audioTracks.map((track) => (
                    <SubtitleOption
                      key={track.streamIndex}
                      onClick={() => handleAudioSelect(track.streamIndex)}
                      className={activeAudio === track.streamIndex ? 'active' : ''}
                    >
                      {track.label}
                      {track.channels && ` (${track.channels} ch)`}
                      {track.default && ' Default'}
                    </SubtitleOption>
                  ))}
                </SubtitleMenu>
              </SubtitleContainer>
            )}
            
            <SubtitleContainer className="track-menu">
              <ControlButton
                onClick={(event) => toggleTrackMenu(event, 'subtitles')}
                title="Subtitles"
              >
                <FiType />
              </ControlButton>
              <SubtitleMenu $visible={showSubtitleMenu} $position={trackMenuPosition}>
                <SubtitleOption
                  onClick={() => handleSubtitleSelect(null)}
                  className={activeSubtitle === null ? 'active' : ''}
                >
                  Off
                </SubtitleOption>
                {subtitleTracks.map((track) => (
                  <SubtitleOption
                    key={`${track.streamIndex}-${track.fileName || track.label}`}
                    onClick={() => handleSubtitleSelect(track.extractable ? track.streamIndex : null)}
                    className={activeSubtitle === track.streamIndex ? 'active' : ''}
                    disabled={!track.extractable}
                  >
                    {track.label}
                    {!track.extractable && ' (not supported)'}
                  </SubtitleOption>
                ))}

                <SubtitleMenuSection>
                  <SubtitleSectionLabel>Download Subtitles</SubtitleSectionLabel>
                  <SubtitleSearchRow>
                    <SubtitleLanguageInput
                      value={subtitleLanguageQuery}
                      onChange={(event) => setSubtitleLanguageQuery(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      placeholder="en,hi"
                      aria-label="Subtitle languages"
                    />
                    <SubtitleSearchButton
                      type="button"
                      onClick={handleSubtitleSearch}
                      disabled={subtitleSearchLoading}
                      title="Search subtitles"
                    >
                      {subtitleSearchLoading ? <FiDownload /> : <FiSearch />}
                    </SubtitleSearchButton>
                  </SubtitleSearchRow>

                  {subtitleSearchError && (
                    <SubtitleStatusText>{subtitleSearchError}</SubtitleStatusText>
                  )}

                  {!subtitleSearchError && subtitleSearchResults.length === 0 && (
                    <SubtitleStatusText>
                      Search by OpenSubtitles hash and title.
                    </SubtitleStatusText>
                  )}

                  {subtitleSearchResults.map((result) => (
                    <SubtitleResultButton
                      type="button"
                      key={result.id}
                      onClick={() => handleSubtitleDownload(result)}
                      disabled={subtitleDownloadId === result.fileId}
                      title="Download and load subtitle"
                    >
                      <SubtitleResultTitle>
                        {result.language?.toUpperCase() || 'UND'} - {result.release || result.fileName || 'Subtitle'}
                      </SubtitleResultTitle>
                      <SubtitleResultMeta>
                        {subtitleDownloadId === result.fileId ? 'Downloading...' : (subtitleResultMeta(result) || result.fileName)}
                      </SubtitleResultMeta>
                    </SubtitleResultButton>
                  ))}
                </SubtitleMenuSection>
              </SubtitleMenu>
            </SubtitleContainer>
            
            <ControlButton onClick={handleFullscreen}>
              <FiMaximize2 />
            </ControlButton>
            
            <TimeDisplay>
              {formatTime(currentTime)} / {formatTime(displayDuration)}
            </TimeDisplay>
          </ControlButtons>
        </Controls>
      </VideoContainer>

      <MovieInfo>
        <MovieTitle>{episodeHeading(movie)}</MovieTitle>
        <MovieMeta>
          {movie.media_type === 'episode' && movie.series_title && <span>{movie.series_title}</span>}
          {movie.release_year && <span>{movie.release_year}</span>}
          {movie.genre && <span>{movie.genre}</span>}
          {movie.rated && <ContentRatingBadge>{movie.rated}</ContentRatingBadge>}
          {movie.duration && <span>{Math.floor(movie.duration / 60)} min</span>}
          {movie.rating && <span>⭐ {movie.rating}/10</span>}
        </MovieMeta>
        {seriesNavigation && selectedSeason && (
          <SeriesNavigation>
            <SeriesSelectGroup>
              <span>Season</span>
              <SeriesSelect
                value={String(selectedSeason.seasonNumber)}
                onChange={handleSeasonChange}
                aria-label="Season"
              >
                {seriesSeasons.map((season) => (
                  <option key={season.seasonNumber} value={String(season.seasonNumber)}>
                    Season {season.seasonNumber}
                  </option>
                ))}
              </SeriesSelect>
            </SeriesSelectGroup>

            <SeriesSelectGroup $wide>
              <span>Episode</span>
              <SeriesSelect
                value={selectedEpisodeValue}
                onChange={handleEpisodeChange}
                aria-label="Episode"
              >
                {!selectedSeasonHasCurrentEpisode && (
                  <option value="" disabled>
                    Select episode
                  </option>
                )}
                {selectedSeasonEpisodes.map((episode) => (
                  <option key={episode.id} value={String(episode.id)}>
                    {episodeOptionLabel(episode)}
                  </option>
                ))}
              </SeriesSelect>
            </SeriesSelectGroup>
          </SeriesNavigation>
        )}
        {movie.description && (
          <MovieDescription>{movie.description}</MovieDescription>
        )}
        {playbackInfo && playbackInfo.streamMode === 'hls' && (
          <MovieMeta>
            <span><strong>Playback:</strong> Preparing MP4; using fallback stream</span>
            {playbackInfo.compatibility?.videoCodec && (
              <span><strong>Original video:</strong> {playbackInfo.compatibility.videoCodec}</span>
            )}
            {playbackInfo.compatibility?.audioCodec && (
              <span><strong>Original audio:</strong> {playbackInfo.compatibility.audioCodec}</span>
            )}
          </MovieMeta>
        )}
        {playbackInfo && playbackInfo.streamMode === 'prepared' && (
          <MovieMeta>
            <span><strong>Playback:</strong> Prepared MP4 direct stream</span>
            {playbackInfo.compatibility?.videoCodec && (
              <span><strong>Original video:</strong> {playbackInfo.compatibility.videoCodec}</span>
            )}
            {playbackInfo.compatibility?.audioCodec && (
              <span><strong>Original audio:</strong> {playbackInfo.compatibility.audioCodec}</span>
            )}
          </MovieMeta>
        )}
        {movie.director && (
          <MovieMeta>
            <span><strong>Director:</strong> {movie.director}</span>
          </MovieMeta>
        )}
        {movie.cast && (
          <MovieMeta>
            <span><strong>Cast:</strong> {movie.cast}</span>
          </MovieMeta>
        )}
      </MovieInfo>
    </Container>
  );
};

export default Watch;
