# openclaw-node

Nó de scraping/automação web do ecossistema OpenClaw, hospedado no **Render.com** e ligado à malha privada Tailscale. Expõe uma API HTTP leve (Express + Puppeteer) na **porta 10000**.

## Endpoints

### `GET /` — health
```json
{"ok": true, "service": "openclaw-node", "tailscale": "100.x.y.z", "time": "..."}
```

### `GET /healthz` — health check (Render)

### `POST /scrape` — scraping/automação
```bash
curl -X POST http://<host>:10000/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://exemplo.com",
    "selector": "h1",            // opcional: devolve texto do elemento
    "wait": 3000,                 // opcional: ms de espera (default 3000)
    "format": "text"              // opcional: text | json | markdown
  }'
```
Resposta:
```json
{
  "ok": true,
  "result": {
    "url": "https://exemplo.com",
    "status": 200,
    "format": "text",
    "text": "conteúdo da página..."
  }
}
```

## Arquitetura
```
Render.com (container) 
  ├─ entrypoint.sh
  │   ├─ tailscaled (userspace networking)  → entra na malha Tailscale
  │   └─ tailscale up --authkey=$TAILSCALE_AUTHKEY
  └─ node server.js (Express + Puppeteer)   → :10000
```

## Integração Telegram (OpenClaw gateway)

O gateway OpenClaw (porta interna `18789`) recebe DMs e comandos do bot configurado
em `channels.telegram.botToken` (gerado por `scripts/init-openclaw.mjs` a partir das env vars):

- `channels.telegram.enabled = true`
- `channels.telegram.dmPolicy = "allowlist"` — sem pareamento; DMs só de quem está no `allowFrom`
- `channels.telegram.allowFrom = ["telegram:<chat_id>"]` — formato EXATO exigido: o OpenClaw
  constrói o senderId de DMs como `telegram:<chatId>` e o allowlist casa por igualdade exata.
- `commands.ownerAllowFrom = ["telegram:<chat_id>"]` — dono para comandos de controlo

Configure no Render:
- `TELEGRAM_BOT_TOKEN_2` (prioridade) ou `TELEGRAM_BOT_TOKEN` → token do bot
- `OPENCLAW_OWNER_ID` → `7648987349` (o script normaliza para `telegram:7648987349`)

## Deploy no Render
1. Cria um **Web Service** a partir deste repo
2. **Env vars**: `TAILSCALE_AUTHKEY` (auth key de Tailscale), `PORT=10000` (opcional, Render define)
3. Render usa o `Dockerfile` automaticamente
4. Porta exposta `10000`

## Tailscale dentro do container (notas)
- Usa `--tun=userspace-networking` (sem privilégios de kernel no Render)
- O proxy SOCKS está em `localhost:1055` se precisares
- A API fica acessível na malha pelo IP Tailscale atribuído + porta 10000