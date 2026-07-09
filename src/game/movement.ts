import { PLAYER_RADIUS } from './constants';
import type { Player, PlayerInput } from './types';

/** Diz se a célula bloqueia o movimento (parede, bloco, bomba...) */
export type SolidFn = (row: number, col: number) => boolean;

const R = PLAYER_RADIUS;
// margem para o jogador não colidir com a célula vizinha quando encostado nela
const EPS = 0.001;

export function movePlayer(
  solid: SolidFn,
  player: Player,
  input: PlayerInput,
  dt: number,
): void {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return;

  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }

  player.facing =
    dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right';

  const dist = player.speed * dt;
  const blockedX = dx !== 0 && moveX(solid, player, dx * dist);
  const blockedY = dy !== 0 && moveY(solid, player, dy * dist);

  // Deslizar na quina: se travou andando reto, desliza no eixo perpendicular
  // em direção ao centro do corredor livre — o toque que deixa o controle fluido
  if (blockedX && dy === 0) slideToRow(solid, player, Math.sign(dx), dist);
  if (blockedY && dx === 0) slideToCol(solid, player, Math.sign(dy), dist);
}

/** Move no eixo X, parando na borda da célula sólida. Retorna true se travou. */
function moveX(solid: SolidFn, p: Player, dx: number): boolean {
  const sign = Math.sign(dx);
  const edge = p.x + dx + sign * R;
  const col = Math.floor(edge);
  const rowMin = Math.floor(p.y - R + EPS);
  const rowMax = Math.floor(p.y + R - EPS);

  for (let row = rowMin; row <= rowMax; row++) {
    if (solid(row, col)) {
      // encosta EXATAMENTE na parede: com raio de meia célula isso deixa o
      // jogador alinhado ao centro do corredor, sem folga nem jitter
      p.x = sign > 0 ? col - R : col + 1 + R;
      return true;
    }
  }
  p.x += dx;
  return false;
}

/** Move no eixo Y, parando na borda da célula sólida. Retorna true se travou. */
function moveY(solid: SolidFn, p: Player, dy: number): boolean {
  const sign = Math.sign(dy);
  const edge = p.y + dy + sign * R;
  const row = Math.floor(edge);
  const colMin = Math.floor(p.x - R + EPS);
  const colMax = Math.floor(p.x + R - EPS);

  for (let col = colMin; col <= colMax; col++) {
    if (solid(row, col)) {
      p.y = sign > 0 ? row - R : row + 1 + R;
      return true;
    }
  }
  p.y += dy;
  return false;
}

function slideToRow(solid: SolidFn, p: Player, dirX: number, dist: number): void {
  const row = Math.floor(p.y); // linha onde está o centro do jogador
  const colAhead = Math.floor(p.x) + dirX;
  if (solid(row, colAhead)) return; // não há passagem nessa linha

  const target = row + 0.5;
  const step = Math.sign(target - p.y) * Math.min(dist, Math.abs(target - p.y));
  if (step !== 0) moveY(solid, p, step);
  // alinha exatamente no centro (resíduo de ponto flutuante do passo a passo)
  if (Math.abs(p.y - target) < 1e-6) p.y = target;
}

function slideToCol(solid: SolidFn, p: Player, dirY: number, dist: number): void {
  const col = Math.floor(p.x);
  const rowAhead = Math.floor(p.y) + dirY;
  if (solid(rowAhead, col)) return;

  const target = col + 0.5;
  const step = Math.sign(target - p.x) * Math.min(dist, Math.abs(target - p.x));
  if (step !== 0) moveX(solid, p, step);
  if (Math.abs(p.x - target) < 1e-6) p.x = target;
}
