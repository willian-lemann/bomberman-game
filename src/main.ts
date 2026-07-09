import { createGame, update } from './game/game';
import { createKeyboard } from './input';
import { serverHttpBase, startOnline, type LobbyRequest } from './online';
import { render, setupCanvas } from './render/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Canvas #game não encontrado');

const ctx = setupCanvas(canvas);
const menu = document.querySelector<HTMLElement>('#menu')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const joinCode = document.querySelector<HTMLInputElement>('#join-code')!;

document.querySelector('#btn-local')?.addEventListener('click', () => {
  menu.hidden = true;
  startLocal();
});

let inSession = false;

function beginOnline(request: LobbyRequest): void {
  if (inSession) return; // uma sessão por vez — clique/tecla repetida não duplica
  inSession = true;
  // tira o foco do botão clicado: Espaço/Enter durante o jogo não podem "reclicar"
  (document.activeElement as HTMLElement | null)?.blur?.();
  menu.hidden = true;
  // se der erro (sala inexistente, servidor fora do ar), volta ao menu
  startOnline(ctx, statusEl, request, () => {
    inSession = false;
    menu.hidden = false;
  });
}

document.querySelector('#btn-quick')?.addEventListener('click', () => {
  beginOnline({ type: 'quick' });
});

const roomName = document.querySelector<HTMLInputElement>('#room-name')!;
document.querySelector('#btn-create')?.addEventListener('click', () => {
  beginOnline({ type: 'create', name: roomName.value });
});
roomName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') beginOnline({ type: 'create', name: roomName.value });
  e.stopPropagation(); // digitar no campo não pode controlar o jogo
});

// ------------------------------------------------ navegador de salas

interface RoomInfo {
  code: string | null;
  name: string;
  players: number;
  max: number;
  status: 'waiting' | 'playing';
}

const roomsList = document.querySelector<HTMLElement>('#rooms-list')!;

function renderRooms(rooms: RoomInfo[]): void {
  roomsList.innerHTML = '';
  if (rooms.length === 0) {
    const empty = document.createElement('p');
    empty.id = 'rooms-empty';
    empty.textContent = 'Nenhuma sala aberta — crie a primeira!';
    roomsList.append(empty);
    return;
  }

  for (const room of rooms) {
    const btn = document.createElement('button');
    btn.className = 'room-btn';
    // só dá para entrar em sala esperando jogadores e com vaga (< 4)
    const joinable =
      room.status === 'waiting' && room.players < room.max && room.code !== null;
    btn.disabled = !joinable;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = room.name;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent =
      room.status === 'playing'
        ? `${room.players}/${room.max} · em partida`
        : `${room.players}/${room.max}`;
    btn.append(name, count);

    if (joinable) {
      btn.addEventListener('click', () => {
        beginOnline({ type: 'join', code: room.code! });
      });
    }
    roomsList.append(btn);
  }
}

async function refreshRooms(): Promise<void> {
  if (menu.hidden) return; // só enquanto o menu está aberto
  try {
    const res = await fetch(`${serverHttpBase()}/rooms`);
    const data = await res.json();
    renderRooms(data.rooms ?? []);
  } catch {
    roomsList.innerHTML = '';
    const err = document.createElement('p');
    err.id = 'rooms-empty';
    err.textContent = 'Servidor offline — não deu para listar as salas';
    roomsList.append(err);
  }
}

refreshRooms();
setInterval(refreshRooms, 2000);

function joinRoom(): void {
  const code = joinCode.value.trim().toUpperCase();
  if (code.length !== 4) {
    statusEl.textContent = 'O código da sala tem 4 letras';
    return;
  }
  beginOnline({ type: 'join', code });
}

document.querySelector('#btn-join')?.addEventListener('click', joinRoom);
joinCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
  e.stopPropagation(); // digitar no campo não pode controlar o jogo
});

/** Modo local: simulação e desenho no mesmo lugar, 2 jogadores no teclado */
function startLocal(): void {
  let state = createGame();
  const keyboard = createKeyboard();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && state.phase === 'over') {
      state = createGame();
    }
  });

  let lastTime = performance.now();

  function loop(now: number): void {
    // dt em segundos, limitado para evitar saltos quando a aba fica em segundo plano
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    update(state, dt, keyboard.getInputs());
    render(ctx, state);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
