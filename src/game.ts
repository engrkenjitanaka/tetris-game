/* ─────────────────────────────────────────────────────────────────────
   Tetris v0  –  TypeScript / Canvas
   ───────────────────────────────────────────────────────────────────── */

// ── Constants ──────────────────────────────────────────────────────────
const COLS = 10;
const ROWS = 20;
const BLOCK = 30;       // px per cell on main board
const NEXT_BLOCK = 24;  // px per cell on next-piece preview
const LINES_PER_LEVEL = 10;

// Points awarded per simultaneous line clear (classic Tetris scoring)
const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800];

// Drop-interval ms per level (index = level-1, capped at index 9)
const SPEED_TABLE: readonly number[] = [800, 650, 500, 370, 250, 170, 120, 90, 70, 50];

// Grace period (ms) after a piece lands before it locks — lets the player
// slide/rotate it. Any successful move or rotation while grounded resets the
// timer, but only up to LOCK_MOVE_RESET_LIMIT times to prevent infinite stall.
const LOCK_DELAY_MS = 500;
const LOCK_MOVE_RESET_LIMIT = 15;

// Length of the line-clear flash/particle phase before rows actually collapse.
const LINE_CLEAR_DURATION_MS = 320;

// ── Types ──────────────────────────────────────────────────────────────
type Shape = readonly (readonly number[])[];

interface TetrominoDef {
  readonly color: string;
  readonly shapes: readonly Shape[];
}

interface GhostPiece {
  shape: Shape;
  row: number;
  col: number;
}

type GameState = 'idle' | 'playing' | 'paused' | 'gameover';

interface LineClearAnim {
  rows: number[];
  elapsed: number;
  duration: number;
  cleared: number;
  awardedScore: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  rot: number;
  vrot: number;
}

// ── Tetromino definitions (SRS shapes, each rotation state) ────────────
const TETROMINOES: Readonly<Record<string, TetrominoDef>> = {
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
function randomKey(): string {
  return PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
}

function createMatrix(rows: number, cols: number): (string | 0)[][] {
  return Array.from({ length: rows }, () => Array<string | 0>(cols).fill(0));
}

// ── Board class ────────────────────────────────────────────────────────
class Board {
  grid: (string | 0)[][];

  constructor() {
    this.grid = createMatrix(ROWS, COLS);
  }

  reset(): void {
    this.grid = createMatrix(ROWS, COLS);
  }

  isValid(shape: Shape, row: number, col: number): boolean {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nr = row + r;
        const nc = col + c;
        if (nr < 0) continue;
        if (nr >= ROWS || nc < 0 || nc >= COLS) return false;
        if (this.grid[nr][nc]) return false;
      }
    }
    return true;
  }

  lock(shape: Shape, row: number, col: number, color: string): boolean {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          if (row + r < 0) return false;
          this.grid[row + r][col + c] = color;
        }
      }
    }
    return true;
  }

  clearLines(): number {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].every(cell => cell !== 0)) {
        this.grid.splice(r, 1);
        this.grid.unshift(Array<string | 0>(COLS).fill(0));
        cleared++;
        r++;
      }
    }
    return cleared;
  }
}

// ── Piece class ────────────────────────────────────────────────────────
class Piece {
  key: string;
  def: TetrominoDef;
  color: string;
  rotIdx: number;
  shape: Shape;
  col: number;
  row: number;

  constructor(key: string) {
    this.key    = key;
    this.def    = TETROMINOES[key];
    this.color  = this.def.color;
    this.rotIdx = 0;
    this.shape  = this.def.shapes[0];
    this.col    = Math.floor((COLS - this.shape[0].length) / 2);
    this.row    = -1;
  }

  rotated(dir = 1): Shape {
    const total = this.def.shapes.length;
    const idx   = (this.rotIdx + dir + total) % total;
    return this.def.shapes[idx];
  }
}

// ── Renderer ───────────────────────────────────────────────────────────
class Renderer {
  private bCtx: CanvasRenderingContext2D;
  private nCtx: CanvasRenderingContext2D;
  private hCtx: CanvasRenderingContext2D;
  private bW: number;
  private bH: number;
  private nW: number;
  private nH: number;
  private hW: number;
  private hH: number;

  constructor(boardCanvas: HTMLCanvasElement, nextCanvas: HTMLCanvasElement, holdCanvas: HTMLCanvasElement) {
    this.bCtx = boardCanvas.getContext('2d')!;
    this.nCtx = nextCanvas.getContext('2d')!;
    this.hCtx = holdCanvas.getContext('2d')!;
    this.bW   = boardCanvas.width;
    this.bH   = boardCanvas.height;
    this.nW   = nextCanvas.width;
    this.nH   = nextCanvas.height;
    this.hW   = holdCanvas.width;
    this.hH   = holdCanvas.height;
  }

  private _getBgColor(): string {
    return document.documentElement.getAttribute('data-theme') === 'light' ? '#d8d8ec' : '#05050d';
  }

  private _drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    const pad = 1;
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + pad, y + pad, size - pad * 2, 4);
    ctx.fillRect(x + pad, y + pad, 4, size - pad * 2);

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + pad, y + size - pad - 4, size - pad * 2, 4);
    ctx.fillRect(x + size - pad - 4, y + pad, 4, size - pad * 2);
  }

  private _drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
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

  renderBoard(board: Board, activePiece: Piece | null, ghostPiece: GhostPiece | null): void {
    const ctx = this.bCtx;

    ctx.fillStyle = this._getBgColor();
    ctx.fillRect(0, 0, this.bW, this.bH);

    this._drawGrid(ctx, this.bW, this.bH);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = board.grid[r][c];
        if (color) this._drawCell(ctx, c * BLOCK, r * BLOCK, BLOCK, color);
      }
    }

    if (ghostPiece) {
      ctx.globalAlpha = 0.2;
      for (let r = 0; r < ghostPiece.shape.length; r++) {
        for (let c = 0; c < ghostPiece.shape[r].length; c++) {
          if (ghostPiece.shape[r][c] && activePiece) {
            const y = (ghostPiece.row + r) * BLOCK;
            const x = (ghostPiece.col + c) * BLOCK;
            if (y >= 0) this._drawCell(ctx, x, y, BLOCK, activePiece.color);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

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

  renderNext(nextKey: string): void {
    const ctx   = this.nCtx;
    const def   = TETROMINOES[nextKey];
    const shape = def.shapes[0];

    ctx.fillStyle = this._getBgColor();
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

  // Drawn on top of the board after renderBoard. Handles the flashing-row
  // overlay during a line clear and any active confetti particles.
  renderEffects(clearAnim: LineClearAnim | null, particles: readonly Particle[]): void {
    const ctx = this.bCtx;

    if (clearAnim) {
      const t = Math.min(1, clearAnim.elapsed / clearAnim.duration);
      // Rapid pulse that fades as the clear progresses.
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 5);
      const alpha = (1 - t) * (0.55 + 0.35 * pulse);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      for (const r of clearAnim.rows) {
        ctx.fillRect(0, r * BLOCK, this.bW, BLOCK);
      }
    }

    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const half = p.size / 2;
      ctx.fillRect(-half, -half, p.size, p.size);
      ctx.restore();
    }
  }

  renderHold(holdKey: string | null, holdUsed: boolean): void {
    const ctx = this.hCtx;
    ctx.fillStyle = this._getBgColor();
    ctx.fillRect(0, 0, this.hW, this.hH);

    if (!holdKey) return;

    const def   = TETROMINOES[holdKey];
    const shape = def.shapes[0];
    const rows  = shape.length;
    const cols  = shape[0].length;
    const ox    = Math.floor((this.hW / NEXT_BLOCK - cols) / 2) * NEXT_BLOCK;
    const oy    = Math.floor((this.hH / NEXT_BLOCK - rows) / 2) * NEXT_BLOCK;

    ctx.globalAlpha = holdUsed ? 0.35 : 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (shape[r][c]) {
          this._drawCell(ctx, ox + c * NEXT_BLOCK, oy + r * NEXT_BLOCK, NEXT_BLOCK, def.color);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ── AudioManager ───────────────────────────────────────────────────────
// All audio synthesized via Web Audio API – no external files needed.
class AudioManager {
  private _ctx:         AudioContext | null = null;
  private _masterGain:  GainNode | null = null;
  private _musicGain:   GainNode | null = null;
  private _sfxGain:     GainNode | null = null;

  private _musicVolume:  number;
  private _muted:        boolean;

  private _melody:       [number, number][];
  private _melodyIdx:    number = 0;
  private _nextNoteTime: number = 0;
  private _schedTimer:   ReturnType<typeof setTimeout> | null = null;
  private _isPlaying:    boolean = false;

  constructor() {
    this._musicVolume = parseFloat(localStorage.getItem('tetris_music_vol') ?? '0.4');
    this._muted       = localStorage.getItem('tetris_muted') === 'true';
    this._melody      = this._buildMelody();
  }

  // Lazy-init AudioContext on first user interaction
  private _getCtx(): AudioContext {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._muted ? 0 : 1;
      this._masterGain.connect(this._ctx.destination);

      this._musicGain = this._ctx.createGain();
      this._musicGain.gain.value = this._musicVolume;
      this._musicGain.connect(this._masterGain);

      this._sfxGain = this._ctx.createGain();
      this._sfxGain.gain.value = 0.5;
      this._sfxGain.connect(this._masterGain);
    }
    return this._ctx;
  }

  // Tetris A theme (Korobeiniki) – encoded as [frequency_hz, duration_s]
  private _buildMelody(): [number, number][] {
    const BPM = 144;
    const Q   = 60 / BPM;   // quarter ≈ 0.417 s
    const E   = Q / 2;       // eighth
    const H   = Q * 2;       // half
    const DQ  = Q * 1.5;     // dotted quarter

    const E5 = 659.25, B4 = 493.88, C5 = 523.25, D5 = 587.33,
          A4 = 440.00, F5 = 698.46, G5 = 783.99, A5 = 880.00;

    return [
      // Part A – main theme
      [E5, Q],  [B4, E],  [C5, E],  [D5, Q],  [C5, E],  [B4, E],
      [A4, Q],  [A4, E],  [C5, E],  [E5, Q],  [D5, E],  [C5, E],
      [B4, DQ], [C5, E],  [D5, Q],  [E5, Q],
      [C5, Q],  [A4, Q],  [A4, H],
      // Part B – bridge
      [0,  E],  [D5, DQ], [F5, E],  [A5, Q],  [G5, E],  [F5, E],
      [E5, DQ], [C5, E],  [E5, Q],  [D5, E],  [C5, E],
      [B4, Q],  [B4, E],  [C5, E],  [D5, Q],  [E5, Q],
      [C5, Q],  [A4, Q],  [A4, Q],  [0,  Q],
    ];
  }

  // Lookahead scheduler – schedules notes slightly ahead of playback position
  private _scheduleNotes(): void {
    const ctx       = this._getCtx();
    const LOOKAHEAD = 0.1;   // seconds ahead to schedule
    const INTERVAL  = 50;    // ms between scheduler runs

    while (this._nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      const [freq, dur] = this._melody[this._melodyIdx];

      if (freq > 0) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.value = freq;

        // Attack / sustain / release envelope
        gain.gain.setValueAtTime(0,    this._nextNoteTime);
        gain.gain.linearRampToValueAtTime(0.25, this._nextNoteTime + 0.005);
        gain.gain.setValueAtTime(0.25, this._nextNoteTime + dur * 0.8);
        gain.gain.linearRampToValueAtTime(0,   this._nextNoteTime + dur * 0.95);

        osc.connect(gain);
        gain.connect(this._musicGain!);
        osc.start(this._nextNoteTime);
        osc.stop(this._nextNoteTime + dur);
      }

      this._nextNoteTime += dur;
      this._melodyIdx = (this._melodyIdx + 1) % this._melody.length;
    }

    if (this._isPlaying) {
      this._schedTimer = setTimeout(() => this._scheduleNotes(), INTERVAL);
    }
  }

  startMusic(): void {
    if (this._isPlaying) return;
    const ctx = this._getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    this._isPlaying    = true;
    this._nextNoteTime = ctx.currentTime + 0.05;
    this._scheduleNotes();
  }

  pauseMusic(): void {
    this._isPlaying = false;
    if (this._schedTimer !== null) {
      clearTimeout(this._schedTimer);
      this._schedTimer = null;
    }
  }

  stopMusic(): void {
    this.pauseMusic();
    this._melodyIdx = 0; // reset to beginning for next game
  }

  setVolume(v: number): void {
    this._musicVolume = v;
    if (this._musicGain) {
      this._musicGain.gain.setTargetAtTime(v, this._getCtx().currentTime, 0.02);
    }
    localStorage.setItem('tetris_music_vol', String(v));
  }

  setMuted(on: boolean): void {
    this._muted = on;
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(on ? 0 : 1, this._getCtx().currentTime, 0.02);
    }
    localStorage.setItem('tetris_muted', String(on));
  }

  get musicVolume(): number { return this._musicVolume; }
  get muted():      boolean { return this._muted; }

  // ── Sound effects ────────────────────────────────────────────────────

  playMove(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 220;
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.05);
  }

  playRotate(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.12);
  }

  playSoftDrop(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 180;
    g.gain.setValueAtTime(0.04, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.05);
  }

  playHardDrop(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.18);
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.22);
  }

  playLock(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 160;
    g.gain.setValueAtTime(0.1, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.12);
  }

  playLineClear(count: number): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    if (count >= 4) {
      // Tetris! – ascending fanfare
      ([523, 659, 784, 1047] as number[]).forEach((freq, i) => {
        const t = now + i * 0.07;
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.14, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(g); g.connect(this._sfxGain!);
        osc.start(t); osc.stop(t + 0.2);
      });
    } else {
      // 1–3 lines – ascending sweep
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(400 + count * 80, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.22);
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      osc.connect(g); g.connect(this._sfxGain!);
      osc.start(now); osc.stop(now + 0.28);
    }
  }

  playLevelUp(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    ([523, 659, 784, 1047] as number[]).forEach((freq, i) => {
      const t = now + i * 0.09;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g); g.connect(this._sfxGain!);
      osc.start(t); osc.stop(t + 0.18);
    });
  }

  playGameOver(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    ([523, 466, 415, 370, 330, 294, 262] as number[]).forEach((freq, i) => {
      const t = now + i * 0.12;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g); g.connect(this._sfxGain!);
      osc.start(t); osc.stop(t + 0.25);
    });
  }

  playHold(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(330, now + 0.14);
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.18);
  }

  playClick(): void {
    const ctx = this._getCtx(), now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 660;
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(g); g.connect(this._sfxGain!);
    osc.start(now); osc.stop(now + 0.08);
  }
}

// ── Game class ─────────────────────────────────────────────────────────
class Game {
  private audio: AudioManager;
  private board: Board;
  private renderer: Renderer;

  private $score: HTMLElement;
  private $level: HTMLElement;
  private $lines: HTMLElement;
  private $highScore: HTMLElement;
  private $overlay: HTMLElement;
  private $title: HTMLElement;
  private $sub: HTMLElement;
  private $btnStart: HTMLElement;

  private highScore: number;
  private state: GameState;
  private rafId: number | null;
  private lastTick: number;
  private dropAccum: number;

  private score: number;
  private level: number;
  private lines: number;
  private piece: Piece | null;
  private nextKey: string | null;
  private holdKey: string | null;
  private holdUsed: boolean;
  private ghost: GhostPiece | null;

  // null = piece not currently grounded; otherwise ms accumulated since landing
  private lockTimer: number | null;
  private lockResets: number;

  // Active line-clear animation (rows held visible while flashing). When set,
  // piece logic is suspended until the animation finishes.
  private clearAnim: LineClearAnim | null;
  private particles: Particle[];

  constructor(audio: AudioManager) {
    this.audio    = audio;
    this.board    = new Board();
    this.renderer = new Renderer(
      document.getElementById('board') as HTMLCanvasElement,
      document.getElementById('next') as HTMLCanvasElement,
      document.getElementById('hold') as HTMLCanvasElement,
    );

    this.$score     = document.getElementById('score')!;
    this.$level     = document.getElementById('level')!;
    this.$lines     = document.getElementById('lines')!;
    this.$highScore = document.getElementById('high-score')!;
    this.$overlay   = document.getElementById('overlay')!;
    this.$title     = document.getElementById('overlay-title')!;
    this.$sub       = document.getElementById('overlay-sub')!;
    this.$btnStart  = document.getElementById('btn-start')!;

    this.highScore = parseInt(localStorage.getItem('tetris_hs') ?? '0', 10);
    this.$highScore.textContent = String(this.highScore);

    this.state     = 'idle';
    this.rafId     = null;
    this.lastTick  = 0;
    this.dropAccum = 0;

    this.score    = 0;
    this.level    = 1;
    this.lines    = 0;
    this.piece    = null;
    this.nextKey  = null;
    this.holdKey  = null;
    this.holdUsed = false;
    this.ghost    = null;

    this.lockTimer  = null;
    this.lockResets = 0;

    this.clearAnim = null;
    this.particles = [];

    this._bindEvents();
    this._bindTouchEvents();
    this._bindTouchPad();
  }

  // ── Event binding ────────────────────────────────────────────────────
  private _bindEvents(): void {
    document.addEventListener('keydown', e => this._handleKey(e));
    this.$btnStart.addEventListener('click', () => {
      try { this.audio.playClick(); } catch (_) {}
      if (this.state === 'paused') this._unpause();
      else this._startOrRestart();
    });
  }

  private _handleKey(e: KeyboardEvent): void {
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
      case 'Shift':      e.preventDefault(); this._holdPiece(); break;
      case 'p': case 'P': this._pause(); break;
    }
  }

  // ── Start / Restart ──────────────────────────────────────────────────
  private _startOrRestart(): void {
    this.board.reset();
    this.score     = 0;
    this.level     = 1;
    this.lines     = 0;
    this.dropAccum = 0;
    this.lastTick  = 0;
    this.holdKey   = null;
    this.holdUsed  = false;
    this.clearAnim = null;
    this.particles = [];

    this._updateHUD();
    this.nextKey = randomKey();
    this._spawnPiece();

    this.state = 'playing';
    this.$overlay.classList.add('hidden');

    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(ts => this._loop(ts));
    try { this.audio.startMusic(); } catch (_) {}
  }

  // ── Spawn ────────────────────────────────────────────────────────────
  private _spawnPiece(): void {
    this.piece      = new Piece(this.nextKey!);
    this.nextKey    = randomKey();
    this.lockTimer  = null;
    this.lockResets = 0;
    this.renderer.renderNext(this.nextKey);
    this.renderer.renderHold(this.holdKey, this.holdUsed);
    this._updateGhost();

    if (!this.board.isValid(this.piece.shape, this.piece.row, this.piece.col)) {
      this._gameOver();
    }
  }

  // ── Ghost piece ──────────────────────────────────────────────────────
  private _updateGhost(): void {
    if (!this.piece) { this.ghost = null; return; }
    let r = this.piece.row;
    while (this.board.isValid(this.piece.shape, r + 1, this.piece.col)) r++;
    this.ghost = { shape: this.piece.shape, row: r, col: this.piece.col };
  }

  // Call after any successful player-driven move or rotation. If the piece
  // slid off a ledge it cancels the lock delay; if it is still grounded it
  // resets the timer (up to LOCK_MOVE_RESET_LIMIT times).
  private _onPieceMoved(): void {
    if (!this.piece) return;
    const grounded = !this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col);
    if (!grounded) {
      this.lockTimer  = null;
      this.lockResets = 0;
    } else if (this.lockTimer !== null && this.lockResets < LOCK_MOVE_RESET_LIMIT) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  // ── Movement ─────────────────────────────────────────────────────────
  private _move(dRow: number, dCol: number): void {
    if (!this.piece) return;
    const { shape, row, col } = this.piece;
    if (this.board.isValid(shape, row + dRow, col + dCol)) {
      this.piece.row += dRow;
      this.piece.col += dCol;
      this._onPieceMoved();
      this._updateGhost();
      this._render();
      this.audio.playMove();
    }
  }

  private _rotate(dir = 1): void {
    if (!this.piece) return;
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
        this._onPieceMoved();
        this._updateGhost();
        this._render();
        this.audio.playRotate();
        return;
      }
    }
  }

  // Basic SRS wall-kick offsets
  private _getKicks(key: string, rotIdx: number, dir: number): [number, number][] {
    if (key === 'O') return [[0, 0]];
    if (key === 'I') {
      const table: [number, number][][] = [
        [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
        [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
        [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
        [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
      ];
      const from = dir === 1 ? rotIdx : (rotIdx + 1) % 4;
      return dir === 1
        ? table[from].map(([r, c]) => [-r, c] as [number, number])
        : table[(from + 3) % 4].map(([r, c]) => [r, -c] as [number, number]);
    }
    const table: [number, number][][] = [
      [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
      [[0,0],[1,0],[1,-1],[0,2],[1,2]],
      [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
      [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    ];
    const from = dir === 1 ? rotIdx : (rotIdx + 3) % 4;
    return dir === 1
      ? table[from].map(([r, c]) => [-r, c] as [number, number])
      : table[(from + 1) % 4].map(([r, c]) => [r, -c] as [number, number]);
  }

  private _softDrop(): void {
    if (!this.piece) return;
    if (this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
      this.piece.row++;
      this.score++;
      this._updateHUD();
      this.dropAccum = 0;
      this._onPieceMoved();
      this.audio.playSoftDrop();
    }
    // When already grounded, _loop's lock-delay timer handles the lock.
    this._render();
  }

  private _hardDrop(): void {
    if (!this.piece) return;
    let dropped = 0;
    while (this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
      this.piece.row++;
      dropped++;
    }
    this.score += dropped * 2;
    this._updateHUD();
    this.audio.playHardDrop();
    this._lock();
    this._render();
  }

  // ── Hold piece ───────────────────────────────────────────────────────
  private _holdPiece(): void {
    if (!this.piece || this.holdUsed) return;
    this.holdUsed = true;
    this.audio.playHold();
    const currentKey = this.piece.key;
    if (this.holdKey === null) {
      this.holdKey = currentKey;
      this._spawnPiece();
    } else {
      const swapKey   = this.holdKey;
      this.holdKey    = currentKey;
      this.piece      = new Piece(swapKey);
      this.lockTimer  = null;
      this.lockResets = 0;
      this._updateGhost();
      this.renderer.renderHold(this.holdKey, this.holdUsed);
    }
    this._render();
  }

  // ── On-screen touch pad (mobile buttons) ─────────────────────────────
  // Wires the visible D-pad to the same actions as keyboard keys. Left/right/
  // soft-drop auto-repeat while held so the player doesn't need to spam taps.
  private _bindTouchPad(): void {
    const REPEAT_DELAY    = 180; // ms before auto-repeat kicks in
    const REPEAT_INTERVAL = 70;  // ms between repeats

    const bind = (id: string, action: () => void, repeat: boolean): void => {
      const el = document.getElementById(id);
      if (!el) return;

      let initialTimer: number | null = null;
      let repeatTimer:  number | null = null;

      const stop = (): void => {
        if (initialTimer !== null) { clearTimeout(initialTimer); initialTimer = null; }
        if (repeatTimer  !== null) { clearInterval(repeatTimer); repeatTimer  = null; }
      };

      const press = (e: Event): void => {
        e.preventDefault();
        if (this.state === 'idle' || this.state === 'gameover') {
          this._startOrRestart();
          return;
        }
        if (this.state === 'paused') {
          if (id === 't-pause') this._unpause();
          return;
        }
        action();
        if (repeat) {
          initialTimer = window.setTimeout(() => {
            repeatTimer = window.setInterval(action, REPEAT_INTERVAL);
          }, REPEAT_DELAY);
        }
      };

      el.addEventListener('touchstart', press, { passive: false });
      el.addEventListener('touchend',   stop,  { passive: true });
      el.addEventListener('touchcancel', stop, { passive: true });
      el.addEventListener('mousedown',  press);
      el.addEventListener('mouseup',    stop);
      el.addEventListener('mouseleave', stop);
    };

    bind('t-left',   () => this._move(0, -1), true);
    bind('t-right',  () => this._move(0,  1), true);
    bind('t-down',   () => this._softDrop(),  true);
    bind('t-rotate', () => this._rotate(1),   false);
    bind('t-drop',   () => this._hardDrop(),  false);
    bind('t-hold',   () => this._holdPiece(), false);
    bind('t-pause',  () => this._pause(),     false);
  }

  // ── Touch / swipe controls ───────────────────────────────────────────
  private _bindTouchEvents(): void {
    const canvas = document.getElementById('board') as HTMLCanvasElement;
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      startX    = t.clientX;
      startY    = t.clientY;
      startTime = Date.now();
    }, { passive: false });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      if (this.state === 'idle' || this.state === 'gameover') {
        this._startOrRestart();
        return;
      }
      if (this.state === 'paused') {
        this._unpause();
        return;
      }
      const t  = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const dt = Date.now() - startTime;
      const SWIPE = 30;

      if (ax < 12 && ay < 12 && dt < 250) {
        this._rotate(1);
      } else if (ax > ay && ax > SWIPE) {
        dx > 0 ? this._move(0, 1) : this._move(0, -1);
      } else if (ay > ax && ay > SWIPE) {
        dy > 0 ? this._hardDrop() : this._holdPiece();
      }
    }, { passive: false });
  }

  // ── Lock piece ───────────────────────────────────────────────────────
  private _lock(): void {
    if (!this.piece) return;
    const ok = this.board.lock(this.piece.shape, this.piece.row, this.piece.col, this.piece.color);
    if (!ok) { this._gameOver(); return; }

    this.audio.playLock();

    const fullRows: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.board.grid[r].every(cell => cell !== 0)) fullRows.push(r);
    }

    if (fullRows.length === 0) {
      this.holdUsed = false;
      this._spawnPiece();
      return;
    }

    // Lines cleared — kick off the visual phase, defer the actual collapse.
    const cleared      = fullRows.length;
    const awardedScore = LINE_SCORES[cleared] * this.level;

    this._spawnLineClearParticles(fullRows);
    this._showClearPopup(cleared, awardedScore);
    this._flashBoardGlow(cleared);
    if (cleared >= 4) this._screenShake();

    this.audio.playLineClear(cleared);

    this.clearAnim = {
      rows:    fullRows,
      elapsed: 0,
      duration: LINE_CLEAR_DURATION_MS,
      cleared,
      awardedScore,
    };
    // Hide the now-locked piece while rows flash; new piece spawns in _completeClear.
    this.piece = null;
    this.ghost = null;
  }

  // Called by the loop once the line-clear animation has run its course.
  // Performs the actual row collapse, scoring, and next-piece spawn.
  private _completeClear(): void {
    if (!this.clearAnim) return;
    const { cleared, awardedScore } = this.clearAnim;

    this.board.clearLines();
    this.score += awardedScore;
    this.lines += cleared;
    const prevLevel = this.level;
    this.level = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
    this._updateHUD();
    if (this.level > prevLevel) this.audio.playLevelUp();

    this.clearAnim = null;
    this.holdUsed  = false;
    this._spawnPiece();
  }

  // ── Effects ──────────────────────────────────────────────────────────
  private _spawnLineClearParticles(rows: readonly number[]): void {
    const PER_CELL = 4;
    for (const r of rows) {
      for (let c = 0; c < COLS; c++) {
        const cell  = this.board.grid[r][c];
        const color = typeof cell === 'string' ? cell : '#ffffff';
        const cx = (c + 0.5) * BLOCK;
        const cy = (r + 0.5) * BLOCK;
        for (let i = 0; i < PER_CELL; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.06 + Math.random() * 0.22; // px/ms
          const life  = 600 + Math.random() * 250;
          this.particles.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.08,    // bias upward
            size: 4 + Math.random() * 5,
            color,
            life,
            maxLife: life,
            rot:  Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 0.02,
          });
        }
      }
    }
  }

  private _updateParticles(dt: number): void {
    if (this.particles.length === 0) return;
    const GRAVITY = 0.0007; // px/ms²
    for (const p of this.particles) {
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vy  += GRAVITY * dt;
      p.rot += p.vrot * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private _showClearPopup(cleared: number, score: number): void {
    const labels = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS!'];
    const wrap = document.querySelector('.board-wrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `clear-popup clear-popup-${cleared}`;
    const label = document.createElement('div');
    label.className = 'popup-label';
    label.textContent = labels[cleared] ?? `${cleared} LINES`;
    const sc = document.createElement('div');
    sc.className = 'popup-score';
    sc.textContent = `+${score}`;
    el.appendChild(label);
    el.appendChild(sc);
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  private _flashBoardGlow(cleared: number): void {
    const canvas = document.getElementById('board') as HTMLCanvasElement | null;
    if (!canvas) return;
    const color = cleared >= 4 ? '#ffd740' : '#00e5ff';
    const blur  = cleared >= 4 ? 50 : 30;
    canvas.style.boxShadow = `0 0 ${blur}px 8px ${color}`;
    setTimeout(() => { canvas.style.boxShadow = ''; }, 260);
  }

  private _screenShake(): void {
    const canvas = document.getElementById('board') as HTMLElement | null;
    if (!canvas) return;
    canvas.classList.remove('shake');
    // Force reflow so the animation restarts when the class is re-added.
    void canvas.offsetWidth;
    canvas.classList.add('shake');
    setTimeout(() => canvas.classList.remove('shake'), 460);
  }

  // ── HUD ──────────────────────────────────────────────────────────────
  private _updateHUD(): void {
    this.$score.textContent = String(this.score);
    this.$level.textContent = String(this.level);
    this.$lines.textContent = String(this.lines);
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('tetris_hs', String(this.highScore));
      this.$highScore.textContent = String(this.highScore);
    }
  }

  // ── Pause ────────────────────────────────────────────────────────────
  private _pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.audio.pauseMusic();
    this.$title.textContent    = 'PAUSED';
    this.$sub.innerHTML        = 'Press <kbd>P</kbd> or <kbd>Enter</kbd> to resume';
    this.$btnStart.textContent = 'RESUME';
    this.$overlay.classList.remove('hidden');
  }

  private _unpause(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.$overlay.classList.add('hidden');
    this.$btnStart.textContent = 'START GAME';
    this.lastTick  = 0;
    this.dropAccum = 0;
    this.rafId = requestAnimationFrame(ts => this._loop(ts));
    try { this.audio.startMusic(); } catch (_) {}
  }

  // ── Game Over ────────────────────────────────────────────────────────
  private _gameOver(): void {
    this.state = 'gameover';
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.audio.stopMusic();
    this.audio.playGameOver();
    this.$title.textContent    = 'GAME OVER';
    this.$sub.innerHTML        = `Score: <strong>${this.score}</strong> — Press <kbd>Enter</kbd> to retry`;
    this.$btnStart.textContent = 'PLAY AGAIN';
    this.$overlay.classList.remove('hidden');
  }

  // ── Render ───────────────────────────────────────────────────────────
  private _render(): void {
    this.renderer.renderBoard(this.board, this.piece, this.ghost);
    this.renderer.renderEffects(this.clearAnim, this.particles);
  }

  // ── Main loop ────────────────────────────────────────────────────────
  private _loop(ts: number): void {
    if (this.state !== 'playing') return;
    if (!this.lastTick) this.lastTick = ts;
    const dt = ts - this.lastTick;
    this.lastTick = ts;

    this._updateParticles(dt);

    if (this.clearAnim) {
      this.clearAnim.elapsed += dt;
      if (this.clearAnim.elapsed >= this.clearAnim.duration) {
        this._completeClear();
      }
    }

    if (!this.clearAnim && this.piece) {
      const grounded = !this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col);

      if (grounded) {
        // Piece has landed — give the player a grace window to slide/rotate
        // before locking, instead of snapping in on contact.
        if (this.lockTimer === null) this.lockTimer = 0;
        this.lockTimer += dt;
        this.dropAccum = 0;

        if (this.lockTimer >= LOCK_DELAY_MS) {
          this._lock();
        }
      } else {
        this.lockTimer  = null;
        this.lockResets = 0;

        const interval = SPEED_TABLE[Math.min(this.level - 1, SPEED_TABLE.length - 1)];
        this.dropAccum += dt;

        if (this.dropAccum >= interval) {
          this.dropAccum -= interval;
          if (this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
            this.piece.row++;
            this._updateGhost();
          }
        }
      }
    }

    this._render();
    this.rafId = requestAnimationFrame(ts2 => this._loop(ts2));
  }
}

// ── BackgroundAnimator ─────────────────────────────────────────────────
// Drifting ghost-tetromino outlines behind the game UI.
interface BgParticle {
  shape: Shape;
  color: string;
  sz: number;
  x: number;
  y: number;
  vy: number;
  rot: number;
  drot: number;
  alpha: number;
}

class BackgroundAnimator {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _particles: BgParticle[];

  constructor() {
    this._canvas    = document.getElementById('bg') as HTMLCanvasElement;
    this._ctx       = this._canvas.getContext('2d')!;
    this._particles = [];
    this._resize();
    const count = window.innerWidth < 680 ? 12 : 22;
    for (let i = 0; i < count; i++) this._particles.push(this._spawn(true));
    window.addEventListener('resize', () => this._resize());
    this._tick();
  }

  private _resize(): void {
    this._canvas.width  = window.innerWidth;
    this._canvas.height = window.innerHeight;
  }

  private _spawn(scatter: boolean): BgParticle {
    const key   = PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
    const def   = TETROMINOES[key];
    const shape = def.shapes[Math.floor(Math.random() * def.shapes.length)];
    const sz    = Math.floor(Math.random() * 14) + 8;
    return {
      shape,
      color: def.color,
      sz,
      x:     Math.random() * window.innerWidth,
      y:     scatter ? Math.random() * (window.innerHeight + 60) - 60 : window.innerHeight + 60,
      vy:    Math.random() * 0.22 + 0.08,
      rot:   Math.random() * Math.PI * 2,
      drot:  (Math.random() - 0.5) * 0.003,
      alpha: Math.random() * 0.045 + 0.015,
    };
  }

  private _tick(): void {
    const ctx = this._ctx;
    const W   = this._canvas.width;
    const H   = this._canvas.height;

    ctx.clearRect(0, 0, W, H);

    for (const p of this._particles) {
      const cols = p.shape[0].length;
      const rows = p.shape.length;
      const cx   = p.x + (cols * p.sz) / 2;
      const cy   = p.y + (rows * p.sz) / 2;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth   = 1;
      ctx.translate(cx, cy);
      ctx.rotate(p.rot);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (p.shape[r][c]) {
            ctx.strokeRect(
              c * p.sz - (cols * p.sz) / 2 + 0.5,
              r * p.sz - (rows * p.sz) / 2 + 0.5,
              p.sz - 1,
              p.sz - 1,
            );
          }
        }
      }

      ctx.restore();

      p.y   -= p.vy;
      p.rot += p.drot;

      if (p.y + p.shape.length * p.sz < -10) {
        Object.assign(p, this._spawn(false));
      }
    }

    requestAnimationFrame(() => this._tick());
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────
const audio = new AudioManager();
const game  = new Game(audio);
new BackgroundAnimator();

// ── Audio controls ────────────────────────────────────────────────────
{
  const btnMute   = document.getElementById('btn-mute')!;
  const volSlider = document.getElementById('music-vol') as HTMLInputElement;

  function syncMuteBtn(muted: boolean): void {
    btnMute.textContent = muted ? '\u266A' : '\u266B'; // ♪ muted : ♫ playing
    btnMute.title       = muted ? 'Unmute music & SFX' : 'Mute music & SFX';
    btnMute.classList.toggle('muted', muted);
  }

  // Restore saved state
  volSlider.value = String(Math.round(audio.musicVolume * 100));
  syncMuteBtn(audio.muted);

  btnMute.addEventListener('click', () => {
    const nowMuted = !audio.muted;
    audio.setMuted(nowMuted);
    syncMuteBtn(nowMuted);
    if (!nowMuted) audio.playClick();
  });

  volSlider.addEventListener('input', () => {
    audio.setVolume(parseInt(volSlider.value, 10) / 100);
  });
}

// ── Theme toggle ──────────────────────────────────────────────────────
{
  const btnTheme = document.getElementById('btn-theme')!;

  // Restore saved theme on page load
  const savedTheme = localStorage.getItem('tetris_theme');
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  function syncThemeBtn(): void {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    btnTheme.textContent = light ? '\u263e' : '\u2600';
    btnTheme.title = light ? 'Switch to dark mode' : 'Switch to light mode';
  }

  syncThemeBtn();
  btnTheme.addEventListener('click', () => {
    audio.playClick();
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    if (light) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('tetris_theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('tetris_theme', 'light');
    }
    syncThemeBtn();
  });
}
