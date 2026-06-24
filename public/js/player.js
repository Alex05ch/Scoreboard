export class Player {
  constructor(videoEl, placeholderEl) {
    this.video = videoEl;
    this.placeholder = placeholderEl;
    this.videoId = null;
    this._listeners = [];
  }

  load(videoId) {
    this.videoId = videoId;
    this.video.src = `/api/video/stream/${videoId}`;
    this.video.load();
    this.placeholder.style.display = 'none';
    this.video.style.display = 'block';
  }

  getCurrentTime() {
    return this.video.currentTime;
  }

  getDuration() {
    return this.video.duration || 0;
  }

  onTimeUpdate(fn) {
    this.video.addEventListener('timeupdate', fn);
    this._listeners.push(['timeupdate', fn]);
  }

  setPlaybackRate(rate) {
    this.video.playbackRate = rate;
  }

  seekTo(sec) {
    this.video.currentTime = sec;
  }

  formatTime(sec) {
    if (isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
