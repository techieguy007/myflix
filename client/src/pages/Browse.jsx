import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { FiPlay, FiRefreshCw, FiShuffle } from 'react-icons/fi';
import toast from 'react-hot-toast';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';
import MediaCard, { displayTitle, mediaImage } from '../components/MediaCard';

const Container = styled.div`
  min-height: 100vh;
  background:
    radial-gradient(circle at 20% 0%, rgba(229, 9, 20, 0.13), transparent 34rem),
    linear-gradient(180deg, #050505 0%, ${({ theme }) => theme.colors.background} 34rem);
  padding-bottom: 4rem;
`;

const Hero = styled.section`
  min-height: 72vh;
  position: relative;
  display: flex;
  align-items: flex-end;
  padding: 8rem 4vw 5rem;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.96) 0%, rgba(0, 0, 0, 0.64) 42%, rgba(0, 0, 0, 0.18) 100%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, #050505 100%),
      ${({ $image }) => ($image ? `url(${$image}) center right/cover no-repeat` : 'linear-gradient(135deg, #2a2a2a, #050505)')};
    transform: scale(1.02);
  }

  @media (max-width: 760px) {
    min-height: 66vh;
    padding: 7rem 1.1rem 3.5rem;

    &::before {
      background:
        linear-gradient(180deg, rgba(0, 0, 0, 0.28) 0%, rgba(0, 0, 0, 0.84) 58%, #050505 100%),
        ${({ $image }) => ($image ? `url(${$image}) center top/cover no-repeat` : 'linear-gradient(135deg, #2a2a2a, #050505)')};
    }
  }
`;

const HeroContent = styled(motion.div)`
  position: relative;
  z-index: 1;
  width: min(720px, 100%);
`;

const Eyebrow = styled.div`
  color: ${({ theme }) => theme.colors.success};
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.7rem;
`;

const HeroTitle = styled.h1`
  color: #fff;
  font-size: clamp(2.35rem, 6vw, 5.5rem);
  line-height: 0.96;
  letter-spacing: 0;
  max-width: 12ch;
  margin-bottom: 1rem;
`;

const MetaLine = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 1rem;
  align-items: center;
  color: rgba(255, 255, 255, 0.78);
  font-weight: 700;
  margin-bottom: 1rem;
`;

const RatingBadge = styled.span`
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 3px;
  padding: 0.12rem 0.44rem;
  font-size: 0.8rem;
`;

const HeroDescription = styled.p`
  color: rgba(255, 255, 255, 0.82);
  width: min(620px, 100%);
  font-size: clamp(0.98rem, 2vw, 1.18rem);
  line-height: 1.55;
  margin-bottom: 1.45rem;

  @media (max-width: 640px) {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
`;

const Button = styled(motion.button)`
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  border-radius: 6px;
  padding: 0.7rem 1.1rem;
  color: ${({ $secondary }) => ($secondary ? '#fff' : '#111')};
  background: ${({ $secondary, theme }) => ($secondary ? 'rgba(255, 255, 255, 0.16)' : theme.colors.text)};
  border: 1px solid ${({ $secondary }) => ($secondary ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.8)')};
  font-weight: 900;
  backdrop-filter: blur(12px);

  &:disabled {
    opacity: 0.58;
    cursor: wait;
  }

  @media (max-width: 520px) {
    flex: 1 1 100%;
  }
`;

const Content = styled.main`
  position: relative;
  z-index: 2;
  margin-top: -2.5rem;
  padding: 0 4vw;
`;

const Shelf = styled.section`
  margin-bottom: 2.3rem;
`;

const ShelfHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
`;

const ShelfTitle = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  font-size: clamp(1.12rem, 2.3vw, 1.55rem);
  font-weight: 900;
`;

const ShelfMeta = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.88rem;
`;

const Row = styled.div`
  display: flex;
  gap: 0.85rem;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  padding: 0.25rem 0.1rem 1.1rem;

  &::-webkit-scrollbar {
    height: 8px;
  }
`;

const ShowBlock = styled.section`
  margin-bottom: 2.8rem;
`;

const ShowHeader = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;

  @media (max-width: 640px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const ShowTitle = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  font-size: clamp(1.25rem, 3vw, 1.9rem);
  font-weight: 900;
`;

const ShowSummary = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.92rem;
  margin-top: 0.2rem;
`;

const SeasonSelect = styled.select`
  min-width: 150px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: ${({ theme }) => theme.colors.text};
  padding: 0.78rem 2.3rem 0.78rem 0.9rem;
  font-weight: 900;
  outline: none;

  option {
    color: #111;
  }
`;

const EmptyState = styled.section`
  padding: 5rem 1rem;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const EmptyTitle = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.6rem;
  margin-bottom: 0.7rem;
`;

const HiddenNotice = styled.div`
  max-width: 820px;
  border-left: 3px solid ${({ theme }) => theme.colors.warning};
  background: rgba(255, 165, 0, 0.08);
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 0.9rem 1rem;
  border-radius: 0 8px 8px 0;
  margin-bottom: 2rem;
`;

const AdminUtility = styled.section`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  padding: 0.85rem;
  margin-bottom: 2rem;

  @media (max-width: 760px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const AdminUtilityText = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.9rem;
`;

const AdminButtonGroup = styled.div`
  display: flex;
  gap: 0.65rem;
  flex-wrap: wrap;

  @media (max-width: 520px) {
    ${Button} {
      flex: 1 1 100%;
    }
  }
`;

function flattenSeries(series) {
  return (series || []).flatMap((show) => (
    (show.seasons || []).flatMap((season) => (
      (season.episodes || []).map((episode) => ({
        ...episode,
        series_title: episode.series_title || show.title,
        rated: episode.rated || show.rated
      }))
    ))
  ));
}

function bestDescription(item) {
  return item?.plot || item?.description || 'Ready to stream from your local MyFlix library.';
}

function itemProgress(item) {
  const duration = Number(item.duration || 0);
  const watchTime = Number(item.watch_time || item.watchTime || 0);
  return duration > 0 && watchTime > 0 ? (watchTime / duration) * 100 : 0;
}

function genreTokens(item) {
  return String(item.genre || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function ratingValue(item) {
  const imdb = Number(item.imdb_rating);
  if (Number.isFinite(imdb) && imdb > 0) return imdb;
  const rating = Number(item.rating);
  return Number.isFinite(rating) && rating > 0 ? rating : 0;
}

function yearValue(item) {
  const year = Number(item.release_year);
  return Number.isFinite(year) ? year : 0;
}

const curatedShelfDefinitions = [
  {
    title: 'Top Rated',
    meta: 'Highest IMDb scores',
    test: (item) => ratingValue(item) >= 6,
    sort: (a, b) => ratingValue(b) - ratingValue(a)
  },
  {
    title: 'New Releases',
    meta: 'Newest titles',
    test: (item) => yearValue(item) >= 2020,
    sort: (a, b) => yearValue(b) - yearValue(a) || ratingValue(b) - ratingValue(a)
  },
  {
    title: 'Comedies',
    meta: 'Laugh-out-loud picks',
    genres: ['comedy']
  },
  {
    title: 'Dramas',
    meta: 'Character-driven stories',
    genres: ['drama']
  },
  {
    title: 'Horror & Thrillers',
    meta: 'Dark, tense, and scary',
    genres: ['horror', 'thriller', 'mystery']
  },
  {
    title: 'Action & Adventure',
    meta: 'Big-screen energy',
    genres: ['action', 'adventure']
  },
  {
    title: 'Crime & Mystery',
    meta: 'Cases, clues, and twists',
    genres: ['crime', 'mystery']
  },
  {
    title: 'War & History',
    meta: 'Battlefield and period stories',
    genres: ['war', 'history']
  },
  {
    title: 'Sci-Fi & Fantasy',
    meta: 'Other worlds and impossible ideas',
    genres: ['sci-fi', 'science fiction', 'fantasy']
  },
  {
    title: 'Family & Animation',
    meta: 'All-ages viewing',
    genres: ['family', 'animation']
  },
  {
    title: 'Romance',
    meta: 'Love stories',
    genres: ['romance']
  },
  {
    title: 'Documentaries',
    meta: 'Real stories',
    genres: ['documentary']
  }
];

function shelfMatches(definition, item) {
  if (definition.test) return definition.test(item);
  const tokens = genreTokens(item);
  return (definition.genres || []).some((genre) => tokens.includes(genre));
}

function buildCuratedShelves(items) {
  return curatedShelfDefinitions
    .map((definition) => {
      const seen = new Set();
      const shelfItems = items
        .filter((item) => shelfMatches(definition, item))
        .filter((item) => {
          const id = Number(item.id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .sort(definition.sort || ((a, b) => ratingValue(b) - ratingValue(a) || yearValue(b) - yearValue(a)))
        .slice(0, 24);

      return { ...definition, items: shelfItems };
    })
    .filter((shelf) => shelf.items.length > 0);
}

function LibraryShelf({ title, meta, items, favoriteIds, onOpen, onFavorite, compact = false, episode = false }) {
  if (!items.length) return null;

  return (
    <Shelf>
      <ShelfHeader>
        <ShelfTitle>{title}</ShelfTitle>
        {meta && <ShelfMeta>{meta}</ShelfMeta>}
      </ShelfHeader>
      <Row>
        {items.map((item, index) => (
          <MediaCard
            key={`${title}-${item.id}`}
            item={item}
            episode={episode || item.media_type === 'episode'}
            compact={compact}
            index={index}
            progress={itemProgress(item)}
            isFavorite={favoriteIds.has(Number(item.id))}
            onOpen={onOpen}
            onFavorite={onFavorite}
          />
        ))}
      </Row>
    </Shelf>
  );
}

const Browse = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [counts, setCounts] = useState({});
  const [scanState, setScanState] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [manualScanRunning, setManualScanRunning] = useState(false);
  const [selectedSeriesSeasons, setSelectedSeriesSeasons] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const episodes = useMemo(() => flattenSeries(series), [series]);
  const allItems = useMemo(() => [...continueWatching, ...movies, ...episodes]
    .filter((item, index, list) => list.findIndex((candidate) => Number(candidate.id) === Number(item.id)) === index), [continueWatching, episodes, movies]);
  const favoriteItems = useMemo(() => allItems.filter((item) => favoriteIds.has(Number(item.id))), [allItems, favoriteIds]);
  const curatedShelves = useMemo(() => buildCuratedShelves(allItems), [allItems]);
  const heroItem = useMemo(() => (
    continueWatching.find((item) => mediaImage(item))
    || movies.find((item) => mediaImage(item) && (item.plot || item.description))
    || episodes.find((item) => mediaImage(item))
    || allItems[0]
  ), [allItems, continueWatching, episodes, movies]);

  const fetchLibrary = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError(null);

      const [libraryResponse, continueResponse, favoritesResponse] = await Promise.allSettled([
        api.get('/api/library'),
        api.get('/api/movies/user/continue-watching'),
        api.get('/api/movies/user/favorites', { params: { limit: 500 } })
      ]);

      if (libraryResponse.status !== 'fulfilled') {
        throw libraryResponse.reason;
      }

      const library = libraryResponse.value.data || {};
      setMovies(library.movies || []);
      setSeries(library.series || []);
      setCounts(library.counts || {});
      setScanState(library.scan || null);

      const readyIds = new Set([...(library.movies || []), ...flattenSeries(library.series || [])].map((item) => Number(item.id)));

      if (continueResponse.status === 'fulfilled') {
        setContinueWatching((continueResponse.value.data || []).filter((item) => readyIds.has(Number(item.id))));
      }

      if (favoritesResponse.status === 'fulfilled') {
        setFavoriteIds(new Set((favoritesResponse.value.data.movies || []).map((item) => Number(item.id))));
      }
    } catch (err) {
      console.error('Failed to fetch library:', err);
      setError('Failed to load your MyFlix library.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin || !scanState?.running) return undefined;

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

  const scanSummary = (result) => {
    if (!result) return '';
    if (result.alreadyRunning) return 'Library scan is already running.';
    return `Last scan: ${result.scanned ?? 0} scanned, ${result.skippedKnown ?? 0} skipped, ${result.added ?? 0} added, ${result.updated ?? 0} updated.`;
  };

  const handleManualRescan = async ({ force = false } = {}) => {
    if (manualScanRunning || scanState?.running) return;

    setManualScanRunning(true);
    setScanResult(null);
    toast.loading(force ? 'Force rebuilding library index...' : 'Scanning for new media...', { id: 'library-rescan' });

    try {
      const response = await api.post('/api/library/scan/rebuild', { force }, { timeout: 10 * 60 * 1000 });
      const result = response.data || {};
      setScanResult(result);
      setScanState({ running: false, lastResult: result });
      toast.success(result.alreadyRunning ? 'Library scan is already running.' : 'Library scan complete.', { id: 'library-rescan' });
      await fetchLibrary({ quiet: true });
    } catch (err) {
      const message = err.response?.data?.error || 'Library rescan failed';
      toast.error(message, { id: 'library-rescan' });
    } finally {
      setManualScanRunning(false);
    }
  };

  const openItem = (item) => navigate(`/watch/${item.id}?autoplay=1`);

  const playRandom = () => {
    if (!allItems.length) return;
    openItem(allItems[Math.floor(Math.random() * allItems.length)]);
  };

  const toggleFavorite = async (item) => {
    const itemId = Number(item.id);
    const wasFavorite = favoriteIds.has(itemId);
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

    try {
      if (wasFavorite) {
        await api.delete(`/api/movies/${item.id}/favorite`);
      } else {
        await api.post(`/api/movies/${item.id}/favorite`);
      }
    } catch (err) {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(itemId);
        else next.delete(itemId);
        return next;
      });
    }
  };

  const selectedSeasonForShow = (show) => {
    const seasons = show.seasons || [];
    const selectedSeasonNumber = selectedSeriesSeasons[show.title];
    return seasons.find((season) => String(season.seasonNumber) === String(selectedSeasonNumber)) || seasons[0];
  };

  const handleSeriesSeasonChange = (showTitle, seasonNumber) => {
    setSelectedSeriesSeasons((current) => ({ ...current, [showTitle]: seasonNumber }));
  };

  if (loading) {
    return <LoadingSpinner fullScreen text="Loading library..." />;
  }

  const isScanning = manualScanRunning || scanState?.running;
  const visibleScanResult = scanResult || scanState?.lastResult;
  const hiddenPendingCount = counts.hidden || 0;
  const hasLibrary = allItems.length > 0;
  const heroTitle = heroItem ? displayTitle(heroItem, heroItem.media_type === 'episode') : 'MyFlix';

  return (
    <Container>
      <Hero $image={heroItem && mediaImage(heroItem)}>
        <HeroContent initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <Eyebrow>{continueWatching.length ? 'Continue watching' : 'Featured now'}</Eyebrow>
          <HeroTitle>{heroTitle}</HeroTitle>
          <MetaLine>
            {heroItem?.rated && <RatingBadge>{heroItem.rated}</RatingBadge>}
            {heroItem?.release_year && <span>{heroItem.release_year}</span>}
            {heroItem?.runtime && <span>{heroItem.runtime}</span>}
            {heroItem?.imdb_rating && <span>IMDb {heroItem.imdb_rating}</span>}
            <span>{counts.total || allItems.length} ready to watch</span>
          </MetaLine>
          <HeroDescription>{heroItem ? bestDescription(heroItem) : 'Your playable movies and shows will appear here as conversion finishes.'}</HeroDescription>
          <ButtonRow>
            <Button disabled={!heroItem} onClick={() => heroItem && openItem(heroItem)} whileTap={{ scale: 0.97 }}>
              <FiPlay /> Play
            </Button>
            <Button $secondary disabled={!hasLibrary} onClick={playRandom} whileTap={{ scale: 0.97 }}>
              <FiShuffle /> Shuffle
            </Button>
          </ButtonRow>
        </HeroContent>
      </Hero>

      <Content>
        {isAdmin && (
          <AdminUtility>
            <AdminUtilityText>
              {isScanning ? 'Scanning media folder now...' : (visibleScanResult ? scanSummary(visibleScanResult) : 'Library tools')}
            </AdminUtilityText>
            <AdminButtonGroup>
              <Button $secondary disabled={isScanning} onClick={() => handleManualRescan()} whileTap={{ scale: 0.97 }}>
                <FiRefreshCw /> {isScanning ? 'Scanning' : 'Scan New'}
              </Button>
              <Button $secondary disabled={isScanning} onClick={() => handleManualRescan({ force: true })} whileTap={{ scale: 0.97 }}>
                <FiRefreshCw /> Force Rescan
              </Button>
            </AdminButtonGroup>
          </AdminUtility>
        )}

        {hiddenPendingCount > 0 && (
          <HiddenNotice>
            {hiddenPendingCount} indexed items are hidden until conversion finishes or compatibility is verified.
          </HiddenNotice>
        )}

        {error ? (
          <EmptyState>
            <EmptyTitle>Unable to Load Library</EmptyTitle>
            <p>{error}</p>
          </EmptyState>
        ) : !hasLibrary ? (
          <EmptyState>
            <EmptyTitle>{(counts.indexedTotal || 0) > 0 ? 'No Playable Media Yet' : 'No Media Yet'}</EmptyTitle>
            <p>
              {(counts.indexedTotal || 0) > 0
                ? `${counts.indexedTotal} indexed items are waiting for conversion or compatibility verification.`
                : 'MyFlix scans your configured media folder on startup.'}
            </p>
          </EmptyState>
        ) : (
          <>
            <LibraryShelf
              title="Continue Watching"
              meta={`${continueWatching.length} in progress`}
              items={continueWatching}
              favoriteIds={favoriteIds}
              onOpen={openItem}
              onFavorite={toggleFavorite}
            />

            <LibraryShelf
              title="My List"
              meta={`${favoriteItems.length} saved`}
              items={favoriteItems}
              favoriteIds={favoriteIds}
              onOpen={openItem}
              onFavorite={toggleFavorite}
            />

            {curatedShelves.map((shelf) => (
              <LibraryShelf
                key={shelf.title}
                title={shelf.title}
                meta={shelf.meta}
                items={shelf.items}
                favoriteIds={favoriteIds}
                onOpen={openItem}
                onFavorite={toggleFavorite}
                compact={shelf.title !== 'Top Rated'}
              />
            ))}

            <LibraryShelf
              title="Movies"
              meta={`${counts.movies || movies.length} titles`}
              items={movies}
              favoriteIds={favoriteIds}
              onOpen={openItem}
              onFavorite={toggleFavorite}
            />

            <LibraryShelf
              title="Recently Ready"
              meta="Playable now"
              items={allItems.slice(0, 24)}
              favoriteIds={favoriteIds}
              onOpen={openItem}
              onFavorite={toggleFavorite}
              compact
            />

            {series.length > 0 && (
              <Shelf>
                <ShelfHeader>
                  <ShelfTitle>TV Shows</ShelfTitle>
                  <ShelfMeta>{counts.series || series.length} shows, {counts.episodes || episodes.length} episodes</ShelfMeta>
                </ShelfHeader>
              </Shelf>
            )}

            {series.map((show) => {
              const selectedSeason = selectedSeasonForShow(show);
              if (!selectedSeason) return null;

              return (
                <ShowBlock key={show.title}>
                  <ShowHeader>
                    <div>
                      <ShowTitle>{show.title}</ShowTitle>
                      <ShowSummary>
                        {show.rated && `${show.rated} | `}
                        {show.episodeCount || 0} episodes across {(show.seasons || []).length} season{(show.seasons || []).length === 1 ? '' : 's'}
                      </ShowSummary>
                    </div>
                    <SeasonSelect
                      value={String(selectedSeason.seasonNumber)}
                      onChange={(event) => handleSeriesSeasonChange(show.title, event.target.value)}
                      aria-label={`${show.title} season`}
                    >
                      {(show.seasons || []).map((season) => (
                        <option key={season.seasonNumber} value={String(season.seasonNumber)}>
                          Season {season.seasonNumber}
                        </option>
                      ))}
                    </SeasonSelect>
                  </ShowHeader>
                  <Row>
                    {selectedSeason.episodes.map((episode, index) => (
                      <MediaCard
                        key={episode.id}
                        item={{ ...episode, rated: episode.rated || show.rated }}
                        episode
                        compact
                        index={index}
                        isFavorite={favoriteIds.has(Number(episode.id))}
                        onOpen={openItem}
                        onFavorite={toggleFavorite}
                      />
                    ))}
                  </Row>
                </ShowBlock>
              );
            })}
          </>
        )}
      </Content>
    </Container>
  );
};

export default Browse;
