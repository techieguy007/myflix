# MyFlix

MyFlix is a personal streaming server for a local movie and TV library. It scans a folder such as `D:\movies`, enriches titles with metadata, prepares browser-compatible MP4 files, and serves a React streaming UI over your home network.

The app is optimized for local-network use on desktop, mobile browsers, and TV browsers. It is not designed to be exposed directly to the public internet.

For architecture details, see [DESIGN.md](DESIGN.md).

## What It Does

- Indexes movies and TV episodes from a local folder.
- Detects season and episode structure such as `S01E02` and `Season 01`.
- Ignores clips shorter than the configured duration and skips common extras such as trailers, deleted scenes, samples, and featurettes.
- Enriches metadata through OMDb with fallback API keys.
- Shows only media that is ready or verified compatible on the main browse page.
- Converts incompatible media to mobile-safe MP4.
- Uses NVIDIA NVENC when available, then falls back gracefully.
- Supports Hindi-first audio selection, then English, then source default.
- Extracts compatible embedded subtitles and downloads subtitles from OpenSubtitles.
- Tracks users, sessions, favorites, continue-watching, and viewing history.
- Provides an admin dashboard for scanning, conversion queue control, users, sessions, and conversion logs.
- Runs as a hidden Windows logon task.

## Current Playback Strategy

Browsers and TVs are picky. MKV, HEVC/x265, EAC3, AVI, WMV, PGS subtitles, and many large direct files can fail or be unseekable on mobile devices.

MyFlix therefore prepares a broadly compatible MP4 target:

- Container: MP4
- Video: H.264, max 1080p, bitrate capped
- Audio: AAC stereo
- Pixel format: `yuv420p`
- Fast-start metadata for seekable playback
- No embedded subtitle, data, or chapter streams in the prepared MP4

Background conversion tries encoders in this order:

1. CUDA decode/scale plus NVENC H.264 encode
2. NVENC H.264 encode with CPU decode/scale fallback
3. CPU `libx264` encode as the final fallback

Task Manager can make this confusing. For reliable GPU confirmation, check the NVIDIA `Video Encode` and `Video Decode` graphs or run:

```powershell
nvidia-smi dmon -c 1 -s u
```

## Requirements

- Windows machine for the provided logon service script.
- Node.js and npm.
- FFmpeg and FFprobe.
- A local media folder, default `D:\movies`.
- Optional OMDb API key or keys for metadata.
- Optional OpenSubtitles credentials for subtitle search/download.
- Optional NVIDIA GPU with NVENC support for faster conversions.

The default config points FFmpeg to the Chocolatey install path:

```text
C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe
C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffprobe.exe
```

## Quick Start

Install dependencies:

```powershell
npm install
npm run build
```

Start once in the foreground:

```powershell
npm start
```

Open locally:

```text
http://127.0.0.1:5000/
```

Default admin account:

```text
username: admin
password: admin123
```

Change the admin password after first login.

## Configuration

Primary config:

```text
config/myflix.config.json
```

Secrets and machine-specific overrides:

```text
config/myflix.local.json
```

`config/myflix.local.json` is ignored by Git and should be used for API keys, passwords, certificate paths, and local machine overrides.

Example local config:

```json
{
  "metadata": {
    "omdbApiKeys": ["first-key", "second-key"],
    "maxRequestsPerScan": 500
  },
  "subtitles": {
    "languages": ["en", "hi"],
    "opensubtitles": {
      "apiKey": "your-opensubtitles-api-key",
      "username": "your-opensubtitles-username",
      "password": "your-opensubtitles-password",
      "userAgent": "MyFlix v1.0.0",
      "downloadFormat": "webvtt"
    }
  }
}
```

Important settings:

- `media.root`: folder to scan, default `D:\movies`
- `media.autoScanOnStart`: run an incremental scan when the service starts
- `media.minDurationMinutes`: ignore video files shorter than this, default `15`
- `media.renameMode`: `suggest` stores clean names without moving files; `apply` can rename/move files
- `metadata.omdbApiKeys`: list of OMDb keys; MyFlix falls back to the next key on quota/auth failures
- `auth.sessionDays`: maximum token lifetime, default `180`
- `auth.idleMinutes`: idle session timeout, default `120`
- `server.host`: use `0.0.0.0` for LAN access
- `server.port`: HTTP port, default `5000`
- `server.https.port`: HTTPS port, default `5443`
- `transcoding.ffmpegThreads`: CPU thread count used by FFmpeg
- `transcoding.deleteOriginalAfterPrepare`: delete the source after a prepared MP4 has been promoted

Environment overrides are also supported. Common ones:

```powershell
$env:MYFLIX_MEDIA_ROOT = "D:\movies"
$env:OMDB_API_KEYS = "first-key,second-key"
$env:MYFLIX_OPENSUBTITLES_API_KEY = "your-key"
$env:MYFLIX_SUBTITLE_LANGUAGES = "en,hi"
$env:MYFLIX_SESSION_DAYS = "180"
```

## Local HTTPS

Generate a private local certificate authority and HTTPS certificate:

```powershell
.\scripts\create-local-https-cert.ps1 -HttpsPort 5443 -SessionDays 180
```

The script:

- creates certificate files under `config\certs\`
- trusts the local root CA for the current Windows user
- writes HTTPS config into `config\myflix.local.json`
- enables HTTP to HTTPS redirect when configured

Restart:

```powershell
.\service\myflix-service.ps1 -Action stop
.\service\myflix-service.ps1 -Action start
```

Open:

```text
https://127.0.0.1:5443/
https://YOUR-LAN-IP:5443/
```

Phones, tablets, and TVs will not automatically trust a certificate generated on the Windows host. To remove the browser warning, install this root CA on each device:

```text
config\certs\myflix-local-root-ca.crt
```

## Windows Logon Service

Install as a hidden current-user logon task:

```powershell
.\service\myflix-service.ps1 -Action install
```

Start now:

```powershell
.\service\myflix-service.ps1 -Action start
```

Check status:

```powershell
.\service\myflix-service.ps1 -Action status
```

Stop:

```powershell
.\service\myflix-service.ps1 -Action stop
```

Uninstall:

```powershell
.\service\myflix-service.ps1 -Action uninstall
```

The service wrapper runs without a visible command prompt and writes logs under `logs/`.

## Scanning The Library

Manual incremental scan:

```powershell
npm run scan-library
```

Force a full rescan:

```powershell
npm run scan-library -- --force
```

The scanner:

- walks `media.root`
- skips unchanged files during normal scans
- uses `ffprobe` to read duration, codecs, audio streams, subtitle streams, and resolution
- ignores files shorter than `media.minDurationMinutes`
- detects movies and TV episodes
- stores clean rename suggestions
- enriches metadata from OMDb when enabled
- marks old missing files so stale titles do not keep showing

Main browse pages intentionally hide indexed items until conversion finishes or compatibility is verified.

## Conversion Queue

Open Admin > Conversions.

Useful controls:

- `Convert All to Mobile-Safe MP4`: queues all non-ready files.
- `Pause Queue`: stops after the current running file.
- `Resume Queue`: restarts queued work.
- Encoder mode: `AUTO`, `GPU`, or `CPU`.
- Clear conversion log: hides old conversion records from the admin view without deleting playback data.

Prepared MP4 files are first created under:

```text
transcodes/
```

After successful preparation, the MP4 can be promoted next to the source file. When configured, the original source file is deleted only after the replacement has been written and the database points to the replacement.

## Subtitles

The player supports:

- Existing `.srt` and `.vtt` sidecar files
- Extractable embedded text subtitles
- OpenSubtitles search and download

OpenSubtitles lookup uses:

- movie hash based on the first and last 64 KB of the video
- filename/title search
- IMDb ID when available
- season and episode numbers for TV episodes

Downloaded subtitles are saved as WebVTT sidecars next to the video:

```text
Movie Name.en.opensubtitles-123456.vtt
```

Network calls to OpenSubtitles retry transient errors such as connection resets, timeouts, and 5xx responses.

## Users And Sessions

Users log in with JWT tokens stored by the browser. The backend also stores server-side session records.

Admin > Users supports:

- create users
- edit profiles
- reset passwords
- change admin status
- inspect and clear viewing history

Admin > Sessions supports:

- viewing active sessions
- seeing idle/expired sessions
- cleaning idle sessions
- terminating a session manually

## Project Structure

```text
client/                 React app
client/src/pages/       Browse, watch, admin, search, login pages
config/                 Base config and local ignored overrides
database/               SQLite database initialization and myflix.db
lib/                    Scanner, metadata, transcoder, subtitles, logging
logs/                   Runtime logs
middleware/             Auth middleware
routes/                 Express API routes
scripts/                Helper scripts, including local HTTPS certificate generation
service/                Windows logon task wrapper
transcodes/             Prepared MP4, HLS, subtitle cache
uploads/                Uploaded media/posters when using upload flows
server.js               Express entry point
```

## API Surface

Main route groups:

- `/api/auth`: login, refresh, users, sessions
- `/api/library`: library browse data, scan status, conversion queue, conversion logs
- `/api/movies`: movie CRUD, favorites, continue-watching, progress
- `/api/stream`: playback profile, direct/prepared/HLS media, subtitle serving
- `/api/subtitles`: OpenSubtitles search and download
- `/api/upload`: upload and folder scan flows

Streaming endpoints support HTTP range requests so prepared MP4 playback can seek normally.

## Logs

Useful files:

```text
logs/myflix-app.jsonl
logs/myflix-node.out.log
logs/myflix-node.err.log
logs/myflix-service.out.log
logs/myflix-service.err.log
```

Quick checks:

```powershell
Get-Content .\logs\myflix-app.jsonl -Tail 80
Get-Content .\logs\myflix-node.err.log -Tail 80
.\service\myflix-service.ps1 -Action status
```

The structured log includes request IDs, scan progress, metadata failures, conversion lifecycle events, FFmpeg warnings, playback decisions, stream requests, subtitle downloads, and session cleanup events.

## Troubleshooting

Admin page still shows old UI:

```powershell
Ctrl + F5
```

The server sends `index.html` with `Cache-Control: no-store`, but a hard refresh clears any old browser state.

LAN device cannot open MyFlix:

- Confirm the server is listening on `0.0.0.0`.
- Use the host LAN IP, not `127.0.0.1`, from other devices.
- Allow Node.js through Windows Firewall.
- If HTTPS is enabled, install the local root CA on the device or accept the local certificate warning.

Video does not play on mobile:

- Confirm the title is converted or skipped as already device-safe.
- Check Admin > Conversions.
- Confirm the watch page says it is using a prepared MP4/direct stream, not an original unsupported file.

Conversion seems CPU-heavy:

- Some work always remains on CPU: demuxing, audio, filters, and CPU decode fallback.
- For GPU activity, check NVIDIA `Video Encode`, not only the Task Manager process GPU column.
- Run `nvidia-smi dmon -c 1 -s u`.

Files cannot be renamed:

- Stop MyFlix with `.\service\myflix-service.ps1 -Action stop`.
- Confirm no `ffmpeg.exe` process is still running.
- The app attempts to stop child transcode jobs on shutdown.

## Updating

Pull latest changes:

```powershell
git pull
npm install
npm run build
.\service\myflix-service.ps1 -Action stop
.\service\myflix-service.ps1 -Action start
```

Back up the database:

```powershell
Copy-Item .\database\myflix.db .\database\myflix.backup.db
```

## Design Notes

See [DESIGN.md](DESIGN.md) for the detailed architecture, data model, conversion pipeline, failure handling, and operations model.

## License

MIT. See [LICENSE](LICENSE).
