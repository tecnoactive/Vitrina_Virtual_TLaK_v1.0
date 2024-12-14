#!/bin/bash

# Activar entorno virtual
source /home/pi/vitrina/venv/bin/activate

# Navegar al directorio de la aplicación
cd /home/pi/vitrina

# Iniciar la aplicación Flask
python app.py >> /home/pi/vitrina/app.log 2>&1
