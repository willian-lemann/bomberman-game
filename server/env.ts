import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Carrega o .env da raiz do projeto (se existir) — nativo do Node, sem deps.
// Variáveis já definidas no ambiente (shell, Docker, Render) têm precedência.
const ENV_FILE = join(import.meta.dirname, '..', '.env');
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}
