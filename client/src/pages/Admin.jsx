import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  FiUpload,
  FiTrash2,
  FiEdit,
  FiPlus,
  FiX,
  FiCheck,
  FiCheckSquare,
  FiSquare,
  FiRefreshCw,
  FiCpu,
  FiPlay,
  FiPause
} from 'react-icons/fi';
import api from '../utils/api';

const Container = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.background};
  padding: 2rem;
`;

const Header = styled.div`
  margin-bottom: 3rem;
`;

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
`;

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.text};
  opacity: 0.7;
`;

const TabContainer = styled.div`
  display: flex;
  margin-bottom: 2rem;
  border-bottom: 1px solid #333;
`;

const Tab = styled.button.withConfig({
  shouldForwardProp: (prop) => prop !== 'active'
})`
  background: none;
  border: none;
  padding: 1rem 2rem;
  color: ${({ active, theme }) => active ? theme.colors.primary : theme.colors.text};
  border-bottom: ${({ active, theme }) => active ? `2px solid ${theme.colors.primary}` : '2px solid transparent'};
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 1rem;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const Content = styled.div`
  background: #1a1a1a;
  border-radius: 8px;
  padding: 2rem;
`;

const UploadSection = styled.div`
  border: 2px dashed #333;
  border-radius: 8px;
  padding: 3rem;
  text-align: center;
  margin-bottom: 2rem;
  transition: border-color 0.3s ease;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const UploadIcon = styled(FiUpload)`
  font-size: 3rem;
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 1rem;
`;

const UploadText = styled.p`
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 1rem;
`;

const FileInput = styled.input`
  display: none;
`;

const UploadButton = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:hover {
    background: #c5302f;
  }
`;

const MovieGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
`;

const MovieCard = styled(motion.div)`
  background: #222;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid ${({ selected, theme }) => selected ? theme.colors.primary : '#333'};
  transition: all 0.3s ease;
  position: relative;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
  }
`;

const MovieImage = styled.div`
  height: 200px;
  background: linear-gradient(45deg, #333, #444);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
`;

const MovieInfo = styled.div`
  padding: 1rem;
`;

const SelectionControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 1rem;
  background: ${({ theme }) => theme.colors.backgroundCard};
  border-radius: 8px;
  border: 1px solid #333;
`;

const ManageFilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
`;

const ManageFilterButton = styled.button.withConfig({
  shouldForwardProp: (prop) => prop !== 'active'
})`
  border: 1px solid ${({ active, theme }) => active ? theme.colors.primary : '#444'};
  background: ${({ active, theme }) => active ? theme.colors.primary : '#2a2a2a'};
  color: white;
  border-radius: 4px;
  padding: 0.6rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const SelectionButton = styled.button.withConfig({
  shouldForwardProp: (prop) => prop !== 'variant'
})`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s ease;

  &:hover {
    opacity: 0.8;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  ${({ variant, theme }) => {
    switch (variant) {
      case 'primary':
        return `
          background: ${theme.colors.primary};
          color: white;
        `;
      case 'danger':
        return `
          background: #dc2626;
          color: white;
        `;
      case 'secondary':
      default:
        return `
          background: #374151;
          color: ${theme.colors.text};
        `;
    }
  }}
`;

const MovieCheckbox = styled.div`
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 2;
  width: 24px;
  height: 24px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  border: 2px solid ${({ checked, theme }) => checked ? theme.colors.primary : '#666'};
  
  &:hover {
    background: rgba(0, 0, 0, 0.95);
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const MovieTitle = styled.h3`
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
`;

const MovieMeta = styled.p`
  color: #999;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
`;

const MovieActions = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
`;

const ActionButton = styled.button.withConfig({
  shouldForwardProp: (prop) => prop !== 'variant'
})`
  background: ${({ variant, theme }) => variant === 'danger' ? '#dc3545' : theme.colors.primary};
  color: white;
  border: none;
  padding: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 0.8;
  }
`;

const LoadingSpinner = styled.div`
  border: 2px solid #333;
  border-top: 2px solid ${({ theme }) => theme.colors.primary};
  border-radius: 50%;
  width: 20px;
  height: 20px;
  animation: spin 1s linear infinite;
  margin: 0 auto;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const Modal = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled(motion.div)`
  background: #1a1a1a;
  padding: 2rem;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: between;
  align-items: center;
  margin-bottom: 2rem;
`;

const ModalTitle = styled.h2`
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  margin-left: auto;
`;

const FormGroup = styled.div`
  margin-bottom: 1rem;
`;

const Label = styled.label`
  display: block;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.75rem;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1rem;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 0.75rem;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1rem;
  min-height: 100px;
  resize: vertical;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
`;

const Button = styled.button.withConfig({
  shouldForwardProp: (prop) => prop !== 'variant'
})`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 0.8;
  }

  ${({ variant, theme }) => {
    if (variant === 'primary') {
      return `
        background: ${theme.colors.primary};
        color: white;
      `;
    } else {
      return `
        background: #333;
        color: ${theme.colors.text};
      `;
    }
  }}
`;

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const conversionStatusStyle = (status) => {
  switch (status) {
    case 'deleted':
      return { color: '#46d369', label: 'Converted, original deleted' };
    case 'promoted':
      return { color: '#4da3ff', label: 'Converted, delete pending' };
    case 'prepared-kept':
      return { color: '#f5c542', label: 'Converted, original kept' };
    case 'delete-failed':
      return { color: '#ff5c5c', label: 'Converted, delete failed' };
    default:
      return { color: '#ccc', label: status || 'Unknown' };
  }
};

const isEpisode = (item) => item.media_type === 'episode';

const formatRuntime = (seconds) => {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return null;

  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const formatEpisodeCode = (item) => {
  if (!isEpisode(item)) return null;

  const season = Number(item.season_number);
  const episode = Number(item.episode_number);
  if (!season || !episode) return 'Episode';

  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
};

const buildPrimaryMeta = (item) => {
  const parts = [];

  if (isEpisode(item)) {
    const episodeCode = formatEpisodeCode(item);
    parts.push(`TV Episode${episodeCode ? ` ${episodeCode}` : ''}`);
    if (item.series_title) parts.push(item.series_title);
  } else {
    parts.push('Movie');
  }

  if (item.genre) parts.push(item.genre);
  if (item.release_year) parts.push(item.release_year);

  return parts.join(' - ');
};

const buildSecondaryMeta = (item) => {
  const parts = [];
  const runtime = formatRuntime(item.duration);

  if (runtime) parts.push(runtime);
  if (item.rating) parts.push(`Rating ${item.rating}`);
  if (item.imdb_rating) parts.push(`IMDb ${item.imdb_rating}`);

  return parts.join(' - ');
};

const formatPercent = (value) => {
  const percent = Number(value || 0);
  if (!Number.isFinite(percent)) return '0%';
  return `${Math.round(percent)}%`;
};

const queueStatusStyle = (status) => {
  switch (status) {
    case 'running':
      return { color: '#4da3ff', label: 'Running' };
    case 'queued':
      return { color: '#f5c542', label: 'Queued' };
    case 'completed':
      return { color: '#46d369', label: 'Completed' };
    case 'failed':
      return { color: '#ff5c5c', label: 'Failed' };
    case 'skipped':
      return { color: '#999', label: 'Skipped' };
    default:
      return { color: '#ccc', label: status || 'Unknown' };
  }
};

const Admin = () => {
  const [activeTab, setActiveTab] = useState('scan');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [editingMovie, setEditingMovie] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [scanPath, setScanPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [selectedMovies, setSelectedMovies] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [manageFilter, setManageFilter] = useState('movies');
  const [encoderPreference, setEncoderPreference] = useState('auto');
  const [conversionDialog, setConversionDialog] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(null);
  const queryClient = useQueryClient();

  // Fetch movies
  const { data: movies = [], isLoading: moviesLoading, refetch: refetchMovies } = useQuery({
    queryKey: ['admin-movies'],
    queryFn: async () => {
      const response = await api.get('/api/movies?limit=5000');
      return response.data.movies || [];
    }
  });

  const movieItems = movies.filter((movie) => !isEpisode(movie));
  const episodeItems = movies.filter((movie) => isEpisode(movie));
  const visibleMovies = manageFilter === 'episodes'
    ? episodeItems
    : manageFilter === 'all'
      ? movies
      : movieItems;
  const visibleMovieIds = visibleMovies.map((movie) => movie.id);
  const visibleSelectedCount = selectedMovies.filter((id) => visibleMovieIds.includes(id)).length;
  const allVisibleSelected = visibleMovies.length > 0 && visibleSelectedCount === visibleMovies.length;

  const {
    data: conversionData,
    isLoading: conversionsLoading,
    refetch: refetchConversions
  } = useQuery({
    queryKey: ['admin-conversions'],
    queryFn: async () => {
      const response = await api.get('/api/library/conversions?limit=100');
      return response.data;
    },
    enabled: activeTab === 'conversions'
  });

  const {
    data: conversionQueue,
    isLoading: conversionQueueLoading,
    refetch: refetchConversionQueue
  } = useQuery({
    queryKey: ['admin-conversion-queue'],
    queryFn: async () => {
      const response = await api.get('/api/library/conversion-queue');
      return response.data;
    },
    enabled: activeTab === 'conversions' || activeTab === 'manage',
    refetchInterval: activeTab === 'conversions' ? 5000 : false
  });

  // Delete movie mutation
  const deleteMovieMutation = useMutation({
    mutationFn: async (movieId) => {
      await api.delete(`/api/movies/${movieId}`);
    },
    onSuccess: () => {
      toast.success('Movie removed from library (original file preserved)');
      queryClient.invalidateQueries(['admin-movies']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Failed to remove movie from library');
    }
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (movieIds) => {
      await api.delete('/api/movies/bulk', { data: { movieIds } });
    },
    onSuccess: (data, variables) => {
      toast.success(`${variables.length} movies removed from library (original files preserved)`);
      setSelectedMovies([]);
      setIsSelecting(false);
      queryClient.invalidateQueries(['admin-movies']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Failed to remove selected movies');
    }
  });

  // Update movie mutation
  const updateMovieMutation = useMutation({
    mutationFn: async (movieData) => {
      const { id, ...data } = movieData;
      await api.put(`/api/movies/${id}`, data);
    },
    onSuccess: () => {
      toast.success('Movie updated successfully');
      queryClient.invalidateQueries(['admin-movies']);
      setShowEditModal(false);
      setEditingMovie(null);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Failed to update movie');
    }
  });

  const queueSelectedConversionMutation = useMutation({
    mutationFn: async (movieIds) => {
      const response = await api.post('/api/library/conversion-queue/selected', {
        movieIds,
        encoderPreference
      });
      return response.data;
    },
    onSuccess: (data) => {
      const queued = data?.result?.queued || 0;
      const alreadyQueued = data?.result?.alreadyQueued || 0;
      const alreadyConverted = data?.result?.alreadyConverted || 0;
      toast.success(`Queued ${queued} universal MP4 conversion(s). ${alreadyConverted} already device-safe, ${alreadyQueued} already queued.`);
      setSelectedMovies([]);
      setIsSelecting(false);
      queryClient.invalidateQueries(['admin-conversion-queue']);
      queryClient.invalidateQueries(['admin-conversions']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to queue selected conversions');
    }
  });

  const queueAllConversionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/library/conversion-queue/all', {
        encoderPreference
      });
      return response.data;
    },
    onSuccess: (data) => {
      const queued = data?.result?.queued || 0;
      const alreadyConverted = data?.result?.alreadyConverted || 0;
      const alreadyQueued = data?.result?.alreadyQueued || 0;
      toast.success(`Queued ${queued} universal MP4 conversion(s). ${alreadyConverted} already device-safe, ${alreadyQueued} already queued.`);
      queryClient.invalidateQueries(['admin-conversion-queue']);
      queryClient.invalidateQueries(['admin-conversions']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to queue library conversions');
    }
  });

  const pauseConversionQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/library/conversion-queue/pause');
      return response.data;
    },
    onSuccess: () => {
      toast.success('Background conversion will pause after the current file');
      queryClient.invalidateQueries(['admin-conversion-queue']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to pause conversion queue');
    }
  });

  const resumeConversionQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/library/conversion-queue/resume');
      return response.data;
    },
    onSuccess: () => {
      toast.success('Background conversion resumed');
      queryClient.invalidateQueries(['admin-conversion-queue']);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to resume conversion queue');
    }
  });

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('Please select a file to upload');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('movie', selectedFile);

    try {
      await api.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          toast.loading(`Uploading... ${progress}%`, { id: 'upload-progress' });
        }
      });
      
      toast.success('Movie uploaded successfully!');
      setSelectedFile(null);
      refetchMovies();
      
      // Reset file input
      const fileInput = document.getElementById('movie-file');
      if (fileInput) fileInput.value = '';
    } catch (error) {
      toast.error(error.response?.data?.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      toast.dismiss('upload-progress');
    }
  };

  const handleDeleteMovie = (movieId) => {
    const confirmMessage = 
      'Are you sure you want to remove this movie from your library?\n\n' +
      '⚠️  This will ONLY remove the movie from MyFlix.\n' +
      '✅ Your original video file will NOT be deleted.\n' +
      '✅ The file will remain in its original location.\n\n' +
      'Continue?';
      
    if (window.confirm(confirmMessage)) {
      deleteMovieMutation.mutate(movieId);
    }
  };

  const handleEditMovie = (movie) => {
    setEditingMovie({ ...movie });
    setShowEditModal(true);
  };

  const handleUpdateMovie = (e) => {
    e.preventDefault();
    updateMovieMutation.mutate(editingMovie);
  };

  const handleModalInputChange = (field, value) => {
    setEditingMovie(prev => ({ ...prev, [field]: value }));
  };

  const handleToggleSelection = (movieId) => {
    setSelectedMovies(prev => 
      prev.includes(movieId) 
        ? prev.filter(id => id !== movieId)
        : [...prev, movieId]
    );
  };

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedMovies((prev) => prev.filter((id) => !visibleMovieIds.includes(id)));
    } else {
      setSelectedMovies((prev) => Array.from(new Set([...prev, ...visibleMovieIds])));
    }
  };

  const handleManageFilterChange = (filter) => {
    setManageFilter(filter);
    setSelectedMovies([]);
    setIsSelecting(false);
  };

  const handleDeleteSelected = () => {
    if (selectedMovies.length === 0) {
      toast.error('No movies selected');
      return;
    }

    const confirmMessage = 
      `Are you sure you want to remove ${selectedMovies.length} movie(s) from your library?\n\n` +
      '⚠️  This will ONLY remove the movies from MyFlix.\n' +
      '✅ Your original video files will NOT be deleted.\n' +
      '✅ All files will remain in their original locations.\n\n' +
      'Continue?';
      
    if (window.confirm(confirmMessage)) {
      bulkDeleteMutation.mutate(selectedMovies);
    }
  };

  const handleQueueSelectedConversions = () => {
    if (selectedMovies.length === 0) {
      toast.error('No library items selected');
      return;
    }
    queueSelectedConversionMutation.mutate(selectedMovies);
  };

  const handleQueueMovieConversion = (movieId) => {
    queueSelectedConversionMutation.mutate([movieId]);
  };

  const handleCancelSelection = () => {
    setSelectedMovies([]);
    setIsSelecting(false);
  };

  // Clear selection when changing tabs
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab !== 'manage') {
      setSelectedMovies([]);
      setIsSelecting(false);
    }
  };

  const handleScanFolder = async () => {
    if (!scanPath.trim()) {
      toast.error('Please enter a folder path');
      return;
    }

    setIsScanning(true);
    setScanResults(null);
    
    try {
      const response = await api.post('/api/upload/scan-folder', {
        folderPath: scanPath.trim()
      });
      
      // Check if conversion is needed
      if (response.data.needsConversion) {
        setConversionDialog(response.data);
        setScanResults(null);
      } else {
        setScanResults(response.data);
        
        if (response.data.addedMovies > 0) {
          toast.success(`Successfully added ${response.data.addedMovies} new movies!`);
          refetchMovies();
        } else {
          toast.info('No new movies found to add');
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to scan folder');
      setScanResults(null);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConvertFiles = async (filesToConvert, deleteOriginals = true) => {
    setIsConverting(true);
    setConversionProgress({ current: 0, total: filesToConvert.length });
    
    try {
      const response = await api.post('/api/upload/convert-and-add', {
        folderPath: conversionDialog.folderPath,
        filesToConvert,
        deleteOriginals
      });
      
      setConversionProgress(null);
      setConversionDialog(null);
      
      if (response.data.results.converted.length > 0) {
        toast.success(`Successfully converted ${response.data.results.converted.length} files and added ${response.data.results.added} movies!`);
        refetchMovies();
      }
      
      if (response.data.results.failed.length > 0) {
        toast.error(`Failed to convert ${response.data.results.failed.length} files`);
      }
      
    } catch (error) {
      console.error('Conversion error:', error);
      toast.error(error.response?.data?.error || 'Failed to convert files');
      setConversionProgress(null);
    } finally {
      setIsConverting(false);
    }
  };

  const handleSkipConversion = async () => {
    // Just process compatible files
    setIsScanning(true);
    
    try {
      const response = await api.post('/api/upload/scan-folder', {
        folderPath: conversionDialog.folderPath,
        skipIncompatible: true
      });
      
      setScanResults(response.data);
      setConversionDialog(null);
      
      if (response.data.addedMovies > 0) {
        toast.success(`Added ${response.data.addedMovies} compatible movies. ${conversionDialog.incompatibleFiles.length} files skipped.`);
        refetchMovies();
      } else {
        toast.info('No compatible movies found');
      }
    } catch (error) {
      toast.error('Failed to process compatible files');
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddAllFiles = async () => {
    // Add all files regardless of format compatibility
    setIsScanning(true);
    
    try {
      const response = await api.post('/api/upload/scan-folder', {
        folderPath: conversionDialog.folderPath,
        skipFormatCheck: true
      });
      
      setScanResults(response.data);
      setConversionDialog(null);
      
      if (response.data.addedMovies > 0) {
        toast.success(`Added all ${response.data.addedMovies} movies to library!`);
        refetchMovies();
      } else {
        toast.info('No new movies found');
      }
    } catch (error) {
      toast.error('Failed to add files');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <Container>
      <Header>
        <Title>Admin Panel</Title>
        <Subtitle>Manage your movie collection</Subtitle>
      </Header>

      <TabContainer>
        <Tab 
          active={activeTab === 'upload'} 
          onClick={() => handleTabChange('upload')}
        >
          Upload Movies
        </Tab>
        <Tab 
          active={activeTab === 'scan'} 
          onClick={() => handleTabChange('scan')}
        >
          Scan Folder
        </Tab>
        <Tab 
          active={activeTab === 'manage'} 
          onClick={() => handleTabChange('manage')}
        >
          Manage Movies
        </Tab>
        <Tab
          active={activeTab === 'conversions'}
          onClick={() => handleTabChange('conversions')}
        >
          Conversions
        </Tab>
      </TabContainer>

      <Content>
        {activeTab === 'scan' && (
          <div>
            <h2 style={{ color: 'white', marginBottom: '2rem' }}>Scan Movie Folder</h2>
            <p style={{ color: '#b3b3b3', marginBottom: '2rem', lineHeight: '1.6' }}>
              Enter the path to a folder containing your movie files. The system will scan for video files 
              (MP4, AVI, MKV, MOV, etc.) and automatically add them to your library.
            </p>
            
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ 
                color: 'white', 
                display: 'block', 
                marginBottom: '0.5rem',
                fontSize: '1rem',
                fontWeight: '600'
              }}>
                Folder Path:
              </label>
              <input
                type="text"
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
                placeholder="e.g., C:\Movies or /home/user/Movies"
                style={{
                  width: '100%',
                  padding: '1rem',
                  fontSize: '1rem',
                  border: '2px solid #333',
                  borderRadius: '4px',
                  backgroundColor: '#2f2f2f',
                  color: 'white',
                  marginBottom: '1rem'
                }}
              />
              
              {/* Quick folder buttons */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.9rem', color: '#b3b3b3', marginBottom: '0.5rem' }}>Quick select:</div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => setScanPath('C:\\Users\\Public\\Videos')}
                    style={{ 
                      padding: '0.5rem 1rem', 
                      backgroundColor: '#444', 
                      border: 'none', 
                      borderRadius: '4px', 
                      color: 'white', 
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    Public Videos
                  </button>
                  <button 
                    onClick={() => setScanPath('C:\\Movies')}
                    style={{ 
                      padding: '0.5rem 1rem', 
                      backgroundColor: '#444', 
                      border: 'none', 
                      borderRadius: '4px', 
                      color: 'white', 
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    C:\Movies
                  </button>
                  <button 
                    onClick={() => setScanPath('/home/user/Videos')}
                    style={{ 
                      padding: '0.5rem 1rem', 
                      backgroundColor: '#444', 
                      border: 'none', 
                      borderRadius: '4px', 
                      color: 'white', 
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    Linux Videos
                  </button>
                </div>
              </div>
              
              <div style={{ fontSize: '0.9rem', color: '#808080', marginBottom: '2rem' }}>
                <strong>Examples:</strong><br/>
                • Windows: <code>C:\Users\YourName\Videos\Movies</code><br/>
                • Linux/Mac: <code>/home/username/Movies</code><br/>
                • Network: <code>\\server\shared\movies</code>
                <br/><br/>
                <strong>Supported formats:</strong> MP4, AVI, MKV, MOV, WMV, FLV, WebM, M4V, M2TS, TS, VOB
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem', flexWrap: 'wrap' }}>
              <Button 
                variant="primary" 
                onClick={handleScanFolder}
                disabled={isScanning}
              >
                {isScanning ? <LoadingSpinner /> : 'Scan Folder'}
              </Button>
              
              <Button 
                variant="success" 
                onClick={async () => {
                  if (!scanPath.trim()) {
                    toast.error('Please enter a folder path');
                    return;
                  }
                  setIsScanning(true);
                  setScanResults(null);
                  try {
                    const response = await api.post('/api/upload/scan-folder', {
                      folderPath: scanPath.trim(),
                      skipFormatCheck: true
                    });
                    setScanResults(response.data);
                    if (response.data.addedMovies > 0) {
                      toast.success(`Successfully added all ${response.data.addedMovies} movies!`);
                      refetchMovies();
                    } else {
                      toast.info('No new movies found');
                    }
                  } catch (error) {
                    toast.error(error.response?.data?.message || 'Failed to scan folder');
                    setScanResults(null);
                  } finally {
                    setIsScanning(false);
                  }
                }}
                disabled={isScanning}
                style={{ background: '#28a745' }}
              >
                📁 Add All Files (Skip Format Check)
              </Button>
              
              <Button 
                variant="secondary" 
                onClick={async () => {
                  setIsScanning(true);
                  try {
                    const response = await api.post('/api/upload/refresh-omdb');
                    if (response.data.updated > 0) {
                      toast.success(`Refreshed ${response.data.updated} movies with OMDb data!`);
                      refetchMovies();
                    } else {
                      toast.info('All movies are already up to date');
                    }
                  } catch (error) {
                    toast.error(error.response?.data?.error || 'Failed to refresh OMDb data');
                  } finally {
                    setIsScanning(false);
                  }
                }}
                disabled={isScanning}
                style={{ background: '#f39c12' }}
              >
                🎬 Refresh OMDb Data
              </Button>
            </div>

            <div style={{ 
              backgroundColor: '#1a1a1a', 
              padding: '1rem', 
              borderRadius: '4px', 
              marginBottom: '2rem',
              fontSize: '0.85rem',
              color: '#ccc'
            }}>
              <strong>📋 Scan Options:</strong>
              <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', lineHeight: '1.4' }}>
                <li><strong>Scan Folder:</strong> Checks format compatibility, downloads OMDb posters/metadata, shows conversion options</li>
                <li><strong>Add All Files:</strong> Skips format checking, gets OMDb data, and adds all video files directly</li>
                <li><strong>Refresh OMDb:</strong> Updates existing movies with professional posters and metadata from IMDb</li>
              </ul>
            </div>

            {/* Scan Results */}
            {scanResults && (
              <div style={{ 
                backgroundColor: '#2f2f2f', 
                padding: '2rem', 
                borderRadius: '8px', 
                border: '1px solid #444' 
              }}>
                <h3 style={{ color: 'white', marginBottom: '1rem', fontSize: '1.2rem' }}>
                  Scan Results
                </h3>
                <div style={{ color: '#b3b3b3', fontSize: '1rem' }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    📁 <strong>Scanned folder:</strong> <code>{scanResults.folderPath}</code>
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    🎬 <strong>Video files found:</strong> {scanResults.totalFiles}
                  </div>
                  <div style={{ marginBottom: '0.5rem', color: '#46d369' }}>
                    ✅ <strong>Movies added:</strong> {scanResults.addedMovies}
                  </div>
                  {scanResults.skippedMovies > 0 && (
                    <div style={{ marginBottom: '0.5rem', color: '#ffa500' }}>
                      ⏭️ <strong>Movies skipped:</strong> {scanResults.skippedMovies} (already in library)
                    </div>
                  )}
                  
                  {scanResults.processedFiles && scanResults.processedFiles.length > 0 && (
                    <details style={{ marginTop: '1rem' }}>
                      <summary style={{ 
                        color: 'white', 
                        cursor: 'pointer', 
                        marginBottom: '0.5rem',
                        fontSize: '0.9rem'
                      }}>
                        📋 Show processed files ({scanResults.processedFiles.length})
                      </summary>
                      <div style={{ 
                        maxHeight: '200px', 
                        overflowY: 'auto', 
                        backgroundColor: '#1a1a1a', 
                        padding: '1rem', 
                        borderRadius: '4px',
                        fontSize: '0.8rem'
                      }}>
                        {scanResults.processedFiles.map((file, index) => (
                          <div key={index} style={{ marginBottom: '0.3rem' }}>
                            <code style={{ color: '#888' }}>{file.name}</code>
                            <br/>
                            <span style={{ color: '#b3b3b3' }}>→ {file.title}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
                
                {scanResults.addedMovies > 0 && (
                  <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                    <button 
                      onClick={() => handleTabChange('manage')}
                      style={{ 
                        padding: '0.75rem 1.5rem', 
                        backgroundColor: '#e50914', 
                        border: 'none', 
                        borderRadius: '4px', 
                        color: 'white', 
                        cursor: 'pointer',
                        fontSize: '1rem'
                      }}
                    >
                      View Added Movies
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'upload' && (
          <div>
            <UploadSection>
              <UploadIcon />
              <UploadText>
                {selectedFile ? selectedFile.name : 'Choose a movie file to upload (MP4, AVI, MKV, MOV, etc.)'}
              </UploadText>
              <UploadButton htmlFor="movie-file">
                <FiPlus /> Select Movie File
              </UploadButton>
              <FileInput
                id="movie-file"
                type="file"
                accept=".mp4,.avi,.mkv,.mov,.wmv,.flv,.webm,.m4v,video/*"
                onChange={handleFileSelect}
              />
            </UploadSection>

            {selectedFile && (
              <div style={{ textAlign: 'center' }}>
                <Button 
                  variant="primary" 
                  onClick={handleUpload}
                  disabled={isUploading}
                >
                  {isUploading ? <LoadingSpinner /> : 'Upload Movie'}
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'manage' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
              <h2 style={{ color: 'white', fontSize: '1.5rem', margin: 0 }}>
                Manage Library ({visibleMovies.length})
                {isSelecting && selectedMovies.length > 0 && (
                  <span style={{ color: '#e50914', fontSize: '1rem', marginLeft: '0.5rem' }}>
                    - {visibleSelectedCount} selected
                  </span>
                )}
              </h2>
              
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!isSelecting ? (
                  <SelectionButton 
                    variant="secondary" 
                    onClick={() => setIsSelecting(true)}
                  >
                    <FiCheckSquare /> Select Movies
                  </SelectionButton>
                ) : (
                  <SelectionButton 
                    variant="secondary" 
                    onClick={handleCancelSelection}
                  >
                    <FiX /> Cancel Selection
                  </SelectionButton>
                )}
              </div>
            </div>

            <ManageFilterBar>
              <ManageFilterButton
                active={manageFilter === 'movies'}
                onClick={() => handleManageFilterChange('movies')}
              >
                Movies ({movieItems.length})
              </ManageFilterButton>
              <ManageFilterButton
                active={manageFilter === 'episodes'}
                onClick={() => handleManageFilterChange('episodes')}
              >
                Episodes ({episodeItems.length})
              </ManageFilterButton>
              <ManageFilterButton
                active={manageFilter === 'all'}
                onClick={() => handleManageFilterChange('all')}
              >
                All ({movies.length})
              </ManageFilterButton>
            </ManageFilterBar>

            {isSelecting && (
              <SelectionControls>
                <SelectionButton onClick={handleSelectAll}>
                  {allVisibleSelected ? <FiSquare /> : <FiCheckSquare />}
                  {allVisibleSelected ? 'Deselect All' : 'Select All'}
                </SelectionButton>
                
                <span style={{ color: '#b3b3b3', fontSize: '0.9rem' }}>
                  {visibleSelectedCount} of {visibleMovies.length} selected
                </span>
                
                <div style={{ marginLeft: 'auto' }}>
                  <SelectionButton
                    variant="primary"
                    onClick={handleQueueSelectedConversions}
                    disabled={selectedMovies.length === 0 || queueSelectedConversionMutation.isLoading}
                    title="Queue selected items for universal MP4 conversion"
                  >
                    <FiCpu /> Convert Selected ({selectedMovies.length})
                  </SelectionButton>
                  <SelectionButton 
                    variant="danger" 
                    onClick={handleDeleteSelected}
                    disabled={selectedMovies.length === 0}
                    style={{ marginLeft: '0.5rem' }}
                  >
                    <FiTrash2 /> Remove Selected ({selectedMovies.length})
                  </SelectionButton>
                </div>
              </SelectionControls>
            )}

            {moviesLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <LoadingSpinner />
              </div>
            ) : visibleMovies.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>
                No items found in this view.
              </div>
            ) : (
              <MovieGrid>
                {visibleMovies.map((movie) => (
                  <MovieCard
                    key={movie.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    selected={selectedMovies.includes(movie.id)}
                  >
                    {isSelecting && (
                      <MovieCheckbox 
                        checked={selectedMovies.includes(movie.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelection(movie.id);
                        }}
                      >
                        {selectedMovies.includes(movie.id) ? <FiCheck /> : null}
                      </MovieCheckbox>
                    )}
                    
                    <MovieImage>
                      {movie.thumbnail ? (
                        <img src={movie.thumbnail} alt={movie.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        'No Thumbnail'
                      )}
                    </MovieImage>
                    <MovieInfo>
                      <MovieTitle>{movie.title}</MovieTitle>
                      <MovieMeta>{buildPrimaryMeta(movie)}</MovieMeta>
                      {buildSecondaryMeta(movie) && (
                        <MovieMeta>{buildSecondaryMeta(movie)}</MovieMeta>
                      )}
                      
                      {!isSelecting && (
                        <MovieActions>
                          <ActionButton
                            onClick={() => handleQueueMovieConversion(movie.id)}
                            title="Queue universal MP4 conversion"
                          >
                            <FiCpu />
                          </ActionButton>
                          <ActionButton 
                            onClick={() => handleEditMovie(movie)}
                            title="Edit movie details"
                          >
                            <FiEdit />
                          </ActionButton>
                          <ActionButton 
                            variant="danger" 
                            onClick={() => handleDeleteMovie(movie.id)}
                            title="Remove from library (keeps original file)"
                          >
                            <FiTrash2 />
                          </ActionButton>
                        </MovieActions>
                      )}
                    </MovieInfo>
                  </MovieCard>
                ))}
              </MovieGrid>
            )}
          </div>
        )}

        {activeTab === 'conversions' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '2rem' }}>
              <div>
                <h2 style={{ color: 'white', fontSize: '1.5rem', margin: 0 }}>
                  Conversion History
                </h2>
                <p style={{ color: '#b3b3b3', marginTop: '0.5rem' }}>
                  Files converted into device-safe H.264/AAC MP4 and what happened to their originals.
                </p>
              </div>
              <SelectionButton
                variant="secondary"
                onClick={() => {
                  refetchConversions();
                  refetchConversionQueue();
                }}
                disabled={conversionsLoading || conversionQueueLoading}
              >
                <FiRefreshCw /> Refresh
              </SelectionButton>
            </div>

            <div style={{
              background: '#222',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ color: 'white', margin: 0 }}>Background Conversion Queue</h3>
                  <p style={{ color: '#999', marginTop: '0.35rem', marginBottom: 0 }}>
                    Converts library files to seekable H.264/AAC MP4 in the background until the queue is empty. Pause stops after the current file.
                  </p>
                </div>
                <div style={{ color: conversionQueue?.capabilities?.h264Nvenc ? '#46d369' : '#f5c542', fontWeight: 700 }}>
                  GPU: {conversionQueue?.capabilities?.h264Nvenc ? 'h264_nvenc available' : 'not available'}
                </div>
              </div>

              <ManageFilterBar>
                {['auto', 'gpu', 'cpu'].map((mode) => (
                  <ManageFilterButton
                    key={mode}
                    active={encoderPreference === mode}
                    onClick={() => setEncoderPreference(mode)}
                    title={mode === 'auto' ? 'Use GPU when available, otherwise CPU' : `Use ${mode.toUpperCase()} encoding preference`}
                  >
                    {mode.toUpperCase()}
                  </ManageFilterButton>
                ))}
              </ManageFilterBar>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '1rem',
                marginBottom: '1rem'
              }}>
                {[
                  ['Queued', conversionQueue?.counts?.queued || 0],
                  ['Running', conversionQueue?.counts?.running || 0],
                  ['Completed', conversionQueue?.counts?.completed || 0],
                  ['Failed', conversionQueue?.counts?.failed || 0],
                  ['Skipped', conversionQueue?.counts?.skipped || 0]
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '6px',
                      padding: '0.85rem'
                    }}
                  >
                    <div style={{ color: '#999', fontSize: '0.8rem' }}>{label}</div>
                    <div style={{ color: 'white', fontSize: '1.35rem', fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>

              {conversionQueue?.active && (
                <div style={{
                  background: '#151515',
                  border: '1px solid #333',
                  borderRadius: '6px',
                  padding: '0.85rem',
                  marginBottom: '1rem',
                  color: '#ddd'
                }}>
                  <strong>Now converting:</strong> {conversionQueue.active.title}
                  <div style={{ marginTop: '0.5rem', height: '8px', background: '#333', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: formatPercent(conversionQueue.active.progress_percent),
                      background: '#e50914'
                    }} />
                  </div>
                  <div style={{ color: '#999', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                    {formatPercent(conversionQueue.active.progress_percent)}
                    {conversionQueue.active.speed ? ` - ${conversionQueue.active.speed}` : ''}
                    {conversionQueue.active.encoder_used ? ` - ${conversionQueue.active.encoder_used}` : ''}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <SelectionButton
                  variant="primary"
                  onClick={() => queueAllConversionMutation.mutate()}
                  disabled={queueAllConversionMutation.isLoading}
                >
                  <FiCpu /> Convert All to Universal MP4
                </SelectionButton>
                {conversionQueue?.paused ? (
                  <SelectionButton
                    variant="secondary"
                    onClick={() => resumeConversionQueueMutation.mutate()}
                    disabled={resumeConversionQueueMutation.isLoading}
                  >
                    <FiPlay /> Resume Queue
                  </SelectionButton>
                ) : (
                  <SelectionButton
                    variant="secondary"
                    onClick={() => pauseConversionQueueMutation.mutate()}
                    disabled={pauseConversionQueueMutation.isLoading}
                  >
                    <FiPause /> Pause Queue
                  </SelectionButton>
                )}
              </div>
            </div>

            {conversionQueue?.jobs?.length > 0 && (
              <div style={{ overflowX: 'auto', border: '1px solid #333', borderRadius: '8px', marginBottom: '2rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                  <thead>
                    <tr style={{ background: '#222', color: '#b3b3b3', textAlign: 'left' }}>
                      <th style={{ padding: '0.9rem' }}>Queued File</th>
                      <th style={{ padding: '0.9rem' }}>Status</th>
                      <th style={{ padding: '0.9rem' }}>Encoder</th>
                      <th style={{ padding: '0.9rem' }}>Progress</th>
                      <th style={{ padding: '0.9rem' }}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversionQueue.jobs.slice(0, 12).map((job) => {
                      const status = queueStatusStyle(job.status);
                      return (
                        <tr key={job.id} style={{ borderTop: '1px solid #333', color: '#ddd', verticalAlign: 'top' }}>
                          <td style={{ padding: '0.9rem', fontWeight: 600 }}>
                            {job.title || `Movie ${job.movie_id}`}
                            <div style={{ color: '#777', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                              ID {job.movie_id} - {job.source_path || '-'}
                            </div>
                          </td>
                          <td style={{ padding: '0.9rem' }}>
                            <span style={{ color: status.color, fontWeight: 700 }}>{status.label}</span>
                            {(job.error || job.reason) && (
                              <div style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                {job.error || job.reason}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.9rem', color: '#b3b3b3' }}>
                            <div>{job.encoder_used || job.encoder_preference || 'auto'}</div>
                            <div style={{ color: '#777', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                              Preference: {job.encoder_preference || 'auto'}
                            </div>
                          </td>
                          <td style={{ padding: '0.9rem', color: '#b3b3b3' }}>
                            <div>{formatPercent(job.progress_percent)}</div>
                            <div style={{ color: '#777', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                              {job.speed || ''}{job.fps ? ` ${job.fps} fps` : ''}
                            </div>
                          </td>
                          <td style={{ padding: '0.9rem', color: '#b3b3b3' }}>
                            {formatDateTime(job.updated_at || job.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {conversionsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <LoadingSpinner />
              </div>
            ) : (
              <>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                  marginBottom: '2rem'
                }}>
                  {[
                    ['Total records', conversionData?.totals?.total || 0],
                    ['Originals deleted', conversionData?.totals?.originalsDeleted || 0],
                    ['Originals kept', conversionData?.totals?.originalsKept || 0],
                    ['Converted size', formatBytes(conversionData?.totals?.convertedBytes)]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        background: '#222',
                        border: '1px solid #333',
                        borderRadius: '8px',
                        padding: '1rem'
                      }}
                    >
                      <div style={{ color: '#999', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{label}</div>
                      <div style={{ color: 'white', fontSize: '1.5rem', fontWeight: 700 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {!conversionData?.conversions?.length ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: '#999', background: '#222', borderRadius: '8px' }}>
                    No conversions recorded yet. Queue universal MP4 conversion and completed files will appear here.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid #333', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '980px' }}>
                      <thead>
                        <tr style={{ background: '#222', color: '#b3b3b3', textAlign: 'left' }}>
                          <th style={{ padding: '0.9rem' }}>Title</th>
                          <th style={{ padding: '0.9rem' }}>Status</th>
                          <th style={{ padding: '0.9rem' }}>Codecs</th>
                          <th style={{ padding: '0.9rem' }}>Size</th>
                          <th style={{ padding: '0.9rem' }}>Updated</th>
                          <th style={{ padding: '0.9rem' }}>Paths</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conversionData.conversions.map((item) => {
                          const status = conversionStatusStyle(item.status);
                          return (
                            <tr key={item.id} style={{ borderTop: '1px solid #333', color: '#ddd', verticalAlign: 'top' }}>
                              <td style={{ padding: '0.9rem', fontWeight: 600 }}>
                                {item.title || `Movie ${item.movie_id}`}
                                <div style={{ color: '#777', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                  ID {item.movie_id || '-'}
                                </div>
                              </td>
                              <td style={{ padding: '0.9rem' }}>
                                <span style={{ color: status.color, fontWeight: 700 }}>{status.label}</span>
                                {item.reason && (
                                  <div style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                    {item.reason}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '0.9rem', color: '#b3b3b3' }}>
                                <div>{item.video_codec || 'unknown'} / {item.audio_codec || 'unknown'}</div>
                                <div style={{ color: '#777', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                  {item.audio_tracks || 0} audio, {item.subtitle_tracks || 0} subtitles
                                </div>
                              </td>
                              <td style={{ padding: '0.9rem', color: '#b3b3b3' }}>
                                <div>Original: {formatBytes(item.source_size)}</div>
                                <div>MP4: {formatBytes(item.replacement_size)}</div>
                              </td>
                              <td style={{ padding: '0.9rem', color: '#b3b3b3' }}>
                                {formatDateTime(item.updated_at || item.created_at)}
                              </td>
                              <td style={{ padding: '0.9rem', color: '#aaa', fontSize: '0.8rem', lineHeight: 1.5 }}>
                                <div><strong>Current:</strong> <code>{item.current_video_path || item.replacement_path || item.prepared_path || '-'}</code></div>
                                <div><strong>Original:</strong> <code>{item.source_path || '-'}</code></div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Content>

      {/* Edit Movie Modal */}
      <AnimatePresence>
        {showEditModal && editingMovie && (
          <Modal
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowEditModal(false)}
          >
            <ModalContent
              initial={{ scale: 0.8, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: 50 }}
              onClick={(e) => e.stopPropagation()}
            >
              <ModalHeader>
                <ModalTitle>Edit Movie</ModalTitle>
                <CloseButton onClick={() => setShowEditModal(false)}>
                  <FiX />
                </CloseButton>
              </ModalHeader>

              <form onSubmit={handleUpdateMovie}>
                <FormGroup>
                  <Label>Title</Label>
                  <Input
                    type="text"
                    value={editingMovie.title || ''}
                    onChange={(e) => handleModalInputChange('title', e.target.value)}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Description</Label>
                  <TextArea
                    value={editingMovie.description || ''}
                    onChange={(e) => handleModalInputChange('description', e.target.value)}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Genre</Label>
                  <Input
                    type="text"
                    value={editingMovie.genre || ''}
                    onChange={(e) => handleModalInputChange('genre', e.target.value)}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Release Year</Label>
                  <Input
                    type="number"
                    value={editingMovie.release_year || ''}
                    onChange={(e) => handleModalInputChange('release_year', e.target.value)}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Rating</Label>
                  <Input
                    type="text"
                    value={editingMovie.rating || ''}
                    onChange={(e) => handleModalInputChange('rating', e.target.value)}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Director</Label>
                  <Input
                    type="text"
                    value={editingMovie.director || ''}
                    onChange={(e) => handleModalInputChange('director', e.target.value)}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Cast</Label>
                  <Input
                    type="text"
                    value={editingMovie.cast || ''}
                    onChange={(e) => handleModalInputChange('cast', e.target.value)}
                  />
                </FormGroup>

                <ButtonGroup>
                  <Button type="button" onClick={() => setShowEditModal(false)}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    variant="primary"
                    disabled={updateMovieMutation.isLoading}
                  >
                    {updateMovieMutation.isLoading ? <LoadingSpinner /> : 'Update Movie'}
                  </Button>
                </ButtonGroup>
              </form>
            </ModalContent>
          </Modal>
        )}

        {/* Conversion Dialog */}
        {conversionDialog && (
          <Modal
            as={motion.div}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ zIndex: 9999 }}
          >
            <ModalContent
              as={motion.div}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              style={{ maxWidth: '600px', maxHeight: '80vh', overflow: 'auto' }}
            >
              <ModalHeader>
                <h2 style={{ color: '#e50914', marginBottom: '0.5rem' }}>
                  ⚠️ Incompatible Video Formats Detected
                </h2>
                <p style={{ color: '#ccc', fontSize: '0.9rem' }}>
                  Found {conversionDialog.incompatibleFiles.length} files that may not play in all browsers
                </p>
              </ModalHeader>

              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#fff', marginBottom: '1rem' }}>Incompatible Files:</h3>
                <div style={{ maxHeight: '200px', overflow: 'auto', background: '#1a1a1a', padding: '1rem', borderRadius: '4px' }}>
                  {conversionDialog.incompatibleFiles.map((file, index) => (
                    <div key={index} style={{ 
                      marginBottom: '0.5rem', 
                      padding: '0.5rem',
                      background: '#2a2a2a',
                      borderRadius: '4px',
                      fontSize: '0.85rem'
                    }}>
                      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '0.2rem' }}>
                        📁 {file.fileName}
                      </div>
                      <div style={{ color: '#ff9500' }}>
                        Format: {file.format.toUpperCase()} • Size: {file.fileSizeMB} MB
                      </div>
                      <div style={{ color: '#ccc', fontSize: '0.8rem' }}>
                        {file.recommendation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {isConverting && (
                <div style={{ 
                  background: '#1a1a1a', 
                  padding: '1rem', 
                  borderRadius: '4px', 
                  marginBottom: '1rem',
                  textAlign: 'center'
                }}>
                  <div style={{ color: '#e50914', marginBottom: '0.5rem' }}>
                    🔄 Converting files to MP4...
                  </div>
                  <div style={{ color: '#ccc', fontSize: '0.9rem' }}>
                    This may take several minutes depending on file sizes.
                  </div>
                  {conversionProgress && (
                    <div style={{ marginTop: '0.5rem', color: '#fff' }}>
                      Progress: {conversionProgress.current} / {conversionProgress.total}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setConversionDialog(null)}
                  disabled={isConverting}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'transparent',
                    border: '1px solid #666',
                    color: '#ccc',
                    borderRadius: '4px',
                    cursor: isConverting ? 'not-allowed' : 'pointer',
                    opacity: isConverting ? 0.5 : 1
                  }}
                >
                  Cancel
                </button>
                
                <button
                  type="button"
                  onClick={handleSkipConversion}
                  disabled={isConverting}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#333',
                    border: '1px solid #666',
                    color: '#fff',
                    borderRadius: '4px',
                    cursor: isConverting ? 'not-allowed' : 'pointer',
                    opacity: isConverting ? 0.5 : 1
                  }}
                >
                  Skip & Add Compatible Only
                </button>
                
                <button
                  type="button"
                  onClick={handleAddAllFiles}
                  disabled={isConverting}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#28a745',
                    border: 'none',
                    color: 'white',
                    borderRadius: '4px',
                    cursor: isConverting ? 'not-allowed' : 'pointer',
                    opacity: isConverting ? 0.5 : 1
                  }}
                >
                  📁 Add All Files (Skip Format Check)
                </button>
                
                <button
                  type="button"
                  onClick={() => handleConvertFiles(
                    conversionDialog.incompatibleFiles.map(f => f.fileName),
                    true
                  )}
                  disabled={isConverting}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#e50914',
                    border: 'none',
                    color: 'white',
                    borderRadius: '4px',
                    cursor: isConverting ? 'not-allowed' : 'pointer',
                    opacity: isConverting ? 0.5 : 1
                  }}
                >
                  {isConverting ? '🔄 Converting...' : '🔄 Convert to MP4 & Delete Originals'}
                </button>
              </div>

              <div style={{ 
                marginTop: '1rem', 
                padding: '0.75rem',
                background: '#1a1a1a',
                borderRadius: '4px',
                fontSize: '0.8rem',
                color: '#ccc'
              }}>
                <strong>Options:</strong>
                <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                  <li><strong>Convert:</strong> Creates MP4 files with H.264 codec for maximum compatibility. Deletes originals.</li>
                  <li><strong>Skip Compatible:</strong> Only adds files that should work in most browsers.</li>
                  <li><strong>Add All:</strong> Adds all files regardless of format - some may not play in all browsers.</li>
                </ul>
              </div>
                         </ModalContent>
           </Modal>
         )}
      </AnimatePresence>
    </Container>
  );
};

export default Admin;
