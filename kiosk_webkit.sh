#!/bin/bash
exec 1> >(logger -s -t $(basename $0)) 2>&1

echo "Iniciando script kiosk"
export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority

echo "Esperando X server"
sleep 5

echo "Verificando display"
if [ -z "$DISPLAY" ]; then
    echo "Error: DISPLAY no está configurado"
    exit 1
fi

cd /home/pi/vitrina || exit 1
echo "Directorio actual: $(pwd)"

echo "Activando entorno virtual"
source venv/bin/activate || exit 1

echo "Iniciando aplicación Python"
python3 kiosk_browser.py
