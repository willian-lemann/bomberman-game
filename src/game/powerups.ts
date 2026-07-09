import {
  MAX_BOMBS,
  MAX_RANGE,
  MAX_SPEED,
  POWERUP_CHANCE,
  SPEED_BONUS,
} from './constants';
import type { GameState, Player, PowerUp, PowerUpType } from './types';

const TYPES: PowerUpType[] = ['extraBomb', 'range', 'speed'];

/** Sorteia se o bloco destruído em (row, col) solta um item */
export function rollPowerUp(row: number, col: number): PowerUp | null {
  if (Math.random() >= POWERUP_CHANCE) return null;
  const type = TYPES[Math.floor(Math.random() * TYPES.length)];
  return { row, col, type };
}

/** Jogador que pisa na célula do item coleta o efeito */
export function updatePickups(state: GameState): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const row = Math.floor(player.y);
    const col = Math.floor(player.x);
    const idx = state.powerUps.findIndex((p) => p.row === row && p.col === col);
    if (idx === -1) continue;

    applyPowerUp(player, state.powerUps[idx].type);
    state.powerUps.splice(idx, 1);
  }
}

function applyPowerUp(player: Player, type: PowerUpType): void {
  switch (type) {
    case 'extraBomb':
      player.maxBombs = Math.min(player.maxBombs + 1, MAX_BOMBS);
      break;
    case 'range':
      player.bombRange = Math.min(player.bombRange + 1, MAX_RANGE);
      break;
    case 'speed':
      player.speed = Math.min(player.speed + SPEED_BONUS, MAX_SPEED);
      break;
  }
}
