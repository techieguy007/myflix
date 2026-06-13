import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import MediaCard from '../components/MediaCard';

const Container = styled.div`
  min-height: 100vh;
  background:
    radial-gradient(circle at 18% 0%, rgba(229, 9, 20, 0.12), transparent 30rem),
    ${({ theme }) => theme.colors.background};
  padding: 7rem 4vw 4rem;
`;

const Header = styled.header`
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.text};
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 1;
  margin-bottom: 0.65rem;
`;

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 1rem;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(154px, 1fr));
  gap: 1rem;

  article {
    width: 100%;
    min-width: 0;
  }

  @media (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
`;

const Empty = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 3rem 0;
  font-size: 1.05rem;
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

const Favorites = () => {
  const navigate = useNavigate();
  const [libraryItems, setLibraryItems] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [libraryResponse, favoritesResponse] = await Promise.all([
        api.get('/api/library'),
        api.get('/api/movies/user/favorites', { params: { limit: 500 } })
      ]);

      const playable = [
        ...(libraryResponse.data.movies || []),
        ...flattenSeries(libraryResponse.data.series || [])
      ];

      setLibraryItems(playable);
      setFavoriteIds(new Set((favoritesResponse.data.movies || []).map((item) => Number(item.id))));
    } catch (err) {
      setError('My List could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const favoriteItems = useMemo(() => (
    libraryItems.filter((item) => favoriteIds.has(Number(item.id)))
  ), [favoriteIds, libraryItems]);

  const removeFavorite = async (item) => {
    const itemId = Number(item.id);
    setFavoriteIds((current) => {
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });

    try {
      await api.delete(`/api/movies/${item.id}/favorite`);
    } catch (err) {
      setFavoriteIds((current) => new Set(current).add(itemId));
    }
  };

  if (loading) return <LoadingSpinner fullScreen text="Loading My List..." />;

  return (
    <Container>
      <Header>
        <Title>My List</Title>
        <Subtitle>{favoriteItems.length} playable saved title{favoriteItems.length === 1 ? '' : 's'}</Subtitle>
      </Header>

      {error ? (
        <Empty>{error}</Empty>
      ) : favoriteItems.length === 0 ? (
        <Empty>Save titles from Browse and they will appear here once they are ready to play.</Empty>
      ) : (
        <Grid>
          {favoriteItems.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              episode={item.media_type === 'episode'}
              index={index}
              isFavorite
              onOpen={() => navigate(`/watch/${item.id}?autoplay=1`)}
              onFavorite={removeFavorite}
            />
          ))}
        </Grid>
      )}
    </Container>
  );
};

export default Favorites;
