import {
  BOMB_FUSE,
  EXPLOSION_TIME,
  GRID_COLS,
  GRID_ROWS,
  PLAYER_RADIUS,
} from '../game/constants';
import {
  Cell,
  type Bomb,
  type Explosion,
  type GameState,
  type Player,
  type PowerUp,
} from '../game/types';

export const TILE_SIZE = 48;
// altura "3D" dos cubos: paredes e blocos se erguem acima do chão
const WALL_H = 14;

// P1 azul, P2 vermelho, P3 verde, P4 roxo
const PLAYER_ACCENTS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea'];

/** Algo desenhado de trás para frente, ordenado pela base (quanto mais
 *  embaixo na tela, mais na frente) — é o que dá a ilusão de profundidade */
interface Drawable {
  baseY: number;
  draw(): void;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  canvas.width = GRID_COLS * TILE_SIZE;
  canvas.height = GRID_ROWS * TILE_SIZE + WALL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D não suportado');
  return ctx;
}

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.save();
  ctx.translate(0, WALL_H); // espaço para a fileira de cima "crescer" para cima

  drawFloor(ctx, state);

  for (const explosion of state.explosions) {
    drawExplosion(ctx, explosion); // chamas ficam rentes ao chão
  }

  const drawables: Drawable[] = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = state.grid[row][col];
      if (cell === Cell.Wall) {
        drawables.push({ baseY: (row + 1) * TILE_SIZE, draw: () => drawCube(ctx, row, col, '#8b95a5', '#5b6472') });
      } else if (cell === Cell.Block) {
        drawables.push({ baseY: (row + 1) * TILE_SIZE, draw: () => drawCrate(ctx, row, col) });
      }
    }
  }

  for (const powerUp of state.powerUps) {
    drawables.push({
      baseY: (powerUp.row + 1) * TILE_SIZE - 2,
      draw: () => drawPowerUp(ctx, powerUp, state.elapsed),
    });
  }

  for (const bomb of state.bombs) {
    drawables.push({
      baseY: (bomb.row + 1) * TILE_SIZE - 2,
      draw: () => drawBomb(ctx, bomb, state.elapsed),
    });
  }

  for (const player of state.players) {
    if (!player.alive) continue;
    drawables.push({
      baseY: (player.y + PLAYER_RADIUS) * TILE_SIZE,
      draw: () => drawPlayer(ctx, player),
    });
  }

  drawables.sort((a, b) => a.baseY - b.baseY);
  for (const d of drawables) d.draw();

  ctx.restore();

  if (state.phase === 'over') drawGameOver(ctx, state);
}

// ---------------------------------------------------------------- chão

function drawFloor(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      ctx.fillStyle = (row + col) % 2 === 0 ? '#4a9e3f' : '#54ab48';
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

      // tufos de grama determinísticos (sem randomizar a cada frame)
      if ((row * 31 + col * 17) % 5 === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(x + ((col * 13) % 30) + 6, y + ((row * 23) % 30) + 6, 8, 4);
      }
    }
  }

  // cubos projetam sombra na célula logo abaixo — vende a altura
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let row = 1; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (state.grid[row][col] !== Cell.Floor) continue;
      if (state.grid[row - 1][col] === Cell.Floor) continue;
      ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, 9);
    }
  }
}

// ---------------------------------------------------------------- cubos

/** Um cubo 2.5D: face superior deslocada para cima + face frontal embaixo */
function drawCube(
  ctx: CanvasRenderingContext2D,
  row: number,
  col: number,
  top: string,
  front: string,
): void {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;

  ctx.fillStyle = front;
  ctx.fillRect(x, y + TILE_SIZE - WALL_H, TILE_SIZE, WALL_H);

  ctx.fillStyle = top;
  ctx.fillRect(x, y - WALL_H, TILE_SIZE, TILE_SIZE);

  // aresta clara em cima, linha escura separando as faces
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(x, y - WALL_H, TILE_SIZE, 3);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(x, y + TILE_SIZE - WALL_H, TILE_SIZE, 2);
}

/** Caixote de madeira destrutível */
function drawCrate(ctx: CanvasRenderingContext2D, row: number, col: number): void {
  drawCube(ctx, row, col, '#c9862e', '#96621d');

  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE - WALL_H;
  ctx.strokeStyle = 'rgba(90, 55, 10, 0.55)';
  ctx.lineWidth = 2;
  // tábuas + moldura na face de cima
  ctx.strokeRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
  ctx.beginPath();
  ctx.moveTo(x + 4, y + TILE_SIZE / 2);
  ctx.lineTo(x + TILE_SIZE - 4, y + TILE_SIZE / 2);
  ctx.stroke();
}

// ---------------------------------------------------------------- entidades

const POWERUP_ICONS = { extraBomb: '💣', range: '🔥', speed: '⚡' } as const;

function drawPowerUp(
  ctx: CanvasRenderingContext2D,
  powerUp: PowerUp,
  elapsed: number,
): void {
  const x = powerUp.col * TILE_SIZE;
  const y = powerUp.row * TILE_SIZE;
  const bob = Math.sin(elapsed * 4 + powerUp.row + powerUp.col) * 2.5;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + TILE_SIZE / 2, y + TILE_SIZE - 8, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x + 7, y + 3 + bob, TILE_SIZE - 14, TILE_SIZE - 14, 8);
  ctx.fill();
  ctx.stroke();

  ctx.font = `${TILE_SIZE * 0.48}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    POWERUP_ICONS[powerUp.type],
    x + TILE_SIZE / 2,
    y + TILE_SIZE / 2 - 4 + bob,
  );
}

function drawBomb(
  ctx: CanvasRenderingContext2D,
  bomb: Bomb,
  elapsed: number,
): void {
  const cx = (bomb.col + 0.5) * TILE_SIZE;
  const cy = (bomb.row + 0.5) * TILE_SIZE;
  // pulsa cada vez mais rápido conforme chega perto de explodir
  const urgency = 1 - bomb.timer / BOMB_FUSE;
  const pulse = 1 + 0.08 * Math.sin(elapsed * (6 + urgency * 14));
  const r = TILE_SIZE * 0.32 * pulse;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.75, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  // pavio com brasa
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.5, cy - r - 9, cx + r * 0.8, cy - r - 5);
  ctx.stroke();
  ctx.fillStyle = urgency > 0.6 && Math.sin(elapsed * 30) > 0 ? '#fde047' : '#f97316';
  ctx.beginPath();
  ctx.arc(cx + r * 0.8, cy - r - 5, 3, 0, Math.PI * 2);
  ctx.fill();

  // esfera com volume (gradiente radial)
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
  grad.addColorStop(0, '#4b5563');
  grad.addColorStop(1, '#0b0f19');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawExplosion(
  ctx: CanvasRenderingContext2D,
  explosion: Explosion,
): void {
  const fade = explosion.timer / EXPLOSION_TIME; // 1 → 0
  ctx.globalAlpha = Math.min(1, fade * 1.4);

  for (const { row, col } of explosion.cells) {
    const cx = (col + 0.5) * TILE_SIZE;
    const cy = (row + 0.5) * TILE_SIZE;
    const grad = ctx.createRadialGradient(cx, cy, 3, cx, cy, TILE_SIZE * 0.72);
    grad.addColorStop(0, '#fffbe8');
    grad.addColorStop(0.35, '#fde047');
    grad.addColorStop(0.75, '#f97316');
    grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - TILE_SIZE * 0.75, cy - TILE_SIZE * 0.75, TILE_SIZE * 1.5, TILE_SIZE * 1.5);
  }

  ctx.globalAlpha = 1;
}

/** Personagem "de pé": sombra, pernas, corpo colorido e cabeça com capacete */
function drawPlayer(ctx: CanvasRenderingContext2D, p: Player): void {
  const accent = PLAYER_ACCENTS[p.id - 1] ?? '#2563eb';
  const px = p.x * TILE_SIZE;
  const feetY = (p.y + PLAYER_RADIUS) * TILE_SIZE;
  const s = TILE_SIZE; // escala

  // sombra nos pés
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(px, feetY, s * 0.28, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // pernas
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(px - s * 0.16, feetY - s * 0.16, s * 0.13, s * 0.16);
  ctx.fillRect(px + s * 0.03, feetY - s * 0.16, s * 0.13, s * 0.16);

  // corpo (macacão na cor do jogador)
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(px - s * 0.24, feetY - s * 0.58, s * 0.48, s * 0.46, s * 0.12);
  ctx.fill();

  // cabeça branca com capacete colorido
  const headY = feetY - s * 0.72;
  const hr = s * 0.26;
  ctx.fillStyle = '#f3f4f6';
  ctx.beginPath();
  ctx.arc(px, headY, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(px, headY, hr, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, headY, hr, 0, Math.PI * 2);
  ctx.stroke();

  // olhos acompanham a direção
  const look = { up: [0, -1], down: [0, 1], left: [-1, 0.3], right: [1, 0.3] }[
    p.facing
  ];
  if (p.facing !== 'up') {
    const eyeY = headY + hr * 0.15 + look[1] * hr * 0.2;
    const eyeDX = look[0] * hr * 0.25;
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(px - hr * 0.32 + eyeDX, eyeY, hr * 0.14, 0, Math.PI * 2);
    ctx.arc(px + hr * 0.32 + eyeDX, eyeY, hr * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- fim de jogo

function drawGameOver(ctx: CanvasRenderingContext2D, state: GameState): void {
  const w = GRID_COLS * TILE_SIZE;
  const h = GRID_ROWS * TILE_SIZE + WALL_H;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, w, h);

  const title =
    state.winnerId === null ? 'Empate!' : `Jogador ${state.winnerId} venceu!`;
  ctx.fillStyle =
    state.winnerId === null
      ? '#e5e7eb'
      : PLAYER_ACCENTS[state.winnerId - 1] ?? '#e5e7eb';
  ctx.font = 'bold 56px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, w / 2, h / 2 - 24);

  ctx.fillStyle = '#e5e7eb';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText('Pressione R para jogar de novo', w / 2, h / 2 + 32);
}
