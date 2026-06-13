import React from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { FiPlay, FiPlus, FiCheck } from 'react-icons/fi';

const Card = styled(motion.article)`
  position: relative;
  min-width: ${({ $compact }) => ($compact ? '148px' : '184px')};
  width: ${({ $compact }) => ($compact ? '148px' : '184px')};
  border-radius: 8px;
  overflow: hidden;
  background: #1b1b1b;
  cursor: pointer;
  scroll-snap-align: start;
  transform-origin: center bottom;
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.24);

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: 3px;
  }

  @media (max-width: 640px) {
    min-width: ${({ $compact }) => ($compact ? '126px' : '142px')};
    width: ${({ $compact }) => ($compact ? '126px' : '142px')};
  }
`;

const Poster = styled.div`
  aspect-ratio: 2 / 3;
  position: relative;
  background:
    ${({ $image }) => ($image ? `url(${$image}) center/cover no-repeat, ` : '')}
    radial-gradient(circle at 24% 18%, rgba(229, 9, 20, 0.26), transparent 34%),
    linear-gradient(145deg, #262626, #0b0b0b 72%);
`;

const FallbackTitle = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  color: rgba(255, 255, 255, 0.74);
  text-align: center;
  font-size: 0.82rem;
  font-weight: 800;
  line-height: 1.25;
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.55rem;
  padding: 0.7rem;
  background: linear-gradient(180deg, transparent 42%, rgba(0, 0, 0, 0.92));
  opacity: 0;
  transition: opacity 0.18s ease;

  ${Card}:hover &,
  ${Card}:focus-visible & {
    opacity: 1;
  }

  @media (hover: none) {
    opacity: 1;
  }
`;

const IconButton = styled.button`
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ $primary, theme }) => ($primary ? theme.colors.primary : 'rgba(255, 255, 255, 0.16)')};
  color: #fff;
  border: 1px solid ${({ $primary }) => ($primary ? 'rgba(229, 9, 20, 0.4)' : 'rgba(255, 255, 255, 0.24)')};
  backdrop-filter: blur(8px);

  &:hover {
    background: ${({ $primary, theme }) => ($primary ? theme.colors.primaryDark : 'rgba(255, 255, 255, 0.25)')};
  }
`;

const Info = styled.div`
  padding: 0.75rem 0.72rem 0.85rem;
`;

const Title = styled.h3`
  color: ${({ theme }) => theme.colors.text};
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.25;
  min-height: 2.25rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.76rem;
  margin-top: 0.45rem;
`;

const RatingBadge = styled.span`
  color: #f5c518;
  font-weight: 800;
`;

const ContentRatingBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.3rem;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 3px;
  color: #fff;
  background: rgba(255, 255, 255, 0.13);
  padding: 0.1rem 0.36rem;
  font-size: 0.7rem;
  font-weight: 800;
  line-height: 1.2;
`;

const ProgressRail = styled.div`
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 0.6rem;
`;

const ProgressFill = styled.div`
  width: ${({ $value }) => `${Math.max(0, Math.min(100, $value || 0))}%`};
  height: 100%;
  background: ${({ theme }) => theme.colors.primary};
`;

export function episodeLabel(item) {
  const season = String(item.season_number || 1).padStart(2, '0');
  const episode = String(item.episode_number || 1).padStart(2, '0');
  return `S${season}E${episode} ${item.episode_title || item.title}`;
}

export function displayTitle(item, episode = false) {
  return episode || item.media_type === 'episode'
    ? episodeLabel(item)
    : item.title;
}

export function mediaImage(item) {
  return item.poster_url || item.thumbnail || '';
}

export function mediaMetaParts(item) {
  return [
    item.release_year,
    item.runtime,
    item.genre && String(item.genre).split(',')[0].trim()
  ].filter(Boolean);
}

export default function MediaCard({
  item,
  episode = false,
  compact = false,
  progress = 0,
  isFavorite = false,
  onOpen,
  onFavorite,
  index = 0
}) {
  const title = displayTitle(item, episode);
  const image = mediaImage(item);

  const handleOpen = () => {
    if (onOpen) onOpen(item);
  };

  const handleFavorite = (event) => {
    event.stopPropagation();
    if (onFavorite) onFavorite(item);
  };

  return (
    <Card
      $compact={compact}
      tabIndex={0}
      role="button"
      aria-label={`Play ${title}`}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.025, 0.22) }}
      whileHover={{ y: -8, scale: 1.035 }}
    >
      <Poster $image={image}>
        {!image && <FallbackTitle>{title}</FallbackTitle>}
        <Overlay>
          <IconButton $primary type="button" aria-label={`Play ${title}`}>
            <FiPlay />
          </IconButton>
          {onFavorite && (
            <IconButton
              type="button"
              aria-label={isFavorite ? `Remove ${title} from My List` : `Add ${title} to My List`}
              onClick={handleFavorite}
            >
              {isFavorite ? <FiCheck /> : <FiPlus />}
            </IconButton>
          )}
        </Overlay>
      </Poster>
      <Info>
        <Title>{title}</Title>
        <Meta>
          {item.rated && <ContentRatingBadge>{item.rated}</ContentRatingBadge>}
          {mediaMetaParts(item).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </Meta>
        {item.imdb_rating && (
          <Meta>
            <RatingBadge>IMDb {item.imdb_rating}</RatingBadge>
          </Meta>
        )}
        {progress > 0 && (
          <ProgressRail aria-label={`${Math.round(progress)} percent watched`}>
            <ProgressFill $value={progress} />
          </ProgressRail>
        )}
      </Info>
    </Card>
  );
}
