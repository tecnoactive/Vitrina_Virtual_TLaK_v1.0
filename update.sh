#!/bin/bash

# 0 * * * * /home/pi/vitrina/update.sh >> /home/pi/vitrina/update.log 2>&1

echo "" >> /home/pi/vitrina/update.log
echo " ~ Lift And Learn Updater ~ " >> /home/pi/vitrina/update.log
date >> /home/pi/vitrina/update.log
echo "Comprobando cambios en el servidor..."

# Configuración
SERVER_URL="https://clientes.tecnoactive.cl/liftandlearn-app"
LOCAL_DIR="/home/pi/vitrina"
DEPLOY_FILE="deploy.json"
REBOOT_REQUIRED=false

# Descargar deploy.json del servidor
wget -q -O "$LOCAL_DIR/$DEPLOY_FILE.new" "$SERVER_URL/$DEPLOY_FILE"

# Si la descarga falla, salir
if [ $? -ne 0 ]; then
    echo "Error: No se pudo descargar deploy.json"
    exit 1
fi

# Si no existe deploy.json, es la primera ejecución: descargar todo
if [ ! -f "$LOCAL_DIR/$DEPLOY_FILE" ]; then
    echo "Primera ejecución. Descargando todos los archivos..."
    rsync -avz --ignore-existing --update "$SERVER_URL/" "$LOCAL_DIR/"
    mv "$LOCAL_DIR/$DEPLOY_FILE.new" "$LOCAL_DIR/$DEPLOY_FILE"
    echo "Instalación inicial completa."
    REBOOT_REQUIRED=true
else
    # Comparar commit_id con el archivo local
    LOCAL_COMMIT=$(jq -r '.commit' "$LOCAL_DIR/$DEPLOY_FILE")
    REMOTE_COMMIT=$(jq -r '.commit' "$LOCAL_DIR/$DEPLOY_FILE.new")
    REMOTE_MESSAGE=$(jq -r '.message' "$LOCAL_DIR/$DEPLOY_FILE.new")
    REMOTE_DATE=$(jq -r '.date' "$LOCAL_DIR/$DEPLOY_FILE.new")

    if [ "$LOCAL_COMMIT" == "$REMOTE_COMMIT" ]; then
        echo "El software ya se encuentra en su versión más reciente."
        rm "$LOCAL_DIR/$DEPLOY_FILE.new"
        exit 0
    fi

    # Si hay cambios, actualizar archivos
    echo "Cambios detectados. Descargando actualización..."
    echo "  > Commit local: $LOCAL_COMMIT"
    echo "  > Commit remoto: $REMOTE_COMMIT"
    echo "  > Mensaje remoto: $REMOTE_MESSAGE"
    echo "  > date remoto: $REMOTE_DATE"
    echo "Iniciando sincronización de archivos..."
    rsync -avz --ignore-existing --update "$SERVER_URL/" "$LOCAL_DIR/"
    mv "$LOCAL_DIR/$DEPLOY_FILE.new" "$LOCAL_DIR/$DEPLOY_FILE"
    REBOOT_REQUIRED=true
    echo "Actualización completa."
fi

# Si hubo cambios, reiniciar la Raspberry Pi
if [ "$REBOOT_REQUIRED" = true ]; then
    echo "Reinicio requerido. Reiniciando ahora..."
    sudo reboot
fi
