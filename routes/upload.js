const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffprobe = require('ffprobe');
const ffprobeStatic = require('ffprobe-static');
const axios = require('axios');
const db = require('../database/init');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Set ffprobe path
ffprobe.FFPROBE_PATH = ffprobeStatic.path;
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Format compatibility detection
const getBrowserCompatibility = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  
  // Only flag formats that are definitely problematic
  const knownProblematicFormats = ['.mkv', '.avi', '.wmv', '.flv'];
  
  // Check if this specific file might have codec issues (HEVC, etc.)
  const hasProblematicCodec = fileName.toLowerCase().includes('hevc') || 
                              fileName.toLowerCase().includes('h.265') ||
                              fileName.toLowerCase().includes('x265');
  
  const needsConversion = knownProblematicFormats.includes(ext) || hasProblematicCodec;
  const isCompatible = !needsConversion;
  
  return {
    isCompatible,
    needsConversion,
    format: ext,
    fileName,
    recommendation: isCompatible 
      ? 'Compatible - should work in most browsers' 
      : needsConversion 
        ? 'Likely needs conversion for optimal browser support'
        : 'Unknown format - may need testing'
  };
};

// Convert video to MP4 format
const convertToMP4 = (inputPath, outputPath, onProgress = null) => {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOptions([
        '-preset medium',
        '-crf 23',
        '-maxrate 5000k',
        '-bufsize 10000k',
        '-b:a 192k',
        '-ac 2',
        '-movflags +faststart'
      ])
      .on('progress', (progress) => {
        if (onProgress) {
          onProgress(progress);
        }
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Conversion error:', err);
        reject(err);
      })
      .save(outputPath);
  });
};

// OMDb API integration
const OMDB_API_KEY = 'bfee0a16';
const OMDB_BASE_URL = 'http://www.omdbapi.com/';

const searchOMDbMovie = async (title, year = null) => {
  try {
    // Clean up title for better search results
    const cleanTitle = title
      .replace(/[\[\](){}]/g, '') // Remove brackets and parentheses
      .replace(/\b(1080p|720p|480p|4K|BluRay|BRRip|DVDRip|WEBRip|HDTV|x264|x265|HEVC|AAC|AC3|DTS)\b/gi, '') // Remove quality indicators
      .replace(/\b\d{4}\b/g, '') // Remove years
      .replace(/[._-]/g, ' ') // Replace dots, underscores, dashes with spaces
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
    
    const params = {
      apikey: OMDB_API_KEY,
      t: cleanTitle,
      type: 'movie',
      plot: 'full'
    };
    
    if (year) {
      params.y = year;
    }
    
    const response = await axios.get(OMDB_BASE_URL, { params, timeout: 10000 });
    
    if (response.data && response.data.Response === 'True') {
      return {
        title: response.data.Title,
        year: parseInt(response.data.Year),
        genre: response.data.Genre,
        director: response.data.Director,
        actors: response.data.Actors,
        plot: response.data.Plot,
        poster: response.data.Poster !== 'N/A' ? response.data.Poster : null,
        imdbRating: response.data.imdbRating !== 'N/A' ? parseFloat(response.data.imdbRating) : null,
        imdbID: response.data.imdbID,
        runtime: response.data.Runtime !== 'N/A' ? response.data.Runtime : null,
        rated: response.data.Rated !== 'N/A' ? response.data.Rated : null,
        country: response.data.Country,
        language: response.data.Language,
        awards: response.data.Awards !== 'N/A' ? response.data.Awards : null
      };
    } else {
      return null;
    }
  } catch (error) {
    console.error('OMDb API error:', error.message);
    return null;
  }
};

const downloadPoster = async (posterUrl, outputPath) => {
  try {
    const response = await axios({
      method: 'get',
      url: posterUrl,
      responseType: 'stream',
      timeout: 30000
    });
    
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        resolve(outputPath);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Poster download error:', error.message);
    return null;
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'movies';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter for video files
const fileFilter = (req, file, cb) => {
  const allowedTypes = /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i;
  if (allowedTypes.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Supported formats: MP4, AVI, MKV, MOV, WMV, FLV, WEBM, M4V'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024 // 10GB max file size
  },
  fileFilter: fileFilter
});

// Extract video metadata using ffprobe
const extractVideoMetadata = async (videoPath) => {
  try {
    // Validate input path
    if (!videoPath || typeof videoPath !== 'string') {
      throw new Error('Invalid video path provided');
    }
    
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // Simple fallback approach - just get basic file info
    const stats = fs.statSync(videoPath);
    return {
      duration: 0, // Will be detected by browser
      fileSize: stats.size,
      format: path.extname(videoPath).substring(1).toLowerCase(),
      resolution: null,
      bitrate: null,
      codec: null,
      subtitles: [] // Will be detected by browser
    };
  } catch (error) {
    console.error('Metadata extraction error:', error);
    // Fallback: return basic file information
    const fallbackData = {
      duration: 0,
      fileSize: 0,
      format: 'unknown',
      resolution: null,
      bitrate: null,
      codec: null,
      subtitles: []
    };
    
    try {
      if (videoPath && fs.existsSync(videoPath)) {
        fallbackData.fileSize = fs.statSync(videoPath).size;
        fallbackData.format = path.extname(videoPath).substring(1).toLowerCase();
      }
    } catch (statError) {
      console.error('Error getting file stats:', statError);
    }
    
    return fallbackData;
  }
};

// Generate thumbnail from video with robust error handling
const generateThumbnail = (videoPath, outputPath) => {
  return new Promise((resolve) => {
    // Multiple fallback strategies for thumbnail generation
    const strategies = [
      { timemarks: ['10%'], options: [] },
      { timemarks: ['5%'], options: [] },
      { timemarks: ['00:00:05'], options: [] },
      { timemarks: ['00:00:01'], options: ['-vf', 'scale=320:240'] }
    ];
    
    let currentStrategy = 0;
    
    function tryStrategy() {
      if (currentStrategy >= strategies.length) {
        resolve(null);
        return;
      }
      
      const strategy = strategies[currentStrategy];
      
      const command = ffmpeg(videoPath)
        .inputOptions(['-hide_banner', '-loglevel', 'error'])
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          timemarks: strategy.timemarks,
          size: '320x240'
        })
        .on('end', () => {
          resolve(outputPath);
        })
        .on('error', (err) => {
          currentStrategy++;
          if (currentStrategy < strategies.length) {
            setTimeout(tryStrategy, 100);
          } else {
            resolve(null);
          }
        });
        
      // Apply additional options if specified
      if (strategy.options.length > 0) {
        command.outputOptions(strategy.options);
      }
    }
    
    tryStrategy();
  });
};

// Upload movie file
router.post('/', authenticateToken, requireAdmin, upload.single('movie'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No movie file provided' });
    }

    const {
      title,
      description,
      genre,
      release_year,
      rating,
      director,
      cast
    } = req.body;

    // Auto-generate title from filename if not provided
    let movieTitle = title;
    if (!movieTitle) {
      movieTitle = path.basename(req.file.originalname, path.extname(req.file.originalname))
        .replace(/[._-]/g, ' ')  // Replace dots, underscores, dashes with spaces
        .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
        .trim();                 // Remove leading/trailing spaces
    }

    const videoPath = req.file.path;
    
    // Extract video metadata
    const metadata = await extractVideoMetadata(videoPath);

    // Generate thumbnail
    const thumbnailDir = 'thumbnails';
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }
    
    const thumbnailPath = path.join(thumbnailDir, `${req.file.filename}-thumb.jpg`);
    const generatedThumbnail = await generateThumbnail(videoPath, thumbnailPath);

    // Save movie to database
    const result = await db.run(`
      INSERT INTO movies (
        title, description, genre, release_year, rating, director, cast,
        video_path, thumbnail, duration, file_size, format, resolution,
        uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      movieTitle,
      description || null,
      genre || null,
      release_year ? parseInt(release_year) : null,
      rating ? parseFloat(rating) : null,
      director || null,
      cast || null,
      videoPath,
      generatedThumbnail,
      metadata.duration,
      metadata.fileSize,
      metadata.format,
      metadata.resolution,
      req.user.userId
    ]);

    res.status(201).json({
      message: 'Movie uploaded successfully',
      movie: {
        id: result.id,
        title: movieTitle,
        description,
        genre,
        release_year,
        rating,
        director,
        cast,
        duration: metadata.duration,
        fileSize: metadata.fileSize,
        format: metadata.format,
        resolution: metadata.resolution,
        thumbnail: generatedThumbnail
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up files on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('File cleanup error:', cleanupError);
      }
    }

    res.status(500).json({ error: 'Upload failed' });
  }
});

// Upload thumbnail separately
router.post('/:id/thumbnail', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const movieId = req.params.id;
    
    // Check if movie exists
    const movie = await db.get('SELECT id, thumbnail FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Configure multer for thumbnail uploads
    const thumbnailUpload = multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          const thumbnailDir = 'thumbnails';
          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }
          cb(null, thumbnailDir);
        },
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, `movie-${movieId}-thumb-${Date.now()}${ext}`);
        }
      }),
      limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = /\.(jpg|jpeg|png|gif|webp)$/i;
        if (allowedTypes.test(path.extname(file.originalname))) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type. Only image files are allowed.'), false);
        }
      }
    }).single('thumbnail');

    thumbnailUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No thumbnail file provided' });
      }

      const newThumbnailPath = req.file.path;

      // Update movie record
      await db.run('UPDATE movies SET thumbnail = ? WHERE id = ?', [newThumbnailPath, movieId]);

      // Clean up old thumbnail
      if (movie.thumbnail && fs.existsSync(movie.thumbnail)) {
        try {
          fs.unlinkSync(movie.thumbnail);
        } catch (cleanupError) {
          console.error('Old thumbnail cleanup error:', cleanupError);
        }
      }

      res.json({
        message: 'Thumbnail updated successfully',
        thumbnail: newThumbnailPath
      });
    });

  } catch (error) {
    console.error('Thumbnail upload error:', error);
    res.status(500).json({ error: 'Thumbnail upload failed' });
  }
});

// Get upload progress (for chunked uploads - basic implementation)
router.get('/progress/:id', authenticateToken, requireAdmin, (req, res) => {
  // This would typically track upload progress for large files
  // For now, return a simple response
  res.json({
    id: req.params.id,
    progress: 100,
    status: 'completed',
    message: 'Upload progress tracking not implemented yet'
  });
});

// Bulk upload endpoint (for multiple files)
router.post('/bulk', authenticateToken, requireAdmin, upload.array('movies', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No movie files provided' });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const movieData = req.body.movies ? JSON.parse(req.body.movies)[i] : {};

      try {
        const title = movieData.title || path.basename(file.originalname, path.extname(file.originalname));
        const videoPath = file.path;
        
        // Extract metadata
        const metadata = await extractVideoMetadata(videoPath);

        // Generate thumbnail
        const thumbnailDir = 'thumbnails';
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true });
        }
        
        const thumbnailPath = path.join(thumbnailDir, `${file.filename}-thumb.jpg`);
        const generatedThumbnail = await generateThumbnail(videoPath, thumbnailPath);

        // Auto-generate title from filename if not provided
        const movieTitle = title || path.basename(file.originalname, path.extname(file.originalname))
          .replace(/[._-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Save to database
        const result = await db.run(`
          INSERT INTO movies (
            title, description, genre, release_year, rating, director, cast,
            video_path, thumbnail, duration, file_size, format, resolution,
            uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          movieTitle,
          movieData.description || null,
          movieData.genre || null,
          movieData.release_year ? parseInt(movieData.release_year) : null,
          movieData.rating ? parseFloat(movieData.rating) : null,
          movieData.director || null,
          movieData.cast || null,
          videoPath,
          generatedThumbnail,
          metadata.duration,
          metadata.fileSize,
          metadata.format,
          metadata.resolution,
          req.user.userId
        ]);

        results.push({
          id: result.id,
          title: movieTitle,
          filename: file.originalname,
          status: 'success'
        });

      } catch (error) {
        console.error(`Error processing ${file.originalname}:`, error);
        
        // Clean up file on error
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('File cleanup error:', cleanupError);
          }
        }

        errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    res.json({
      message: 'Bulk upload completed',
      successful: results.length,
      failed: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    
    // Clean up files on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('File cleanup error:', cleanupError);
          }
        }
      });
    }

    res.status(500).json({ error: 'Bulk upload failed' });
  }
});

// Get available genres for dropdown
router.get('/genres', async (req, res) => {
  try {
    const genres = await db.all('SELECT name FROM categories ORDER BY name');
    res.json(genres.map(g => g.name));
  } catch (error) {
    console.error('Get genres error:', error);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

// Scan folder for movie files
router.post('/scan-folder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { folderPath, skipIncompatible = false, skipFormatCheck = false } = req.body;
    
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    // Check if folder exists and is accessible
    try {
      if (!fs.existsSync(folderPath)) {
        return res.status(404).json({ error: `Folder not found: ${folderPath}` });
      }

      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }

      // Test read access
      fs.accessSync(folderPath, fs.constants.R_OK);
    } catch (accessError) {
      return res.status(403).json({ 
        error: `Cannot access folder: ${accessError.message}. Check permissions.` 
      });
    }

    // Video file extensions to scan for
    const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.m2ts', '.ts', '.vob'];
    
    // Scan directory for video files
    let files;
    try {
      files = fs.readdirSync(folderPath);
    } catch (readError) {
      return res.status(500).json({ 
        error: `Cannot read directory contents: ${readError.message}` 
      });
    }
    
    const videoFiles = files.filter(file => {
              try {
          const ext = path.extname(file).toLowerCase();
          const fullPath = path.join(folderPath, file);
          const stat = fs.statSync(fullPath);
          
          // Only include regular files with video extensions and reasonable size
          return stat.isFile() && 
                 videoExtensions.includes(ext) && 
                 stat.size > 1024 * 1024; // At least 1MB to filter out corrupt/empty files
        } catch (e) {
          // Skip files we can't access
          // Skip file due to error
          return false;
        }
    });

    let fileCompatibility, incompatibleFiles, compatibleFiles, filesToProcess;
    
    if (skipFormatCheck) {
      // Skip format checking entirely - treat all files as compatible
      fileCompatibility = videoFiles.map(fileName => ({
        fileName,
        fullPath: path.join(folderPath, fileName),
        isCompatible: true,
        needsConversion: false,
        format: path.extname(fileName).toLowerCase(),
        recommendation: 'Format check skipped'
      }));
      incompatibleFiles = [];
      compatibleFiles = fileCompatibility;
      filesToProcess = fileCompatibility;
    } else {
      // Check format compatibility for all files
      fileCompatibility = videoFiles.map(fileName => {
        const fullPath = path.join(folderPath, fileName);
        const compatibility = getBrowserCompatibility(fullPath);
        return {
          fileName,
          fullPath,
          ...compatibility
        };
      });
      
      incompatibleFiles = fileCompatibility.filter(file => !file.isCompatible);
      compatibleFiles = fileCompatibility.filter(file => file.isCompatible);
      
      // If there are incompatible files and user hasn't chosen to skip, ask for conversion
      if (incompatibleFiles.length > 0 && !skipIncompatible) {
        return res.json({
          success: false,
          needsConversion: true,
          message: `Found ${incompatibleFiles.length} files that may not play in all browsers`,
          totalFiles: videoFiles.length,
          compatibleFiles: compatibleFiles.length,
          incompatibleFiles: incompatibleFiles.map(file => ({
            fileName: file.fileName,
            format: file.format,
            recommendation: file.recommendation,
            fileSizeMB: Math.round(fs.statSync(file.fullPath).size / (1024 * 1024))
          })),
          folderPath
        });
      }
      
      // If skipping incompatible files, only process compatible ones
      filesToProcess = skipIncompatible ? compatibleFiles : fileCompatibility;
    }
    
    let addedMovies = 0;
    let skippedMovies = 0;

    for (const fileInfo of filesToProcess) {
      const fileName = fileInfo.fileName;
      try {
        const fullPath = path.join(folderPath, fileName);
        
                 // Generate title from filename (improved parsing)
         let title = path.parse(fileName).name
           .replace(/[\._-]/g, ' ')
           .replace(/\(.*?\)/g, '') // Remove year or other parentheses
           .replace(/\[.*?\]/g, '') // Remove brackets
           .replace(/\d{4}/g, '') // Remove standalone years
           .replace(/\s+/g, ' ') // Normalize spaces
           .trim();
         
         // Capitalize each word
         title = title.replace(/\b\w/g, l => l.toUpperCase());

        // Check if movie already exists
        const existingMovie = await db.get('SELECT id FROM movies WHERE title = ? OR video_path = ?', [title, fullPath]);
        
                 if (existingMovie) {
           skippedMovies++;
           console.log(`⏭️  Skipped existing movie: ${title}`);
           continue;
         }

        // Get file stats
        const fileStats = fs.statSync(fullPath);
        const fileSize = fileStats.size;
        const format = path.extname(fileName).substring(1).toLowerCase();

        // Extract basic metadata
        const metadata = await extractVideoMetadata(fullPath);

        // Generate thumbnail path (optional)
        const thumbnailDir = path.join(__dirname, '../uploads/thumbnails');
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true });
        }
        
        const thumbnailName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
        const thumbnailPath = path.join(thumbnailDir, thumbnailName);
        const relativeThumbnailPath = `/uploads/thumbnails/${thumbnailName}`;

        // Search for movie metadata using OMDb
        const omdbData = await searchOMDbMovie(title);
        
        let finalThumbnail = null;
        let omdbTitle = title;
        
        if (omdbData && omdbData.poster) {
          // Download poster from OMDb
          try {
            const posterResult = await downloadPoster(omdbData.poster, thumbnailPath);
            if (posterResult) {
              finalThumbnail = relativeThumbnailPath;
              omdbTitle = omdbData.title; // Use official title from OMDb
            }
          } catch (posterError) {
            // Poster download failed, will fallback to video thumbnail
          }
        }
        
        // Fallback to video thumbnail if no OMDb poster
        if (!finalThumbnail) {
          try {
            const result = await Promise.race([
              generateThumbnail(fullPath, thumbnailPath),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout after 30 seconds')), 30000)
              )
            ]);
            if (result && fs.existsSync(thumbnailPath)) {
              finalThumbnail = relativeThumbnailPath;
            }
          } catch (thumbError) {
            // Thumbnail generation failed
          }
        }

        // Insert movie into database with OMDb metadata
        await db.run(`
          INSERT INTO movies (
            title, video_path, file_size, format, 
            thumbnail, uploaded_by, duration,
            description, genre, release_year, rating,
            director, cast, poster_url, imdb_id, imdb_rating,
            plot, runtime, rated, country, language, awards,
            omdb_updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          omdbTitle,
          fullPath,
          fileSize,
          format,
          finalThumbnail,
          req.user.userId,
          metadata.duration || 0,
          omdbData?.plot || null,
          omdbData?.genre || null,
          omdbData?.year || null,
          omdbData?.imdbRating || null,
          omdbData?.director || null,
          omdbData?.actors || null,
          omdbData?.poster || null,
          omdbData?.imdbID || null,
          omdbData?.imdbRating || null,
          omdbData?.plot || null,
          omdbData?.runtime || null,
          omdbData?.rated || null,
          omdbData?.country || null,
          omdbData?.language || null,
          omdbData?.awards || null,
          omdbData ? new Date().toISOString() : null
        ]);

                 addedMovies++;

      } catch (fileError) {
        console.error(`Error processing file ${fileName}:`, fileError);
        // Continue with next file
      }
    }

    // Summary
    const processedCount = filesToProcess.length;
    const skippedIncompatible = skipIncompatible ? incompatibleFiles.length : 0;

         res.json({
       success: true,
       message: skipIncompatible 
         ? `Scan complete! Found ${videoFiles.length} video files, processed ${compatibleFiles.length} compatible files, skipped ${incompatibleFiles.length} incompatible files.`
         : `Scan complete! Found ${videoFiles.length} video files.`,
       totalFiles: videoFiles.length,
       processedFiles: processedCount,
       compatibleFiles: compatibleFiles.length,
       incompatibleFiles: incompatibleFiles.length,
       addedMovies,
       skippedMovies,
       skippedIncompatible,
       folderPath,
       supportedExtensions: videoExtensions
     });

  } catch (error) {
    console.error('Folder scan error:', error);
    res.status(500).json({ error: 'Failed to scan folder' });
  }
});

// Convert and add incompatible files
router.post('/convert-and-add', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { folderPath, filesToConvert, deleteOriginals = true } = req.body;
    
    if (!folderPath || !filesToConvert || !Array.isArray(filesToConvert)) {
      return res.status(400).json({ error: 'Invalid conversion request' });
    }


    
    const results = {
      converted: [],
      failed: [],
      added: 0
    };

    for (const fileName of filesToConvert) {
      try {
        const inputPath = path.join(folderPath, fileName);
        const outputFileName = path.parse(fileName).name + '.mp4';
        const outputPath = path.join(folderPath, outputFileName);
        
        // Check if file exists
        if (!fs.existsSync(inputPath)) {
          results.failed.push({ fileName, error: 'File not found' });
          continue;
        }
        
        // Check if output file already exists
        if (fs.existsSync(outputPath)) {
          results.failed.push({ fileName, error: 'MP4 version already exists' });
          continue;
        }

        // Convert the file
        await convertToMP4(inputPath, outputPath);
        
        // Generate title from filename
        let title = path.parse(outputFileName).name
          .replace(/[\._-]/g, ' ')
          .replace(/\(.*?\)/g, '')
          .replace(/\[.*?\]/g, '')
          .replace(/\d{4}/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        title = title.replace(/\b\w/g, l => l.toUpperCase());

        // Check if movie already exists
        const existingMovie = await db.get('SELECT id FROM movies WHERE title = ? OR video_path = ?', [title, outputPath]);
        
        if (existingMovie) {
          console.log(`⏭️  Movie already exists: ${title}`);
        } else {
          // Get file stats
          const fileStats = fs.statSync(outputPath);
          const fileSize = fileStats.size;
          
          // Extract metadata
          const metadata = await extractVideoMetadata(outputPath);
          
          // Generate thumbnail
          const thumbnailDir = path.join(__dirname, '../uploads/thumbnails');
          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }
          
          const thumbnailName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
          const thumbnailPath = path.join(thumbnailDir, thumbnailName);
          const relativeThumbnailPath = `/uploads/thumbnails/${thumbnailName}`;
          
          // Search for movie metadata using OMDb
          const omdbData = await searchOMDbMovie(title);
          
          let finalThumbnail = null;
          let omdbTitle = title;
          
          if (omdbData && omdbData.poster) {
            // Download poster from OMDb
            try {
              const posterResult = await downloadPoster(omdbData.poster, thumbnailPath);
              if (posterResult) {
                finalThumbnail = relativeThumbnailPath;
                omdbTitle = omdbData.title; // Use official title from OMDb
              }
            } catch (posterError) {
              // Poster download failed, will fallback to video thumbnail
            }
          }
          
          // Fallback to video thumbnail if no OMDb poster
          if (!finalThumbnail) {
            try {
              await generateThumbnail(outputPath, thumbnailPath);
              if (fs.existsSync(thumbnailPath)) {
                finalThumbnail = relativeThumbnailPath;
              }
            } catch (thumbError) {
              // Thumbnail generation failed
            }
          }
          
          // Insert movie into database with OMDb metadata
          await db.run(`
            INSERT INTO movies (
              title, video_path, file_size, format, 
              thumbnail, uploaded_by, duration,
              description, genre, release_year, rating,
              director, cast, poster_url, imdb_id, imdb_rating,
              plot, runtime, rated, country, language, awards,
              omdb_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            omdbTitle,
            outputPath,
            fileSize,
            'mp4',
            finalThumbnail,
            req.user.userId,
            metadata.duration || 0,
            omdbData?.plot || null,
            omdbData?.genre || null,
            omdbData?.year || null,
            omdbData?.imdbRating || null,
            omdbData?.director || null,
            omdbData?.actors || null,
            omdbData?.poster || null,
            omdbData?.imdbID || null,
            omdbData?.imdbRating || null,
            omdbData?.plot || null,
            omdbData?.runtime || null,
            omdbData?.rated || null,
            omdbData?.country || null,
            omdbData?.language || null,
            omdbData?.awards || null,
            omdbData ? new Date().toISOString() : null
          ]);
          
          results.added++;
        }
        
        // Delete original file if requested
        if (deleteOriginals) {
          try {
            fs.unlinkSync(inputPath);
          } catch (deleteError) {
            // Failed to delete original file, but conversion was successful
          }
        }
        
        results.converted.push({ 
          original: fileName, 
          converted: outputFileName,
          title,
          originalDeleted: deleteOriginals
        });
        
      } catch (error) {
        console.error(`❌ Failed to convert ${fileName}:`, error);
        results.failed.push({ fileName, error: error.message });
      }
    }
    

    
    res.json({
      success: true,
      message: `Conversion complete! ${results.converted.length} files converted, ${results.added} added to library`,
      results
    });
    
  } catch (error) {
    console.error('Conversion process error:', error);
    res.status(500).json({ error: 'Failed to convert files' });
  }
});

// Refresh OMDb data for existing movies
router.post('/refresh-omdb', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get movies that don't have OMDb data or have old data (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const movies = await db.all(`
      SELECT id, title, video_path, thumbnail 
      FROM movies 
      WHERE (omdb_updated IS NULL OR omdb_updated < ?) 
      AND video_path IS NOT NULL
      LIMIT 50
    `, [thirtyDaysAgo]);
    
    if (movies.length === 0) {
      return res.json({
        success: true,
        message: 'All movies are up to date with OMDb data',
        updated: 0
      });
    }
    
    let updated = 0;
    let errors = 0;
    
    for (const movie of movies) {
      try {
        const omdbData = await searchOMDbMovie(movie.title);
        
        if (omdbData) {
          let posterPath = movie.thumbnail;
          
          // Download new poster if available and different
          if (omdbData.poster && omdbData.poster !== movie.poster_url) {
            const thumbnailDir = path.join(__dirname, '../uploads/thumbnails');
            if (!fs.existsSync(thumbnailDir)) {
              fs.mkdirSync(thumbnailDir, { recursive: true });
            }
            
            const thumbnailName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
            const thumbnailPath = path.join(thumbnailDir, thumbnailName);
            const relativeThumbnailPath = `/uploads/thumbnails/${thumbnailName}`;
            
            const posterResult = await downloadPoster(omdbData.poster, thumbnailPath);
            if (posterResult) {
              posterPath = relativeThumbnailPath;
            }
          }
          
          // Update movie with OMDb data
          await db.run(`
            UPDATE movies SET 
              title = ?, description = ?, genre = ?, release_year = ?, 
              rating = ?, director = ?, cast = ?, thumbnail = ?,
              poster_url = ?, imdb_id = ?, imdb_rating = ?, plot = ?,
              runtime = ?, rated = ?, country = ?, language = ?, 
              awards = ?, omdb_updated = ?
            WHERE id = ?
          `, [
            omdbData.title,
            omdbData.plot,
            omdbData.genre,
            omdbData.year,
            omdbData.imdbRating,
            omdbData.director,
            omdbData.actors,
            posterPath,
            omdbData.poster,
            omdbData.imdbID,
            omdbData.imdbRating,
            omdbData.plot,
            omdbData.runtime,
            omdbData.rated,
            omdbData.country,
            omdbData.language,
            omdbData.awards,
            new Date().toISOString(),
            movie.id
          ]);
          
          updated++;
        } else {
          // Mark as checked even if no data found
          await db.run('UPDATE movies SET omdb_updated = ? WHERE id = ?', [
            new Date().toISOString(),
            movie.id
          ]);
        }
        
        // Small delay to avoid hitting API limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`❌ Error refreshing ${movie.title}:`, error.message);
        errors++;
      }
    }
    

    
    res.json({
      success: true,
      message: `OMDb refresh complete: ${updated} movies updated, ${errors} errors`,
      updated,
      errors,
      total: movies.length
    });
    
  } catch (error) {
    console.error('OMDb refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh OMDb data' });
  }
});

module.exports = router; 