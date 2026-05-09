import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, 'bin');
const outputPath = path.join(binDir, 'yt-dlp-standalone');

function isPythonScript(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(64);
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    const header = buf.toString('utf8');
    return header.includes('python') || header.includes('Python');
  } catch {
    return false;
  }
}

function downloadWithRedirects(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadWithRedirects(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download yt-dlp: HTTP ${res.statusCode}`));
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
  if (fs.existsSync(outputPath) && !isPythonScript(outputPath)) {
    console.log('Standalone yt-dlp already present');
    return;
  }

  // Also check if youtube-dl-exec already gave us a standalone binary
  try {
    const youtubeDl = await import('youtube-dl-exec');
    const execPath = youtubeDl.default?.constants?.YOUTUBE_DL_PATH;
    if (execPath && fs.existsSync(execPath) && !isPythonScript(execPath)) {
      console.log('youtube-dl-exec provides a standalone binary');
      return;
    }
  } catch {
    // ignore
  }

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  console.log('Downloading standalone yt-dlp binary for Linux...');
  await downloadWithRedirects(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    outputPath
  );
  console.log('Standalone yt-dlp downloaded successfully');
}

main().catch(e => {
  console.error('Failed to download yt-dlp:', e.message);
  process.exit(1);
});
