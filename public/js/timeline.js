export class Timeline {
  constructor(containerEl, player, scoreboardState) {
    this.container = containerEl;
    this.player = player;
    this.state = scoreboardState;
    this.slowmoRegions = [];
    this.clipInsertions = [];
    this.sfxInsertions = [];
    this.duration = 0;
    this.scale = 5; // px per second
    this._onChange = null;
    this._tooltip = null;
    this._dragState = null;
    this._rafId = null;
    this._build();
    this._startPlayheadLoop();
  }

  setDuration(duration) {
    this.duration = duration;
    this.scale = Math.max(2, Math.min(10, (this.container.clientWidth - 24) / duration));
    this._render();
  }

  setOnChange(fn) { this._onChange = fn; }

  _build() {
    const scroll = this.container.querySelector('#timeline-scroll');
    this.scroll = scroll;
    this.inner = scroll.querySelector('#timeline-inner');
    this.ruler = scroll.querySelector('#tl-ruler');
    this.mainBar = scroll.querySelector('#tl-main-bar');
    this.playhead = scroll.querySelector('#tl-playhead');

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'tl-tooltip';
    this._tooltip.style.display = 'none';
    document.body.appendChild(this._tooltip);

    scroll.addEventListener('wheel', e => {
      if (e.ctrlKey) {
        e.preventDefault();
        this.scale = Math.max(1, Math.min(30, this.scale * (e.deltaY < 0 ? 1.15 : 0.85)));
        this._render();
      }
    }, { passive: false });

    scroll.addEventListener('click', e => {
      if (e.target === this.inner || e.target === this.mainBar) {
        const x = e.offsetX;
        const sec = x / this.scale;
        this.player.seekTo(Math.max(0, Math.min(sec, this.duration)));
      }
    });
  }

  _toX(sec) { return sec * this.scale; }
  _toSec(x) { return x / this.scale; }

  _render() {
    if (!this.duration) return;
    const totalW = this._toX(this.duration);
    this.inner.style.width = Math.max(totalW, this.scroll.clientWidth - 24) + 'px';

    this.mainBar.style.left = '0';
    this.mainBar.style.width = totalW + 'px';
    this._renderRuler(totalW);
    this._renderRegions();
    this._renderClips();
    this._renderSfx();
    this._renderScoreEvents();
  }

  _renderRuler(totalW) {
    this.ruler.innerHTML = '';
    const step = this._tickStep();
    for (let t = 0; t <= this.duration; t += step) {
      const x = this._toX(t);
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = x + 'px';
      tick.textContent = this._fmtTime(t);
      const line = document.createElement('div');
      line.className = 'tl-tick-line';
      line.style.left = x + 'px';
      this.ruler.appendChild(tick);
      this.ruler.appendChild(line);
    }
  }

  _tickStep() {
    const pxPerSec = this.scale;
    if (pxPerSec >= 15) return 5;
    if (pxPerSec >= 7) return 10;
    if (pxPerSec >= 3) return 30;
    return 60;
  }

  _fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  _renderRegions() {
    this.inner.querySelectorAll('.tl-slowmo').forEach(el => el.remove());
    for (const r of this.slowmoRegions) {
      const el = document.createElement('div');
      el.className = 'tl-slowmo';
      el.style.left = this._toX(r.startSec) + 'px';
      el.style.width = Math.max(8, this._toX(r.endSec - r.startSec)) + 'px';
      el.dataset.id = r.id;
      el.innerHTML = `<div class="tl-handle left" data-handle="left" data-id="${r.id}"></div><span>${r.speed}x</span><div class="tl-handle right" data-handle="right" data-id="${r.id}"></div>`;
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.slowmoRegions = this.slowmoRegions.filter(x => x.id !== r.id);
        this._render(); if (this._onChange) this._onChange();
      });
      this._bindDragRegion(el, r);
      this.inner.appendChild(el);
    }
  }

  _bindDragRegion(el, region) {
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      const handle = e.target.dataset.handle;
      const startX = e.clientX;
      const origStart = region.startSec;
      const origEnd = region.endSec;

      const onMove = ev => {
        const dx = (ev.clientX - startX) / this.scale;
        if (handle === 'left') {
          region.startSec = Math.max(0, Math.min(origStart + dx, region.endSec - 1));
        } else if (handle === 'right') {
          region.endSec = Math.max(region.startSec + 1, Math.min(origEnd + dx, this.duration));
        } else {
          const d = origEnd - origStart;
          region.startSec = Math.max(0, Math.min(origStart + dx, this.duration - d));
          region.endSec = region.startSec + d;
        }
        this._render();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (this._onChange) this._onChange();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _renderClips() {
    this.inner.querySelectorAll('.tl-clip').forEach(el => el.remove());
    for (const c of this.clipInsertions) {
      const el = document.createElement('div');
      el.className = 'tl-clip';
      el.style.left = this._toX(c.insertAtSec) + 'px';
      const w = Math.max(30, this._toX(c.duration || 3));
      el.style.width = w + 'px';
      el.dataset.id = c.id;
      el.title = c.name || c.clipId;
      el.textContent = (c.name || 'CLIP').slice(0, 12);
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.clipInsertions = this.clipInsertions.filter(x => x.id !== c.id);
        this._render(); if (this._onChange) this._onChange();
      });
      this._bindDragClip(el, c);
      this.inner.appendChild(el);
    }
  }

  _bindDragClip(el, clip) {
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      const startX = e.clientX;
      const origAt = clip.insertAtSec;
      const onMove = ev => {
        const dx = (ev.clientX - startX) / this.scale;
        clip.insertAtSec = Math.max(0, Math.min(origAt + dx, this.duration));
        el.style.left = this._toX(clip.insertAtSec) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._render(); if (this._onChange) this._onChange();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _renderScoreEvents() {
    this.inner.querySelectorAll('.tl-score-event').forEach(el => el.remove());
    const timeline = this.state.timeline;
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      const el = document.createElement('div');
      el.className = 'tl-score-event';
      el.style.left = this._toX(entry.videoTime) + 'px';
      el.title = `t=${this._fmtTime(entry.videoTime)}`;
      el.addEventListener('mouseenter', ev => {
        const s = entry.state;
        const p0 = s.players?.[0]?.name || 'A';
        const p1 = s.players?.[1]?.name || 'B';
        const g = s.game?.points || [0, 0];
        this._tooltip.textContent = `${this._fmtTime(entry.videoTime)} | ${p0}: ${g[0]} - ${p1}: ${g[1]}`;
        this._tooltip.style.display = 'block';
        this._tooltip.style.left = ev.clientX + 12 + 'px';
        this._tooltip.style.top = ev.clientY - 8 + 'px';
      });
      el.addEventListener('mousemove', ev => {
        this._tooltip.style.left = ev.clientX + 12 + 'px';
        this._tooltip.style.top = ev.clientY - 8 + 'px';
      });
      el.addEventListener('mouseleave', () => { this._tooltip.style.display = 'none'; });
      el.addEventListener('click', () => this.player.seekTo(entry.videoTime));
      this._bindDragScoreEvent(el, entry, i);
      this.inner.appendChild(el);
    }
  }

  _bindDragScoreEvent(el, entry, idx) {
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      const startX = e.clientX;
      const origTime = entry.videoTime;
      const onMove = ev => {
        const dx = (ev.clientX - startX) / this.scale;
        entry.videoTime = Math.max(0, Math.min(origTime + dx, this.duration));
        el.style.left = this._toX(entry.videoTime) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this.state.timeline.sort((a, b) => a.videoTime - b.videoTime);
        this._render(); if (this._onChange) this._onChange();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _startPlayheadLoop() {
    const update = () => {
      if (this.duration > 0) {
        const x = this._toX(this.player.getCurrentTime());
        this.playhead.style.left = x + 'px';
      }
      this._rafId = requestAnimationFrame(update);
    };
    this._rafId = requestAnimationFrame(update);
  }

  addSlowmoRegion(startSec, endSec, speed = 0.5) {
    const id = 'sm_' + Date.now();
    this.slowmoRegions.push({ id, startSec, endSec, speed });
    this._render();
    if (this._onChange) this._onChange();
  }

  addClipInsertion(clipId, name, duration, insertAtSec) {
    const id = 'ci_' + Date.now();
    this.clipInsertions.push({ id, clipId, name, duration, insertAtSec });
    this._render();
    if (this._onChange) this._onChange();
  }

  addSfxInsertion(sfxId, name, duration, insertAtSec) {
    const id = 'sfx_' + Date.now();
    this.sfxInsertions = this.sfxInsertions || [];
    this.sfxInsertions.push({ id, sfxId, name, duration, insertAtSec });
    this._render();
    if (this._onChange) this._onChange();
  }

  _renderSfx() {
    this.inner.querySelectorAll('.tl-sfx').forEach(el => el.remove());
    for (const s of (this.sfxInsertions || [])) {
      const w = Math.max(40, this._toX(s.duration || 1));
      const el = document.createElement('div');
      el.className = 'tl-sfx' + (s.muteMain ? ' muted' : '');
      el.style.left = this._toX(s.insertAtSec) + 'px';
      el.style.width = w + 'px';
      el.title = s.name + (s.muteMain ? ' · silencia audio' : '');

      el.innerHTML = `
        <span class="tl-sfx-name">${(s.name || 'SFX').slice(0, 8)}</span>
        <button class="tl-sfx-mute" title="${s.muteMain ? 'Restaurar audio' : 'Silenciar audio principal'}">${s.muteMain ? '🔇' : '🔊'}</button>
      `;

      el.querySelector('.tl-sfx-mute').addEventListener('click', e => {
        e.stopPropagation();
        s.muteMain = !s.muteMain;
        this._render(); if (this._onChange) this._onChange();
      });

      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.sfxInsertions = this.sfxInsertions.filter(x => x.id !== s.id);
        this._render(); if (this._onChange) this._onChange();
      });

      this._bindDragSfx(el, s);
      this.inner.appendChild(el);
    }
  }

  _bindDragSfx(el, sfx) {
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      const startX = e.clientX;
      const origAt = sfx.insertAtSec;
      const onMove = ev => {
        sfx.insertAtSec = Math.max(0, Math.min(origAt + (ev.clientX - startX) / this.scale, this.duration));
        el.style.left = this._toX(sfx.insertAtSec) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (this._onChange) this._onChange();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  redraw() { this._render(); }
}
