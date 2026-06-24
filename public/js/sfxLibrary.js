import api from './api.js';

export class SfxLibrary {
  constructor(containerEl) {
    this.container = containerEl;
    this.sfxList = [];
    this._audio = null;
    this._build();
    this.load();
  }

  _build() {
    this.dropZone = this.container.querySelector('#sfx-drop-zone');
    this.fileInput = this.container.querySelector('#sfx-file-input');
    this.grid = this.container.querySelector('#sfx-grid');

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

  async load() {
    try {
      this.sfxList = await api.get('/api/sfx/list');
      this._render();
    } catch {}
  }

  async _upload(file) {
    const placeholder = this._placeholder(file.name);
    try {
      const sfx = await api.uploadFile('/api/sfx/upload', file, 'file');
      this.sfxList.push(sfx);
      placeholder.remove();
      this._render();
    } catch (e) {
      placeholder.remove();
      alert('Error subiendo SFX: ' + e.message);
    }
  }

  _placeholder(name) {
    const el = document.createElement('div');
    el.className = 'sfx-card';
    el.innerHTML = `<div class="sfx-card-icon">⏳</div><div class="sfx-card-info"><div class="sfx-card-name">${name}</div><div class="sfx-card-meta">Subiendo...</div></div>`;
    this.grid.prepend(el);
    return el;
  }

  _render() {
    this.grid.innerHTML = '';
    for (const sfx of this.sfxList) this.grid.appendChild(this._card(sfx));
  }

  _card(sfx) {
    const card = document.createElement('div');
    card.className = 'sfx-card';
    card.draggable = true;
    card.dataset.sfxId = sfx.sfxId;

    const dur = sfx.duration ? `${sfx.duration.toFixed(1)}s` : '?';
    card.innerHTML = `
      <div class="sfx-card-icon">🔊</div>
      <div class="sfx-card-info">
        <div class="sfx-card-name">${esc(sfx.name)}</div>
        <div class="sfx-card-meta">${dur}</div>
      </div>
      <button class="sfx-play-btn" title="Previsualizar">▶</button>
      <button class="sfx-delete-btn" title="Eliminar">✕</button>
    `;

    card.querySelector('.sfx-play-btn').addEventListener('click', e => {
      e.stopPropagation();
      this._preview(sfx.sfxId, card.querySelector('.sfx-play-btn'));
    });

    card.querySelector('.sfx-delete-btn').addEventListener('click', e => {
      e.stopPropagation();
      this._delete(sfx.sfxId, card);
    });

    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/sfx-id', sfx.sfxId);
      e.dataTransfer.setData('application/sfx-name', sfx.name);
      e.dataTransfer.setData('application/sfx-duration', String(sfx.duration || 1));
      e.dataTransfer.effectAllowed = 'copy';
    });

    return card;
  }

  _preview(sfxId, btn) {
    if (this._audio) {
      this._audio.pause();
      this._audio = null;
      document.querySelectorAll('.sfx-play-btn').forEach(b => b.textContent = '▶');
      return;
    }
    this._audio = new Audio(`/api/sfx/stream/${sfxId}`);
    btn.textContent = '⏹';
    this._audio.play().catch(() => { btn.textContent = '▶'; this._audio = null; });
    this._audio.onended = () => { btn.textContent = '▶'; this._audio = null; };
    this._audio.onerror = () => { btn.textContent = '▶'; this._audio = null; };
  }

  async _delete(sfxId, card) {
    if (!confirm('¿Eliminar este efecto?')) return;
    try {
      await api.del(`/api/sfx/${sfxId}`);
      this.sfxList = this.sfxList.filter(s => s.sfxId !== sfxId);
      card.remove();
    } catch (e) { alert('Error: ' + e.message); }
  }
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
