const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const PROJECTS_DIR = path.join(__dirname, '../../projects');

router.post('/save', (req, res) => {
  const { project } = req.body;
  if (!project) return res.status(400).json({ error: 'Proyecto vacío' });

  const id = `project_${Date.now()}`;
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ id, savedAt: new Date().toISOString(), project }, null, 2));
  res.json({ id });
});

router.get('/list', (req, res) => {
  const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
      return {
        id: data.id,
        savedAt: data.savedAt || data.project?.savedAt,
        videoId: data.project?.videoId,
        videoName: data.project?.videoName
      };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  res.json(list);
});

router.get('/load/:id', (req, res) => {
  const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});

module.exports = router;
