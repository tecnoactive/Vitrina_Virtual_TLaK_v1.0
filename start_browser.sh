#!/bin/bash

# Esperar a que la red esté disponible
sleep 10

# Desactivar protector de pantalla
xset s off
xset -dpms
xset s noblank

# Iniciar Chromium en modo kiosko
chromium-browser --noerrdialogs \
                --disable-translate \
                --disable-infobars \
                --disable-features=TranslateUI \
                --disable-sync \
                --disable-session-crashed-bubble \
                --disable-features=PreloadMediaEngagementData \
                --disable-features=MediaEngagementBypassAutoplayPolicies \
                --kiosk \
                --app=http://localhost:5000
