#!/bin/bash

# Wine is installed at /usr/lib/wine/wine
export PATH="/usr/lib/wine:$PATH"

# Copy template Wine prefix if this is a new user
if [ ! -d "/saves/.wine" ]; then
    cp -r /opt/cm0102-wineprefix /saves/.wine
fi

# Ensure CD drive is always mapped (handles prefixes created before CD was added)
if [ ! -d "/saves/.wine/drive_d" ]; then
    cp -r /opt/cm0102-wineprefix/drive_d /saves/.wine/drive_d
fi
ln -sf ../drive_d /saves/.wine/dosdevices/d:
rm -f /saves/.wine/dosdevices/d::

export WINEPREFIX=/saves/.wine
export DISPLAY=:1

# Start PulseAudio with null sink (dummy audio device)
pulseaudio --daemonize --no-cpu-limit --exit-idle-time=-1 || true
pactl load-module module-null-sink sink_name=dummy || true
pactl set-default-sink dummy || true

# Start combined X server + VNC server (TigerVNC replaces Xvfb + x11vnc)
# Using SecurityTypes=None since auth is handled by the web app + TLS
Xtigervnc :1 -geometry 800x600 -depth 24 -rfbport 5900 -SecurityTypes None -AlwaysShared -AcceptKeyEvents -AcceptPointerEvents &
sleep 1

# Start noVNC (WebSocket to VNC bridge)
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 1

# Launch Championship Manager with Wine virtual desktop
cd "/saves/.wine/drive_c/Program Files (x86)/Championship Manager 01-02"
wine explorer /desktop=CM,800x600 cm0102_GDI.exe &
WINE_PID=$!

# Keep container alive even if Wine exits
wait $WINE_PID || true

# If wine exits, keep the container running so we can debug
echo "Wine process exited. Keeping container alive for debugging."
while true; do sleep 3600; done
