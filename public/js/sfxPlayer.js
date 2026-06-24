export class SfxPlayer {
  constructor(videoEl, getInsertions) {
    this.video = videoEl;
    this.getInsertions = getInsertions;
    this._active = new Map(); // id -> { audio }

    this.video.addEventListener('timeupdate', () => this._tick());
    this.video.addEventListener('seeked',     () => this._reset());
    this.video.addEventListener('pause',      () => this._stopAll());
  }

  _tick() {
    if (this.video.paused) return;
    const t = this.video.currentTime;
    const insertions = this.getInsertions();

    for (const s of insertions) {
      const start = s.insertAtSec;
      const end   = start + (s.duration || 1);
      const inRange = t >= start && t < end;

      if (inRange && !this._active.has(s.id)) {
        // Arrange muting before audio starts
        if (s.muteMain) this.video.muted = true;

        const audio = new Audio(`/api/sfx/stream/${s.sfxId}`);
        audio.currentTime = Math.max(0, t - start);
        audio.play().catch(() => {});

        audio.addEventListener('ended', () => {
          if (s.muteMain) this.video.muted = false;
          this._active.delete(s.id);
        }, { once: true });

        this._active.set(s.id, { audio, muteMain: s.muteMain });
      }

      if (!inRange && this._active.has(s.id)) {
        const { audio, muteMain } = this._active.get(s.id);
        audio.pause();
        if (muteMain) this.video.muted = false;
        this._active.delete(s.id);
      }
    }
  }

  _reset() {
    this._stopAll();
    // Re-evaluate immediately after seek
    setTimeout(() => this._tick(), 50);
  }

  _stopAll() {
    for (const [, { audio, muteMain }] of this._active) {
      audio.pause();
      if (muteMain) this.video.muted = false;
    }
    this._active.clear();
  }
}
