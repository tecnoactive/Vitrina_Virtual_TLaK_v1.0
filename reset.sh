#!/bin/bash

# Puerto a verificar
puerto=5000

# Función para matar un proceso dado su PID
matar_proceso() {
    pid="$1"
    echo "Matando proceso con PID $pid..."
    kill -9 "$pid"
}

# Encontrar los procesos que utilizan el puerto
procesos=$(lsof -t -i :"$puerto")

# Si se encontraron procesos, matarlos
if [ -z "$procesos" ]; then
    echo "No se encontraron procesos utilizando el puerto $puerto."
else
    echo "Los siguientes procesos están utilizando el puerto $puerto:"
    echo "$procesos"
    for pid in $procesos; do
        matar_proceso "$pid"
    done
fi
