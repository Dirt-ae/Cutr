import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, 'bin');

function downloadWithRedirects(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadWithRedirects(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.chmodSync(dest, 0o755);
        resolve();
      });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureYtDlp() {
  const dest = path.join(binDir, 'yt-dlp-standalone');
  if (fs.existsSync(dest)) return;
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  try {
    await downloadWithRedirects(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
      dest
    );
    console.log('yt-dlp downloaded');
  } catch (e) {
    console.error('yt-dlp download failed:', e.message);
  }
}

async function ensureFfmpeg() {
  const dest = path.join(binDir, 'ffmpeg');
  if (fs.existsSync(dest)) return;
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const urls = [
    'https://github.com/eugeneware/ffmpeg-static/releases/download/b7.0/ffmpeg-linux-x64',
    'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64'
  ];
  for (const url of urls) {
    try {
      await downloadWithRedirects(url, dest);
      console.log('ffmpeg downloaded');
      return;
    } catch (e) {
      console.error('ffmpeg download failed:', url, e.message);
    }
  }
}

// Run downloads in background without blocking
export function startBinaryDownloads() {
  ensureYtDlp();
  ensureFfmpeg();
}
