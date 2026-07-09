import { BOMB_FUSE, EXPLOSION_TIME, PLAYER_RADIUS } from './constants';
import { rollPowerUp } from './powerups';
import {
  Cell,
  type Bomb,
  type GameState,
  type Player,
  type PowerUp,
} from './types';

export function placeBomb(state: GameState, player: Player): void {
  const row = Math.floor(player.y);
  const col = Math.floor(player.x);

  const alreadyThere = state.bombs.some((b) => b.row === row && b.col === col);
  const active = state.bombs.filter((b) => b.ownerId === player.id).length;
  if (alreadyThere || active >= player.maxBombs) return;

  state.bombs.push({
    row,
    col,
    ownerId: player.id,
    timer: BOMB_FUSE,
    range: player.bombRange,
    // quem está em cima da bomba ao plantar pode sair de cima dela
    passThrough: state.players
      .filter((p) => p.alive && overlapsCell(p, row, col))
      .map((p) => p.id),
  });
}

export function updateBombs(state: GameState, dt: number): void {
  // a bomba vira sólida para cada jogador assim que ele sai de cima dela
  for (const bomb of state.bombs) {
    bomb.passThrough = bomb.passThrough.filter((id) => {
      const p = state.players.find((pl) => pl.id === id);
      return p !== undefined && overlapsCell(p, bomb.row, bomb.col);
    });
    bomb.timer -= dt;
  }

  const expired = state.bombs.filter((b) => b.timer <= 0);
  for (const bomb of expired) {
    // pode já ter sido detonada em cadeia por outra bomba deste frame
    if (state.bombs.includes(bomb)) detonate(state, bomb);
  }
}

export function updateExplosions(state: GameState, dt: number): void {
  for (const explosion of state.explosions) {
    explosion.timer -= dt;

    for (const player of state.players) {
      if (!player.alive) continue;
      const hit = explosion.cells.some((c) =>
        overlapsCell(player, c.row, c.col, 0.6),
      );
      if (hit) player.alive = false;
    }
  }
  state.explosions = state.explosions.filter((e) => e.timer > 0);
}

/**
 * Explode a bomba: chamas em cruz que param na primeira parede,
 * destroem o primeiro bloco que encontram e detonam outras bombas em cadeia.
 */
function detonate(state: GameState, bomb: Bomb): void {
  const cells: { row: number; col: number }[] = [];
  const queue: Bomb[] = [bomb];
  const detonated = new Set<Bomb>();
  const drops: PowerUp[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (detonated.has(current)) continue;
    detonated.add(current);

    cells.push({ row: current.row, col: current.col });

    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      for (let i = 1; i <= current.range; i++) {
        const row = current.row + dr * i;
        const col = current.col + dc * i;
        const cell = state.grid[row]?.[col];

        if (cell === undefined || cell === Cell.Wall) break;

        cells.push({ row, col });

        if (cell === Cell.Block) {
          state.grid[row][col] = Cell.Floor;
          const drop = rollPowerUp(row, col);
          if (drop) drops.push(drop);
          break; // a chama para no bloco que destruiu
        }

        const chained = state.bombs.find(
          (b) => b.row === row && b.col === col && !detonated.has(b),
        );
        if (chained) queue.push(chained);
      }
    }
  }

  state.bombs = state.bombs.filter((b) => !detonated.has(b));
  state.explosions.push({ cells, timer: EXPLOSION_TIME });

  // chamas queimam itens já expostos no chão; os recém-saídos dos blocos ficam
  state.powerUps = state.powerUps.filter(
    (p) => !cells.some((c) => c.row === p.row && c.col === p.col),
  );
  state.powerUps.push(...drops);
}

/** O retângulo do jogador (escalado por `shrink`) toca a célula? */
function overlapsCell(
  p: Player,
  row: number,
  col: number,
  shrink = 1,
): boolean {
  const r = PLAYER_RADIUS * shrink;
  return p.x + r > col && p.x - r < col + 1 && p.y + r > row && p.y - r < row + 1;
}
