import { BLOCK_DENSITY, GRID_COLS, GRID_ROWS } from './constants';
import { Cell, type Grid } from './types';

/**
 * Gera o mapa clássico do Bomberman:
 * - borda de paredes indestrutíveis
 * - paredes internas em padrão xadrez (linhas e colunas pares)
 * - blocos destrutíveis aleatórios no resto
 * - cantos livres para os jogadores nascerem
 */
export function createMap(): Grid {
  const grid: Grid = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    const line: Cell[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      if (isWall(row, col)) {
        line.push(Cell.Wall);
      } else if (!isSpawnZone(row, col) && Math.random() < BLOCK_DENSITY) {
        line.push(Cell.Block);
      } else {
        line.push(Cell.Floor);
      }
    }
    grid.push(line);
  }

  return grid;
}

function isWall(row: number, col: number): boolean {
  const isBorder =
    row === 0 || col === 0 || row === GRID_ROWS - 1 || col === GRID_COLS - 1;
  const isPillar = row % 2 === 0 && col % 2 === 0;
  return isBorder || isPillar;
}

/** Cantos e as duas células adjacentes ficam livres para o spawn dos jogadores */
function isSpawnZone(row: number, col: number): boolean {
  const nearTop = row <= 2;
  const nearBottom = row >= GRID_ROWS - 3;
  const nearLeft = col <= 2;
  const nearRight = col >= GRID_COLS - 3;
  const corner =
    (nearTop || nearBottom) && (nearLeft || nearRight);
  if (!corner) return false;
  // libera só o L do canto (célula do canto + 2 vizinhas), não o quadrado 3x3
  const distRow = Math.min(row - 1, GRID_ROWS - 2 - row);
  const distCol = Math.min(col - 1, GRID_COLS - 2 - col);
  return distRow + distCol <= 1;
}
