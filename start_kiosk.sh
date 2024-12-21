#!/bin/bash

# Esperar a que la red esté disponible
sleep 10

# Configuración de pantalla
xset s off
xset s noblank
xset -dpms

# Ocultar el cursor
unclutter -idle 0 -root &

# Matar instancias previas de Chromium
pkill -f chromium

# Limpiar cache
rm -rf ~/.cache/chromium/*
rm -rf ~/.config/chromium/Default/Cache/*

# Iniciar Chromium con flags optimizadas
chromium-browser \
  --kiosk \
  --start-fullscreen \
  --disable-translate \
  --disable-features=TranslateUI \
  --disable-sync \
  --disable-suggestions-service \
  --disable-save-password-bubble \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --disable-notifications \
  --noerrdialogs \
  --no-first-run \
  --fast \
  --fast-start \
  --disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies \
  --autoplay-policy=no-user-gesture-required \
  --disable-gpu-driver-bug-workarounds \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --ignore-gpu-blocklist \
  --enable-accelerated-video-decode \
  --disk-cache-size=1 \
  --media-cache-size=1 \
  http://localhost:5000
