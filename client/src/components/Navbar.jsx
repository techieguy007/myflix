import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { FiSearch, FiHeart, FiUser, FiLogOut, FiSettings } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';

const NavContainer = styled.nav`
  height: 70px;
  background-color: rgba(20, 20, 20, 0.95);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 2rem;
`;

const Logo = styled(Link)`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 1.8rem;
  font-weight: bold;
  text-decoration: none;
  
  &:hover {
    opacity: 0.8;
  }
`;

const NavLinks = styled.div`
  display: flex;
  align-items: center;
  gap: 1.5rem;
  
  @media (max-width: 768px) {
    display: none;
  }
`;

const NavLink = styled(Link)`
  color: ${({ theme, $active }) => 
    $active ? theme.colors.text : theme.colors.textSecondary};
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s ease;
  position: relative;
  
  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
  
  ${({ $active, theme }) => $active && `
    &::after {
      content: '';
      position: absolute;
      bottom: -20px;
      left: 0;
      right: 0;
      height: 2px;
      background: ${theme.colors.primary};
    }
  `}
`;

const RightSection = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const IconButton = styled(motion.button)`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 1.2rem;
  padding: 0.5rem;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  
  &:hover {
    color: ${({ theme }) => theme.colors.text};
    background: rgba(255, 255, 255, 0.1);
  }
`;

const UserMenu = styled(motion.div)`
  position: relative;
`;

const UserButton = styled(motion.button)`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    color: ${({ theme }) => theme.colors.text};
    background: rgba(255, 255, 255, 0.1);
  }
`;

const UserAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 0.9rem;
`;

const Dropdown = styled(motion.div)`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.5rem;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  min-width: 200px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
`;

const DropdownItem = styled(Link)`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-decoration: none;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: ${({ theme }) => theme.colors.text};
  }
  
  svg {
    font-size: 1rem;
  }
`;

const DropdownButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  width: 100%;
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: ${({ theme }) => theme.colors.text};
  }
  
  svg {
    font-size: 1rem;
  }
`;

const Navbar = () => {
  const { user, logout, isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
    setShowUserMenu(false);
  };

  const isActive = (path) => location.pathname === path;

  if (!isAuthenticated) {
    return null; // Don't show navbar on login/register pages
  }

  return (
    <NavContainer>
      <LeftSection>
        <Logo to="/browse">MyFlix</Logo>
        
        <NavLinks>
          <NavLink 
            to="/browse" 
            $active={isActive('/browse')}
          >
            Browse
          </NavLink>
          <NavLink 
            to="/favorites" 
            $active={isActive('/favorites')}
          >
            My List
          </NavLink>
          {isAdmin && (
            <NavLink 
              to="/admin" 
              $active={location.pathname.startsWith('/admin')}
            >
              Admin
            </NavLink>
          )}
        </NavLinks>
      </LeftSection>

      <RightSection>
        <IconButton
          as={Link}
          to="/search"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <FiSearch />
        </IconButton>

        <UserMenu>
          <UserButton
            onClick={() => setShowUserMenu(!showUserMenu)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <UserAvatar>
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </UserAvatar>
            <span>{user?.username}</span>
          </UserButton>

          {showUserMenu && (
            <Dropdown
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <DropdownItem 
                to="/profile"
                onClick={() => setShowUserMenu(false)}
              >
                <FiUser />
                Profile
              </DropdownItem>
              
              <DropdownItem 
                to="/favorites"
                onClick={() => setShowUserMenu(false)}
              >
                <FiHeart />
                Favorites
              </DropdownItem>

              {isAdmin && (
                <DropdownItem 
                  to="/admin"
                  onClick={() => setShowUserMenu(false)}
                >
                  <FiSettings />
                  Admin Panel
                </DropdownItem>
              )}

              <DropdownButton onClick={handleLogout}>
                <FiLogOut />
                Sign Out
              </DropdownButton>
            </Dropdown>
          )}
        </UserMenu>
      </RightSection>

      {/* Click outside to close menu */}
      {showUserMenu && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: -1
          }}
          onClick={() => setShowUserMenu(false)}
        />
      )}
    </NavContainer>
  );
};

export default Navbar; 