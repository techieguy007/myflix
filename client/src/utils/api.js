import axios from 'axios';
import toast from 'react-hot-toast';

// Create axios instance
const api = axios.create({
  baseURL: process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000',
  timeout: 30000, // 30 seconds timeout
});

const makeRequestId = () => {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const responseHeader = (headers, name) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] || headers[name.toLowerCase()] || null;
};

const apiRequestSummary = (config = {}) => ({
  requestId: config.metadata?.requestId,
  method: (config.method || 'get').toUpperCase(),
  url: `${config.baseURL || ''}${config.url || ''}`,
  durationMs: config.metadata?.startedAt ? Date.now() - config.metadata.startedAt : null
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const requestId = makeRequestId();
    config.metadata = {
      ...(config.metadata || {}),
      requestId,
      startedAt: Date.now()
    };
    config.headers = config.headers || {};
    config.headers['X-Request-Id'] = config.headers['X-Request-Id'] || requestId;

    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const serverRequestId = responseHeader(error.response?.headers, 'x-request-id');
    const summary = {
      ...apiRequestSummary(error.config),
      requestId: serverRequestId || error.config?.metadata?.requestId,
      status: error.response?.status || null,
      message: error.message,
      response: error.response?.data || null
    };
    console.error('[MyFlix API error]', summary);

    if (error.response) {
      const { status, data } = error.response;
      
      switch (status) {
        case 401:
          // Unauthorized - redirect to login
          localStorage.removeItem('authToken');
          if (window.location.pathname !== '/login') {
            toast.error('Session expired. Please login again.');
            window.location.href = '/login';
          }
          break;
          
        case 403:
          toast.error('Access denied');
          break;
          
        case 404:
          toast.error('Resource not found');
          break;
          
        case 429:
          toast.error('Too many requests. Please slow down.');
          break;
          
        case 500:
          toast.error('Server error. Please try again later.');
          break;
          
        default:
          if (data?.error) {
            toast.error(data.error);
          } else {
            toast.error('An unexpected error occurred');
          }
      }
    } else if (error.request) {
      // Network error
      toast.error('Network error. Please check your connection.');
    } else {
      // Other errors
      toast.error('An unexpected error occurred');
    }
    
    return Promise.reject(error);
  }
);

export default api;
