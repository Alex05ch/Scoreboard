import api from './api.js';
import { Player } from './player.js';
import { ScoreboardState, ScoreboardUI } from './scoreboard.js';
import { Timeline } from './timeline.js';
import { ClipLibrary } from './clipLibrary.js';
import { SfxLibrary } from './sfxLibrary.js';
import { SfxPlayer } from './sfxPlayer.js';
import { Exporter } from './exporter.js';

const project = { videoId: null, _youtubeUrl: null, videoName: null };

// ── Instances ──────────────────────────────────────────────────
const player = new Player(
  document.getElementById('main-video'),
  document.getElementById('video-placeholder')
);
const sbState = new ScoreboardState();
const sbUI = new ScoreboardUI(sbState, document.getElementById('scoreboard-overlay'), document.getElementById('score-controls'));
const timeline = new Timeline(document.getElementById('timeline-section'), player, sbState);
const clipLibrary = new ClipLibrary(document.getElementById('right-panel'), () => {});
const sfxLibrary = new SfxLibrary(document.getElementById('sfx-library'));
const sfxPlayer = new SfxPlayer(document.getElementById('main-video'), () => timeline.sfxInsertions);
const exporter = new Exporter(document.getElementById('progress-overlay'));

sbState.setOnChange(() => { sbUI.render(); timeline.redraw(); });

// ── YouTube download ───────────────────────────────────────────
document.getElementById('btn-load').addEventListener('click', async () => {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;
  project._youtubeUrl = url;
  const btn = document.getElementById('btn-load');
  btn.disabled = true; btn.textContent = 'Descargando...';
  try {
    const result = await api.post('/api/video/download', { url });
    if (result.cached) {
      await _loadVideo(result.videoId, result.name);
      btn.textContent = 'Cargar YT'; btn.disabled = false;
    } else {
      api.sseStream(`/api/video/download/progress/${result.jobId}`, data => {
        btn.textContent = `${Math.round(data.progress || 0)}%`;
      }, async data => {
        if (data.status === 'done') {
          const info = await api.get(`/api/video/info/${result.videoId}`).catch(() => ({}));
          await _loadVideo(result.videoId, info.name || result.videoId);
        } else {
          alert('Error descargando:\n' + (data.error || 'desconocido'));
        }
        btn.textContent = 'Cargar YT'; btn.disabled = false;
      });
    }
  } catch (e) {
    alert('Error: ' + e.message);
    btn.textContent = 'Cargar YT'; btn.disabled = false;
  }
});

// ── Local video upload ─────────────────────────────────────────
document.getElementById('local-video-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const label = document.getElementById('btn-upload-local');
  label.style.opacity = '0.5'; label.style.pointerEvents = 'none';
  try {
    const result = await api.uploadFile('/api/video/upload', file, 'file', pct => {
      label.childNodes[0].textContent = ` Subiendo ${pct}%`;
    });
    await _loadVideo(result.videoId, result.name || file.name);
  } catch (err) {
    alert('Error subiendo vídeo: ' + err.message);
  } finally {
    label.style.opacity = ''; label.style.pointerEvents = '';
    label.childNodes[0].textContent = '📂 Subir vídeo';
    e.target.value = '';
  }
});

// ── Load video helper ──────────────────────────────────────────
async function _loadVideo(videoId, name) {
  project.videoId = videoId;
  project.videoName = name || videoId;
  player.load(videoId);
  sbUI.show();
  _showVideoName(project.videoName);
  try {
    const info = await api.get(`/api/video/info/${videoId}`);
    timeline.setDuration(info.duration || 0);
    if (info.name) { project.videoName = info.name; _showVideoName(info.name); }
  } catch {}
}

function _showVideoName(name) {
  const el = document.getElementById('video-name-display');
  const btn = document.getElementById('btn-rename-video');
  el.textContent = name;
  el.style.display = 'inline';
  btn.style.display = 'inline-block';
}

// ── Rename video ───────────────────────────────────────────────
document.getElementById('btn-rename-video').addEventListener('click', async () => {
  if (!project.videoId) return;
  const newName = prompt('Nuevo nombre para el vídeo:', project.videoName || '');
  if (!newName?.trim()) return;
  try {
    await api.post(`/api/video/rename/${project.videoId}`, { name: newName.trim() });
    project.videoName = newName.trim();
    _showVideoName(project.videoName);
  } catch (e) { alert('Error: ' + e.message); }
});

// Nota: api.post usa fetch con método POST; necesitamos PUT para rename
// Parche: sobreescribir con PUT
const _origPost = api.post.bind(api);
api.put = async (url, body) => {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
};
document.getElementById('btn-rename-video').addEventListener('click', () => {}, { once: false });
// Reemplazar listener con versión que usa PUT
document.getElementById('btn-rename-video').replaceWith(document.getElementById('btn-rename-video').cloneNode(true));
document.getElementById('btn-rename-video').addEventListener('click', async () => {
  if (!project.videoId) return;
  const newName = prompt('Nuevo nombre para el vídeo:', project.videoName || '');
  if (!newName?.trim()) return;
  try {
    const res = await fetch(`/api/video/rename/${project.videoId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (res.ok) { project.videoName = newName.trim(); _showVideoName(project.videoName); }
  } catch (e) { alert('Error: ' + e.message); }
});

// ── Score buttons ───────────────────────────────────────────────
document.getElementById('btn-point-0').addEventListener('click', () => sbState.pointWon(0, player.getCurrentTime()));
document.getElementById('btn-point-1').addEventListener('click', () => sbState.pointWon(1, player.getCurrentTime()));
document.getElementById('btn-undo').addEventListener('click', () => { sbState.undoLastPoint(); timeline.redraw(); });
document.getElementById('btn-reset-score').addEventListener('click', () => {
  if (confirm('¿Resetear el marcador completamente?')) { sbState.reset(); sbUI.render(); timeline.redraw(); }
});

// ── Player names ───────────────────────────────────────────────
document.getElementById('name-0').addEventListener('input', e => { sbState.players[0].name = e.target.value || 'Equipo A'; sbUI.render(); });
document.getElementById('name-1').addEventListener('input', e => { sbState.players[1].name = e.target.value || 'Equipo B'; sbUI.render(); });

// ── Golden point ────────────────────────────────────────────────
document.getElementById('toggle-golden').addEventListener('change', e => { sbState.game.isGoldenPoint = e.target.checked; sbUI.render(); });

// ── Slow motion ────────────────────────────────────────────────
let slowmoStart = null;
document.getElementById('btn-slowmo-start').addEventListener('click', () => {
  slowmoStart = player.getCurrentTime();
  document.getElementById('btn-slowmo-start').textContent = `Desde ${player.formatTime(slowmoStart)}`;
  document.getElementById('btn-slowmo-end').disabled = false;
});
document.getElementById('btn-slowmo-end').addEventListener('click', () => {
  const end = player.getCurrentTime();
  if (slowmoStart === null || end <= slowmoStart) { alert('El punto final debe ser mayor que el inicial'); return; }
  const speed = parseFloat(document.getElementById('slowmo-speed').value);
  timeline.addSlowmoRegion(slowmoStart, end, speed);
  slowmoStart = null;
  document.getElementById('btn-slowmo-start').textContent = 'Marcar inicio SM';
  document.getElementById('btn-slowmo-end').disabled = true;
});

// ── Drop clips & SFX onto timeline ────────────────────────────
const tlScroll = document.getElementById('timeline-scroll');
tlScroll.addEventListener('dragover', e => { if (e.dataTransfer.types.some(t => t.startsWith('application/'))) e.preventDefault(); });
tlScroll.addEventListener('drop', e => {
  e.preventDefault();
  const rect = tlScroll.getBoundingClientRect();
  const sec = Math.max(0, (e.clientX - rect.left + tlScroll.scrollLeft) / timeline.scale);

  const clipId = e.dataTransfer.getData('application/clip-id');
  if (clipId) {
    timeline.addClipInsertion(clipId, e.dataTransfer.getData('application/clip-name'), parseFloat(e.dataTransfer.getData('application/clip-duration')) || 3, sec);
    return;
  }
  const sfxId = e.dataTransfer.getData('application/sfx-id');
  if (sfxId) {
    timeline.addSfxInsertion(sfxId, e.dataTransfer.getData('application/sfx-name'), parseFloat(e.dataTransfer.getData('application/sfx-duration')) || 1, sec);
  }
});

// ── Export ─────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', async () => {
  if (!project.videoId) { alert('Carga un vídeo primero.'); return; }
  await exporter.export({
    videoId: project.videoId,
    scoreboard: sbState.toJSON(),
    slowmoRegions: timeline.slowmoRegions,
    clipInsertions: timeline.clipInsertions,
    sfxInsertions: timeline.sfxInsertions
  });
});

// ── Save project ───────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', async () => {
  if (!project.videoId) { alert('Carga un vídeo primero.'); return; }
  try {
    const { id } = await api.post('/api/project/save', {
      project: {
        videoId: project.videoId,
        videoName: project.videoName,
        _youtubeUrl: project._youtubeUrl,
        scoreboard: sbState.toJSON(),
        slowmoRegions: timeline.slowmoRegions,
        clipInsertions: timeline.clipInsertions,
        sfxInsertions: timeline.sfxInsertions,
        playerNames: [document.getElementById('name-0').value, document.getElementById('name-1').value],
        goldenPoint: document.getElementById('toggle-golden').checked,
        savedAt: new Date().toISOString()
      }
    });
    alert(`Proyecto guardado ✓`);
  } catch (e) { alert('Error guardando: ' + e.message); }
});

// ── Load project ───────────────────────────────────────────────
document.getElementById('btn-load-project').addEventListener('click', async () => {
  const modal = document.getElementById('load-modal');
  const list = document.getElementById('project-list');
  modal.style.display = 'flex';
  list.innerHTML = '<div style="color:var(--text2);font-size:13px">Cargando...</div>';
  try {
    const projects = await api.get('/api/project/list');
    if (!projects.length) { list.innerHTML = '<div style="color:var(--text2);font-size:13px">No hay proyectos guardados.</div>'; return; }
    list.innerHTML = '';
    for (const p of projects) {
      const el = document.createElement('div');
      el.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color .15s;';
      el.innerHTML = `<div style="font-weight:600;font-size:13px">${esc(p.videoName || p.videoId || 'Sin nombre')}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${new Date(p.savedAt).toLocaleString('es-ES')}</div>`;
      el.addEventListener('mouseenter', () => el.style.borderColor = 'var(--accent)');
      el.addEventListener('mouseleave', () => el.style.borderColor = 'var(--border)');
      el.addEventListener('click', () => _loadProject(p.id, modal));
      list.appendChild(el);
    }
  } catch (e) { list.innerHTML = `<div style="color:var(--red)">${e.message}</div>`; }
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
  document.getElementById('load-modal').style.display = 'none';
});

async function _loadProject(id, modal) {
  try {
    const { project: p } = await api.get(`/api/project/load/${id}`);
    modal.style.display = 'none';

    // Restore video
    await _loadVideo(p.videoId, p.videoName);

    // Restore scoreboard
    sbState.fromJSON(p.scoreboard);
    if (p.playerNames) {
      document.getElementById('name-0').value = p.playerNames[0] || 'Equipo A';
      document.getElementById('name-1').value = p.playerNames[1] || 'Equipo B';
    }
    if (p.goldenPoint !== undefined) {
      document.getElementById('toggle-golden').checked = p.goldenPoint;
      sbState.game.isGoldenPoint = p.goldenPoint;
    }

    // Restore timeline
    timeline.slowmoRegions = p.slowmoRegions || [];
    timeline.clipInsertions = p.clipInsertions || [];
    timeline.sfxInsertions = p.sfxInsertions || [];
    timeline.redraw();

    sbUI.render();
  } catch (e) { alert('Error cargando proyecto: ' + e.message); }
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Initial render ─────────────────────────────────────────────
sbUI.render();
