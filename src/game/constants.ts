// Dimensões clássicas do Bomberman: grade ímpar para o padrão xadrez de paredes
export const GRID_COLS = 15;
export const GRID_ROWS = 13;

// Chance de uma célula livre virar bloco destrutível na geração do mapa
export const BLOCK_DENSITY = 0.7;

export const PLAYER_SPEED = 4.5; // células por segundo
// Raio de colisão menor que meia célula para o movimento não "prender" nas quinas
export const PLAYER_RADIUS = 0.36;

export const BOMB_FUSE = 3; // segundos até explodir
export const EXPLOSION_TIME = 0.45; // segundos de chama ativa
export const INITIAL_MAX_BOMBS = 1;
export const INITIAL_BOMB_RANGE = 2;

// Power-ups
export const POWERUP_CHANCE = 0.35; // chance de bloco destruído soltar item
export const SPEED_BONUS = 0.5; // células/s a mais por item de velocidade
export const MAX_SPEED = 7;
export const MAX_BOMBS = 6;
export const MAX_RANGE = 7;
