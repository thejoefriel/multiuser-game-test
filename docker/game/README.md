# CM 01/02 Game Docker Image

Docker image that runs Championship Manager 01/02 headlessly and exposes it via noVNC on port 6080.

## Prerequisites

The Dockerfile expects a `cm0102-wineprefix/` directory containing a pre-built Wine prefix with CM 01/02 installed and patched. This must be created manually because the game installer requires interaction.

## Building the Wine Prefix

Run this on a machine with Docker installed:

```bash
mkdir -p /tmp/cm-build && cd /tmp/cm-build

# Download the game disc image from fmscout (free, made freeware by Eidos in 2009)
# Download the v3.9.68 patch from champman0102.net

# Start an interactive container
docker run -it --rm \
  -v /tmp/cm-build:/build \
  -e DISPLAY=:1 \
  ubuntu:24.04 bash

# Inside the container:
dpkg --add-architecture i386
apt update && apt install -y wine32 wine64 xvfb x11vnc
Xvfb :1 -screen 0 1024x768x24 &
export DISPLAY=:1

# Mount the disc image and run the installer via Wine
# Apply the v3.9.68 patch
# Test that the game launches: wine "~/.wine/drive_c/Program Files/Championship Manager 01-02/cm0102.exe"

# Copy the Wine prefix out
cp -r ~/.wine /build/cm0102-wineprefix
```

Then copy the resulting `cm0102-wineprefix/` directory into this folder (`docker/game/`).

## Building the Image

```bash
docker build -t cm0102-server:latest .
```

## Running Locally

```bash
docker run -p 6080:6080 -v /tmp/test-saves:/saves cm0102-server:latest
```

Then open http://localhost:6080/vnc.html to play.

## Environment Variables

| Variable       | Default    | Description                  |
|---------------|------------|------------------------------|
| `VNC_PASSWORD` | `changeme` | Password for the VNC server  |

## Volumes

| Path     | Purpose                                    |
|----------|--------------------------------------------|
| `/saves` | Persistent user save files (Wine prefix)   |
