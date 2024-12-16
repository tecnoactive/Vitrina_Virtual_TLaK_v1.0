#!/bin/bash

# Esperar a que la red esté disponible
sleep 30

# Configuración de pantalla
xset s off
xset s noblank
xset -dpms

# Ocultar el cursor
unclutter -idle 0 -root &

# Iniciar Chromium optimizado
chromium-browser \
    --kiosk \
    --disable-gpu \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --disable-accelerated-2d-canvas \
    --disable-accelerated-compositing \
    --disable-features=IsolateOrigins,site-per-process \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-translate \
    --no-first-run \
    --no-default-browser-check \
    --process-per-site \
    --disk-cache-size=1 \
    --media-cache-size=1 \
    --disk-cache-dir=/dev/null \
    --aggressive-cache-discard \
    --enable-low-end-device-mode \
    http://localhost:5000
