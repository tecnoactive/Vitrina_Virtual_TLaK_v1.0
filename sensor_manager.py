import json
import RPi.GPIO as GPIO
import time
from threading import Thread

class SensorManager:
    def __init__(self, json_file="sensor_data.json"):
        # Removido GPIO 4 de la lista de pines
        self.SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19]
        self.json_file = json_file
        self.pin_states = {pin: False for pin in self.SENSOR_PINS}
        self.setup_gpio()
        self.start_monitoring()

    def setup_gpio(self):
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        
        for pin in self.SENSOR_PINS:
            try:
                GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
                # Agregar detección de eventos para mejor respuesta
                GPIO.add_event_detect(pin, GPIO.BOTH, 
                                   callback=self.handle_sensor_change,
                                   bouncetime=100)
            except Exception as e:
                print(f"Error configurando pin {pin}: {str(e)}")

    def handle_sensor_change(self, pin):
        self.pin_states[pin] = GPIO.input(pin)
        self.update_json()

    def update_json(self):
        try:
            data = {
                "active_sensors": [],
                "status": {str(pin): GPIO.input(pin) for pin in self.SENSOR_PINS}
            }
            
            # Un sensor está "activo" cuando NO detecta objeto (GPIO.input es 0)
            for pin in self.SENSOR_PINS:
                if not GPIO.input(pin):  # Si el sensor NO detecta
                    data["active_sensors"].append(pin)

            with open(self.json_file, 'w') as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            print(f"Error actualizando JSON: {str(e)}")

    def start_monitoring(self):
        def monitor():
            while True:
                # Verificación periódica como respaldo
                for pin in self.SENSOR_PINS:
                    try:
                        current_state = GPIO.input(pin)
                        if current_state != self.pin_states[pin]:
                            self.pin_states[pin] = current_state
                            self.update_json()
                    except Exception as e:
                        print(f"Error leyendo pin {pin}: {str(e)}")
                time.sleep(0.25)

        Thread(target=monitor, daemon=True).start()

    def cleanup(self):
        try:
            for pin in self.SENSOR_PINS:
                GPIO.remove_event_detect(pin)
            GPIO.cleanup()
        except Exception as e:
            print(f"Error en cleanup: {str(e)}")

if __name__ == "__main__":
    manager = SensorManager()
    try:
        print("Monitoreando sensores... Presiona Ctrl+C para detener")
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        manager.cleanup()
        print("\nMonitoreo detenido")