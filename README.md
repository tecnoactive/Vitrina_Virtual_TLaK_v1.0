# Vitrina Virtual TLaK

![Vitrina Virtual TLaK](portada.jpeg)

Vitrina Virtual TLaK (Take, Lift and Know) es un proyecto dedicado a la exploración interactiva de productos mediante el uso de sensores y pantallas.

## Características principales

- Monitoreo en tiempo real de sensores para activar diferentes modos de visualización
- Modos de visualización: Fondo, Único, Versus, Triple y Cuádruple
- Panel de administración para gestionar sensores, videos y configuración
- Estadísticas y gráficos detallados sobre el uso de la vitrina

## Requisitos del sistema

- Raspberry Pi 3 o superior
- Sensores conectados a los pines GPIO
- Pantalla para visualización
- Python 3.7+
- Flask
- SQLite

## Instalación

1. Clona este repositorio en tu Raspberry Pi:
   ```
   git clone https://github.com/hleonCL/Vitrina_Virtual_TLaK.git
   ```

2. Navega al directorio del proyecto:
   ```
   cd Vitrina_Virtual_TLaK
   ```

3. Instala las dependencias:
   ```
   pip install -r requirements.txt
   ```

4. Configura las variables de entorno necesarias (consulta la documentación para más detalles)

5. Ejecuta la aplicación:
   ```
   python app.py
   ```

## Uso

1. Accede al panel de administración en `http://<raspberry_pi_ip>:5000/login`
2. Configura los sensores, carga videos y ajusta la configuración según tus necesidades
3. ¡Disfruta de la experiencia interactiva de la Vitrina Virtual TLaK!

## Contribución

Las contribuciones son bienvenidas. Por favor, abre un issue primero para discutir los cambios que te gustaría hacer.

## Licencia

[MIT](https://choosealicense.com/licenses/mit/)

## Contacto

Hugo León González - [@hleonCL](https://github.com/hleonCL)

Proyecto: [https://github.com/hleonCL/Vitrina_Virtual_TLaK](https://github.com/hleonCL/Vitrina_Virtual_TLaK)

---

*"Dedicado a Benjamín León Tudezca, con amor eterno."*
