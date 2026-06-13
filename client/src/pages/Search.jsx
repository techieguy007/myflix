import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { FiSearch } from 'react-icons/fi';
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
  max-width: 920px;
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.text};
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 1;
  margin-bottom: 1rem;
`;

const SearchBox = styled.label`
  height: 3.4rem;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.16);
  padding: 0 1rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SearchInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.15rem;

  &::placeholder {
    color: ${({ theme }) => theme.colors.textMuted};
  }
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

function searchableText(item) {
  return [
    item.title,
    item.episode_title,
    item.series_title,
    item.genre,
    item.director,
    item.cast,
    item.release_year,
    item.rated
  ].filter(Boolean).join(' ').toLowerCase();
}

const Search = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await api.get('/api/library');
        setItems([...(response.data.movies || []), ...flattenSeries(response.data.series || [])]);
      } catch (err) {
        setError('Search is unavailable because the library could not be loaded.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items.slice(0, 36);
    return items.filter((item) => searchableText(item).includes(normalized));
  }, [items, query]);

  if (loading) return <LoadingSpinner fullScreen text="Loading search..." />;

  return (
    <Container>
      <Header>
        <Title>Search</Title>
        <SearchBox>
          <FiSearch />
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search movies, shows, actors, genres"
            autoFocus
          />
        </SearchBox>
      </Header>

      {error ? (
        <Empty>{error}</Empty>
      ) : results.length === 0 ? (
        <Empty>No playable titles match "{query}".</Empty>
      ) : (
        <Grid>
          {results.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              episode={item.media_type === 'episode'}
              index={index}
              onOpen={() => navigate(`/watch/${item.id}?autoplay=1`)}
            />
          ))}
        </Grid>
      )}
    </Container>
  );
};

export default Search;
