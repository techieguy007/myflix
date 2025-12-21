#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔄 MyFlix Database Reset');
console.log('========================\n');

// Database file path
const dbPath = path.join(__dirname, 'database', 'myflix.db');

// Check if database exists
if (fs.existsSync(dbPath)) {
  console.log('📁 Found existing database file');
  
  // Create backup
  const backupPath = path.join(__dirname, 'database', `myflix.db.backup.${Date.now()}`);
  try {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`💾 Created backup: ${path.basename(backupPath)}`);
  } catch (error) {
    console.error('⚠️  Could not create backup:', error.message);
  }
  
  // Remove old database
  try {
    fs.unlinkSync(dbPath);
    console.log('🗑️  Removed old database file');
  } catch (error) {
    console.error('❌ Could not remove old database:', error.message);
    process.exit(1);
  }
} else {
  console.log('📁 No existing database found');
}

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('📁 Created database directory');
}

console.log('\n🚀 Reinitializing database...');

// Import and initialize database
try {
  const db = require('./database/init');
  console.log('✅ Database reinitialized successfully!');
  console.log('\n🎬 You can now start MyFlix:');
  console.log('   npm run dev');
  console.log('\n🔑 Default admin login:');
  console.log('   Username: admin');
  console.log('   Password: admin123');
} catch (error) {
  console.error('❌ Database initialization failed:', error.message);
  process.exit(1);
} 