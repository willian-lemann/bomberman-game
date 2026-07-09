# Otimizações de rede — feito e por fazer

## ✅ Já implementado

- **Predição local** (`src/online.ts`): seu jogador responde em 0ms. Cada input
  é numerado (`seq`), enviado ao servidor e aplicado localmente na hora, com a
  mesma física de `src/game/movement.ts`.
- **Reconciliação**: o servidor ecoa o último `seq` processado (`acks` no
  broadcast). Ao receber o estado oficial, o cliente parte da posição do
  servidor e reaplica só os inputs ainda não confirmados. Como a simulação é
  determinística (passo fixo de 1/60s nos dois lados), o resultado é exato —
  verificado em teste com erro 0.0.
- **Interpolação do oponente**: desenhado ~100ms no passado
  (`INTERP_DELAY_MS`), deslizando entre os dois últimos estados em vez de
  teleportar a cada pacote.
- **Fila de inputs no servidor**: 1 input por tick, fila limitada — cliente
  não consegue acelerar o próprio jogador (anti speed-hack).
- **Servidor na região dos jogadores**: ao publicar, escolher datacenter no
  Brasil (ex.: Fly.io região `gru`). É a otimização de maior impacto/esforço.

## 🔜 Próximos passos (em ordem sugerida)

### 1. Enviar menos dados (banda e jitter)
Hoje o servidor manda o estado COMPLETO (grade inclusa) 60x/s em JSON:
- Mandar a grade só no início e quando mudar (evento `blockDestroyed`
  com `row/col` — o cliente aplica na cópia local).
- Reduzir o broadcast para 20–30Hz; a interpolação já preenche os frames
  (aumentar `INTERP_DELAY_MS` para ~2 intervalos de broadcast).
- Depois: encoding binário (ArrayBuffer) em vez de JSON — só vale com
  4 jogadores ou muito tráfego.

### 2. Predição da própria bomba
Ao apertar Espaço, a bomba só aparece quando o servidor confirma (~RTT).
Desenhar uma bomba "fantasma" local imediatamente e substituí-la pela oficial
no próximo estado (ou removê-la se o servidor rejeitar).

### 3. Suavizar correções raras
Se a predição divergir (ex.: você pegou um power-up de velocidade que ainda
não sabia), hoje a correção é um snap. Interpolar o próprio jogador até a
posição corrigida ao longo de ~3 frames quando o erro for pequeno.

### 4. Medir para decidir
Antes de otimizar mais: overlay de debug com ping (RTT), tamanho médio dos
pacotes e erro de predição por segundo. Só otimizar o que o número mostrar.

### Fora do escopo por enquanto
- WebRTC/WebTransport (canal não-confiável evita head-of-line blocking do
  TCP): ganho real, complexidade alta — só se o jogo virar competitivo.
- Lag compensation de hits: pouco relevante aqui, as bombas têm timer de 3s.
