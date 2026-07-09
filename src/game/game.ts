import { placeBomb, updateBombs, updateExplosions } from './bombs';
import {
  GRID_COLS,
  GRID_ROWS,
  INITIAL_BOMB_RANGE,
  INITIAL_MAX_BOMBS,
  PLAYER_SPEED,
} from './constants';
import { createMap } from './map';
import { movePlayer, type SolidFn } from './movement';
import { updatePickups } from './powerups';
import { Cell, type GameState, type Player, type PlayerInput } from './types';

export function createGame(): GameState {
  return {
    grid: createMap(),
    players: [
      spawnPlayer(1, 1.5, 1.5), // canto superior esquerdo
      spawnPlayer(2, GRID_COLS - 1.5, GRID_ROWS - 1.5), // canto inferior direito
    ],
    bombs: [],
    explosions: [],
    powerUps: [],
    phase: 'playing',
    winnerId: null,
    elapsed: 0,
  };
}

function spawnPlayer(id: number, x: number, y: number): Player {
  return {
    id,
    x,
    y,
    speed: PLAYER_SPEED,
    facing: 'down',
    alive: true,
    maxBombs: INITIAL_MAX_BOMBS,
    bombRange: INITIAL_BOMB_RANGE,
  };
}

/**
 * Avança a simulação em `dt` segundos.
 * Toda a regra do jogo (movimento, bombas, explosões) vive aqui —
 * nunca acesse Canvas ou teclado neste módulo.
 */
export function update(
  state: GameState,
  dt: number,
  inputs: PlayerInput[],
): void {
  if (state.phase === 'over') return;
  state.elapsed += dt;

  state.players.forEach((player, i) => {
    if (!player.alive) return;
    const input = inputs[i];
    if (!input) return;

    movePlayer(solidFor(state, player), player, input, dt);
    if (input.bomb) placeBomb(state, player);
  });

  updatePickups(state);
  updateBombs(state, dt);
  updateExplosions(state, dt);
  checkRoundOver(state);
}

/** Colisão do ponto de vista de um jogador: grade + bombas que ele não atravessa */
export function solidFor(state: GameState, player: Player): SolidFn {
  return (row, col) => {
    const cell = state.grid[row]?.[col];
    if (cell === undefined || cell !== Cell.Floor) return true;
    return state.bombs.some(
      (b) =>
        b.row === row && b.col === col && !b.passThrough.includes(player.id),
    );
  };
}

function checkRoundOver(state: GameState): void {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length > 1) return;
  state.phase = 'over';
  state.winnerId = alive[0]?.id ?? null; // null = os dois morreram: empate
}
