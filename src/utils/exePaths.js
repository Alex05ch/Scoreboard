const { spawnSync } = require('child_process');
const fs = require('fs');

// Rutas conocidas de instalaciones WinGet comunes
const KNOWN_PATHS = {
  'yt-dlp': [
    process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\yt-dlp.exe',
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',
  ],
  'ffmpeg': [
    process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Packages\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-N-124716-g054dffd133-win64-gpl\\bin\\ffmpeg.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
  ],
  'ffprobe': [
    process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Packages\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-N-124716-g054dffd133-win64-gpl\\bin\\ffprobe.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffprobe.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffprobe.exe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
  ]
};

function resolveExe(name) {
  // 1. Buscar con where.exe (busca en PATH del proceso actual)
  const where = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
  if (!where.error && where.status === 0) {
    const found = where.stdout.trim().split('\n')[0].trim();
    if (found && fs.existsSync(found)) return found;
  }

  // 2. Buscar con PowerShell Get-Command (carga entorno completo del usuario)
  const ps = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `(Get-Command '${name}' -ErrorAction SilentlyContinue).Source`
  ], { encoding: 'utf8', windowsHide: true });
  const psFound = (ps.stdout || '').trim();
  if (psFound && fs.existsSync(psFound)) return psFound;

  // 3. Buscar en rutas conocidas de WinGet/Chocolatey
  for (const candidate of KNOWN_PATHS[name] || []) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // 4. Fallback: asumir que está en PATH
  return name;
}

const YTDLP   = resolveExe('yt-dlp');
const FFMPEG  = resolveExe('ffmpeg');
const FFPROBE = resolveExe('ffprobe');

console.log(`  yt-dlp  : ${YTDLP}`);
console.log(`  ffmpeg  : ${FFMPEG}`);
console.log(`  ffprobe : ${FFPROBE}`);

module.exports = { YTDLP, FFMPEG, FFPROBE };
