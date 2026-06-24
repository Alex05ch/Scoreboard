const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { exportVideo } = require('../services/ffmpeg');
const { createJob, getJob } = require('../utils/jobs');

const EXPORTS_DIR = path.join(__dirname, '../../exports');

router.post('/start', async (req, res) => {
  const { project } = req.body;
  if (!project || !project.videoId) return res.status(400).json({ error: 'Proyecto inválido' });

  const jobId = uuidv4();
  createJob(jobId, 'export');
  res.json({ jobId });

  exportVideo(project, jobId).catch(err => {
    console.error('Export error:', err.message);
  });
});

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const jobId = req.params.jobId;
  const interval = setInterval(() => {
    const job = getJob(jobId);
    if (!job) { clearInterval(interval); res.end(); return; }

    res.write(`data: ${JSON.stringify(job)}\n\n`);

    if (job.status === 'done' || job.status === 'error') {
      clearInterval(interval);
      setTimeout(() => res.end(), 500);
    }
  }, 500);

  req.on('close', () => clearInterval(interval));
});

router.get('/download/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'Export no listo' });

  const filePath = job.result?.outputFile;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichero no encontrado' });

  res.download(filePath, `padel_export_${req.params.jobId.slice(0, 8)}.mp4`);
});

module.exports = router;
