FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Enable 32-bit architecture (required for Wine)
RUN dpkg --add-architecture i386 && \
    apt-get update && apt-get install -y --no-install-recommends \
    wine32 \
    wine64 \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built template Wine prefix with CM 01/02 installed and patched.
# This directory must be created manually — see README.md for instructions.
COPY cm0102-wineprefix/ /opt/cm0102-wineprefix/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]
