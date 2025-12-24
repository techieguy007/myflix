const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Create database directory if it doesn't exist
const dbDir = path.dirname(__filename);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('📁 Created database directory');
}

const dbPath = path.join(__dirname, 'myflix.db');
console.log('📍 Database path:', dbPath);

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('📊 Connected to SQLite database');
    initializeTables();
  }
});

// Initialize database tables
function initializeTables() {
  console.log('📋 Creating database tables...');
  
  // Create tables in sequence and wait for completion
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        profile_picture TEXT,
        is_admin BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating users table:', err);
      } else {
        console.log('✅ Users table ready');
      }
    });

    // Movies table
    db.run(`
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        genre TEXT,
        release_year INTEGER,
        duration INTEGER,
        rating REAL,
        director TEXT,
        cast TEXT,
        thumbnail TEXT,
        video_path TEXT NOT NULL,
        file_size INTEGER,
        resolution TEXT,
        format TEXT,
        uploaded_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        poster_url TEXT,
        imdb_id TEXT,
        imdb_rating REAL,
        plot TEXT,
        runtime TEXT,
        rated TEXT,
        country TEXT,
        language TEXT,
        awards TEXT,
        omdb_updated DATETIME,
        FOREIGN KEY (uploaded_by) REFERENCES users (id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating movies table:', err);
      } else {
        console.log('✅ Movies table ready');
        
        // Add new columns to existing table if they don't exist
        const newColumns = [
          'poster_url TEXT',
          'imdb_id TEXT', 
          'imdb_rating REAL',
          'plot TEXT',
          'runtime TEXT',
          'rated TEXT',
          'country TEXT',
          'language TEXT',
          'awards TEXT',
          'omdb_updated DATETIME'
        ];
        
        newColumns.forEach(column => {
          const columnName = column.split(' ')[0];
          db.run(`ALTER TABLE movies ADD COLUMN ${column}`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error(`Error adding column ${columnName}:`, err);
            } else if (!err) {
              console.log(`✅ Added column: ${columnName}`);
            }
          });
        });
      }
    });

    // Watch history table
    db.run(`
      CREATE TABLE IF NOT EXISTS watch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        movie_id INTEGER NOT NULL,
        watch_time INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT 0,
        last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (movie_id) REFERENCES movies (id),
        UNIQUE(user_id, movie_id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating watch_history table:', err);
      } else {
        console.log('✅ Watch history table ready');
      }
    });

    // Favorites table
    db.run(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        movie_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (movie_id) REFERENCES movies (id),
        UNIQUE(user_id, movie_id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating favorites table:', err);
      } else {
        console.log('✅ Favorites table ready');
      }
    });

    // Categories/Genres table
    db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating categories table:', err);
      } else {
        console.log('✅ Categories table ready');
      }
    });

    // Movie categories junction table
    db.run(`
      CREATE TABLE IF NOT EXISTS movie_categories (
        movie_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        PRIMARY KEY (movie_id, category_id),
        FOREIGN KEY (movie_id) REFERENCES movies (id),
        FOREIGN KEY (category_id) REFERENCES categories (id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating movie_categories table:', err);
      } else {
        console.log('✅ Movie categories table ready');
        
        // Only create default data after all tables are created
        setTimeout(() => {
          createDefaultUsers();
          createDefaultCategories();
          console.log('📋 Database initialization complete');
          
          // Auto-seed demo data if database is empty (for fresh deployments)
          setTimeout(() => {
            checkAndAutoSeedDemoData();
          }, 500);
        }, 100);
      }
    });
  });
}

// Create default users
function createDefaultUsers() {
  const bcrypt = require('bcryptjs');
  
  // Check if users table exists and has any users
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (err) {
      console.error('Error checking users table:', err);
      // Try to create admin user anyway
      tryCreateAdminUser();
      return;
    }
    
    if (row && row.count === 0) {
      tryCreateAdminUser();
    } else if (row && row.count > 0) {
      console.log('👤 Users already exist in database');
    }
  });
  
  function tryCreateAdminUser() {
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    db.run(
      "INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)",
      ['admin', 'admin@myflix.com', defaultPassword, 1],
      function(err) {
        if (err) {
          console.error('Error creating default admin:', err);
        } else {
          console.log('👤 Created default admin user (username: admin, password: admin123)');
          console.log('⚠️  IMPORTANT: Change the admin password after login!');
        }
      }
    );
  }
}

// Create default categories
function createDefaultCategories() {
  const defaultCategories = [
    'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror',
    'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War'
  ];

  db.get("SELECT COUNT(*) as count FROM categories", (err, row) => {
    if (err) {
      console.error('Error checking categories table:', err);
      // Try to create categories anyway
      tryCreateCategories();
      return;
    }
    
    if (row && row.count === 0) {
      tryCreateCategories();
    } else if (row && row.count > 0) {
      console.log('🏷️  Categories already exist in database');
    }
  });
  
  function tryCreateCategories() {
    const stmt = db.prepare("INSERT INTO categories (name) VALUES (?)");
    let inserted = 0;
    
    defaultCategories.forEach(category => {
      stmt.run(category, function(err) {
        if (err) {
          console.error(`Error inserting category ${category}:`, err);
        } else {
          inserted++;
        }
      });
    });
    
    stmt.finalize((err) => {
      if (err) {
        console.error('Error finalizing category statement:', err);
      } else {
        console.log(`🏷️  Created ${inserted}/${defaultCategories.length} movie categories`);
      }
    });
  }
}

// Database helper methods
const dbMethods = {
  // Get database instance
  getDB: () => db,
  
  // Run query with promise
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  },
  
  // Get single row
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  },
  
  // Get all rows
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  },
  
  // Close database connection
  close: () => {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('📊 Database connection closed');
          resolve();
        }
      });
    });
  }
};

// Auto-seed demo data if database is empty (for fresh deployments)
function checkAndAutoSeedDemoData() {
  // Check if database has any movies
  db.get('SELECT COUNT(*) as count FROM movies', (err, row) => {
    if (err) {
      console.error('Error checking movies for auto-seed:', err);
      return;
    }
    
    // If no movies exist, seed demo data
    if (row && row.count === 0) {
      console.log('🌱 Database is empty, auto-seeding demo data...');
      // Import auto-seed module
      try {
        const autoSeedPath = path.join(__dirname, '..', 'auto-seed-demo');
        if (fs.existsSync(autoSeedPath + '.js')) {
          const autoSeed = require(autoSeedPath);
          autoSeed.checkAndSeedDemoData(db)
            .then((seeded) => {
              if (seeded) {
                console.log('✅ Demo data auto-seeded successfully!');
                console.log('🔑 Demo Users: admin/admin123, john/password123, sarah/password123, mike/password123');
              }
            })
            .catch((error) => {
              console.error('❌ Error auto-seeding demo data:', error);
            });
        } else {
          console.log('💡 Auto-seed module not found. Run "npm run seed-demo" manually to populate demo data');
        }
      } catch (error) {
        console.error('❌ Error loading auto-seed module:', error.message);
        console.log('💡 Run "npm run seed-demo" manually to populate demo data');
      }
    }
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await dbMethods.close();
    process.exit(0);
  } catch (err) {
    console.error('Error closing database:', err);
    process.exit(1);
  }
});

module.exports = dbMethods; 