import RPi.GPIO as GPIO
import time

class SensorHandler:
    def __init__(self):
        self.SENSOR_PINS = [17, 27, 4, 5, 6, 13, 18, 22, 26, 19]
        GPIO.setmode(GPIO.BCM)
        self.setup_pins()
        
    def setup_pins(self):
        for pin in self.SENSOR_PINS:
            GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
            
    def get_active_sensors(self):
        active = []
        for pin in self.SENSOR_PINS:
            if GPIO.input(pin):
                active.append(pin)
        return active
    
    def cleanup(self):
        GPIO.cleanup()
