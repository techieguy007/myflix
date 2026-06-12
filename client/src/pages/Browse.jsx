import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { FiPlay, FiInfo, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';

const Container = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.background};
  padding-bottom: 4rem;
`;

const Hero = styled.div`
  height: 48vh;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.35) 0%,
    rgba(0, 0, 0, 0.78) 100%
  ), url('https://images.unsplash.com/photo-1489599577372-f975c7079ca8?ixlib=rb-4.0.3') center/cover;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 4rem;
  position: relative;

  @media (max-width: 768px) {
    padding: 0 2rem;
    height: 42vh;
  }

  @media (max-width: 480px) {
    padding: 0 1rem;
    height: 36vh;
  }
`;

const HeroContent = styled(motion.div)`
  max-width: 640px;
  color: white;
`;

const HeroTitle = styled.h1`
  font-size: 3rem;
  font-weight: bold;
  margin-bottom: 1rem;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);

  @media (max-width: 768px) {
    font-size: 2rem;
  }
`;

const HeroDescription = styled.p`
  font-size: 1.15rem;
  line-height: 1.5;
  margin-bottom: 2rem;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);

  @media (max-width: 768px) {
    font-size: 1rem;
    margin-bottom: 1.5rem;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
`;

const Button = styled(motion.button)`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &.primary {
    background: white;
    color: black;
  }

  &.secondary {
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  &.accent {
    background: ${({ theme }) => theme.colors.primary};
    color: white;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
`;

const ScanStatus = styled.p`
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.9rem;
  margin-top: 0.85rem;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.75);
`;

const Content = styled.div`
  padding: 2rem 4rem;

  @media (max-width: 768px) {
    padding: 2rem 1rem;
  }
`;

const Section = styled.div`
  margin-bottom: 3rem;
`;

const SectionTitle = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
`;

const SeriesTitle = styled.h3`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.2rem;
  margin: 1.5rem 0 0.75rem;
`;

const SeasonTitle = styled.h4`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 1rem;
  margin: 1rem 0 0.75rem;
`;

const MediaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;

  @media (max-width: 768px) {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;
  }

  @media (max-width: 480px) {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.5rem;
  }
`;

const MediaCardShell = styled(motion.div)`
  background: ${({ theme }) => theme.colors.backgroundCard};
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    transform: scale(1.04);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
`;

const Poster = styled.div`
  height: 300px;
  background: ${({ $thumbnail }) =>
    $thumbnail
      ? `url(${$thumbnail}) center/cover no-repeat`
      : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  };
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.2rem;
  font-weight: 700;
  position: relative;
  overflow: hidden;

  @media (max-width: 768px) {
    height: 250px;
  }

  @media (max-width: 480px) {
    height: 200px;
  }
`;

const MediaInfo = styled.div`
  padding: 1rem;
`;

const MediaTitle = styled.h3`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
`;

const MediaMeta = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 4rem 2rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const EmptyTitle = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.5rem;
  margin-bottom: 1rem;
`;

const EmptyDescription = styled.p`
  font-size: 1.1rem;
  line-height: 1.6;
`;

function episodeLabel(item) {
  const season = String(item.season_number || 1).padStart(2, '0');
  const episode = String(item.episode_number || 1).padStart(2, '0');
  return `S${season}E${episode} - ${item.episode_title || item.title}`;
}

function MediaCard({ item, index, cardVariants, navigate, episode = false }) {
  const imageUrl = item.thumbnail || item.poster_url || '';
  return (
    <MediaCardShell
      variants={cardVariants}
      initial="initial"
      animate="animate"
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
      onClick={() => navigate(`/watch/${item.id}`)}
    >
      <Poster $thumbnail={imageUrl}>
        {!imageUrl && <span>{episode ? 'TV' : 'Movie'}</span>}
      </Poster>
      <MediaInfo>
        <MediaTitle>{episode ? episodeLabel(item) : item.title}</MediaTitle>
        <MediaMeta>
          {item.release_year && `${item.release_year}`}
          {item.release_year && item.genre && ' - '}
          {item.genre}
          {item.runtime && (item.release_year || item.genre) && ' - '}
          {item.runtime}
        </MediaMeta>
        {item.imdb_rating && (
          <MediaMeta style={{ color: '#f5c518', fontWeight: 'bold' }}>
            IMDb {item.imdb_rating}/10
          </MediaMeta>
        )}
        {item.rated && (
          <MediaMeta style={{
            display: 'inline-block',
            background: 'rgba(255,255,255,0.2)',
            padding: '0.2rem 0.4rem',
            borderRadius: '3px',
            fontSize: '0.8rem',
            marginTop: '0.5rem'
          }}>
            {item.rated}
          </MediaMeta>
        )}
      </MediaInfo>
    </MediaCardShell>
  );
}

const Browse = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [counts, setCounts] = useState({ movies: 0, series: 0, episodes: 0, total: 0 });
  const [scanState, setScanState] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [manualScanRunning, setManualScanRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLibrary();
  }, []);

  const fetchLibrary = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      const response = await api.get('/api/library');
      setMovies(response.data.movies || []);
      setSeries(response.data.series || []);
      setCounts(response.data.counts || { movies: 0, series: 0, episodes: 0, total: 0 });
      setScanState(response.data.scan || null);
    } catch (err) {
      console.error('Failed to fetch library:', err);
      setError('Failed to load library');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const scanSummary = (result) => {
    if (!result) return '';
    if (result.alreadyRunning) return 'Library scan is already running.';

    const scanned = result.scanned ?? 0;
    const added = result.added ?? 0;
    const updated = result.updated ?? 0;
    const removed = result.removed ?? 0;
    return `Last scan: ${scanned} scanned, ${added} added, ${updated} updated, ${removed} removed.`;
  };

  const handleManualRescan = async () => {
    if (manualScanRunning || scanState?.running) return;

    setManualScanRunning(true);
    setScanResult(null);
    toast.loading('Rebuilding library index...', { id: 'library-rescan' });

    try {
      const response = await api.post('/api/library/scan/rebuild', {}, { timeout: 10 * 60 * 1000 });
      const result = response.data || {};
      setScanResult(result);
      setScanState({ running: false, lastResult: result });

      if (result.alreadyRunning) {
        toast('Library scan is already running.', { id: 'library-rescan' });
      } else {
        toast.success(`Scan complete: ${result.scanned || 0} items checked.`, { id: 'library-rescan' });
      }

      await fetchLibrary({ quiet: true });
    } catch (err) {
      console.error('Manual library scan failed:', err);
      const message = err.response?.data?.error || 'Library rescan failed';
      toast.error(message, { id: 'library-rescan' });
    } finally {
      setManualScanRunning(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || !scanState?.running) {
      return undefined;
    }

    const interval = setInterval(async () => {
      try {
        const response = await api.get('/api/library/scan/status', { timeout: 15000 });
        const nextScanState = response.data || null;
        setScanState(nextScanState);

        if (nextScanState && !nextScanState.running) {
          setScanResult(nextScanState.lastResult || null);
          await fetchLibrary({ quiet: true });
        }
      } catch (err) {
        console.warn('Failed to refresh scan status:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isAdmin, scanState?.running]); // eslint-disable-line react-hooks/exhaustive-deps

  const heroVariants = {
    initial: { opacity: 0, y: 50 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8 }
  };

  const cardVariants = {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.3 }
  };

  const isScanning = manualScanRunning || scanState?.running;
  const visibleScanResult = scanResult || scanState?.lastResult;

  if (loading) {
    return <LoadingSpinner fullScreen text="Loading library..." />;
  }

  return (
    <Container>
      <Hero>
        <HeroContent
          variants={heroVariants}
          initial="initial"
          animate="animate"
        >
          <HeroTitle>MyFlix Library</HeroTitle>
          <HeroDescription>
            Stream your indexed movies and TV shows from your local network.
            TV shows are grouped by show, season, and episode.
          </HeroDescription>
          <ButtonGroup>
            <Button className="primary" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <FiPlay />
              Play Something
            </Button>
            <Button className="secondary" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <FiInfo />
              {counts.total || 0} indexed items
            </Button>
            {isAdmin && (
              <Button
                className="accent"
                disabled={isScanning}
                onClick={handleManualRescan}
                whileHover={isScanning ? {} : { scale: 1.05 }}
                whileTap={isScanning ? {} : { scale: 0.95 }}
              >
                <FiRefreshCw />
                {isScanning ? 'Scanning...' : 'Rescan Library'}
              </Button>
            )}
          </ButtonGroup>
          {(isScanning || visibleScanResult) && (
            <ScanStatus>
              {isScanning ? 'Scanning media folder now...' : scanSummary(visibleScanResult)}
            </ScanStatus>
          )}
        </HeroContent>
      </Hero>

      <Content>
        {error ? (
          <EmptyState>
            <EmptyTitle>Error Loading Library</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyState>
        ) : movies.length === 0 && series.length === 0 ? (
          <EmptyState>
            <EmptyTitle>No Media Yet</EmptyTitle>
            <EmptyDescription>
              MyFlix scans your configured media folder on startup. Admin users can rebuild the index from this page.
            </EmptyDescription>
          </EmptyState>
        ) : (
          <>
            {movies.length > 0 && (
              <Section>
                <SectionTitle>Movies ({counts.movies || movies.length})</SectionTitle>
                <MediaGrid>
                  {movies.map((movie, index) => (
                    <MediaCard
                      key={movie.id}
                      item={movie}
                      index={index}
                      cardVariants={cardVariants}
                      navigate={navigate}
                    />
                  ))}
                </MediaGrid>
              </Section>
            )}

            {series.length > 0 && (
              <Section>
                <SectionTitle>TV Shows ({counts.series || series.length} shows, {counts.episodes || 0} episodes)</SectionTitle>
                {series.map((show) => (
                  <div key={show.title}>
                    <SeriesTitle>{show.title}</SeriesTitle>
                    {show.seasons.map((season) => (
                      <div key={`${show.title}-${season.seasonNumber}`}>
                        <SeasonTitle>Season {season.seasonNumber}</SeasonTitle>
                        <MediaGrid>
                          {season.episodes.map((episode, index) => (
                            <MediaCard
                              key={episode.id}
                              item={episode}
                              index={index}
                              cardVariants={cardVariants}
                              navigate={navigate}
                              episode
                            />
                          ))}
                        </MediaGrid>
                      </div>
                    ))}
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </Content>
    </Container>
  );
};

export default Browse;
