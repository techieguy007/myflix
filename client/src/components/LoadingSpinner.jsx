import React from 'react';
import styled, { keyframes } from 'styled-components';

const spin = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;

const SpinnerContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  ${({ fullScreen }) => fullScreen && `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(20, 20, 20, 0.9);
    z-index: 9999;
  `}
  ${({ center }) => center && `
    width: 100%;
    height: 200px;
  `}
  padding: ${({ size }) => size === 'small' ? '10px' : '20px'};
`;

const Spinner = styled.div`
  width: ${({ size }) => {
    switch (size) {
      case 'small': return '20px';
      case 'large': return '60px';
      default: return '40px';
    }
  }};
  height: ${({ size }) => {
    switch (size) {
      case 'small': return '20px';
      case 'large': return '60px';
      default: return '40px';
    }
  }};
  border: ${({ size }) => {
    switch (size) {
      case 'small': return '2px';
      case 'large': return '4px';
      default: return '3px';
    }
  }} solid #333;
  border-top: ${({ size }) => {
    switch (size) {
      case 'small': return '2px';
      case 'large': return '4px';
      default: return '3px';
    }
  }} solid ${({ theme }) => theme.colors.primary};
  border-radius: 50%;
  animation: ${spin} 1s linear infinite;
`;

const LoadingText = styled.div`
  margin-top: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ size }) => {
    switch (size) {
      case 'small': return '12px';
      case 'large': return '18px';
      default: return '14px';
    }
  }};
  text-align: center;
`;

const LoadingSpinner = ({ 
  fullScreen = false, 
  center = false, 
  size = 'medium',
  text = '',
  className = ''
}) => {
  return (
    <SpinnerContainer 
      fullScreen={fullScreen} 
      center={center} 
      size={size}
      className={className}
    >
      <div>
        <Spinner size={size} />
        {text && <LoadingText size={size}>{text}</LoadingText>}
      </div>
    </SpinnerContainer>
  );
};

export default LoadingSpinner; 