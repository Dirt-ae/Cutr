import fs from 'fs';
import https from 'https';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, 'bin');

const commandExists = (command, args = ['-version']) => {
  try {
    execFileSync(command, args, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

const getYtDlpAsset = () => {
  if (process.platform === 'win32') return { fileName: 'yt-dlp-standalone.exe', assetName: 'yt-dlp.exe' };
  if (process.platform === 'darwin') return { fileName: 'yt-dlp-standalone', assetName: 'yt-dlp_macos' };
  return { fileName: 'yt-dlp-standalone', assetName: 'yt-dlp_linux' };
};

function downloadWithRedirects(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadWithRedirects(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const tempDest = `${dest}.download`;
      const file = fs.createWriteStream(tempDest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.renameSync(tempDest, dest);
        fs.chmodSync(dest, 0o755);
        resolve();
      });
      file.on('error', (error) => {
        fs.rmSync(tempDest, { force: true });
        reject(error);
      });
    }).on('error', reject);
  });
}

async function ensureYtDlp() {
  if (commandExists('yt-dlp', ['--version'])) return;

  const { fileName, assetName } = getYtDlpAsset();
  const dest = path.join(binDir, fileName);
  if (fs.existsSync(dest)) return;
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  try {
    await downloadWithRedirects(
      `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`,
      dest
    );
    console.log('yt-dlp downloaded');
  } catch (e) {
    console.error('yt-dlp download failed:', e.message);
  }
}

async function ensureFfmpeg() {
  if (commandExists('ffmpeg')) return;

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
