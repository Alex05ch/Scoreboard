const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { downloadVideo, extractVideoId } = require('../services/ytdlp');
const { getVideoInfo } = require('../services/ffmpeg');
const { createJob, getJob } = require('../utils/jobs');

const VIDEOS_DIR = path.join(__dirname, '../../videos');
const META_FILE = path.join(VIDEOS_DIR, 'videos.json');

function readMeta() {
  if (!fs.existsSync(META_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return {}; }
}
function saveMeta(videoId, fields) {
  const meta = readMeta();
  meta[videoId] = { ...(meta[videoId] || {}), ...fields };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  return meta[videoId];
}

// ── Local video upload ────────────────────────────────
const storage = multer.diskStorage({
  destination: VIDEOS_DIR,
  filename: (req, file, cb) => cb(null, `local_${uuidv4()}${path.extname(file.originalname) || '.mp4'}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Formato no soportado'));
  }
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió fichero' });
  const videoId = req.file.filename.replace(path.extname(req.file.filename), '');
  const destPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
  if (req.file.path !== destPath) fs.renameSync(req.file.path, destPath);
  const name = path.basename(req.file.originalname, path.extname(req.file.originalname));
  saveMeta(videoId, { name, originalName: req.file.originalname, source: 'local', addedAt: new Date().toISOString() });
  res.json({ videoId, name });
});

// ── YouTube download ──────────────────────────────────
router.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL de YouTube no válida' });

  const existingPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
  if (fs.existsSync(existingPath)) {
    const meta = readMeta();
    return res.json({ videoId, cached: true, name: meta[videoId]?.name || videoId });
  }

  const jobId = uuidv4();
  createJob(jobId, 'download');
  res.json({ jobId, videoId });

  downloadVideo(url, jobId).then(({ title }) => {
    saveMeta(videoId, { name: title || videoId, url, source: 'youtube', addedAt: new Date().toISOString() });
  }).catch(err => console.error('Download error:', err.message));
});

router.get('/download/progress/:jobId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const jobId = req.params.jobId;
  const interval = setInterval(() => {
    const job = getJob(jobId);
    if (!job) { clearInterval(interval); res.end(); return; }
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    if (job.status === 'done' || job.status === 'error') { clearInterval(interval); setTimeout(() => res.end(), 500); }
  }, 500);
  req.on('close', () => clearInterval(interval));
});

// ── Rename ────────────────────────────────────────────
router.put('/rename/:videoId', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nombre vacío' });
  res.json(saveMeta(req.params.videoId, { name: name.trim() }));
});

// ── Info & list ───────────────────────────────────────
router.get('/info/:videoId', (req, res) => {
  const filePath = path.join(VIDEOS_DIR, `${req.params.videoId}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Vídeo no encontrado' });
  const info = getVideoInfo(filePath);
  if (!info) return res.status(500).json({ error: 'No se pudo leer info del vídeo' });
  const meta = readMeta();
  res.json({ ...info, ...(meta[req.params.videoId] || {}), videoId: req.params.videoId });
});

router.get('/list', (req, res) => {
  const meta = readMeta();
  const files = fs.readdirSync(VIDEOS_DIR).filter(f => f.endsWith('.mp4'));
  res.json(files.map(f => {
    const videoId = f.replace('.mp4', '');
    return { videoId, name: meta[videoId]?.name || videoId, ...(meta[videoId] || {}) };
  }));
});

// ── Streaming ─────────────────────────────────────────
router.get('/stream/:videoId', (req, res) => {
  const filePath = path.join(VIDEOS_DIR, `${req.params.videoId}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
});

module.exports = router;
