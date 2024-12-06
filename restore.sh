# restore.sh
#!/bin/bash

# Listar respaldos disponibles
echo "Respaldos disponibles:"
echo "---------------------"

# Crear array con respaldos
mapfile -t BACKUPS < <(ls -d backup_* | sort -r)

# Mostrar lista numerada
for i in "${!BACKUPS[@]}"; do
    echo "$((i+1)). ${BACKUPS[$i]}"
done

echo "---------------------"
echo "Seleccione el número de respaldo a restaurar:"
read SELECTION

# Validar selección
if ! [[ "$SELECTION" =~ ^[0-9]+$ ]] || [ "$SELECTION" -lt 1 ] || [ "$SELECTION" -gt "${#BACKUPS[@]}" ]; then
    echo "Selección inválida"
    exit 1
fi

SELECTED_BACKUP="${BACKUPS[$((SELECTION-1))]}"

# Confirmar restauración
echo "¿Restaurar desde $SELECTED_BACKUP? (s/n)"
read CONFIRM

if [ "$CONFIRM" != "s" ]; then
    echo "Restauración cancelada"
    exit 0
fi

# Restaurar archivos
cp -r "$SELECTED_BACKUP/templates/" .
cp -r "$SELECTED_BACKUP/static/" .
cp "$SELECTED_BACKUP/app.py" .
cp "$SELECTED_BACKUP/sensor_handler.py" .
cp "$SELECTED_BACKUP/vitrina.db" .

echo "Restauración completada desde $SELECTED_BACKUP"
