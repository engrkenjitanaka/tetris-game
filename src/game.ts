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

    ctx.fillStyle = '#05050d';
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

  renderHold(holdKey: string | null, holdUsed: boolean): void {
    const ctx = this.hCtx;
    ctx.fillStyle = '#05050d';
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

    this._bindEvents();
    this._bindTouchEvents();
  }

  // ── Event binding ────────────────────────────────────────────────────
  private _bindEvents(): void {
    document.addEventListener('keydown', e => this._handleKey(e));
    this.$btnStart.addEventListener('click', () => {
      this.audio.playClick();
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

    this._updateHUD();
    this.nextKey = randomKey();
    this._spawnPiece();

    this.state = 'playing';
    this.$overlay.classList.add('hidden');

    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(ts => this._loop(ts));
    this.audio.startMusic();
  }

  // ── Spawn ────────────────────────────────────────────────────────────
  private _spawnPiece(): void {
    this.piece   = new Piece(this.nextKey!);
    this.nextKey = randomKey();
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

  // ── Movement ─────────────────────────────────────────────────────────
  private _move(dRow: number, dCol: number): void {
    if (!this.piece) return;
    const { shape, row, col } = this.piece;
    if (this.board.isValid(shape, row + dRow, col + dCol)) {
      this.piece.row += dRow;
      this.piece.col += dCol;
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
      this.audio.playSoftDrop();
    } else {
      this._lock();
    }
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
      const swapKey = this.holdKey;
      this.holdKey  = currentKey;
      this.piece    = new Piece(swapKey);
      this._updateGhost();
      this.renderer.renderHold(this.holdKey, this.holdUsed);
    }
    this._render();
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

    const cleared = this.board.clearLines();
    if (cleared) {
      this.score += LINE_SCORES[cleared] * this.level;
      this.lines += cleared;
      const prevLevel = this.level;
      this.level = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
      this._updateHUD();
      this._flashLines();
      this.audio.playLineClear(cleared);
      if (this.level > prevLevel) this.audio.playLevelUp();
    }
    this.holdUsed = false;
    this._spawnPiece();
  }

  // ── Visual flash on line clear ───────────────────────────────────────
  private _flashLines(): void {
    const canvas = document.getElementById('board') as HTMLCanvasElement;
    canvas.style.boxShadow = '0 0 30px 6px #00e5ff';
    setTimeout(() => { canvas.style.boxShadow = ''; }, 200);
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
    this.audio.startMusic();
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
  }

  // ── Main loop ────────────────────────────────────────────────────────
  private _loop(ts: number): void {
    if (this.state !== 'playing') return;
    if (!this.lastTick) this.lastTick = ts;
    const dt = ts - this.lastTick;
    this.lastTick = ts;

    const interval = SPEED_TABLE[Math.min(this.level - 1, SPEED_TABLE.length - 1)];
    this.dropAccum += dt;

    if (this.dropAccum >= interval) {
      this.dropAccum -= interval;
      if (this.piece && this.board.isValid(this.piece.shape, this.piece.row + 1, this.piece.col)) {
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
const audio = new AudioManager();
new Game(audio);

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
