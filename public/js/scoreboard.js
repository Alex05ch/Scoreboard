const POINT_LABELS = ['0', '15', '30', '40'];

function displayPoint(raw, opponentRaw, isTiebreak, isGoldenPoint) {
  if (isTiebreak) return String(raw);
  if (isGoldenPoint && raw === 3 && opponentRaw === 3) return 'GP';
  if (raw === 4) return 'AD';
  return POINT_LABELS[raw] || '0';
}

export class ScoreboardState {
  constructor() {
    this.reset();
  }

  reset() {
    this.players = [{ name: 'Equipo A' }, { name: 'Equipo B' }];
    this.sets = [];
    this.currentSet = { scores: [0, 0], isTiebreak: false };
    this.game = { points: [0, 0], isTiebreak: false, isGoldenPoint: false };
    this.server = 0;
    this.timeline = [];
    this._onChange = null;
  }

  setOnChange(fn) { this._onChange = fn; }

  _notify() { if (this._onChange) this._onChange(); }

  _snapshot() {
    return JSON.parse(JSON.stringify({
      players: this.players,
      sets: this.sets,
      currentSet: this.currentSet,
      game: this.game,
      server: this.server
    }));
  }

  recordTimestamp(videoTime) {
    this.timeline.push({ videoTime, state: this._snapshot() });
  }

  pointWon(winnerIdx, videoTime) {
    const loserIdx = 1 - winnerIdx;

    if (this.game.isTiebreak) {
      this.game.points[winnerIdx]++;
      const w = this.game.points[winnerIdx];
      const l = this.game.points[loserIdx];
      if (w >= 7 && w - l >= 2) this._gameWon(winnerIdx, videoTime);
      else { this.recordTimestamp(videoTime); this._notify(); }
    } else if (this.game.isGoldenPoint && this.game.points[0] === 3 && this.game.points[1] === 3) {
      this._gameWon(winnerIdx, videoTime);
    } else {
      const wp = this.game.points[winnerIdx];
      const lp = this.game.points[loserIdx];
      if (wp >= 3 && lp >= 3) {
        if (wp === 4) {
          this._gameWon(winnerIdx, videoTime);
        } else {
          this.game.points[winnerIdx] = 4;
          this.game.points[loserIdx] = 3;
          this.recordTimestamp(videoTime); this._notify();
        }
      } else if (wp === 3) {
        this._gameWon(winnerIdx, videoTime);
      } else {
        this.game.points[winnerIdx]++;
        this.recordTimestamp(videoTime); this._notify();
      }
    }
  }

  _gameWon(winnerIdx, videoTime) {
    this.currentSet.scores[winnerIdx]++;
    this.game.points = [0, 0];
    this.game.isTiebreak = false;
    this.server = 1 - this.server;

    const [s0, s1] = this.currentSet.scores;
    const winner = s0 > s1 ? 0 : 1;
    const maxScore = Math.max(s0, s1);
    const minScore = Math.min(s0, s1);
    const isTiebreakScore = s0 === 7 && s1 === 6 || s0 === 6 && s1 === 7;

    if ((maxScore >= 6 && maxScore - minScore >= 2) || isTiebreakScore) {
      this._setWon(winner, videoTime);
    } else if (s0 === 6 && s1 === 6) {
      this._enterTiebreak(videoTime);
    } else {
      this.recordTimestamp(videoTime); this._notify();
    }
  }

  _enterTiebreak(videoTime) {
    this.game.isTiebreak = true;
    this.currentSet.isTiebreak = true;
    this.recordTimestamp(videoTime); this._notify();
  }

  _setWon(winnerIdx, videoTime) {
    this.sets.push({ scores: [...this.currentSet.scores] });
    this.currentSet = { scores: [0, 0], isTiebreak: false };
    this.game.isTiebreak = false;
    this.recordTimestamp(videoTime); this._notify();
  }

  undoLastPoint() {
    if (this.timeline.length === 0) return;
    this.timeline.pop();
    if (this.timeline.length > 0) {
      const last = this.timeline[this.timeline.length - 1];
      const s = last.state;
      this.players = s.players;
      this.sets = s.sets;
      this.currentSet = s.currentSet;
      this.game = { ...s.game, isGoldenPoint: this.game.isGoldenPoint };
      this.server = s.server;
    } else {
      this.sets = [];
      this.currentSet = { scores: [0, 0], isTiebreak: false };
      this.game = { points: [0, 0], isTiebreak: false, isGoldenPoint: this.game.isGoldenPoint };
      this.server = 0;
    }
    this._notify();
  }

  toJSON() {
    return {
      players: this.players,
      sets: this.sets,
      currentSet: this.currentSet,
      game: this.game,
      server: this.server,
      timeline: this.timeline
    };
  }

  fromJSON(data) {
    this.players = data.players || this.players;
    this.sets = data.sets || [];
    this.currentSet = data.currentSet || { scores: [0, 0], isTiebreak: false };
    this.game = data.game || { points: [0, 0], isTiebreak: false, isGoldenPoint: false };
    this.server = data.server || 0;
    this.timeline = data.timeline || [];
    this._notify();
  }
}

export class ScoreboardUI {
  constructor(state, overlayEl, controlsEl) {
    this.state = state;
    this.overlay = overlayEl;
    this.controls = controlsEl;
    this._dragging = false;
    this._dragOffX = 0;
    this._dragOffY = 0;
    this._initDrag();
    state.setOnChange(() => this.render());
  }

  _initDrag() {
    this.overlay.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      this._dragging = true;
      const rect = this.overlay.getBoundingClientRect();
      this._dragOffX = e.clientX - rect.left;
      this._dragOffY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      const parent = this.overlay.parentElement.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - parent.left - this._dragOffX, parent.width - this.overlay.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - parent.top - this._dragOffY, parent.height - this.overlay.offsetHeight));
      this.overlay.style.left = x + 'px';
      this.overlay.style.top = y + 'px';
    });
    document.addEventListener('mouseup', () => { this._dragging = false; });
  }

  show() { this.overlay.classList.add('visible'); }
  hide() { this.overlay.classList.remove('visible'); }

  render() {
    const { players, sets, currentSet, game, server } = this.state;
    const p0pts = displayPoint(game.points[0], game.points[1], game.isTiebreak, game.isGoldenPoint);
    const p1pts = displayPoint(game.points[1], game.points[0], game.isTiebreak, game.isGoldenPoint);
    const leading0 = game.points[0] > game.points[1];
    const leading1 = game.points[1] > game.points[0];
    const modeLabel = game.isTiebreak ? 'TIE-BREAK' : (game.isGoldenPoint ? 'GOLDEN POINT' : '');

    const setScores = (playerIdx) =>
      sets.map((s, i) => {
        const won = s.scores[playerIdx] > s.scores[1 - playerIdx];
        return `<span class="sb-set-score ${won ? 'won' : ''}">${s.scores[playerIdx]}</span>`;
      }).join('<span class="sb-sep">·</span>');

    this.overlay.innerHTML = `
      <div class="sb-header">
        <span>PÁDEL</span>
        ${modeLabel ? `<span class="sb-mode">${modeLabel}</span>` : ''}
      </div>
      <div class="sb-body">
        <div class="sb-row">
          <div class="sb-server-dot ${server === 0 ? 'active' : ''}"></div>
          <div class="sb-name">${escapeHtml(players[0].name)}</div>
          <div class="sb-sets">${setScores(0)}</div>
          ${sets.length ? '<span class="sb-sep">|</span>' : ''}
          <div class="sb-games">${currentSet.scores[0]}</div>
          <div class="sb-game-points ${leading0 ? 'leading' : leading1 ? 'trailing' : ''}">${p0pts}</div>
        </div>
        <div class="sb-row">
          <div class="sb-server-dot ${server === 1 ? 'active' : ''}"></div>
          <div class="sb-name">${escapeHtml(players[1].name)}</div>
          <div class="sb-sets">${setScores(1)}</div>
          ${sets.length ? '<span class="sb-sep">|</span>' : ''}
          <div class="sb-games">${currentSet.scores[1]}</div>
          <div class="sb-game-points ${leading1 ? 'leading' : leading0 ? 'trailing' : ''}">${p1pts}</div>
        </div>
      </div>
    `;

    this._renderControls();
  }

  _renderControls() {
    const { players } = this.state;
    const p0 = players[0].name;
    const p1 = players[1].name;
    this.controls.querySelectorAll('.score-team-label').forEach((el, i) => {
      el.textContent = i === 0 ? p0 : p1;
    });
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
