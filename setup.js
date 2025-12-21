#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🎬 MyFlix Setup Script');
console.log('======================\n');

// Check if Node.js version is compatible
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);

if (majorVersion < 16) {
  console.error('❌ Node.js version 16 or higher is required.');
  console.error(`   Current version: ${nodeVersion}`);
  console.error('   Please upgrade Node.js and try again.');
  process.exit(1);
}

console.log(`✅ Node.js ${nodeVersion} detected`);

// Check if npm is available
try {
  execSync('npm --version', { stdio: 'ignore' });
  console.log('✅ npm detected');
} catch (error) {
  console.error('❌ npm is not available. Please install npm and try again.');
  process.exit(1);
}

// Check if FFmpeg is installed
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  console.log('✅ FFmpeg detected');
} catch (error) {
  console.warn('⚠️  FFmpeg not detected. Video processing features will be limited.');
  console.log('   Install FFmpeg for full functionality:');
  console.log('   - Windows: choco install ffmpeg');
  console.log('   - macOS: brew install ffmpeg');
  console.log('   - Linux: sudo apt install ffmpeg\n');
}

console.log('\n📦 Installing dependencies...\n');

// Install backend dependencies
console.log('Installing backend dependencies...');
try {
  execSync('npm install', { stdio: 'inherit' });
  console.log('✅ Backend dependencies installed');
} catch (error) {
  console.error('❌ Failed to install backend dependencies');
  process.exit(1);
}

// Install frontend dependencies
console.log('\nInstalling frontend dependencies...');
try {
  execSync('npm run install-client', { stdio: 'inherit' });
  console.log('✅ Frontend dependencies installed');
} catch (error) {
  console.error('❌ Failed to install frontend dependencies');
  process.exit(1);
}

// Create necessary directories
console.log('\n📁 Creating directories...');

const directories = [
  'movies',
  'uploads',
  'thumbnails',
  'database'
];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created ${dir}/ directory`);
  } else {
    console.log(`✅ ${dir}/ directory already exists`);
  }
});

// Create .env file if it doesn't exist
console.log('\n⚙️  Setting up configuration...');

const envPath = '.env';
if (!fs.existsSync(envPath)) {
  const envContent = `# MyFlix Configuration
PORT=5000
NODE_ENV=development

# Security - IMPORTANT: Change this in production!
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# File Upload Limits
MAX_FILE_SIZE=10737418240

# Database
DB_PATH=./database/myflix.db
`;

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Created .env configuration file');
  console.log('⚠️  IMPORTANT: Change the JWT_SECRET in .env file for production use!');
} else {
  console.log('✅ .env file already exists');
}

// Create a sample movie directory structure
const sampleDir = path.join('movies', 'samples');
if (!fs.existsSync(sampleDir)) {
  fs.mkdirSync(sampleDir, { recursive: true });
  
  const readmeContent = `# Sample Movies Directory

Place your video files in this directory or create subdirectories for organization.

Supported formats:
- MP4 (recommended)
- AVI
- MKV
- MOV
- WMV
- FLV
- WebM
- M4V

Example structure:
\`\`\`
movies/
├── Action/
│   ├── movie1.mp4
│   └── movie2.mkv
├── Comedy/
│   └── funny_movie.mp4
└── samples/
    └── README.md (this file)
\`\`\`

Note: Thumbnails will be auto-generated when you upload movies through the admin panel.
`;

  fs.writeFileSync(path.join(sampleDir, 'README.md'), readmeContent);
  console.log('✅ Created sample directory structure');
}

console.log('\n🎉 Setup Complete!\n');

console.log('📝 Next Steps:');
console.log('1. Start the application:');
console.log('   npm run dev');
console.log('');
console.log('2. Open your browser and go to:');
console.log('   http://localhost:3000');
console.log('');
console.log('3. Login with default admin credentials:');
console.log('   Username: admin');
console.log('   Password: admin123');
console.log('   ⚠️  IMPORTANT: Change this password after login!');
console.log('');
console.log('4. Upload your first movie through the admin panel');
console.log('');
console.log('5. For network access from other devices:');
console.log('   - Find your IP address (ipconfig/ifconfig)');
console.log('   - Update server.js to bind to 0.0.0.0');
console.log('   - Access via http://YOUR-IP-ADDRESS:5000');
console.log('');
console.log('📚 For more information, see README.md');
console.log('');
console.log('Enjoy your personal Netflix clone! 🍿');

// Offer to start the application
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nWould you like to start MyFlix now? (y/n): ', (answer) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    console.log('\n🚀 Starting MyFlix...\n');
    try {
      execSync('npm run dev', { stdio: 'inherit' });
    } catch (error) {
      console.error('Failed to start the application. Try running "npm run dev" manually.');
    }
  } else {
    console.log('\nRun "npm run dev" when you\'re ready to start MyFlix!');
  }
  rl.close();
}); 