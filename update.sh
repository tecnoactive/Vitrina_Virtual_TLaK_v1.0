#!/bin/bash
# 0 * * * * /home/pi/vitrina/update.sh >> /home/pi/vitrina/update.log 2>&1

echo "" >> /home/pi/vitrina/update.log
echo " ~~~~~~~~ Lift And Learn Updater ~~~~~~~~ " >> /home/pi/vitrina/update.log
date >> /home/pi/vitrina/update.log
echo "Comprobando cambios en el servidor..."

SERVER_URL="https://clientes.tecnoactive.cl/liftandlearn-app"
LOCAL_DIR="/home/pi/vitrina"
DEPLOY_FILE="deploy.json"
TMP_DIR="/tmp/deploy_tmp"
REBOOT_REQUIRED=false

# Crear directorio temporal limpio
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

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

    # Descargar todos los archivos sin crear la carpeta del dominio
    wget -q -r -np -nH --cut-dirs=1 -P "$TMP_DIR" "$SERVER_URL/"

    # Sincronizar los archivos descargados sin tocar `venv` ni `vitrina.db`
    echo "Archivos sincronizados:"
    rsync -avz --update --delete --exclude='venv/' --exclude='vitrina.db' "$TMP_DIR/" "$LOCAL_DIR" | grep -E '^(sending|deleting|[^ ]+/$)'

    chmod +x "$LOCAL_DIR/update.sh"

    # Limpiar archivos temporales
    rm -rf "$TMP_DIR"
    # Mover deploy.json
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
        echo " ** No se requiere actualización. **"
        rm "$LOCAL_DIR/$DEPLOY_FILE.new"
        exit 0
    fi

    # Si hay cambios, actualizar archivos
    echo "Cambios detectados. Descargando actualización..."
    echo "  > Commit remoto: $REMOTE_COMMIT"
    echo "  > Mensaje remoto: $REMOTE_MESSAGE"
    echo "  > Fecha del commit remoto: $REMOTE_DATE"
    echo "Archivos sincronizados:"

    # Descargar archivos actualizados sin crear la carpeta del dominio
    wget -q -r -np -nH --cut-dirs=1 -P "$TMP_DIR" "$SERVER_URL/"

    # Sincronizar solo archivos nuevos o modificados sin tocar `venv` ni `vitrina.db`
    rsync -avz --update --delete --exclude='venv/' --exclude='vitrina.db' "$TMP_DIR/" "$LOCAL_DIR" | grep -E '^(sending|deleting|[^ ]+/$)'

    # Limpiar archivos temporales
    rm -rf "$TMP_DIR"

    # Mover deploy.json
    mv "$LOCAL_DIR/$DEPLOY_FILE.new" "$LOCAL_DIR/$DEPLOY_FILE"

    # Hacer que el script sea ejecutable
    echo "Cambiando permisos de archivos..."
    chmod +x "$LOCAL_DIR/update.sh"
    chmod +x "$LOCAL_DIR/launcher.sh"
    chmod +x "$LOCAL_DIR/start_app.sh"
    chmod +x "$LOCAL_DIR/start_vitrina.sh"
    chmod +x "$LOCAL_DIR/start_kiosk.sh"
    chmod +x "$LOCAL_DIR/app.py"

    REBOOT_REQUIRED=true
    echo "Actualización completa."
fi

# Si hubo cambios, reiniciar la Raspberry Pi
if [ "$REBOOT_REQUIRED" = true ]; then
    echo "Reinicio requerido. Reiniciando ahora..."
    sudo reboot
fi
