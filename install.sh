#!/bin/bash
# =============================================================
#  INSTALL APLIKASI TANDA TERIMA SERVICE (VERSI WEB)
#  Universal: berjalan di server mana pun yang punya Docker
#  (CasaOS, Ubuntu, Debian, VPS, Synology, dsb.)
#
#  Cara pakai:
#    1. Ekstrak paket di folder yang diinginkan
#    2. chmod +x install.sh
#    3. sudo ./install.sh
# =============================================================

set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "===================================================="
echo "  INSTALL - APLIKASI TANDA TERIMA SERVICE (WEB)"
echo "===================================================="

# Cek Docker
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}Docker tidak ditemukan di server ini.${NC}"
  echo "Install Docker dulu dengan:"
  echo "  curl -fsSL https://get.docker.com | sh"
  exit 1
fi

# Deteksi docker compose
COMPOSE_CMD="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    echo -e "${RED}Docker Compose tidak ditemukan.${NC}"
    exit 1
  fi
fi
echo -e "${CYAN}Docker OK.${NC}"

# Buat .env (username + password admin)
if [ ! -f .env ]; then
  echo ""
  echo "Atur akun admin aplikasi:"
  read -p "  Username admin [admin]: " UN
  UN=${UN:-admin}
  while true; do
    read -s -p "  Password admin (min 6 karakter): " PW
    echo ""
    if [ ${#PW} -ge 6 ]; then break; fi
    echo -e "${RED}Password terlalu pendek (minimal 6 karakter).${NC}"
  done
  read -s -p "  Ulangi password: " PW2
  echo ""
  if [ "$PW" != "$PW2" ]; then
    echo -e "${RED}Password tidak sama. Jalankan ulang.${NC}"
    exit 1
  fi
  cat > .env <<EOF
ADMIN_USERNAME=$UN
ADMIN_PASSWORD=$PW
PORT=3000
EOF
  chmod 600 .env
  echo -e "${GREEN}.env berhasil dibuat (diatur tidak bisa dibaca user lain).${NC}"
else
  echo -e "${YELLOW}.env sudah ada. Gunakan nilai yang tersimpan.${NC}"
fi

# Build & jalankan
echo ""
echo -e "${CYAN}Membangun & menjalankan aplikasi...${NC}"
$COMPOSE_CMD up -d --build

sleep 2
PORT=$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3000}
IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo "===================================================="
echo -e "${GREEN}SELESAI! Aplikasi berjalan.${NC}"
echo ""
echo -e "  Akses dari komputer ini : ${CYAN}http://localhost:${PORT}${NC}"
if [ -n "$IP" ]; then
  echo -e "  Akses dari HP/LAN        : ${CYAN}http://${IP}:${PORT}${NC}"
fi
echo ""
echo "Perintah umum (dari folder aplikasi):"
echo -e "  Cek status : ${CYAN}$COMPOSE_CMD ps${NC}"
echo -e "  Lihat log  : ${CYAN}$COMPOSE_CMD logs -f${NC}"
echo -e "  Stop       : ${CYAN}$COMPOSE_CMD stop${NC}"
echo -e "  Start lagi : ${CYAN}$COMPOSE_CMD start${NC}"
echo -e "  Update     : ${CYAN}$COMPOSE_CMD up -d --build${NC}"
echo ""
echo "BACKUP: salin seluruh folder ./data"
echo "        (berisi receipts.db = data tanda terima, dan uploads = logo)"
echo "===================================================="