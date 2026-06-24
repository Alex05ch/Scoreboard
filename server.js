const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

const DIRS = ['videos', 'clips', 'exports', 'projects', 'temp', 'sfx'].map(d => path.join(__dirname, d));
DIRS.forEach(d => fs.mkdirSync(d, { recursive: true }));

const { YTDLP, FFMPEG, FFPROBE } = require('./src/utils/exePaths');

console.log('\nRutas resueltas:');
console.log(`  yt-dlp  : ${YTDLP}`);
console.log(`  ffmpeg  : ${FFMPEG}`);
console.log(`  ffprobe : ${FFPROBE}`);
console.log('');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/video', require('./src/routes/video'));
app.use('/api/clips', require('./src/routes/clips'));
app.use('/api/sfx', require('./src/routes/sfx'));
app.use('/api/export', require('./src/routes/export'));
app.use('/api/project', require('./src/routes/project'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Padel Scoreboard corriendo en http://localhost:${PORT}\n`);
});

// Timeout largo para subidas de vídeo grandes (iPhone = varios GB)
server.timeout = 30 * 60 * 1000; // 30 minutos
