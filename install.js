#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

console.log('🎬 MyFlix Installation Script');
console.log('==============================\n');

// Function to run command with better error handling
function runCommand(command, description) {
  console.log(`📦 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} completed\n`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} failed`);
    console.error(`Command: ${command}`);
    console.error(`Error: ${error.message}\n`);
    return false;
  }
}

// Check prerequisites
console.log('🔍 Checking prerequisites...\n');

const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);

if (majorVersion < 16) {
  console.error('❌ Node.js version 16 or higher is required.');
  console.error(`   Current version: ${nodeVersion}`);
  process.exit(1);
}
console.log(`✅ Node.js ${nodeVersion}`);

try {
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  console.log(`✅ npm ${npmVersion}`);
} catch (error) {
  console.error('❌ npm not found');
  process.exit(1);
}

// Check FFmpeg (optional)
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  console.log('✅ FFmpeg detected');
} catch (error) {
  console.warn('⚠️  FFmpeg not found - video processing will be limited');
  console.log('   To install FFmpeg:');
  console.log('   Windows: choco install ffmpeg');
  console.log('   macOS: brew install ffmpeg');
  console.log('   Linux: sudo apt install ffmpeg');
}
console.log('');

// Clean npm cache to avoid issues
console.log('🧹 Cleaning npm cache...');
try {
  execSync('npm cache clean --force', { stdio: 'inherit' });
  console.log('✅ Cache cleaned\n');
} catch (error) {
  console.warn('⚠️  Cache clean failed, continuing...\n');
}

// Install backend dependencies
console.log('📦 Installing backend dependencies...');
const backendSuccess = runCommand('npm install --no-optional', 'Backend dependency installation');

if (!backendSuccess) {
  console.log('🔧 Trying alternative installation method...');
  
  // Try installing packages individually for better error reporting
  const corePackages = [
    'express@^4.18.2',
    'cors@^2.8.5',
    'helmet@^7.0.0',
    'bcryptjs@^2.4.3',
    'jsonwebtoken@^9.0.2',
    'multer@^1.4.5-lts.1',
    'sqlite3@^5.1.6',
    'express-rate-limit@^6.10.0',
    'compression@^1.7.4'
  ];
  
  const ffmpegPackages = [
    'ffprobe@^1.1.2',
    'ffprobe-static@^3.1.0',
    'fluent-ffmpeg@^2.1.2'
  ];
  
  // Install core packages first
  for (const pkg of corePackages) {
    const success = runCommand(`npm install ${pkg}`, `Installing ${pkg.split('@')[0]}`);
    if (!success) {
      console.error(`Failed to install ${pkg}`);
    }
  }
  
  // Install FFmpeg packages (optional)
  console.log('📼 Installing video processing packages (optional)...');
  for (const pkg of ffmpegPackages) {
    const success = runCommand(`npm install ${pkg}`, `Installing ${pkg.split('@')[0]}`);
    if (!success) {
      console.warn(`⚠️  Failed to install ${pkg} - some video features may not work`);
    }
  }
}

// Install development dependencies
runCommand('npm install --save-dev nodemon@^3.0.1 concurrently@^8.2.1', 'Installing development dependencies');

// Create client directory if it doesn't exist
if (!fs.existsSync('client')) {
  fs.mkdirSync('client', { recursive: true });
  console.log('✅ Created client directory');
}

// Install frontend dependencies
console.log('🖥️  Installing frontend dependencies...');
const clientSuccess = runCommand('cd client && npm install', 'Frontend dependency installation');

if (!clientSuccess) {
  console.log('🔧 Trying to install frontend dependencies manually...');
  process.chdir('client');
  
  const frontendPackages = [
    'react@^18.2.0',
    'react-dom@^18.2.0',
    'react-scripts@5.0.1',
    'react-router-dom@^6.15.0',
    'axios@^1.5.0',
    'styled-components@^6.0.8'
  ];
  
  for (const pkg of frontendPackages) {
    runCommand(`npm install ${pkg}`, `Installing ${pkg.split('@')[0]}`);
  }
  
  process.chdir('..');
}

// Create necessary directories
console.log('📁 Creating project directories...');
const directories = ['movies', 'uploads', 'thumbnails', 'database'];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created ${dir}/ directory`);
  } else {
    console.log(`✅ ${dir}/ directory exists`);
  }
});

// Create .env file
console.log('\n⚙️  Setting up configuration...');
if (!fs.existsSync('.env')) {
  const envContent = `# MyFlix Configuration
PORT=5000
NODE_ENV=development

# Security - CHANGE THIS IN PRODUCTION!
JWT_SECRET=myflix-secret-key-${Date.now()}-change-this

# File Upload Limits (10GB)
MAX_FILE_SIZE=10737418240
`;

  fs.writeFileSync('.env', envContent);
  console.log('✅ Created .env file');
} else {
  console.log('✅ .env file already exists');
}

// Create sample directory
const sampleDir = path.join('movies', 'samples');
if (!fs.existsSync(sampleDir)) {
  fs.mkdirSync(sampleDir, { recursive: true });
  
  const readmeContent = `# Movies Directory

Add your video files here!

Supported formats: MP4, AVI, MKV, MOV, WMV, FLV, WebM, M4V

Example:
movies/
├── Action/
│   └── my-action-movie.mp4
└── Comedy/
    └── funny-movie.mkv
`;

  fs.writeFileSync(path.join(sampleDir, 'README.md'), readmeContent);
  console.log('✅ Created sample movies directory');
}

console.log('\n🎉 Installation Complete!\n');

console.log('🚀 To start MyFlix:');
console.log('   npm run dev');
console.log('');
console.log('📍 Then open: http://localhost:3000');
console.log('');
console.log('🔑 Default admin login:');
console.log('   Username: admin');
console.log('   Password: admin123');
console.log('');
console.log('⚠️  Remember to change the admin password!');
console.log('');
console.log('🎬 Enjoy your personal Netflix! 🍿'); 