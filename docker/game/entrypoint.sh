#!/bin/bash
set -e

# Copy template Wine prefix if this is a new user
if [ ! -d "/saves/.wine" ]; then
    cp -r /opt/cm0102-wineprefix /saves/.wine
fi

export WINEPREFIX=/saves/.wine
export DISPLAY=:1

# Start virtual framebuffer
Xvfb :1 -screen 0 1024x768x24 &
sleep 1

# Start VNC server
x11vnc -display :1 -passwd "${VNC_PASSWORD:-changeme}" -forever -listen 0.0.0.0 -rfbport 5900 &
sleep 1

# Start noVNC (WebSocket to VNC bridge)
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 1

# Launch Championship Manager — exec so signals propagate for clean shutdown
exec wine "/saves/.wine/drive_c/Program Files/Championship Manager 01-02/cm0102.exe"
