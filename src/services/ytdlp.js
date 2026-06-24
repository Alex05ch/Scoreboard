const { spawn } = require('child_process');
const path = require('path');
const { updateJob } = require('../utils/jobs');
const { YTDLP, FFMPEG } = require('../utils/exePaths');

const VIDEOS_DIR = path.join(__dirname, '../../videos');

function extractVideoId(url) {
  const patterns = [
    /(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function downloadVideo(url, jobId) {
  return new Promise((resolve, reject) => {
    const videoId = extractVideoId(url);
    if (!videoId) return reject(new Error('URL de YouTube no válida'));

    const outputPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
    const ffmpegDir = path.dirname(FFMPEG);

    // Usar & "ruta_completa" para que PowerShell ejecute el binario directamente
    // aunque no esté en el PATH del proceso sin perfil
    const psCmd = [
      `& "${YTDLP}"`,
      '-f', '"bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', `"${ffmpegDir}"`,
      '--no-playlist',
      '--newline',
      '-o', `"${outputPath}"`,
      `"${url}"`
    ].join(' ');

    console.log('[yt-dlp] YTDLP path:', YTDLP);
    console.log('[yt-dlp] Comando:', psCmd);

    const proc = spawn('powershell', ['-NoProfile', '-Command', psCmd]);
    let stderrBuf = '';
    let title = null;

    // yt-dlp escribe el progreso en stderr
    proc.stderr.on('data', data => {
      const text = data.toString();
      stderrBuf += text;
      for (const line of text.split('\n')) {
        const pct  = line.match(/(\d+\.?\d*)%/);
        const spd  = line.match(/([\d.]+[KMG]iB\/s)/);
        if (pct) {
          updateJob(jobId, {
            status: 'running',
            progress: parseFloat(pct[1]),
            stage: 'Descargando' + (spd ? ` · ${spd[1]}` : '')
          });
        }
      }
    });

    proc.stdout.on('data', data => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        const pct = line.match(/(\d+\.?\d*)%/);
        const spd = line.match(/([\d.]+[KMG]iB\/s)/);
        if (pct) {
          updateJob(jobId, {
            status: 'running',
            progress: parseFloat(pct[1]),
            stage: 'Descargando' + (spd ? ` · ${spd[1]}` : '')
          });
        }
        // Capturar título del vídeo de la línea "[info] ...: Downloading..."
        const titleMatch = line.match(/\[info\] [^:]+: Downloading \d+ format/);
        if (titleMatch && !title) {
          const m = line.match(/\[download\] Destination:.*?([^\\\/]+)\.f\d+\./);
          if (m) title = m[1];
        }
        const destMatch = line.match(/\[Merger\] Merging formats into "(.+?)"/);
        if (destMatch && !title) {
          title = path.basename(destMatch[1], path.extname(destMatch[1]));
        }
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        updateJob(jobId, { status: 'done', progress: 100, result: { videoId, outputPath, title } });
        resolve({ videoId, outputPath, title });
      } else {
        console.error('[yt-dlp] Falló con código', code, '\n', stderrBuf.slice(-600));
        const msg = stderrBuf.slice(-300) || `Código de salida: ${code}`;
        updateJob(jobId, { status: 'error', error: msg });
        reject(new Error(msg));
      }
    });

    proc.on('error', err => {
      console.error('[yt-dlp spawn error]', err);
      updateJob(jobId, { status: 'error', error: err.message });
      reject(err);
    });
  });
}

module.exports = { downloadVideo, extractVideoId };
