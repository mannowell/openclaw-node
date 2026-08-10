#!/bin/sh
# ============================================================
# openclaw-node — entrypoint (Render / Northflank)
# 1. Tailscale (userspace) + auth — SOMENTE se TAILSCALE_AUTHKEY
#    existir (no Northflank é opcional: polling do Telegram é outbound)
# 2. Gera config do OpenClaw a partir das env vars
# 3. Sobe gateway OpenClaw (18789, bg)
# 4. Exporta TAILSCALE_IP (lido pelo server.js no "/")
# 5. Sobe API Node (10000, foreground)
# ============================================================

# 1. Tailscale é opcional: só inicia se houver chave (poupa RAM no Northflank)
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "[entrypoint] Iniciando tailscaled (userspace)..."
    tailscaled --tun=userspace-networking --outbound-http-proxy-listen=localhost:1055 &
    sleep 3

    # 2. Autentica no Tailscale
    echo "[entrypoint] Autenticando no Tailscale..."
    # A ephemeralidade é definida na PRÓPRIA AUTHKEY (Tailscale admin console),
    # não no CLI. Sem --ephemeral aqui: o comando up usa a config da chave.
    tailscale up --authkey="${TAILSCALE_AUTHKEY}" --hostname=openclaw-node \
        --accept-dns=false --reset &
else
    echo "[entrypoint] TAILSCALE_AUTHKEY não definida — sem malha privada (OK no Northflank)."
fi

# 3. Espera até 30s pelo IP (não bloqueia o app se falhar)
TS_IP=""
i=0
while [ $i -lt 30 ]; do
    TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
    [ -n "$TS_IP" ] && break
    i=$((i + 1))
    sleep 1
done
if [ -n "$TS_IP" ]; then
    export TAILSCALE_IP="$TS_IP"
    echo "[entrypoint] Tailscale OK: $TS_IP"
else
    echo "[entrypoint] AVISO: Tailscale não conectou em 30s (continua sem IP)"
fi

# 4. Gera a configuração do OpenClaw a partir das env vars (idempotente)
echo "[entrypoint] Gerando config do OpenClaw..."
node /app/scripts/init-openclaw.mjs || echo "[entrypoint] AVISO: falha ao gerar config OpenClaw (continua sem gateway)"

# 5. Sobe o gateway OpenClaw em background (porta interna 18789)
echo "[entrypoint] Iniciando gateway OpenClaw (porta 18789)..."
# Localiza o binário do OpenClaw (PATH pode variar conforme o npm global)
OPENCLAW_BIN=""
for cand in "$(command -v openclaw 2>/dev/null)" \
            "/usr/local/bin/openclaw" \
            "/usr/local/lib/node_modules/openclaw/openclaw.mjs" \
            "$(npm prefix -g 2>/dev/null)/bin/openclaw"; do
  if [ -n "$cand" ] && [ -e "$cand" ]; then
    OPENCLAW_BIN="$cand"
    break
  fi
done
if [ -z "$OPENCLAW_BIN" ]; then
  echo "[entrypoint] ERRO: binário 'openclaw' não encontrado. npm ls -g:"
  npm ls -g 2>&1 | head -10
else
  echo "[entrypoint] OpenClaw binário: $OPENCLAW_BIN"
  # Loga o start. ⚠️ NÃO usar `wait` em subshell: depois do `exec node server.js`
  # o gateway não é mais filho do subshell e `wait` retorna 127 (falso positivo
  # "GATEWAY EXITED"). O --verbose faz o openclaw jogar o progresso no stdout,
  # que vai para /app/openclaw-gateway.log (lido pela API em /gateway/log).
  echo "[entrypoint] $(date -u +%FT%TZ) starting gateway (log segue)" > /app/openclaw-gateway.log
  nohup node "$OPENCLAW_BIN" gateway --port 18789 --allow-unconfigured --force --verbose >> /app/openclaw-gateway.log 2>&1 &
  echo "[entrypoint] gateway PID=$!" >> /app/openclaw-gateway.log
  sleep 3
fi

# 6. Inicia a API Node.js imediatamente (saúde/logs — Render ou Northflank)
echo "[entrypoint] Subindo API na porta ${PORT:-10000}..."
exec node server.js