#!/usr/bin/env bash
# One-shot: ZeroTier oficial no servidor da API (tvde) + sudo NOPASSWD para zerotier-cli.
# Corre como macbusinesss (vai pedir password do sudo uma vez).
set -euo pipefail

USER_NAME="${SUDO_USER:-$(id -un)}"
if [ "$(id -u)" -eq 0 ]; then
  echo "Corre este script como o user da app (ex. macbusinesss), não como root."
  exit 1
fi

echo "==> user=$USER_NAME hostname=$(hostname)"

if snap list zerotier >/dev/null 2>&1; then
  echo "==> a remover snap zerotier (incompleto / sem /var/lib/zerotier-one)…"
  sudo snap remove zerotier || true
fi

echo "==> a instalar ZeroTier oficial…"
curl -fsSL https://install.zerotier.com | sudo bash

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
ZT_CLI="$(command -v zerotier-cli || true)"
if [ -z "$ZT_CLI" ]; then
  echo "erro: zerotier-cli não encontrado após instalação" >&2
  exit 1
fi

echo "==> serviço…"
sudo systemctl enable --now zerotier-one || true
sleep 2
sudo "$ZT_CLI" info

SUDOERS_FILE="/etc/sudoers.d/tvde-zerotier"
echo "==> sudoers NOPASSWD → $SUDOERS_FILE"
sudo tee "$SUDOERS_FILE" >/dev/null <<EOF
# TVDE API: permitir join/status ZeroTier sem password (PM2 corre como $USER_NAME)
$USER_NAME ALL=(root) NOPASSWD: /usr/sbin/zerotier-cli, /usr/bin/zerotier-cli, $ZT_CLI
$USER_NAME ALL=(root) NOPASSWD: /bin/systemctl start zerotier-one, /bin/systemctl enable zerotier-one, /bin/systemctl restart zerotier-one, /usr/bin/systemctl start zerotier-one, /usr/bin/systemctl enable zerotier-one, /usr/bin/systemctl restart zerotier-one
EOF
sudo chmod 440 "$SUDOERS_FILE"
sudo visudo -cf "$SUDOERS_FILE"

echo "==> teste sudo -n…"
sudo -n "$ZT_CLI" info
sudo -n "$ZT_CLI" listnetworks || true

echo
echo "OK. Volta ao painel ZeroTier → «Entrar em todas as redes»."
echo "O join já não precisa da password SSH dos servidores PBS/PVE."
