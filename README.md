# 🎬 MyFlix - Your own n**flix Clone for Home Network Streaming

A complete n**flix-inspired streaming platform built for your home network. Built with **React.js** and **Node.js**, this full-stack application lets you stream your personal movie collection with a beautiful, responsive interface that rivals commercial streaming services.

![MyFlix Dashboard](https://via.placeholder.com/800x400/e50914/ffffff?text=MyFlix+Dashboard)

## ✨ Features

### 🎥 Core Streaming Features
- **High-Quality Video Streaming** - Optimized video delivery with range request support
- **Responsive Video Player** - Custom player with play/pause, seek, volume control
- **Progress Tracking** - Resume watching from where you left off
- **Multiple Format Support** - MP4, AVI, MKV, MOV, and more
- **Subtitle Support** - SRT, VTT subtitle files automatically detected

### 🏠 Home Network Optimized
- **Local Server Deployment** - Run entirely on your home network
- **Fast File Access** - Direct file system access for instant loading
- **No Internet Required** - Works completely offline once set up
- **Network Device Support** - Access from phones, tablets, smart TVs, computers

### 🎨 n**flix-Style Interface
- **Modern UI Design** - Clean, dark theme matching n**flix aesthetics
- **Responsive Design** - Perfect on desktop, tablet, and mobile devices
- **Smooth Animations** - Fluid page transitions and hover effects
- **Grid & Row Layouts** - n**flix-style movie browsing experience

### 👤 User Management
- **Multi-User Support** - Individual accounts with separate watch histories
- **Admin Panel** - Upload and manage movies, user administration
- **Watch Progress** - Individual progress tracking per user
- **Favorites** - Personal movie favorites list
- **Continue Watching** - Quick access to partially watched content

### 🔍 Content Discovery
- **Advanced Search** - Search by title, director, cast, genre
- **Genre Filtering** - Browse movies by category
- **Recently Added** - See newest additions to the library
- **Ratings System** - Rate and view movie ratings

### 🔒 Security Features
- **JWT Authentication** - Secure user sessions
- **Admin-Only Uploads** - Controlled content management
- **Rate Limiting** - Protection against abuse
- **Input Validation** - Security against malicious inputs

### 📱 Progressive Web App (PWA) Features
- **Installable App** - Install MyFlix as a standalone app on your device
- **Standalone Mode** - Runs in its own window without browser UI
- **App-Like Experience** - Native app feel with quick access from taskbar/dock
- **Cross-Device Sync** - Install on multiple devices for seamless access
- **Offline Capability** - Enhanced offline experience (when configured)

## 💻 Tech Stack

MyFlix is built using modern web technologies with a React.js frontend and Node.js backend architecture.

### Frontend (React.js)

**Core Framework:**
- **React 18.2.0** - Modern React with hooks and concurrent features
- **React DOM** - React rendering engine
- **Create React App** - Development tooling and build configuration

**Routing & Navigation:**
- **React Router DOM v6.15.0** - Client-side routing and navigation

**State Management & Data Fetching:**
- **React Query v3.39.3** - Powerful data synchronization for React (server state management, caching, background updates)

**UI & Styling:**
- **Styled Components v6.0.8** - CSS-in-JS styling solution
- **Framer Motion v10.16.4** - Production-ready motion library for React animations
- **React Icons v4.11.0** - Popular icons for React

**Forms & Validation:**
- **React Hook Form v7.46.0** - Performant, flexible forms with easy validation

**Video & Media:**
- **React Player v2.13.0** - React component for playing media from various sources

**Notifications:**
- **React Hot Toast v2.4.1** - Beautiful toast notifications for React

**Performance & UX:**
- **React Intersection Observer v9.5.2** - Hooks for detecting element visibility
- **React LazyLoad v3.2.0** - Lazy loading component for React
- **Swiper v10.3.0** - Modern touch slider with React support

**Utilities:**
- **Axios v1.5.0** - Promise-based HTTP client for API requests
- **Lodash Debounce v4.0.8** - Debounce function for performance optimization
- **Date-fns v2.30.0** - Modern JavaScript date utility library

### Backend (Node.js)

**Core Framework:**
- **Node.js** - JavaScript runtime environment
- **Express.js v4.18.2** - Fast, unopinionated web framework

**Database:**
- **SQLite3 v5.1.6** - Lightweight, serverless database engine

**Authentication & Security:**
- **JWT (JSON Web Tokens) v9.0.2** - Secure token-based authentication
- **BcryptJS v2.4.3** - Password hashing library
- **Helmet v7.0.0** - Security middleware for Express
- **Express Rate Limit v6.10.0** - Basic rate-limiting middleware

**File Handling:**
- **Multer v1.4.5** - Middleware for handling multipart/form-data (file uploads)
- **FFmpeg** - Video processing and thumbnail generation
- **Fluent FFmpeg v2.1.2** - Node.js wrapper for FFmpeg

**Utilities:**
- **CORS v2.8.5** - Cross-Origin Resource Sharing middleware
- **Compression v1.7.4** - Compression middleware for Express
- **Axios v1.10.0** - HTTP client for API calls

### Development Tools

- **Nodemon v3.0.1** - Development utility that monitors for file changes
- **Concurrently v8.2.1** - Run multiple commands concurrently

### Architecture

- **Full-Stack JavaScript** - Single language (JavaScript) for both frontend and backend
- **RESTful API** - Backend exposes REST API endpoints
- **JWT-based Authentication** - Stateless authentication system
- **SQLite Database** - File-based database, perfect for home server setup
- **React SPA** - Single Page Application with client-side routing

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or later)
- **npm** or **yarn**
- **FFmpeg** (for video processing and thumbnails)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd myflix
   ```

2. **Install dependencies:**
   ```bash
   # Install backend dependencies
   npm install

   # Install frontend dependencies
   cd client
   npm install
   cd ..
   ```

3. **Install FFmpeg:**

   **Windows:**
   ```bash
   # Using Chocolatey
   choco install ffmpeg

   # Or download from https://ffmpeg.org/download.html
   ```

   **macOS:**
   ```bash
   # Using Homebrew
   brew install ffmpeg
   ```

   **Linux (Ubuntu/Debian):**
   ```bash
   sudo apt update
   sudo apt install ffmpeg
   ```

4. **Start the application:**
   ```bash
   # Development mode (both backend and frontend)
   npm run dev

   # Or start individually
   npm run dev:server  # Backend only
   npm run dev:client  # Frontend only
   ```

5. **Access MyFlix:**
   - Open your browser and go to `http://localhost:3000`
   - The backend API runs on `http://localhost:5000`

### Default Admin Account

```
Username: admin
Email: admin@myflix.com
Password: admin123
```

**⚠️ Important: Change the default admin password immediately after setup!**

## 📁 Project Structure

```
myflix/
├── client/                     # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── contexts/           # React contexts (Auth, etc.)
│   │   ├── pages/              # Page components
│   │   ├── utils/              # Utility functions
│   │   └── App.js              # Main app component
│   └── package.json
├── database/                   # Database setup and management
│   └── init.js                 # Database initialization
├── middleware/                 # Express middleware
│   └── auth.js                 # Authentication middleware
├── routes/                     # API route handlers
│   ├── auth.js                 # Authentication routes
│   ├── movies.js               # Movie management routes
│   ├── stream.js               # Video streaming routes
│   └── upload.js               # File upload routes
├── movies/                     # Video files storage
├── thumbnails/                 # Generated thumbnails
├── uploads/                    # Uploaded files
├── server.js                   # Express server
├── package.json                # Backend dependencies
└── README.md                   # This file
```

## 🎬 Adding Movies to Your Library

### Method 1: Admin Web Interface

1. Log in with admin credentials
2. Navigate to `/admin` or click "Admin" in the navigation
3. Use the upload form to add movies with metadata
4. Thumbnails are auto-generated from video files

### Method 2: Direct File Copy

1. Copy video files to the `movies/` directory
2. Use the admin panel to scan for new files
3. Add metadata through the web interface

### Supported Video Formats

- MP4 (Recommended)
- AVI
- MKV
- MOV
- WMV
- FLV
- WebM
- M4V

### Thumbnail Generation

Thumbnails are automatically generated at 10% of video duration. For best results:
- Ensure FFmpeg is properly installed
- Videos should have clear scenes early in the content
- Custom thumbnails can be uploaded via admin panel

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Security
JWT_SECRET=your-super-secret-jwt-key-change-this

# File Upload Limits
MAX_FILE_SIZE=10737418240  # 10GB in bytes
```

### Network Access

To access MyFlix from other devices on your network:

1. Find your computer's IP address:
   ```bash
   # Windows
   ipconfig

   # macOS/Linux
   ifconfig
   ```

2. Update the server to bind to all interfaces:
   - In `server.js`, change the listen call:
   ```javascript
   app.listen(PORT, '0.0.0.0', () => {
     // ...
   });
   ```

3. Access from other devices using: `http://YOUR-IP-ADDRESS:5000`

## 📱 Device Compatibility

### Tested Browsers
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Mobile Support
- iOS Safari
- Android Chrome
- Responsive design adapts to all screen sizes

### Smart TV Support
- Modern smart TV browsers
- Casting support (via browser casting)
- Full-screen video playback

## 📲 Progressive Web App (PWA) Installation

MyFlix is configured as a **Progressive Web App (PWA)**, which means modern browsers (Chrome, Edge, Firefox, Safari) will automatically detect it and offer to install it as a standalone application.

### Why You See the Install Prompt

When you visit MyFlix in your browser (especially Edge, Chrome, or other Chromium-based browsers), you may see an **"Install MyFlix"** prompt. This happens because:

1. **PWA Manifest** - The app includes a `manifest.json` file that declares it as installable
2. **Standalone Display Mode** - Configured to run as a standalone app (not just a website)
3. **Browser Detection** - Modern browsers automatically detect PWA-capable sites and offer installation

### Benefits of Installing as PWA

Installing MyFlix as a PWA provides several advantages:

- ✅ **Dedicated Window** - Opens in its own focused window without browser UI
- ✅ **Quick Access** - Pin to taskbar (Windows) or dock (macOS) for instant access
- ✅ **App-Like Experience** - Feels like a native application
- ✅ **Better Performance** - Optimized loading and caching
- ✅ **Cross-Device** - Install on multiple devices (phone, tablet, desktop)

### How to Install

**On Desktop (Windows/macOS/Linux):**
- Click the **"Install"** button when the prompt appears
- Or look for the install icon (➕) in your browser's address bar
- Or go to browser menu → "Install MyFlix" / "Install app"

**On Mobile (iOS/Android):**
- **iOS Safari**: Tap Share → "Add to Home Screen"
- **Android Chrome**: Tap the menu → "Install app" or "Add to Home Screen"

### If You Don't Want to Install

You can simply click **"Not now"** or dismiss the prompt. MyFlix will continue to work normally in your browser. The prompt may reappear on future visits, but you can always dismiss it.

**Note:** The PWA features are optional. You can use MyFlix entirely in your browser without installing it.

## 🛡️ Security Considerations

### For Home Network Use
- Change default admin password
- Keep the server updated
- Use strong JWT secret
- Consider VPN for remote access

### For Internet Exposure (Not Recommended)
- Use HTTPS/SSL certificates
- Implement additional authentication
- Regular security updates
- Consider professional security review

## 🚨 Troubleshooting

### Common Issues

**Videos won't play:**
- Check video format compatibility
- Ensure FFmpeg is installed correctly
- Verify file permissions in `movies/` directory

**Thumbnails not generating:**
- Confirm FFmpeg installation: `ffmpeg -version`
- Check server logs for FFmpeg errors
- Ensure write permissions in `thumbnails/` directory

**Can't access from other devices:**
- Check firewall settings
- Ensure server is binding to `0.0.0.0`
- Verify network connectivity

**Upload fails:**
- Check available disk space
- Verify file size limits
- Ensure proper file permissions

### Performance Tips

**For Large Libraries:**
- Use SSD storage for better performance
- Consider video transcoding for lower bandwidth
- Implement caching strategies

**For Multiple Users:**
- Monitor server resources
- Consider load balancing for heavy usage
- Optimize database queries

## 🔄 Updates and Maintenance

### Keeping MyFlix Updated
1. Backup your database and movie files
2. Pull latest changes from repository
3. Run `npm install` to update dependencies
4. Restart the server

### Database Backup
```bash
# Backup SQLite database
cp database/myflix.db database/myflix.db.backup
```

### Log Management
Check server logs for issues:
```bash
# View server logs
npm run dev:server

# Or check specific log files if configured
```

## 🤝 Contributing

Contributions are welcome! Please feel free to:
- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by n**flix's user interface and experience
- Built with **React.js 18.2** frontend and **Node.js/Express.js** backend
- **FFmpeg** for video processing and thumbnail generation
- **SQLite** for lightweight, serverless database management
- **React Router**, **React Query**, and other modern React ecosystem libraries
- All the open-source contributors and libraries that made this project possible

---

## 🎯 Next Steps

After setting up MyFlix:

1. **Change default admin password**
2. **Upload your first movie**
3. **Create user accounts for family members**
4. **Configure network access for other devices**
5. **Explore the admin panel features**

Enjoy your personal n**flix clone! 🍿

---

*Made with ❤️ for home entertainment* 
