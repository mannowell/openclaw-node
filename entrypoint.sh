#!/bin/sh
# 1. Inicia o daemon do Tailscale em modo userspace
tailscaled --tun=userspace-networking --outbound-http-proxy-listen=localhost:1055 &
sleep 2

# 2. Tenta autenticar no Tailscale sem bloquear a execução do script
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Autenticando no Tailscale..."
    tailscale up --authkey="${TAILSCALE_AUTHKEY}" --hostname=openclaw-node --accept-dns=false &
else
    echo "AVISO: TAILSCALE_AUTHKEY não encontrada."
fi

# 3. Inicia a API Node.js imediatamente para responder ao Render na porta 10000
exec node server.js
