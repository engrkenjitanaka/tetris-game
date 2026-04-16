/* ─────────────────────────────────────────────────────────────────────
   Tetris v0  –  vanilla JS / Canvas
   ───────────────────────────────────────────────────────────────────── */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────
const COLS       = 10;
const ROWS       = 20;
const BLOCK      = 30;          // px per cell on main board
const NEXT_BLOCK = 24;          // px per cell on next-piece preview
const LINES_PER_LEVEL = 10;

// Points awarded per simultaneous line clear (classic Tetris scoring)
const LINE_SCORES = [0, 100, 300, 500, 800];

// Drop-interval ms per level (index = level-1, capped at index 9)
const SPEED_TABLE = [800, 650, 500, 370, 250, 170, 120, 90, 70, 50];

// ── Tetromino definitions (SRS shapes, each rotation state) ────────────
const TETROMINOES = {
  I: {
    color: '#00e5ff',
    shapes: [
      [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
      [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    ],
  },
  O: {
    color: '#ffd740',
    shapes: [
      [[1,1],[1,1]],
    ],
  },
  T: {
    color: '#ea80fc',
    shapes: [
      [[0,1,0],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,1],[0,1,0]],
      [[0,1,0],[1,1,0],[0,1,0]],
    ],
  },
  S: {
    color: '#69f0ae',
    shapes: [
      [[0,1,1],[1,1,0],[0,0,0]],
      [[0,1,0],[0,1,1],[0,0,1]],
      [[0,0,0],[0,1,1],[1,1,0]],
      [[1,0,0],[1,1,0],[0,1,0]],
    ],
  },
  Z: {
    color: '#ff5252',
    shapes: [
      [[1,1,0],[0,1,1],[0,0,0]],
      [[0,0,1],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,0],[0,1,1]],
      [[0,1,0],[1,1,0],[1,0,0]],
    ],
  },
  J: {
    color: '#448aff',
    shapes: [
      [[1,0,0],[1,1,1],[0,0,0]],
      [[0,1,1],[0,1,0],[0,1,0]],
      [[0,0,0],[1,1,1],[0,0,1]],
      [[0,1,0],[0,1,0],[1,1,0]],
    ],
  },
  L: {
    color: '#ff9100',
    shapes: [
      [[0,0,1],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,0],[0,1,1]],
      [[0,0,0],[1,1,1],[1,0,0]],
      [[1,1,0],[0,1,0],[0,1,0]],
    ],
  },
};

const PIECE_KEYS = Object.keys(TETROMINOES);

// ── Helpers ────────────────────────────────────────────────────────────
function randomKey() {
  return PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
}

function createMatrix(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

// ── Board class ────────────────────────────────────────────────────────
class Board {
  constructor() {
    this.grid = createMatrix(ROWS, COLS);
  }

  reset() {
    this.grid = createMatrix(ROWS, COLS);
  }

  /** Returns true if the piece position is valid (no overlap / out-of-bounds). */
  isValid(shape, row, col) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nr = row + r;
        const nc = col + c;
        if (nr < 0) continue;                              // above the board is fine
        if (nr >= ROWS || nc < 0 || nc >= COLS) return false;
        if (this.grid[nr][nc]) return false;
      }
    }
    return true;
  }

  /** Lock the active piece into the grid. */
  lock(shape, row, col, color) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          if (row + r < 0) return false; // piece locked above board = game over
          this.grid[row + r][col + c] = color;
        }
      }
    }
    return true;
  }

  /** Clear completed lines; return count cleared. */
  clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].every(cell => cell !== 0)) {
        this.grid.splice(r, 1);
        this.grid.unshift(Array(COLS).fill(0));
        cleared++;
        r++; // recheck same index
      }
    }
    return cleared;
  }
}

// ── Piece class ────────────────────────────────────────────────────────
class Piece {
  constructor(key) {
    this.key    = key;
    this.def    = TETROMINOES[key];
    this.color  = this.def.color;
    this.rotIdx = 0;
    this.shape  = this.def.shapes[0];
    // Spawn centered
    this.col    = Math.floor((COLS - this.shape[0].length) / 2);
    this.row    = -1;
  }

  rotated(dir = 1) {
    const total = this.def.shapes.length;
    const idx   = (this.rotIdx + dir + total) % total;
    return this.def.shapes[idx];
  }
}

// ── Renderer ───────────────────────────────────────────────────────────
class Renderer {
  constructor(boardCanvas, nextCanvas) {
    this.bCtx = boardCanvas.getContext('2d');
    this.nCtx = nextCanvas.getContext('2d');
    this.bW   = boardCanvas.width;
    this.bH   = boardCanvas.height;
    this.nW   = nextCanvas.width;
    this.nH   = nextCanvas.height;
  }

  // Draw a single cell block
  _drawCell(ctx, x, y, size, color) {
    const pad = 1;
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + pad, y + pad, size - pad * 2, 4);
    ctx.fillRect(x + pad, y + pad, 4, size - pad * 2);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + pad, y + size - pad - 4, size - pad * 2, 4);
    ctx.fillRect(x + size - pad - 4, y + pad, 4, size - pad * 2);
  }

  _drawGrid(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth   = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * BLOCK, 0);
      ctx.lineTo(c * BLOCK, height);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * BLOCK);
      ctx.lineTo(width, r * BLOCK);
      ctx.stroke();
    }
  }

  renderBoard(board, activePiece, ghostPiece) {
    const ctx = this.bCtx;

    // Background
    ctx.fillStyle = '#05050d';
    ctx.fillRect(0, 0, this.bW, this.bH);

    this._drawGrid(ctx, this.bW, this.bH);

    // Locked cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = board.grid[r][c];
        if (color) this._drawCell(ctx, c * BLOCK, r * BLOCK, BLOCK, color);
      }
    }

    // Ghost piece
    if (ghostPiece) {
      ctx.globalAlpha = 0.2;
      for (let r = 0; r < ghostPiece.shape.length; r++) {
        for (let c = 0; c < ghostPiece.shape[r].length; c++) {
          if (ghostPiece.shape[r][c]) {
            const y = (ghostPiece.row + r) * BLOCK;
            const x = (ghostPiece.col + c) * BLOCK;
            if (y >= 0) this._drawCell(ctx, x, y, BLOCK, activePiece.color);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Active piece
    if (activePiece) {
      for (let r = 0; r < activePiece.shape.length; r++) {
        for (let c = 0; c < activePiece.shape[r].length; c++) {
          if (activePiece.shape[r][c]) {
            const y = (activePiece.row + r) * BLOCK;
            const x = (activePiece.col + c) * BLOCK;
            if (y >= 0) this._drawCell(ctx, x, y, BLOCK, activePiece.color);
          }
        }
      }
    }
  }

  renderNext(nextKey) {
    const ctx   = this.nCtx;
    const def   = TETROMINOES[nextKey];
    const shape = def.shapes[0];

    ctx.fillStyle = '#05050d';
    ctx.fillRect(0, 0, this.nW, this.nH);

    const rows = shape.length;
    const cols = shape[0].length;
    const ox   = Math.floor((this.nW / NEXT_BLOCK - cols) / 2) * NEXT_BLOCK;
    const oy   = Math.floor((this.nH / NEXT_BLOCK - rows) / 2) * NEXT_BLOCK;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (shape[r][c]) {
          this._drawCell(ctx, ox + c * NEXT_BLOCK, oy + r * NEXT_BLOCK, NEXT_BLOCK, def.color);
        }
      }
    }
  }
}

// ── Game class ─────────────────────────────────────────────────────────
class Game {
  constructor() {
    this.board    = new Board();
    this.renderer = new Renderer(
      document.getElementById('board'),
      document.getElementById('next'),
    );

    this.$score    = document.getElementById('score');
    this.$level    = document.getElementById('level');
    this.$lines    = document.getElementById('lines');
    this.$highScore= document.getElementById('high-score');
    this.$overlay  = document.getElementById('overlay');
    this.$title    = document.getElementById('overlay-title');
    this.$sub      = document.getElementById('overlay-sub');
    this.$btnStart = document.getElementById('btn-start');

    this.highScore = parseInt(localStorage.getItem('tetris_hs') || '0', 10);
    this.$highScore.textContent = this.highScore;

    this.state    = 'idle'; // 'idle' | 'playing' | 'paused' | 'gameover'
    this.rafId    = null;
    this.lastTick = 0;
    this.dropAccum= 0;

    this.score    = 0;
    this.level    = 1;
    this.lines    = 0;
    this.piece    = null;
    this.nextKey  = null;
    this.ghost    = null;

    this._bindEvents();
  }

  // ── Event binding ────────────────────────────────────────────────────
  _bindEvents() {
    document.addEventListener('keydown', e => this._handleKey(e));
    this.$btnStart.addEventListener('click', () => {
      if (this.state === 'paused') this._unpause();
      else this._startOrRestart();
    });
  }

  _handleKey(e) {
    if (e.key === 'Enter') {
      if (this.state === 'paused') { this._unpause(); return; }
      if (this.state === 'idle' || this.state === 'gameover') this._startOrRestart();
      return;
    }
    if (this.state !== 'playing') {
      if (e.key === 'p' || e.key === 'P') this._unpause();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); this._move(0, -1); break;
      case 'ArrowRight': e.preventDefault(); this._move(0,  1); break;
      case 'ArrowDown':  e.preventDefault(); this._softDrop();   break;
      case 'ArrowUp':    e.preventDefault(); this._rotate(1);    break;
      case 'z': case 'Z': this._rotate(-1); break;
      case ' ':          e.preventDefault(); this._hardDrop();   break;
      case 'p': case 'P': this._pause(); break;
    }
  }

  // ── Start / Restart ──────────────────────────────────────────────────
  _startOrRestart() {
    this.board.reset();
    this.score     = 0;
    this.level     = 1;
    this.lines     = 0;
    this.dropAccum = 0;
    this.lastTick  = 0;

    this._updateHUD();
    this.nextKey = randomKey();
    this._spawnPiece();

    this.state = 'playing';
    this.$overlay.classList.add('hidden');

    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(ts => this._loop(ts));
  }

  // ── Spawn ────────────────────────────────────────────────────────────
  _spawnPiece() {
    this.piece   = new Piece(this.nextKey);
    this.nextKey = randomKey();
    this.renderer.renderNext(this.nextKey);
    this._updateGhost();

    if (!this.board.isValid(this.piece.shape, this.piece.row, this.piece.col)) {
      this._gameOver();
    }
  }

  // ── Ghost piece ──────────────────────────────────────────────────────
  _updateGhost() {
    if (!this.piece) { this.ghost = null; return; }
    let r = this.piece.row;
    while (this.board.isValid(this.piece.shape, r + 1, this.piece.col)) r++;
    this.ghost = { shape: this.piece.shape, row: r, col: this.piece.col };
  }

  // ── Movement ─────────────────────────────────────────────────────────
  _move(dRow, dCol) {
    const { shape, row, col } = this.piece;
    if (this.board.isValid(shape, row + dRow, col + dCol)) {
      this.piece.row += dRow;
      this.piece.col += dCol;
      this._updateGhost();
      this._render();
    }
  }

  _rotate(dir = 1) {
    const newShape = this.piece.rotated(dir);
    const kicks    = this._getKicks(this.piece.key, this.piece.rotIdx, dir);

    for (const [kr, kc] of kicks) {
      const nr = this.piece.row + kr;
      const nc = this.piece.col + kc;
      if (this.board.isValid(newShape, nr, nc)) {
        this.piece.shape  = newShape;
        this.piece.rotIdx = (this.piece.rotIdx + dir + this.piece.def.shapes.length) % this.piece.def.shapes.length;
        this.piece.row    = nr;
        this.piece.col    = nc;
        this._updateGhost();
        this._render();
        return;
      }
    }
  }

  // Basic SRS wall-kick offsets
  _getKicks(key, rotIdx, dir) {
    if (key === 'O') return [[0, 0]];
    if (key === 'I') {
      const table = [
        [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
        [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
        [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
        [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
      ];
      const from = dir === 1 ? rotIdx : (rotIdx + 1) % 4;
      return dir === 1
        ? table[from].map(([r, c]) => [-r, c])
        : table[(from + 3) % 4].map(([r, c]) => [r, -c]);
    }
    const table = [
      [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
      [[0,0],[1,0],[1,-1],[0,2],[1,2]],
      [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
      [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    ];
    const from = dir === 1 ? rotIdx : (rotIdx + 3) % 4;
    return dir === 1
      ? table[from].map(([r, c]) => [-r, c])
      : table[(from + 1) % 4].map(([r, c]) => [r, -c]);
  }

  _softDrop() {
    if (this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
      this.piece.row++;
      this.score++;
      this._updateHUD();
      this.dropAccum = 0;
    } else {
      this._lock();
    }
    this._render();
  }

  _hardDrop() {
    let dropped = 0;
    while (this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
      this.piece.row++;
      dropped++;
    }
    this.score += dropped * 2;
    this._updateHUD();
    this._lock();
    this._render();
  }

  // ── Lock piece ───────────────────────────────────────────────────────
  _lock() {
    const ok = this.board.lock(this.piece.shape, this.piece.row, this.piece.col, this.piece.color);
    if (!ok) { this._gameOver(); return; }

    const cleared = this.board.clearLines();
    if (cleared) {
      this.score += LINE_SCORES[cleared] * this.level;
      this.lines += cleared;
      this.level  = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
      this._updateHUD();
      this._flashLines();
    }
    this._spawnPiece();
  }

  // ── Visual flash on line clear (simple) ─────────────────────────────
  _flashLines() {
    const canvas = document.getElementById('board');
    canvas.style.boxShadow = '0 0 30px 6px #00e5ff';
    setTimeout(() => { canvas.style.boxShadow = ''; }, 200);
  }

  // ── HUD ──────────────────────────────────────────────────────────────
  _updateHUD() {
    this.$score.textContent = this.score;
    this.$level.textContent = this.level;
    this.$lines.textContent = this.lines;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('tetris_hs', this.highScore);
      this.$highScore.textContent = this.highScore;
    }
  }

  // ── Pause ────────────────────────────────────────────────────────────
  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    cancelAnimationFrame(this.rafId);
    this.$title.textContent    = 'PAUSED';
    this.$sub.innerHTML        = 'Press <kbd>P</kbd> or <kbd>Enter</kbd> to resume';
    this.$btnStart.textContent = 'RESUME';
    this.$overlay.classList.remove('hidden');
  }

  _unpause() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.$overlay.classList.add('hidden');
    this.$btnStart.textContent = 'START GAME';
    this.lastTick  = 0;
    this.dropAccum = 0;
    this.rafId = requestAnimationFrame(ts => this._loop(ts));
  }

  // ── Game Over ────────────────────────────────────────────────────────
  _gameOver() {
    this.state = 'gameover';
    cancelAnimationFrame(this.rafId);
    this.$title.textContent    = 'GAME OVER';
    this.$sub.innerHTML        = `Score: <strong>${this.score}</strong> — Press <kbd>Enter</kbd> to retry`;
    this.$btnStart.textContent = 'PLAY AGAIN';
    this.$overlay.classList.remove('hidden');
  }

  // ── Render ───────────────────────────────────────────────────────────
  _render() {
    this.renderer.renderBoard(this.board, this.piece, this.ghost);
  }

  // ── Main loop ────────────────────────────────────────────────────────
  _loop(ts) {
    if (this.state !== 'playing') return;
    if (!this.lastTick) this.lastTick = ts;
    const dt = ts - this.lastTick;
    this.lastTick = ts;

    const interval = SPEED_TABLE[Math.min(this.level - 1, SPEED_TABLE.length - 1)];
    this.dropAccum += dt;

    if (this.dropAccum >= interval) {
      this.dropAccum -= interval;
      if (this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
        this.piece.row++;
        this._updateGhost();
      } else {
        this._lock();
      }
    }

    this._render();
    this.rafId = requestAnimationFrame(ts2 => this._loop(ts2));
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────
const game = new Game();
