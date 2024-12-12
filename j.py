import json
import time
import RPi.GPIO as GPIO

# Configura los pines GPIO y el archivo JSON
SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19]
JSON_FILE = "sensor_data.json"

# Inicializa GPIO
GPIO.setmode(GPIO.BCM)
for pin in SENSOR_PINS:
    GPIO.setup(pin, GPIO.IN)

# Estructura del JSON
data = {"active_sensors": [], "status": {}}

# Función para actualizar el JSON
def update_json():
    active_sensors = []
    for pin in SENSOR_PINS:
        if GPIO.input(pin):
            active_sensors.append(pin)
            data["status"][str(pin)] = 1
        else:
            data["status"][str(pin)] = 0
    data["active_sensors"] = active_sensors
    with open(JSON_FILE, 'w') as f:
        json.dump(data, f, indent=4)

# Bucle principal
while True:
    update_json()
    time.sleep(5)
