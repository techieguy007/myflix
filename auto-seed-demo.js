#!/usr/bin/env node

/**
 * Auto-seed demo data if database is empty
 * This runs automatically on server startup if no movies exist
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database', 'myflix.db');

// Check if database exists and if it's empty
function checkAndSeedDemoData(db) {
  return new Promise((resolve, reject) => {
    // Check if database has any movies
    db.get('SELECT COUNT(*) as count FROM movies', (err, row) => {
      if (err) {
        console.error('Error checking movies:', err);
        resolve(false);
        return;
      }
      
      // If no movies exist, seed demo data
      if (row && row.count === 0) {
        console.log('🌱 Database is empty, seeding demo data...');
        seedDemoData(db)
          .then(() => {
            console.log('✅ Demo data seeded successfully!');
            resolve(true);
          })
          .catch((error) => {
            console.error('❌ Error seeding demo data:', error);
            resolve(false);
          });
      } else {
        console.log(`📊 Database already has ${row.count} movies, skipping demo data seed`);
        resolve(false);
      }
    });
  });
}

async function seedDemoData(db) {
  // Helper functions
  const runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  };

  const getQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  const getAllQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };

  try {
    // Check if users exist, if not create demo users
    const userCount = await getQuery('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
      console.log('👥 Creating demo users...');
      const users = [
        { username: 'admin', email: 'admin@myflix.com', password: 'admin123', is_admin: 1 },
        { username: 'john', email: 'john@example.com', password: 'password123', is_admin: 0 },
        { username: 'sarah', email: 'sarah@example.com', password: 'password123', is_admin: 0 },
        { username: 'mike', email: 'mike@example.com', password: 'password123', is_admin: 0 }
      ];
      
      for (const user of users) {
        const passwordHash = bcrypt.hashSync(user.password, 10);
        await runQuery(
          'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)',
          [user.username, user.email, passwordHash, user.is_admin]
        );
      }
    }

    // Check if categories exist, if not create them
    const categoryCount = await getQuery('SELECT COUNT(*) as count FROM categories');
    if (categoryCount.count === 0) {
      console.log('🏷️  Creating categories...');
      const categories = [
        'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
        'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror',
        'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War'
      ];
      
      for (const category of categories) {
        await runQuery('INSERT INTO categories (name) VALUES (?)', [category]);
      }
    }

    // Create demo movies
    console.log('🎬 Creating demo movies...');
    const adminUser = await getQuery('SELECT id FROM users WHERE username = ?', ['admin']);
    const uploadedBy = adminUser ? adminUser.id : 1;

    const demoMovies = [
      {
        title: 'The Matrix',
        description: 'A computer hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers.',
        genre: 'Sci-Fi',
        release_year: 1999,
        duration: 136,
        rating: 8.7,
        director: 'Lana Wachowski, Lilly Wachowski',
        cast: 'Keanu Reeves, Laurence Fishburne, Carrie-Anne Moss',
        video_path: '/movies/demo/the-matrix.mp4',
        file_size: 2147483648,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 8.7,
        plot: 'When a beautiful stranger leads computer hacker Neo to a forbidding underworld, he discovers the shocking truth--the life he knows is the elaborate deception of an evil cyber-intelligence.',
        runtime: '136 min',
        rated: 'R',
        country: 'USA',
        language: 'English',
        awards: 'Won 4 Oscars. 42 wins & 51 nominations total'
      },
      {
        title: 'Inception',
        description: 'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
        genre: 'Sci-Fi',
        release_year: 2010,
        duration: 148,
        rating: 8.8,
        director: 'Christopher Nolan',
        cast: 'Leonardo DiCaprio, Marion Cotillard, Tom Hardy',
        video_path: '/movies/demo/inception.mp4',
        file_size: 3221225472,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 8.8,
        plot: 'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
        runtime: '148 min',
        rated: 'PG-13',
        country: 'USA, UK',
        language: 'English, Japanese, French',
        awards: 'Won 4 Oscars. 157 wins & 220 nominations total'
      },
      {
        title: 'The Dark Knight',
        description: 'When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.',
        genre: 'Action',
        release_year: 2008,
        duration: 152,
        rating: 9.0,
        director: 'Christopher Nolan',
        cast: 'Christian Bale, Heath Ledger, Aaron Eckhart',
        video_path: '/movies/demo/the-dark-knight.mp4',
        file_size: 4294967296,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 9.0,
        plot: 'When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.',
        runtime: '152 min',
        rated: 'PG-13',
        country: 'USA, UK',
        language: 'English, Mandarin',
        awards: 'Won 2 Oscars. 163 wins & 159 nominations total'
      },
      {
        title: 'Pulp Fiction',
        description: 'The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.',
        genre: 'Crime',
        release_year: 1994,
        duration: 154,
        rating: 8.9,
        director: 'Quentin Tarantino',
        cast: 'John Travolta, Uma Thurman, Samuel L. Jackson',
        video_path: '/movies/demo/pulp-fiction.mp4',
        file_size: 3221225472,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 8.9,
        plot: 'The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.',
        runtime: '154 min',
        rated: 'R',
        country: 'USA',
        language: 'English, Spanish, French',
        awards: 'Won 1 Oscar. 70 wins & 75 nominations total'
      },
      {
        title: 'The Shawshank Redemption',
        description: 'Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.',
        genre: 'Drama',
        release_year: 1994,
        duration: 142,
        rating: 9.3,
        director: 'Frank Darabont',
        cast: 'Tim Robbins, Morgan Freeman, Bob Gunton',
        video_path: '/movies/demo/shawshank-redemption.mp4',
        file_size: 3221225472,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 9.3,
        plot: 'Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.',
        runtime: '142 min',
        rated: 'R',
        country: 'USA',
        language: 'English',
        awards: 'Nominated for 7 Oscars. 21 wins & 42 nominations total'
      },
      {
        title: 'Forrest Gump',
        description: 'The presidencies of Kennedy and Johnson, the Vietnam War, the Watergate scandal and other historical events unfold from the perspective of an Alabama man with an IQ of 75.',
        genre: 'Drama',
        release_year: 1994,
        duration: 142,
        rating: 8.8,
        director: 'Robert Zemeckis',
        cast: 'Tom Hanks, Robin Wright, Gary Sinise',
        video_path: '/movies/demo/forrest-gump.mp4',
        file_size: 3221225472,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 8.8,
        plot: 'The presidencies of Kennedy and Johnson, the Vietnam War, the Watergate scandal and other historical events unfold from the perspective of an Alabama man with an IQ of 75.',
        runtime: '142 min',
        rated: 'PG-13',
        country: 'USA',
        language: 'English',
        awards: 'Won 6 Oscars. 52 wins & 75 nominations total'
      },
      {
        title: 'The Godfather',
        description: 'The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.',
        genre: 'Crime',
        release_year: 1972,
        duration: 175,
        rating: 9.2,
        director: 'Francis Ford Coppola',
        cast: 'Marlon Brando, Al Pacino, James Caan',
        video_path: '/movies/demo/the-godfather.mp4',
        file_size: 5368709120,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 9.2,
        plot: 'The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.',
        runtime: '175 min',
        rated: 'R',
        country: 'USA',
        language: 'English, Italian, Latin',
        awards: 'Won 3 Oscars. 32 wins & 31 nominations total'
      },
      {
        title: 'Interstellar',
        description: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
        genre: 'Sci-Fi',
        release_year: 2014,
        duration: 169,
        rating: 8.6,
        director: 'Christopher Nolan',
        cast: 'Matthew McConaughey, Anne Hathaway, Jessica Chastain',
        video_path: '/movies/demo/interstellar.mp4',
        file_size: 5368709120,
        format: 'mp4',
        resolution: '1080p',
        imdb_rating: 8.6,
        plot: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
        runtime: '169 min',
        rated: 'PG-13',
        country: 'USA, UK, Canada',
        language: 'English',
        awards: 'Won 1 Oscar. 44 wins & 148 nominations total'
      }
    ];

    for (const movie of demoMovies) {
      await runQuery(
        `INSERT INTO movies (
          title, description, genre, release_year, duration, rating, director, cast,
          video_path, file_size, format, resolution, uploaded_by,
          imdb_rating, plot, runtime, rated, country, language, awards
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          movie.title, movie.description, movie.genre, movie.release_year,
          movie.duration, movie.rating, movie.director, movie.cast,
          movie.video_path, movie.file_size, movie.format, movie.resolution, uploadedBy,
          movie.imdb_rating, movie.plot, movie.runtime, movie.rated,
          movie.country, movie.language, movie.awards
        ]
      );
    }

    // Create some watch history and favorites
    const regularUsers = await getAllQuery('SELECT id FROM users WHERE is_admin = 0');
    const movies = await getAllQuery('SELECT id, duration FROM movies LIMIT 5');

    if (regularUsers.length > 0 && movies.length > 0) {
      for (let i = 0; i < regularUsers.length; i++) {
        const user = regularUsers[i];
        const movie = movies[i % movies.length];
        const maxWatchTime = Math.floor((movie.duration || 120) * 0.8 * 60);
        const watchTime = Math.floor(Math.random() * maxWatchTime);
        
        await runQuery(
          'INSERT OR REPLACE INTO watch_history (user_id, movie_id, watch_time, completed, last_watched) VALUES (?, ?, ?, ?, datetime("now"))',
          [user.id, movie.id, watchTime, watchTime > maxWatchTime * 0.9 ? 1 : 0]
        );

        // Add favorites
        const favoriteCount = 2 + Math.floor(Math.random() * 2);
        const shuffled = movies.sort(() => 0.5 - Math.random());
        const favorites = shuffled.slice(0, favoriteCount);
        for (const favMovie of favorites) {
          await runQuery(
            'INSERT OR IGNORE INTO favorites (user_id, movie_id) VALUES (?, ?)',
            [user.id, favMovie.id]
          );
        }
      }
    }
  } catch (error) {
    console.error('Error seeding demo data:', error);
    throw error;
  }
}

module.exports = { checkAndSeedDemoData };

