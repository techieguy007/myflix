import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import styled, { ThemeProvider, createGlobalStyle } from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';

// Import contexts and hooks
import { useAuth } from './contexts/AuthContext';

// Import components
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import LoadingSpinner from './components/LoadingSpinner';

// Import pages
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Browse from './pages/Browse';
import Watch from './pages/Watch';
import Profile from './pages/Profile';
import Search from './pages/Search';
import Favorites from './pages/Favorites';
import Admin from './pages/Admin';

// Netflix-style theme
const theme = {
  colors: {
    primary: '#e50914',
    primaryDark: '#b20710',
    background: '#141414',
    backgroundLight: '#1f1f1f',
    backgroundCard: '#2f2f2f',
    text: '#ffffff',
    textSecondary: '#b3b3b3',
    textMuted: '#808080',
    success: '#46d369',
    warning: '#ffa500',
    error: '#e87c03',
  },
  fonts: {
    primary: "'Helvetica Neue', Arial, sans-serif",
    secondary: "'Netflix Sans', 'Helvetica Neue', Arial, sans-serif",
  },
  breakpoints: {
    mobile: '480px',
    tablet: '768px',
    desktop: '1024px',
    largeDesktop: '1440px',
  },
  zIndex: {
    header: 100,
    modal: 1000,
    tooltip: 1100,
  },
};

// Global styles
const GlobalStyle = createGlobalStyle`
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: ${({ theme }) => theme.fonts.primary};
    background-color: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    line-height: 1.6;
    overflow-x: hidden;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  button {
    cursor: pointer;
    border: none;
    outline: none;
    font-family: inherit;
  }

  input, textarea {
    font-family: inherit;
    outline: none;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  .loading-screen {
    display: none;
  }

  /* Custom scrollbar */
  ::-webkit-scrollbar {
    width: 8px;
  }

  ::-webkit-scrollbar-track {
    background: ${({ theme }) => theme.colors.background};
  }

  ::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
`;

const AppContainer = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const MainContent = styled.main`
  flex: 1;
  min-height: calc(100vh - 70px);
`;

const PageTransition = styled(motion.div)`
  width: 100%;
  min-height: 100vh;
`;

// Page transition variants
const pageTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

function App() {
  const { user, loading, checkAuthStatus } = useAuth();

  useEffect(() => {
    // Check authentication status on app startup
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <ThemeProvider theme={theme}>
        <GlobalStyle />
        <AppContainer>
          <LoadingSpinner fullScreen />
        </AppContainer>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <AppContainer>
        {/* Navigation bar - shown on all pages except login/register */}
        <Routes>
          <Route path="/login" element={null} />
          <Route path="/register" element={null} />
          <Route path="*" element={<Navbar />} />
        </Routes>

        <MainContent>
          <AnimatePresence mode="wait">
            <Routes>
              {/* Public routes */}
              <Route
                path="/login"
                element={
                  user ? (
                    <Navigate to="/browse" replace />
                  ) : (
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Login />
                    </PageTransition>
                  )
                }
              />
              <Route
                path="/register"
                element={
                  user ? (
                    <Navigate to="/browse" replace />
                  ) : (
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Register />
                    </PageTransition>
                  )
                }
              />

              {/* Home page - accessible to everyone */}
              <Route
                path="/"
                element={
                  <PageTransition
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={pageTransition}
                    transition={{ duration: 0.3 }}
                  >
                    <Home />
                  </PageTransition>
                }
              />

              {/* Protected routes - require authentication */}
              <Route
                path="/browse"
                element={
                  <ProtectedRoute>
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Browse />
                    </PageTransition>
                  </ProtectedRoute>
                }
              />
              
              <Route
                path="/watch/:id"
                element={
                  <ProtectedRoute>
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Watch />
                    </PageTransition>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/search"
                element={
                  <ProtectedRoute>
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Search />
                    </PageTransition>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/favorites"
                element={
                  <ProtectedRoute>
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Favorites />
                    </PageTransition>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Profile />
                    </PageTransition>
                  </ProtectedRoute>
                }
              />

              {/* Admin routes - require admin privileges */}
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute adminRequired>
                    <PageTransition
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      variants={pageTransition}
                      transition={{ duration: 0.3 }}
                    >
                      <Admin />
                    </PageTransition>
                  </ProtectedRoute>
                }
              />

              {/* Default redirect */}
              <Route
                path="*"
                element={<Navigate to={user ? "/browse" : "/"} replace />}
              />
            </Routes>
          </AnimatePresence>
        </MainContent>
      </AppContainer>
    </ThemeProvider>
  );
}

export default App; 