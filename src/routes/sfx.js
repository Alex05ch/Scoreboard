const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { spawnSync } = require('child_process');
const { FFPROBE } = require('../utils/exePaths');

const SFX_DIR = path.join(__dirname, '../../sfx');
const META_FILE = path.join(SFX_DIR, 'sfx.json');
fs.mkdirSync(SFX_DIR, { recursive: true });

function readMeta() {
  if (!fs.existsSync(META_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; }
}
function writeMeta(data) { fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2)); }

function getAudioDuration(filePath) {
  const r = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `& "${FFPROBE}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
  ], { encoding: 'utf8', windowsHide: true });
  const val = parseFloat((r.stdout || '').trim());
  return isNaN(val) ? 0 : val;
}

const storage = multer.diskStorage({
  destination: SFX_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Formato no soportado. Usa MP3, WAV, OGG, AAC, M4A'));
  }
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió fichero' });
  const duration = getAudioDuration(req.file.path);
  const entry = {
    sfxId: req.file.filename,
    originalName: req.file.originalname,
    name: path.basename(req.file.originalname, path.extname(req.file.originalname)),
    filename: req.file.filename,
    duration,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  };
  const meta = readMeta();
  meta.push(entry);
  writeMeta(meta);
  res.json(entry);
});

router.get('/list', (req, res) => res.json(readMeta()));

router.put('/rename/:sfxId', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nombre vacío' });
  const meta = readMeta();
  const entry = meta.find(s => s.sfxId === req.params.sfxId);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  entry.name = name.trim();
  writeMeta(meta);
  res.json(entry);
});

router.delete('/:sfxId', (req, res) => {
  const meta = readMeta();
  const idx = meta.findIndex(s => s.sfxId === req.params.sfxId);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  const filePath = path.join(SFX_DIR, meta[idx].filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  meta.splice(idx, 1);
  writeMeta(meta);
  res.json({ ok: true });
});

const MIME = { '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.aac':'audio/aac', '.m4a':'audio/mp4', '.flac':'audio/flac' };

router.get('/stream/:sfxId', (req, res) => {
  const meta = readMeta();
  const entry = meta.find(s => s.sfxId === req.params.sfxId);
  if (!entry) return res.status(404).send('Not found');
  const filePath = path.join(SFX_DIR, entry.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  const ext = path.extname(entry.filename).toLowerCase();
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
