#!/bin/bash

# Encuentra todos los PIDs de los procesos Python
pids=$(ps aux | grep '[P]ython' | awk '{print $2}')

# Mata cada proceso
for pid in $pids; do
    kill $pid
done
