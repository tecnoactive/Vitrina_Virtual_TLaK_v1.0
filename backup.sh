i# backup.sh
#!/bin/bash

echo "Nombre para esta versión de respaldo:"
read VERSION_NAME

# Validar nombre
if [ -z "$VERSION_NAME" ]; then
    echo "Error: Nombre vacío"
    exit 1
fi

# Crear directorio con fecha y nombre
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)_$VERSION_NAME"
mkdir -p $BACKUP_DIR

# Copiar archivos
cp -r templates $BACKUP_DIR/
cp -r static $BACKUP_DIR/
cp app.py $BACKUP_DIR/
cp sensor_handler.py $BACKUP_DIR/
cp vitrina.db $BACKUP_DIR/

echo "Respaldo creado en: $BACKUP_DIR"
