const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { secsToHMS, hmsToSecs } = require('../utils/timecode');
const { updateJob } = require('../utils/jobs');
const { FFMPEG, FFPROBE } = require('../utils/exePaths');

const VIDEOS_DIR = path.join(__dirname, '../../videos');
const CLIPS_DIR = path.join(__dirname, '../../clips');
const EXPORTS_DIR = path.join(__dirname, '../../exports');
const TEMP_DIR = path.join(__dirname, '../../temp');

function escapeDrawtext(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "’")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function runPsSync(cmd) {
  return spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', windowsHide: true });
}

function getVideoDuration(filePath) {
  const cmd = `& "${FFPROBE}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  const r = runPsSync(cmd);
  const val = parseFloat((r.stdout || '').trim());
  return isNaN(val) ? null : val;
}

function getVideoInfo(filePath) {
  const cmd = `& "${FFPROBE}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`;
  const r = runPsSync(cmd);
  const out = (r.stdout || '').trim();
  if (!out) return null;
  const [width, height] = out.split(',').map(Number);
  const duration = getVideoDuration(filePath);
  return { width, height, duration };
}

const POINT_LABELS = ['0', '15', '30', '40', 'AD'];

function displayPoint(raw, opponentRaw, isTiebreak, isGoldenPoint) {
  if (isTiebreak) return String(raw);
  if (isGoldenPoint && raw === 3 && opponentRaw === 3) return 'GP';
  if (raw >= 4) return 'AD';
  return POINT_LABELS[raw] || '0';
}

function buildScoreText(snapshot) {
  if (!snapshot) return { row1: '', row2: '', setHistory: '' };
  const { players, sets, currentSet, game } = snapshot;
  const p0 = players[0]?.name || 'Equipo A';
  const p1 = players[1]?.name || 'Equipo B';

  const setStr0 = sets.map(s => s.scores[0]).join(' ');
  const setStr1 = sets.map(s => s.scores[1]).join(' ');
  const curG0 = currentSet?.scores[0] ?? 0;
  const curG1 = currentSet?.scores[1] ?? 0;
  const gpt0 = displayPoint(game?.points[0] ?? 0, game?.points[1] ?? 0, game?.isTiebreak, game?.isGoldenPoint);
  const gpt1 = displayPoint(game?.points[1] ?? 0, game?.points[0] ?? 0, game?.isTiebreak, game?.isGoldenPoint);

  const setsDisplay0 = sets.length ? `${setStr0} ${curG0}` : `${curG0}`;
  const setsDisplay1 = sets.length ? `${setStr1} ${curG1}` : `${curG1}`;

  return {
    row1: `${p0}  ${setsDisplay0}  ${gpt0}`,
    row2: `${p1}  ${setsDisplay1}  ${gpt1}`,
    isTiebreak: game?.isTiebreak
  };
}

function buildDrawtextFilter(snapshot, videoWidth, videoHeight) {
  const { row1, row2, isTiebreak } = buildScoreText(snapshot);
  const boxW = Math.min(Math.max(videoWidth * 0.45, 320), 600);
  const boxH = 70;
  const boxX = 10;
  const boxY = 10;
  const fontSize = 18;

  const r1 = escapeDrawtext(row1);
  const r2 = escapeDrawtext(row2);
  const tbTag = isTiebreak ? escapeDrawtext(' [TB]') : '';

  return [
    `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.75:t=fill`,
    `drawtext=fontsize=${fontSize}:fontcolor=white:x=${boxX + 8}:y=${boxY + 10}:text='${r1}'`,
    `drawtext=fontsize=${fontSize}:fontcolor=white:x=${boxX + 8}:y=${boxY + 38}:text='${r2}${tbTag}'`
  ].join(',');
}

function findActiveSnapshot(timeline, timeSec) {
  if (!timeline || timeline.length === 0) return null;
  let active = null;
  for (const entry of timeline) {
    if (entry.videoTime <= timeSec) active = entry.state;
    else break;
  }
  return active;
}

function buildSegmentList(videoDuration, slowmoRegions, clipInsertions) {
  const boundaries = new Set([0, videoDuration]);
  for (const r of slowmoRegions) {
    boundaries.add(Math.max(0, r.startSec));
    boundaries.add(Math.min(videoDuration, r.endSec));
  }
  for (const c of clipInsertions) {
    boundaries.add(Math.min(videoDuration, c.insertAtSec));
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments = [];

  const sortedClips = [...clipInsertions].sort((a, b) => a.insertAtSec - b.insertAtSec);

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end - start < 0.01) continue;

    const slowmo = slowmoRegions.find(r => r.startSec <= start && r.endSec >= end);
    segments.push({ type: 'main', start, end, speed: slowmo ? slowmo.speed : 1 });

    const clipsHere = sortedClips.filter(c => Math.abs(c.insertAtSec - end) < 0.01);
    for (const c of clipsHere) {
      segments.push({ type: 'clip', clipId: c.clipId, clipPath: path.join(CLIPS_DIR, c.clipId) });
    }
  }

  return segments;
}

async function runFFmpeg(args, onProgress, totalDuration) {
  return new Promise((resolve, reject) => {
    const allArgs = [...args, '-progress', 'pipe:1', '-nostats'];
    // Usar & "ruta_completa" para invocar ffmpeg independientemente del PATH
    const quotedArgs = allArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
    const psCmd = `& "${FFMPEG}" ${quotedArgs}`;
    const proc = spawn('powershell', ['-NoProfile', '-Command', psCmd]);
    let stderr = '';

    proc.stdout.on('data', data => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('out_time=') && totalDuration) {
          const t = hmsToSecs(line.replace('out_time=', '').trim());
          if (!isNaN(t)) onProgress(Math.min(99, (t / totalDuration) * 100));
        }
      }
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });

    proc.on('error', err => {
      reject(new Error(err.code === 'ENOENT' ? 'ffmpeg no encontrado. Instálalo con: winget install Gyan.FFmpeg' : err.message));
    });
  });
}

async function exportVideo(project, jobId) {
  const { videoId, scoreboard, slowmoRegions = [], clipInsertions = [], sfxInsertions = [] } = project;
  const videoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
  const info = getVideoInfo(videoPath);
  if (!info) throw new Error('No se pudo leer el vídeo. ¿Está descargado?');

  const { width, height, duration } = info;
  const timeline = scoreboard?.timeline || [];
  const tempDir = path.join(TEMP_DIR, jobId);
  fs.mkdirSync(tempDir, { recursive: true });

  const segments = buildSegmentList(duration, slowmoRegions, clipInsertions);
  const segmentFiles = [];
  const totalSegments = segments.length;

  updateJob(jobId, { status: 'running', stage: 'Procesando segmentos...' });

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segFile = path.join(tempDir, `seg_${i}.mp4`);
    segmentFiles.push(segFile);

    const segProgress = (pct) => {
      const overall = ((i + pct / 100) / (totalSegments + 1)) * 100;
      updateJob(jobId, { progress: Math.round(overall), stage: `Segmento ${i + 1}/${totalSegments}` });
    };

    if (seg.type === 'clip') {
      await runFFmpeg([
        '-i', seg.clipPath,
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-ar', '44100',
        '-y', segFile
      ], segProgress, null);
    } else {
      const segDur = (seg.end - seg.start) / seg.speed;
      const snapshot = findActiveSnapshot(timeline, seg.start);
      const dtFilter = buildDrawtextFilter(snapshot, width, height);

      const vfFilters = [];
      if (seg.speed !== 1) vfFilters.push(`setpts=${(1 / seg.speed).toFixed(4)}*PTS`);
      vfFilters.push(dtFilter);

      const args = [
        '-ss', String(seg.start), '-to', String(seg.end),
        '-i', videoPath,
        '-vf', vfFilters.join(','),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-ar', '44100'
      ];
      if (seg.speed !== 1) args.push('-af', `atempo=${seg.speed}`);
      args.push('-y', segFile);

      await runFFmpeg(args, segProgress, segDur);
    }
  }

  updateJob(jobId, { stage: 'Concatenando...', progress: 95 });

  const concatList = path.join(tempDir, 'concat.txt');
  fs.writeFileSync(concatList, segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));

  const SFX_DIR = path.join(__dirname, '../../sfx');
  const concatFile = path.join(tempDir, 'concat_raw.mp4');
  const outputFile = path.join(EXPORTS_DIR, `${jobId}.mp4`);

  const muteRegions = sfxInsertions.filter(s => s.muteMain);
  const needsAudioProcess = sfxInsertions.length > 0 || muteRegions.length > 0;

  if (needsAudioProcess) {
    await runFFmpeg(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-y', concatFile], () => {}, null);

    updateJob(jobId, { stage: 'Mezclando audio...', progress: 97 });

    const sfxArgs = ['-i', concatFile];
    const filterParts = [];

    // Base audio con zonas silenciadas
    if (muteRegions.length > 0) {
      const muteExpr = muteRegions
        .map(s => `between(t,${s.insertAtSec.toFixed(3)},${(s.insertAtSec + (s.duration || 1)).toFixed(3)})`)
        .join('+');
      filterParts.push(`[0:a]volume=enable='${muteExpr}':volume=0,aformat=sample_rates=44100:channel_layouts=stereo[base]`);
    } else {
      filterParts.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo[base]`);
    }

    const mixInputs = ['[base]'];

    sfxInsertions.forEach((s, i) => {
      const sfxPath = path.join(SFX_DIR, s.sfxId);
      sfxArgs.push('-i', sfxPath);
      const delayMs = Math.round(s.insertAtSec * 1000);
      filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs},aformat=sample_rates=44100:channel_layouts=stereo[sfx${i}]`);
      mixInputs.push(`[sfx${i}]`);
    });

    filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[aout]`);

    sfxArgs.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100',
      '-y', outputFile
    );
    await runFFmpeg(sfxArgs, () => {}, null);
  } else {
    await runFFmpeg(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-y', outputFile], () => {}, null);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });

  updateJob(jobId, { status: 'done', progress: 100, stage: 'Completado', result: { outputFile } });
  return outputFile;
}

module.exports = { exportVideo, getVideoDuration, getVideoInfo };
