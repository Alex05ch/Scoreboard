import api from './api.js';

export class ClipLibrary {
  constructor(containerEl, onDropToTimeline) {
    this.container = containerEl;
    this.onDropToTimeline = onDropToTimeline;
    this.clips = [];
    this._build();
    this.loadClips();
  }

  _build() {
    this.dropZone = this.container.querySelector('#clip-drop-zone');
    this.fileInput = this.container.querySelector('#clip-file-input');
    this.grid = this.container.querySelector('#clip-grid');

    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', e => {
      for (const f of e.target.files) this._upload(f);
      this.fileInput.value = '';
    });

    this.dropZone.addEventListener('dragover', e => { e.preventDefault(); this.dropZone.classList.add('drag-over'); });
    this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drag-over'));
    this.dropZone.addEventListener('drop', e => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      for (const f of e.dataTransfer.files) this._upload(f);
    });
  }

  async loadClips() {
    try {
      this.clips = await api.get('/api/clips/list');
      this._renderGrid();
    } catch (e) {
      console.error('Error loading clips:', e);
    }
  }

  async _upload(file) {
    const card = this._addPlaceholderCard(file.name);
    try {
      const clip = await api.uploadFile('/api/clips/upload', file, 'file');
      this.clips.push(clip);
      card.remove();
      this._renderGrid();
    } catch (e) {
      card.remove();
      alert('Error subiendo clip: ' + e.message);
    }
  }

  _addPlaceholderCard(name) {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.innerHTML = `<div class="clip-card-icon">⏳</div><div class="clip-card-info"><div class="clip-card-name">${name}</div><div class="clip-card-meta">Subiendo...</div></div>`;
    this.grid.prepend(card);
    return card;
  }

  _renderGrid() {
    this.grid.innerHTML = '';
    for (const clip of this.clips) {
      this.grid.appendChild(this._buildCard(clip));
    }
  }

  _buildCard(clip) {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.draggable = true;
    card.dataset.clipId = clip.clipId;

    const dur = clip.duration ? this._fmtDur(clip.duration) : '?';
    const size = clip.size ? (clip.size / 1024 / 1024).toFixed(1) + ' MB' : '';

    card.innerHTML = `
      <div class="clip-card-icon">
        <video src="/api/clips/stream/${clip.clipId}" muted preload="metadata" style="pointer-events:none"></video>
      </div>
      <div class="clip-card-info">
        <div class="clip-card-name">${escapeHtml(clip.originalName || clip.clipId)}</div>
        <div class="clip-card-meta">${dur} ${size ? '· ' + size : ''}</div>
      </div>
      <button class="clip-delete-btn" title="Eliminar">✕</button>
    `;

    const video = card.querySelector('video');
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(1, video.duration / 2);
    });

    card.querySelector('.clip-delete-btn').addEventListener('click', e => {
      e.stopPropagation();
      this._deleteClip(clip.clipId, card);
    });

    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/clip-id', clip.clipId);
      e.dataTransfer.setData('application/clip-name', clip.originalName || clip.clipId);
      e.dataTransfer.setData('application/clip-duration', String(clip.duration || 3));
      e.dataTransfer.effectAllowed = 'copy';
    });

    return card;
  }

  async _deleteClip(clipId, card) {
    if (!confirm('¿Eliminar este clip?')) return;
    try {
      await api.del(`/api/clips/${clipId}`);
      this.clips = this.clips.filter(c => c.clipId !== clipId);
      card.remove();
    } catch (e) {
      alert('Error eliminando clip: ' + e.message);
    }
  }

  _fmtDur(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
