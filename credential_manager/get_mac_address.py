import re
import subprocess

def get_mac_address():
    try:
        # Ejecutar ifconfig y capturar la salida
        result = subprocess.run(['ifconfig'], capture_output=True, text=True)
        output = result.stdout

        # Buscar la sección de wlan0
        match = re.search(r'wlan0:.*?ether ([0-9a-fA-F:]{17})', output, re.DOTALL)
        if match:
            return match.group(1)  # Retorna la MAC de wlan0

        # Si no se encuentra en ifconfig, probar con 'ip link'
        result = subprocess.run(['ip', 'link'], capture_output=True, text=True)
        output = result.stdout
        match = re.search(r'wlan0.*?link/ether ([0-9a-fA-F:]{17})', output)
        if match:
            return match.group(1)  # Retorna la MAC de wlan0

        raise RuntimeError("No se pudo encontrar la dirección MAC de wlan0.")

    except Exception as e:
        raise RuntimeError("Error al obtener la dirección MAC.") from e

# Prueba la función
print(get_mac_address())
