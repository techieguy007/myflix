import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

const HomeContainer = styled.div`
  min-height: 100vh;
  background: linear-gradient(
    rgba(0, 0, 0, 0.7),
    rgba(0, 0, 0, 0.3)
  ), url('https://images.unsplash.com/photo-1489599577372-f975c7079ca8?ixlib=rb-4.0.3') center/cover;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: white;
`;

const ContentContainer = styled(motion.div)`
  max-width: 800px;
  padding: 2rem;
  
  @media (max-width: 768px) {
    padding: 1rem;
  }
  
  @media (max-width: 480px) {
    padding: 0.75rem;
  }
`;

const Title = styled.h1`
  font-size: 4rem;
  font-weight: bold;
  margin-bottom: 1rem;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
  
  @media (max-width: 768px) {
    font-size: 2.5rem;
  }
  
  @media (max-width: 480px) {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }
`;

const Subtitle = styled.h2`
  font-size: 1.5rem;
  font-weight: 300;
  margin-bottom: 2rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  
  @media (max-width: 768px) {
    font-size: 1.2rem;
    margin-bottom: 1.5rem;
  }
  
  @media (max-width: 480px) {
    font-size: 1rem;
    margin-bottom: 1rem;
  }
`;

const Description = styled.p`
  font-size: 1.1rem;
  line-height: 1.6;
  margin-bottom: 3rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  
  @media (max-width: 768px) {
    font-size: 1rem;
    margin-bottom: 2rem;
  }
  
  @media (max-width: 480px) {
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
  }
`;

const ButtonContainer = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
`;

const Button = styled(Link)`
  display: inline-block;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  text-decoration: none;
  border-radius: 4px;
  transition: all 0.3s ease;
  
  @media (max-width: 480px) {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    width: 100%;
    text-align: center;
  }
  
  &.primary {
    background-color: ${({ theme }) => theme.colors.primary};
    color: white;
    
    &:hover {
      background-color: ${({ theme }) => theme.colors.primaryDark};
      transform: translateY(-2px);
    }
  }
  
  &.secondary {
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.3);
    
    &:hover {
      background-color: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.5);
      transform: translateY(-2px);
    }
  }
`;

const FeatureGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
  margin-top: 4rem;
  max-width: 1200px;
  
  @media (max-width: 768px) {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
    margin-top: 3rem;
  }
  
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 1rem;
    margin-top: 2rem;
  }
`;

const FeatureCard = styled(motion.div)`
  background: rgba(255, 255, 255, 0.1);
  padding: 2rem;
  border-radius: 8px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  
  @media (max-width: 768px) {
    padding: 1.5rem;
  }
  
  @media (max-width: 480px) {
    padding: 1rem;
  }
`;

const FeatureIcon = styled.div`
  font-size: 2.5rem;
  margin-bottom: 1rem;
  
  @media (max-width: 480px) {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }
`;

const FeatureTitle = styled.h3`
  font-size: 1.3rem;
  margin-bottom: 0.5rem;
  color: white;
  
  @media (max-width: 480px) {
    font-size: 1.1rem;
    margin-bottom: 0.4rem;
  }
`;

const FeatureDescription = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.95rem;
  line-height: 1.5;
  
  @media (max-width: 480px) {
    font-size: 0.85rem;
    line-height: 1.4;
  }
`;

const features = [
  {
    icon: '🎬',
    title: 'Stream Your Movies',
    description: 'Upload and stream your personal movie collection in high quality from any device on your network.'
  },
  {
    icon: '🏠',
    title: 'Home Network Only',
    description: 'Completely private streaming server that runs on your home network. No internet required once setup.'
  },
  {
    icon: '📱',
    title: 'All Your Devices',
    description: 'Access your movies from phones, tablets, computers, and smart TVs with our responsive design.'
  },
  {
    icon: '👥',
    title: 'Multi-User Support',
    description: 'Create accounts for family members with individual watch histories and favorites lists.'
  }
];

const Home = () => {
  const { isAuthenticated } = useAuth();

  const containerVariants = {
    initial: { opacity: 0, y: 50 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8 }
  };

  const cardVariants = {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.5 }
  };

  return (
    <HomeContainer>
      <ContentContainer
        variants={containerVariants}
        initial="initial"
        animate="animate"
      >
        <Title>Welcome to MyFlix</Title>
        <Subtitle>Your Personal Netflix for Home Streaming</Subtitle>
        <Description>
          Transform your home into a personal entertainment hub. Stream your movie collection 
          with the elegance and functionality of major streaming platforms, all running privately 
          on your own network.
        </Description>
        
        <ButtonContainer>
          {isAuthenticated ? (
            <Button to="/browse" className="primary">
              Browse Movies
            </Button>
          ) : (
            <>
              <Button to="/login" className="primary">
                Sign In
              </Button>
              <Button to="/register" className="secondary">
                Create Account
              </Button>
            </>
          )}
        </ButtonContainer>

        <FeatureGrid>
          {features.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              variants={cardVariants}
              initial="initial"
              animate="animate"
              transition={{ delay: 0.2 * index }}
            >
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <FeatureTitle>{feature.title}</FeatureTitle>
              <FeatureDescription>{feature.description}</FeatureDescription>
            </FeatureCard>
          ))}
        </FeatureGrid>
      </ContentContainer>
    </HomeContainer>
  );
};

export default Home; 