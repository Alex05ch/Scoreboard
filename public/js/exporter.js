import api from './api.js';

export class Exporter {
  constructor(overlayEl) {
    this.overlay = overlayEl;
    this.fill = overlayEl.querySelector('#progress-bar-fill');
    this.stageEl = overlayEl.querySelector('#progress-stage');
    this.titleEl = overlayEl.querySelector('#progress-title');
    this.percentEl = overlayEl.querySelector('#progress-percent');
    this.downloadBtn = overlayEl.querySelector('#progress-download');
    this.closeBtn = overlayEl.querySelector('#progress-close');
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  show(title = 'Exportando...') {
    this.overlay.classList.add('active');
    this._setProgress(0);
    this.stageEl.textContent = 'Iniciando...';
    this.titleEl.textContent = title;
    this.downloadBtn.style.display = 'none';
  }

  hide() { this.overlay.classList.remove('active'); }

  _setProgress(pct, stage) {
    const p = Math.min(100, Math.max(0, Math.round(pct)));
    this.fill.style.width = p + '%';
    this.percentEl.textContent = p + '%';
    if (stage !== undefined) this.stageEl.textContent = stage;
  }

  async export(project) {
    this.show('Exportando vídeo...');
    try {
      const { jobId } = await api.post('/api/export/start', { project });
      await this._watchProgress(jobId);
    } catch (e) {
      this._setProgress(0);
      this.stageEl.textContent = '❌ ' + e.message;
    }
  }

  _watchProgress(jobId) {
    return new Promise((resolve, reject) => {
      api.sseStream(`/api/export/progress/${jobId}`, data => {
        this._setProgress(data.progress || 0, data.stage || '...');
      }, data => {
        if (data.status === 'done') {
          this._setProgress(100, '✅ Completado');
          this.downloadBtn.style.display = 'inline-block';
          this.downloadBtn.href = `/api/export/download/${jobId}`;
          resolve();
        } else {
          this._setProgress(0, '❌ ' + (data.error || 'Error desconocido').slice(0, 80));
          reject(new Error(data.error));
        }
      });
    });
  }
}
