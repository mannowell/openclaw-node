#!/bin/sh
# Inicia o daemon do Tailscale em modo userspace
tailscaled --tun=userspace-networking --outbound-http-proxy-listen=localhost:1055 &
sleep 3

# Autentica na rede usando a chave de ambiente
tailscale up --authkey= --hostname=openclaw-node --accept-dns=false

# Pega o IP atribuído e inicia a API
export TAILSCALE_IP=100.70.102.102
echo Tailscale conectado com o IP: 

exec node index.js
