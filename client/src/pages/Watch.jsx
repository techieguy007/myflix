import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { FiArrowLeft, FiPlay, FiPause, FiMaximize2, FiType, FiVolume2 } from 'react-icons/fi';
import Hls from 'hls.js';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';

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
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(0, 0, 0, 0.9);
  border-radius: 4px;
  padding: 0.5rem 0;
  min-width: 200px;
  max-height: 300px;
  overflow-y: auto;
  z-index: 10;
  display: ${({ visible }) => visible ? 'block' : 'none'};
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
  gap: 2rem;
  margin-bottom: 1rem;
  color: ${({ theme }) => theme.colors.textSecondary};
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
  if (isNaN(seconds)) return '0:00';
  
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
  const [audioTracks, setAudioTracks] = useState([]);
  const [activeAudio, setActiveAudio] = useState(null);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState(null);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [videoSrc, setVideoSrc] = useState('');
  const [streamMode, setStreamMode] = useState('direct');
  const [playbackInfo, setPlaybackInfo] = useState(null);

  useEffect(() => {
    fetchMovie();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [showControls, isPlaying]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if ((showSubtitleMenu || showAudioMenu) && !event.target.closest('.track-menu')) {
        setShowSubtitleMenu(false);
        setShowAudioMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showAudioMenu, showSubtitleMenu]);

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
      maxBufferLength: 60,
      backBufferLength: 30
    });

    hls.loadSource(videoSrc);
    hls.attachMedia(videoRef);
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal) {
        return;
      }

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }

      setVideoError({
        message: 'Browser-compatible stream failed',
        details: data.details || 'The transcoded stream could not be played.'
      });
      hls.destroy();
    });

    return () => {
      hls.destroy();
    };
  }, [videoRef, videoSrc, streamMode]);

  const baseUrl = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000';

  const tokenParam = () => {
    const token = localStorage.getItem('authToken');
    return token ? `?token=${encodeURIComponent(token)}` : '';
  };

  const toAbsoluteUrl = (pathOrUrl) => (
    pathOrUrl && pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`
  );

  const applyPlayback = (playback) => {
    const tracks = playback.compatibility || {};
    const audio = tracks.audioTracks || [];
    const subtitles = tracks.subtitleTracks || [];
    const selectedAudio = tracks.selectedAudioStreamIndex ?? (audio[0] ? audio[0].streamIndex : null);

    setPlaybackInfo(playback);
    setStreamMode(playback.streamMode || 'direct');
    setAudioTracks(audio);
    setActiveAudio(selectedAudio);
    setSubtitleTracks(subtitles);
    setActiveSubtitle((current) => (
      subtitles.some((track) => track.streamIndex === current && track.extractable) ? current : null
    ));

    const sourcePath = playback.streamMode === 'hls' ? playback.hlsUrl : playback.directUrl;
    setVideoSrc(toAbsoluteUrl(sourcePath));
  };

  const loadPlayback = async (movieId, audioStreamIndex = null) => {
    const params = new URLSearchParams();
    const token = localStorage.getItem('authToken');
    if (token) params.set('token', token);
    if (Number.isInteger(audioStreamIndex)) params.set('audio', String(audioStreamIndex));

    const query = params.toString() ? `?${params.toString()}` : '';
    const playbackResponse = await api.get(`/api/stream/${movieId}/playback${query}`);
    applyPlayback(playbackResponse.data);
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

  const fetchMovie = async () => {
    try {
      setLoading(true);
      setVideoError(null);
      setPlaybackInfo(null);
      setStreamMode('direct');
      setAudioTracks([]);
      setSubtitleTracks([]);
      setActiveAudio(null);
      setActiveSubtitle(null);

      const movieResponse = await api.get(`/api/movies/${id}`);
      setMovie(movieResponse.data);

      try {
        await loadPlayback(movieResponse.data.id);
      } catch (playbackError) {
        console.warn('Playback profile failed; falling back to direct stream:', playbackError);
        setPlaybackInfo(null);
        setStreamMode('direct');
        setVideoSrc(`${baseUrl}/api/stream/${movieResponse.data.id}${tokenParam()}`);
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
      videoRef.play();
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef) {
      setCurrentTime(videoRef.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef) {
      setDuration(videoRef.duration);

      if (resumeTimeRef.current > 0) {
        videoRef.currentTime = resumeTimeRef.current;
        resumeTimeRef.current = 0;
      }

      applySubtitleSelection();

      if (shouldResumeRef.current) {
        shouldResumeRef.current = false;
        videoRef.play().catch((error) => {
          console.warn('Unable to resume playback after track change:', error);
        });
      }
    }
  };

  const handleProgressClick = (e) => {
    if (!videoRef || !duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    videoRef.currentTime = newTime;
  };

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

  const handleAudioSelect = async (streamIndex) => {
    if (!movie || streamIndex === activeAudio) {
      setShowAudioMenu(false);
      return;
    }

    try {
      resumeTimeRef.current = videoRef ? videoRef.currentTime : 0;
      shouldResumeRef.current = isPlaying;
      setVideoError(null);
      setShowAudioMenu(false);
      if (videoRef) videoRef.pause();
      await loadPlayback(movie.id, streamIndex);
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

  const progress = duration ? (currentTime / duration) * 100 : 0;
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
                 // Retry loading the video
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
            // Video data loaded - subtitles will be detected via other methods
          }}
          onPlay={() => setIsPlaying(true)}
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
            // Video can start playing
          }}
          onCanPlayThrough={() => {
            // Video can play through without buffering
          }}
          onProgress={() => {
            // Track buffering progress if needed in the future
            // Buffering progress tracking can be implemented here when needed
          }}
          controls={false}
          crossOrigin="anonymous"
          preload="metadata"
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
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowAudioMenu(!showAudioMenu);
                    setShowSubtitleMenu(false);
                  }}
                  title="Audio track"
                >
                  <FiVolume2 />
                </ControlButton>
                <SubtitleMenu visible={showAudioMenu}>
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
            
            {subtitleTracks.length > 0 && (
              <SubtitleContainer className="track-menu">
                <ControlButton
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowSubtitleMenu(!showSubtitleMenu);
                    setShowAudioMenu(false);
                  }}
                  title="Subtitles"
                >
                  <FiType />
                </ControlButton>
                <SubtitleMenu visible={showSubtitleMenu}>
                  <SubtitleOption
                    onClick={() => handleSubtitleSelect(null)}
                    className={activeSubtitle === null ? 'active' : ''}
                  >
                    Off
                  </SubtitleOption>
                  {subtitleTracks.map((track) => (
                    <SubtitleOption
                      key={track.streamIndex}
                      onClick={() => handleSubtitleSelect(track.extractable ? track.streamIndex : null)}
                      className={activeSubtitle === track.streamIndex ? 'active' : ''}
                      disabled={!track.extractable}
                    >
                      {track.label}
                      {!track.extractable && ' (not supported)'}
                    </SubtitleOption>
                  ))}
                </SubtitleMenu>
              </SubtitleContainer>
            )}
            
            <ControlButton onClick={handleFullscreen}>
              <FiMaximize2 />
            </ControlButton>
            
            <TimeDisplay>
              {formatTime(currentTime)} / {formatTime(duration)}
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
          {movie.duration && <span>{Math.floor(movie.duration / 60)} min</span>}
          {movie.rating && <span>⭐ {movie.rating}/10</span>}
        </MovieMeta>
        {movie.description && (
          <MovieDescription>{movie.description}</MovieDescription>
        )}
        {playbackInfo && playbackInfo.streamMode === 'hls' && (
          <MovieMeta>
            <span><strong>Playback:</strong> Browser-compatible stream</span>
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
