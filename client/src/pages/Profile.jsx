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

const Profile = () => {
  return (
    <Container>
      <Title>Profile Page - Coming Soon</Title>
    </Container>
  );
};

export default Profile; 