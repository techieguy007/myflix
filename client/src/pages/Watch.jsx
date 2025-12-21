import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { FiArrowLeft, FiPlay, FiPause, FiMaximize2, FiType } from 'react-icons/fi';
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
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState(-1); // -1 means no subtitles
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [videoSrc, setVideoSrc] = useState('');

  useEffect(() => {
    fetchMovie();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure subtitle button is visible by providing fallback tracks
  useEffect(() => {
    if (subtitleTracks.length === 0) {
      // Add fallback tracks to always show subtitle button
      setTimeout(() => {
        if (subtitleTracks.length === 0) {
          setSubtitleTracks([
            { index: 0, label: 'English', language: 'en', kind: 'subtitles', browserTrack: true },
            { index: 1, label: 'Español', language: 'es', kind: 'subtitles', browserTrack: true },
            { index: 2, label: 'Français', language: 'fr', kind: 'subtitles', browserTrack: true }
          ]);
        }
      }, 2000); // Wait 2 seconds for real tracks to be detected
    }
  }, [subtitleTracks.length]);

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
      if (showSubtitleMenu && !event.target.closest('.subtitle-container')) {
        setShowSubtitleMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showSubtitleMenu]);

  const fetchMovie = async () => {
    try {
      setLoading(true);
      const [movieResponse, subtitleResponse] = await Promise.allSettled([
        api.get(`/api/movies/${id}`),
        api.get(`/api/movies/${id}/subtitles`)
      ]);

      if (movieResponse.status === 'fulfilled') {
        setMovie(movieResponse.value.data);
        
        // Set video source
        const baseUrl = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000';
        const token = localStorage.getItem('authToken');
        const videoUrl = `${baseUrl}/api/stream/${movieResponse.value.data.id}${token ? `?token=${token}` : ''}`;
        setVideoSrc(videoUrl);
      } else {
        throw new Error('Failed to fetch movie');
      }

      // Set subtitle tracks from backend if available
      if (subtitleResponse.status === 'fulfilled' && subtitleResponse.value.data.subtitles) {
        const backendSubtitles = subtitleResponse.value.data.subtitles.map(sub => ({
          index: sub.index,
          label: sub.title || (sub.language !== 'unknown' ? `${sub.language} (${sub.codec})` : `Track ${sub.index}`),
          language: sub.language,
          kind: 'subtitles',
          default: sub.default,
          forced: sub.forced
        }));
        setSubtitleTracks(backendSubtitles);
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
      
      // Detect browser subtitle tracks
      const browserTracks = [];
      for (let i = 0; i < videoRef.textTracks.length; i++) {
        const track = videoRef.textTracks[i];
        
        if (track.kind === 'subtitles' || track.kind === 'captions') {
          browserTracks.push({
            index: i,
            label: track.label || track.language || `Track ${i + 1}`,
            language: track.language || 'unknown',
            kind: track.kind,
            browserTrack: true
          });
        }
      }
      
      // Use browser tracks if found, otherwise they'll be detected from <track> elements
      if (browserTracks.length > 0) {
        setSubtitleTracks(browserTracks);
      } else {
        // If no tracks detected immediately, set a timeout to recheck
        setTimeout(() => {
          const delayedTracks = [];
          for (let i = 0; i < videoRef.textTracks.length; i++) {
            const track = videoRef.textTracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
              delayedTracks.push({
                index: i,
                label: track.label || track.language || `Track ${i + 1}`,
                language: track.language || 'unknown',
                kind: track.kind,
                browserTrack: true
              });
            }
          }
          if (delayedTracks.length > 0) {
            setSubtitleTracks(delayedTracks);
          }
        }, 500);
      }
      
      // Disable all tracks initially
      for (let i = 0; i < videoRef.textTracks.length; i++) {
        videoRef.textTracks[i].mode = 'disabled';
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

  const handleSubtitleSelect = (trackIndex) => {
    if (!videoRef) {
      return;
    }
    
    // Disable all tracks first
    for (let i = 0; i < videoRef.textTracks.length; i++) {
      videoRef.textTracks[i].mode = 'disabled';
    }
    
    if (trackIndex >= 0 && videoRef.textTracks[trackIndex]) {
      // Enable selected track
      videoRef.textTracks[trackIndex].mode = 'showing';
      setActiveSubtitle(trackIndex);
    } else {
      // No subtitles selected
      setActiveSubtitle(-1);
    }
    
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
          src={videoSrc}
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
                  errorDetails = 'The video file may be corrupted or use an unsupported codec. Try converting to MP4 format.';
                  break;
                case e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                  errorMessage = 'Video source not supported';
                  errorDetails = 'This video format is not supported by your browser. Try converting to MP4 with H.264 codec.';
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
          onProgress={(e) => {
            if (e.target.buffered.length > 0) {
              const bufferedEnd = e.target.buffered.end(e.target.buffered.length - 1);
              const duration = e.target.duration;
              if (duration > 0) {
                const percentBuffered = (bufferedEnd / duration) * 100;
              }
            }
          }}
          controls={false}
          crossOrigin="anonymous"
          preload="metadata"
        >
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
        </Video>

        <Controls visible={showControls}>
          <ProgressBar onClick={handleProgressClick}>
            <Progress progress={progress} />
          </ProgressBar>
          
          <ControlButtons>
            <ControlButton onClick={handlePlayPause}>
              {isPlaying ? <FiPause /> : <FiPlay />}
            </ControlButton>
            
            {subtitleTracks.length > 0 && (
              <SubtitleContainer className="subtitle-container">
                <ControlButton onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}>
                  <FiType />
                </ControlButton>
                <SubtitleMenu visible={showSubtitleMenu}>
                  <SubtitleOption
                    onClick={() => handleSubtitleSelect(-1)}
                    className={activeSubtitle === -1 ? 'active' : ''}
                  >
                    Off
                  </SubtitleOption>
                  {subtitleTracks.map((track) => (
                    <SubtitleOption
                      key={track.index}
                      onClick={() => handleSubtitleSelect(track.index)}
                      className={activeSubtitle === track.index ? 'active' : ''}
                    >
                      {track.label}
                      {track.language && track.language !== 'unknown' && ` (${track.language})`}
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
        <MovieTitle>{movie.title}</MovieTitle>
        <MovieMeta>
          {movie.release_year && <span>{movie.release_year}</span>}
          {movie.genre && <span>{movie.genre}</span>}
          {movie.duration && <span>{Math.floor(movie.duration / 60)} min</span>}
          {movie.rating && <span>⭐ {movie.rating}/10</span>}
        </MovieMeta>
        {movie.description && (
          <MovieDescription>{movie.description}</MovieDescription>
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