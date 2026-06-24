const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getVideoDuration } = require('../services/ffmpeg');

const CLIPS_DIR = path.join(__dirname, '../../clips');
const META_FILE = path.join(CLIPS_DIR, 'clips.json');

function readMeta() {
  if (!fs.existsSync(META_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; }
}

function writeMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
  destination: CLIPS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.gif'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Formato no soportado'));
  }
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió fichero' });

  const duration = getVideoDuration(req.file.path) || 0;
  const entry = {
    clipId: req.file.filename,
    originalName: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    duration,
    uploadedAt: new Date().toISOString()
  };

  const meta = readMeta();
  meta.push(entry);
  writeMeta(meta);

  res.json(entry);
});

router.get('/list', (req, res) => {
  res.json(readMeta());
});

router.delete('/:clipId', (req, res) => {
  const { clipId } = req.params;
  const meta = readMeta();
  const idx = meta.findIndex(c => c.clipId === clipId);
  if (idx === -1) return res.status(404).json({ error: 'Clip no encontrado' });

  const entry = meta[idx];
  const filePath = path.join(CLIPS_DIR, entry.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  meta.splice(idx, 1);
  writeMeta(meta);
  res.json({ ok: true });
});

router.get('/stream/:clipId', (req, res) => {
  const meta = readMeta();
  const entry = meta.find(c => c.clipId === req.params.clipId);
  if (!entry) return res.status(404).send('Not found');

  const filePath = path.join(CLIPS_DIR, entry.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
});

module.exports = router;
