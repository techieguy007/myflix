import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

const Container = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    rgba(0, 0, 0, 0.7),
    rgba(0, 0, 0, 0.3)
  ), url('https://images.unsplash.com/photo-1489599577372-f975c7079ca8?ixlib=rb-4.0.3') center/cover;
  padding: 2rem;
`;

const LoginCard = styled(motion.div)`
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 3rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
`;

const Logo = styled.h1`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 2.5rem;
  font-weight: bold;
  text-align: center;
  margin-bottom: 2rem;
`;

const Title = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.8rem;
  font-weight: 600;
  margin-bottom: 2rem;
  text-align: center;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.9rem;
  font-weight: 500;
`;

const Input = styled.input`
  background: ${({ theme }) => theme.colors.backgroundLight};
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1rem;
  padding: 0.75rem 1rem;
  transition: all 0.2s ease;
  
  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
    outline: none;
    box-shadow: 0 0 0 2px rgba(229, 9, 20, 0.2);
  }
  
  &::placeholder {
    color: ${({ theme }) => theme.colors.textMuted};
  }
`;

const ErrorMessage = styled.span`
  color: ${({ theme }) => theme.colors.error};
  font-size: 0.85rem;
  margin-top: 0.25rem;
`;

const Button = styled(motion.button)`
  background: ${({ theme }) => theme.colors.primary};
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  padding: 0.875rem 1.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 1rem;
  
  &:hover {
    background: ${({ theme }) => theme.colors.primaryDark};
    transform: translateY(-1px);
  }
  
  &:disabled {
    background: ${({ theme }) => theme.colors.textMuted};
    cursor: not-allowed;
    transform: none;
  }
`;

const Divider = styled.div`
  margin: 2rem 0;
  text-align: center;
  position: relative;
  
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
  }
  
  span {
    background: rgba(0, 0, 0, 0.85);
    color: ${({ theme }) => theme.colors.textSecondary};
    padding: 0 1rem;
    font-size: 0.9rem;
  }
`;

const LinkText = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.9rem;
  text-align: center;
  
  a {
    color: ${({ theme }) => theme.colors.primary};
    text-decoration: none;
    
    &:hover {
      text-decoration: underline;
    }
  }
`;

const BackToHome = styled(Link)`
  position: absolute;
  top: 2rem;
  left: 2rem;
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(0, 0, 0, 0.7);
  }
`;

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  
  const from = location.state?.from?.pathname || '/browse';
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const onSubmit = async (data) => {
    setIsLoading(true);
    try {
      const result = await login(data);
      
      if (result.success) {
        toast.success('Login successful! Welcome back.');
        navigate(from, { replace: true });
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const cardVariants = {
    initial: { opacity: 0, y: 50 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5 }
  };

  const buttonVariants = {
    hover: { scale: 1.02 },
    tap: { scale: 0.98 }
  };

  return (
    <Container>
      <BackToHome to="/">← Back to Home</BackToHome>
      
      <LoginCard
        variants={cardVariants}
        initial="initial"
        animate="animate"
      >
        <Logo>MyFlix</Logo>
        <Title>Sign In</Title>
        
        <Form onSubmit={handleSubmit(onSubmit)}>
          <InputGroup>
            <Label>Username or Email</Label>
            <Input
              {...register('username', {
                required: 'Username or email is required'
              })}
              type="text"
              placeholder="Enter your username or email"
              autoComplete="username"
            />
            {errors.username && (
              <ErrorMessage>{errors.username.message}</ErrorMessage>
            )}
          </InputGroup>

          <InputGroup>
            <Label>Password</Label>
            <Input
              {...register('password', {
                required: 'Password is required'
              })}
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
            {errors.password && (
              <ErrorMessage>{errors.password.message}</ErrorMessage>
            )}
          </InputGroup>

          <Button
            type="submit"
            disabled={isLoading}
            variants={buttonVariants}
            whileHover="hover"
            whileTap="tap"
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </Button>
        </Form>

        <Divider>
          <span>New to MyFlix?</span>
        </Divider>

        <LinkText>
          Don't have an account? <Link to="/register">Sign up now</Link>
        </LinkText>
        
        <Divider>
          <span>Default Admin Account</span>
        </Divider>
        
        <LinkText style={{ fontSize: '0.8rem', opacity: 0.8 }}>
          Username: <strong>admin</strong><br />
          Password: <strong>admin123</strong><br />
          <em>Remember to change this after first login!</em>
        </LinkText>
      </LoginCard>
    </Container>
  );
};

export default Login; 