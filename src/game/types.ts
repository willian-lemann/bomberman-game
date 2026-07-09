export enum Cell {
  Floor = 0,
  Wall = 1, // parede indestrutível
  Block = 2, // bloco destrutível
}

/** Grade do mapa, indexada como grid[row][col] */
export type Grid = Cell[][];

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Comandos de um jogador em um frame — vem do teclado hoje, da rede amanhã */
export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** true apenas no frame em que o botão foi apertado (não segura) */
  bomb: boolean;
}

export interface Bomb {
  row: number;
  col: number;
  ownerId: number;
  /** segundos até explodir */
  timer: number;
  /** alcance da explosão em células por direção */
  range: number;
  /** jogadores que ainda podem atravessar (quem estava em cima ao plantar) */
  passThrough: number[];
}

export interface Explosion {
  cells: { row: number; col: number }[];
  /** segundos restantes de chama */
  timer: number;
}

export type PowerUpType = 'extraBomb' | 'range' | 'speed';

export interface PowerUp {
  row: number;
  col: number;
  type: PowerUpType;
}

export interface Player {
  id: number;
  /** centro do jogador em unidades de célula (ex: 1.5 = meio da célula 1) */
  x: number;
  y: number;
  /** células por segundo */
  speed: number;
  facing: Direction;
  alive: boolean;
  /** quantas bombas pode ter plantadas ao mesmo tempo */
  maxBombs: number;
  /** alcance das bombas deste jogador */
  bombRange: number;
}

export interface GameState {
  grid: Grid;
  players: Player[];
  bombs: Bomb[];
  explosions: Explosion[];
  powerUps: PowerUp[];
  phase: 'playing' | 'over';
  /** id do vencedor quando phase === 'over'; null = empate */
  winnerId: number | null;
  /** tempo total de jogo em segundos */
  elapsed: number;
}
