#!/usr/bin/env bash
# Instala libs + fontes do Chromium sem root (Ubuntu 20.04+).
# Preferível: `sudo npx playwright install-deps chromium` quando houver sudo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBDIR="${PORTAL_RPA_LIBS_DIR:-$ROOT/.playwright-libs}"
DEBDIR="$LIBDIR/debs"

mkdir -p "$DEBDIR"
cd "$DEBDIR"

PKGS=(
  libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libxkbcommon0 libgbm1
  libcairo2 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libasound2 libnspr4 libnss3 libdrm2 libxcb1 libx11-6 libxext6 libx11-xcb1
  libxcb-dri3-0 libxshmfence1 libwayland-client0 libwayland-server0 libffi7
  libpixman-1-0 libfontconfig1 libfreetype6 libpng16-16 libthai0 libdatrie1
  libgraphite2-3 libharfbuzz0b libxcb-render0 libxcb-shm0 libxrender1
  libavahi-common3 libavahi-client3 libdbus-1-3 libxi6 libxtst6 libxss1
  fonts-liberation fonts-dejavu-core fonts-freefont-ttf fontconfig fontconfig-config
  libgtk-3-0 libgdk-pixbuf2.0-0 libglib2.0-0 libepoxy0 libcairo-gobject2
  libxcursor1 libxinerama1 libwayland-cursor0 libwayland-egl1
)

echo "==> apt-get download (${#PKGS[@]} packages) → $DEBDIR"
apt-get download "${PKGS[@]}"

echo "==> extract → $LIBDIR"
for deb in *.deb; do
  dpkg-deb -x "$deb" "$LIBDIR"
done

FONTDIR="$LIBDIR/usr/share/fonts"
CONFDIR="$LIBDIR/etc/fonts"
mkdir -p "$LIBDIR/fontconfig-cache" "$CONFDIR"

cat > "$CONFDIR/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>$FONTDIR</dir>
  <dir>$FONTDIR/truetype</dir>
  <dir>$FONTDIR/truetype/dejavu</dir>
  <dir>$FONTDIR/truetype/liberation</dir>
  <dir>$FONTDIR/truetype/freefont</dir>
  <cachedir>$LIBDIR/fontconfig-cache</cachedir>
  <alias>
    <family>sans-serif</family>
    <prefer><family>DejaVu Sans</family></prefer>
  </alias>
  <alias>
    <family>sans</family>
    <prefer><family>DejaVu Sans</family></prefer>
  </alias>
  <alias>
    <family>serif</family>
    <prefer><family>DejaVu Serif</family></prefer>
  </alias>
  <alias>
    <family>monospace</family>
    <prefer><family>DejaVu Sans Mono</family></prefer>
  </alias>
</fontconfig>
EOF

echo "==> OK: $LIBDIR"
echo "Reinicie a API (pm2 restart tvde-api) para aplicar LD_LIBRARY_PATH / FONTCONFIG."
