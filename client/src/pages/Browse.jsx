import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { FiPlay, FiInfo } from 'react-icons/fi';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';

const Container = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.background};
  padding-bottom: 4rem;
`;

const Hero = styled.div`
  height: 60vh;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.3) 0%,
    rgba(0, 0, 0, 0.7) 100%
  ), url('https://images.unsplash.com/photo-1489599577372-f975c7079ca8?ixlib=rb-4.0.3') center/cover;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 4rem;
  position: relative;
`;

const HeroContent = styled(motion.div)`
  max-width: 500px;
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
  font-size: 1.2rem;
  line-height: 1.5;
  margin-bottom: 2rem;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
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
    
    &:hover {
      background: rgba(255, 255, 255, 0.8);
    }
  }
  
  &.secondary {
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
    
    &:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  }
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

const MoviesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
`;

const MovieCard = styled(motion.div)`
  background: ${({ theme }) => theme.colors.backgroundCard};
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s ease;
  
  &:hover {
    transform: scale(1.05);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
`;

const MoviePoster = styled.div`
  height: 300px;
  background: ${({ $thumbnail }) => 
    $thumbnail 
      ? `url(${process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000'}${$thumbnail}) center/cover no-repeat`
      : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  };
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 3rem;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  
  /* Fallback emoji styling when no thumbnail */
  ${({ $thumbnail }) => !$thumbnail && `
    &:hover {
      background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%);
      transform: scale(1.02);
    }
  `}
  
  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: ${({ $thumbnail }) => 
      $thumbnail 
        ? 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 100%)'
        : 'none'
    };
    pointer-events: none;
  }
  
  /* Loading state for thumbnails */
  ${({ $thumbnail }) => $thumbnail && `
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    
    &::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    @keyframes spin {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
  `}
`;

const MovieInfo = styled.div`
  padding: 1rem;
`;

const MovieTitle = styled.h3`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
`;

const MovieMeta = styled.p`
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

const Browse = () => {
  const navigate = useNavigate();
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMovies();
  }, []);

  const fetchMovies = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/movies');
      const moviesData = response.data.movies;
      

      
      setMovies(moviesData);
    } catch (err) {
      console.error('Failed to fetch movies:', err);
      setError('Failed to load movies');
    } finally {
      setLoading(false);
    }
  };

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

  if (loading) {
    return <LoadingSpinner fullScreen text="Loading movies..." />;
  }

  return (
    <Container>
      <Hero>
        <HeroContent
          variants={heroVariants}
          initial="initial"
          animate="animate"
        >
          <HeroTitle>Welcome to MyFlix</HeroTitle>
          <HeroDescription>
            Your personal movie streaming platform. Upload and enjoy your favorite movies 
            from anywhere in your home network.
          </HeroDescription>
          <ButtonGroup>
            <Button 
              className="primary"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <FiPlay />
              Get Started
            </Button>
            <Button 
              className="secondary"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <FiInfo />
              Learn More
            </Button>
          </ButtonGroup>
        </HeroContent>
      </Hero>

      <Content>
        {error ? (
          <EmptyState>
            <EmptyTitle>Error Loading Movies</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyState>
        ) : movies.length === 0 ? (
          <EmptyState>
            <EmptyTitle>No Movies Yet</EmptyTitle>
            <EmptyDescription>
              Your movie library is empty. Upload some movies through the admin panel to get started!
            </EmptyDescription>
          </EmptyState>
        ) : (
          <Section>
            <SectionTitle>Your Movies ({movies.length})</SectionTitle>
            <MoviesGrid>
              {movies.map((movie, index) => (
                <MovieCard
                  key={movie.id}
                  variants={cardVariants}
                  initial="initial"
                  animate="animate"
                  transition={{ delay: index * 0.1 }}
                  onClick={() => navigate(`/watch/${movie.id}`)}
                >
                  <MoviePoster $thumbnail={movie.thumbnail || movie.poster_url}>
                    {!(movie.thumbnail || movie.poster_url) && (
                      <span style={{ position: 'relative', zIndex: 1 }}>🎬</span>
                    )}
                    {(movie.thumbnail || movie.poster_url) && (() => {
                      const imageUrl = movie.thumbnail 
                        ? movie.thumbnail  // Use relative URL to avoid CORS
                        : movie.poster_url;
                      
                      return (
                        <img
                          src={imageUrl}
                          alt={movie.title}
                          style={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            top: 0,
                            left: 0,
                            opacity: 0
                          }}
                        onLoad={(e) => {
                          e.target.style.opacity = '1';
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                          // Show fallback emoji
                          const fallback = document.createElement('span');
                          fallback.textContent = '🎬';
                          fallback.style.cssText = 'position: relative; z-index: 1; font-size: 3rem;';
                          e.target.parentElement.appendChild(fallback);
                        }}
                        />
                      );
                    })()}
                  </MoviePoster>
                  <MovieInfo>
                    <MovieTitle>{movie.title}</MovieTitle>
                    <MovieMeta>
                      {movie.release_year && `${movie.release_year}`}
                      {movie.release_year && movie.genre && ' • '}
                      {movie.genre}
                      {movie.runtime && (movie.release_year || movie.genre) && ' • '}
                      {movie.runtime}
                    </MovieMeta>
                    {movie.imdb_rating && (
                      <MovieMeta style={{ color: '#f5c518', fontWeight: 'bold' }}>
                        ⭐ {movie.imdb_rating}/10 IMDb
                      </MovieMeta>
                    )}
                    {movie.rated && (
                      <MovieMeta style={{ 
                        display: 'inline-block', 
                        background: 'rgba(255,255,255,0.2)', 
                        padding: '0.2rem 0.4rem', 
                        borderRadius: '3px',
                        fontSize: '0.8rem',
                        marginTop: '0.5rem'
                      }}>
                        {movie.rated}
                      </MovieMeta>
                    )}
                  </MovieInfo>
                </MovieCard>
              ))}
            </MoviesGrid>
          </Section>
        )}
      </Content>
    </Container>
  );
};

export default Browse; 