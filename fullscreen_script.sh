#!/bin/bash

epiphany-browser "http://localhost:5000" &
sleep 2 # Esperar a que Epiphany se inicie

# Maximizar la ventana
xdotool key alt+F10  # Si esto falla busca el comando para maximizar ventana en tu entorno
# Ocultar la barra de título (si tu entorno lo permite) - puede variar segun tu entorno de escritorio
# gsettings set org.gnome.mutter.hide-title-bar-on-maximize true  (Ejemplo para GNOME)


# Simular pantalla completa ajustando la resolución (con LIMITACIONES)
xrandr --output <nombre_de_tu_salida> --mode 1920x1080 # Reemplaza <nombre_de_tu_salida> con la salida que indica xrandr, ejemplo HDMI-1
