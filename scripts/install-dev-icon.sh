#!/usr/bin/env bash
# One-time setup: installs a .desktop entry so GNOME Wayland can resolve
# the Arlesh icon in alt+tab and the Activities overview.
#
# On Wayland, window icons set via the GTK API are ignored for the taskbar.
# GNOME Shell matches the app's Wayland app_id ("com.atai.arlesh") to a
# .desktop file of the same name, then reads the Icon= field from it.
#
# Run once after cloning:  bash scripts/install-dev-icon.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ICON_PATH="$PROJECT_DIR/src-tauri/icons/128x128.png"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/com.atai.arlesh.desktop"

mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=Arlesh
Type=Application
Exec=/bin/true
Icon=$ICON_PATH
NoDisplay=true
StartupWMClass=Arlesh
EOF

if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$DESKTOP_DIR"
fi

echo "Installed $DESKTOP_FILE"
echo "Icon -> $ICON_PATH"
