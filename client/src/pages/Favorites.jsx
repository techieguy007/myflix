import React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.background};
`;

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.text};
  text-align: center;
`;

const Favorites = () => {
  return (
    <Container>
      <Title>My Favorites - Coming Soon</Title>
    </Container>
  );
};

export default Favorites; 