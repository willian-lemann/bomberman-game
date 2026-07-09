import type { PlayerInput } from './game/types';

// Jogador 1: WASD + Espaço | Jogador 2: setas + Enter
// (só no modo local — no online cada jogador usa Espaço no próprio teclado)
const KEYMAPS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', bomb: 'Space' },
  {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    bomb: 'Enter',
  },
] as const;

export function createKeyboard(): { getInputs(): PlayerInput[] } {
  const pressed = new Set<string>();
  const justPressed = new Set<string>();

  window.addEventListener('keydown', (e) => {
    if (!e.repeat) justPressed.add(e.code);
    pressed.add(e.code);
    // evita a página rolar (setas/espaço) e — crucial — impede que Espaço e
    // Enter "cliquem" o último botão do menu que ficou com foco
    if (
      e.code.startsWith('Arrow') ||
      e.code === 'Space' ||
      e.code === 'Enter' ||
      e.code === 'NumpadEnter'
    ) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => pressed.delete(e.code));
  window.addEventListener('blur', () => {
    pressed.clear();
    justPressed.clear();
  });

  return {
    getInputs: () => {
      const inputs = KEYMAPS.map((keys) => ({
        up: pressed.has(keys.up),
        down: pressed.has(keys.down),
        left: pressed.has(keys.left),
        right: pressed.has(keys.right),
        bomb: justPressed.has(keys.bomb),
      }));
      justPressed.clear(); // "apertou agora" vale por um frame só
      return inputs;
    },
  };
}
