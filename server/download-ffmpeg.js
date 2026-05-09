import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, 'bin');
const outputPath = path.join(binDir, 'ffmpeg');

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

async function main() {
  if (fs.existsSync(outputPath)) {
    console.log('ffmpeg already present');
    return;
  }

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const urls = [
    'https://github.com/eugeneware/ffmpeg-static/releases/download/b7.0/ffmpeg-linux-x64',
    'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64'
  ];

  for (const url of urls) {
    try {
      console.log(`Trying: ${url}`);
      await downloadWithRedirects(url, outputPath);
      console.log('ffmpeg downloaded successfully');
      return;
    } catch (e) {
      console.log(`Failed: ${e.message}`);
    }
  }

  console.warn('Could not download ffmpeg; 1080p YouTube merge will be disabled');
}

main().catch(e => {
  console.error('ffmpeg download error:', e.message);
  process.exit(0); // Don't block server startup
});
