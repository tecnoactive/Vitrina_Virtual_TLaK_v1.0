from flask import Flask, render_template, jsonify, request, session, redirect, url_for
import RPi.GPIO as GPIO
import sqlite3
import os
from datetime import datetime
from functools import wraps
import time
from werkzeug.utils import secure_filename
import functools
import psutil # Para información del sistema
import subprocess # Para ejecutar comandos del sistema
from datetime import timedelta

app = Flask(__name__)
app.secret_key = 'admin'

# Configuración
UPLOAD_FOLDER = 'static/videos'
ALLOWED_EXTENSIONS = {'mp4', 'webm', 'mov'}
SENSOR_PINS = [17, 27, 4, 5, 6, 13, 18, 22, 26, 19]

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Variables globales
previous_active_sensors = []
current_mode = 1  # Valor por defecto

def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    for pin in SENSOR_PINS:
        GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

def init_db():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()

                # Mapeo correcto de sensores
        sensor_mapping = {
            17: 'Sensor 1',
            27: 'Sensor 2',
            5: 'Sensor 3',
            6: 'Sensor 4',
            13: 'Sensor 5',
            18: 'Sensor 6',
            22: 'Sensor 7',
            26: 'Sensor 8',
            19: 'Sensor 9'
        }

        # Tablas necesarias
        c.execute('''CREATE TABLE IF NOT EXISTS sensor_videos 
                    (sensor_id INTEGER PRIMARY KEY,
                     video_path TEXT,
                     description TEXT)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS background_videos 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     video_path TEXT,
                     orden INTEGER)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS activaciones 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     sensor_id INTEGER,
                     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS versus 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     sensor1_id INTEGER,
                     sensor2_id INTEGER,
                     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS etiquetas_sensores
            (gpio_pin INTEGER PRIMARY KEY,
             sensor_numero TEXT NOT NULL,
             nombre_fantasia TEXT,
             nombre_comercial TEXT,
             timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

        c.execute('''CREATE TABLE IF NOT EXISTS system_config
                    (key TEXT PRIMARY KEY,
                     value TEXT)''')

        c.execute('''CREATE TABLE IF NOT EXISTS extra_content
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content_path TEXT NOT NULL,
                    position TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS etiquetas_sensores
                    (gpio_pin INTEGER PRIMARY KEY,
                     sensor_numero TEXT NOT NULL,
                     nombre_fantasia TEXT,
                     nombre_comercial TEXT)''') 
        
        c.execute('''CREATE TABLE IF NOT EXISTS activaciones 
            (id INTEGER PRIMARY KEY AUTOINCREMENT,
             sensor_id INTEGER,
             duration INTEGER,
             timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

        # Configuración inicial
        c.execute('''INSERT OR IGNORE INTO system_config (key, value) 
                 VALUES 
                 ('versus_mode', '1'),
                 ('debug_enabled', 'false')''')
        
        # Insertar nombres predeterminados de sensores
        for pin, nombre in sensor_mapping.items():
            c.execute('''INSERT OR REPLACE INTO etiquetas_sensores (gpio_pin, sensor_numero) 
                        VALUES (?, ?)''', (pin, nombre))
        try:
            c.execute('ALTER TABLE etiquetas_sensores ADD COLUMN nombre_fantasia TEXT')
            conn.commit()
        except sqlite3.OperationalError:
            # La columna ya existe
            pass
            
 
        
        conn.commit()


def login_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login')
def login_page():
    if session.get('logged_in'):
        return redirect(url_for('panel'))
    return render_template('login.html')

@app.route('/panel')
@login_required
def panel():
    try:
        conn = sqlite3.connect('vitrina.db')
        cursor = conn.cursor()
        
        # Obtener información de los sensores
        cursor.execute('''
            SELECT s.gpio_pin, s.sensor_numero, s.nombre_fantasia, v.video_path 
            FROM etiquetas_sensores s 
            LEFT JOIN sensor_videos v ON s.gpio_pin = v.sensor_id
            ORDER BY s.sensor_numero
        ''')
        
        sensors = []
        for row in cursor.fetchall():
            sensors.append({
                'gpio_pin': row[0],  # gpio_pin
                'sensor_numero': row[1],  # sensor_numero
                'nombre_fantasia': row[2] if row[2] else '',  # nombre_fantasia
                'video_path': row[3] if row[3] else None  # video_path
            })
            
        conn.close()
        return render_template('panel.html', sensors=sensors)
        
    except Exception as e:
        print(f"Error al cargar el panel: {str(e)}")
        return render_template('panel.html', sensors=[])

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if data and data.get('username') == 'admin' and data.get('password') == 'admin':
        session['logged_in'] = True
        return jsonify({'success': True})
    return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('logged_in', None)
    return jsonify({'success': True})

@app.route('/api/update-sensor-name', methods=['POST'])
def update_sensor_name():
    try:
        data = request.get_json()
        sensor_id = data.get('sensor_id')
        new_name = data.get('new_name')
        
        if not sensor_id or new_name is None:
            return jsonify({'error': 'Se requiere sensor_id y new_name'}), 400
            
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''
                UPDATE etiquetas_sensores 
                SET nombre_fantasia = ? 
                WHERE gpio_pin = ?
            ''', (new_name, sensor_id))
            conn.commit()
            
            if c.rowcount == 0:
                # Si no existe, lo insertamos
                c.execute('''
                    INSERT INTO etiquetas_sensores (gpio_pin, sensor_numero, nombre_fantasia)
                    VALUES (?, ?, ?)
                ''', (sensor_id, f'Sensor {sensor_id}', new_name))
                conn.commit()
                
        return jsonify({'success': True, 'message': 'Nombre actualizado correctamente'})
        
    except Exception as e:
        app.logger.error(f"Error updating sensor name: {str(e)}")
        return jsonify({'error': f'Error al actualizar el nombre del sensor: {str(e)}'}), 500

@app.route('/monitor')
def monitor():
    return render_template('monitor.html') # Renderizar monitor.html


@app.route('/api/sensor_status/<int:sensor_id>')
def get_sensor_status(sensor_id):
    try:
        status = GPIO.input(sensor_id)
        return jsonify({'status': status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/remove_sensor_video/<int:sensor_id>', methods=['DELETE', 'POST'])
@login_required
def remove_sensor_video(sensor_id):
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            
            # Obtener el video actual
            c.execute('SELECT video_path FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
            result = c.fetchone()
            
            if result:
                video_path = result[0]
                # Eliminar el registro de la base de datos
                c.execute('DELETE FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
                conn.commit()
                
                # Eliminar el archivo si existe
                try:
                    if os.path.exists(video_path):
                        os.remove(video_path)
                except Exception as e:
                    print(f"Error al eliminar archivo: {str(e)}")
                
                return jsonify({'success': True, 'message': 'Video eliminado correctamente'})
            else:
                return jsonify({'success': False, 'error': 'No se encontró el video'}), 404
            
    except Exception as e:
        print(f"Error al eliminar video: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/upload_background', methods=['POST'])
@login_required
def upload_background_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No se encontró archivo de video'}), 400
    
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó ningún archivo'}), 400

    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Obtener el máximo orden actual
            c.execute('SELECT MAX(orden) FROM background_videos')
            max_orden = c.fetchone()[0] or 0
            
            # Insertar el nuevo video
            c.execute('INSERT INTO background_videos (video_path, orden) VALUES (?, ?)',
                     (os.path.join('videos', filename), max_orden + 1))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error subiendo video de fondo: {str(e)}")
        return jsonify({'error': str(e)}), 500

    
    
@app.route('/api/remove_background/<int:video_id>', methods=['DELETE'])
@login_required
def remove_background_video(video_id):
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Obtener ruta del video
            c.execute('SELECT video_path FROM background_videos WHERE id = ?', (video_id,))
            result = c.fetchone()
            
            if result:
                video_path = os.path.join(app.config['UPLOAD_FOLDER'], 
                                        os.path.basename(result[0]))
                # Eliminar archivo si existe
                if os.path.exists(video_path):
                    os.remove(video_path)
                    
                # Eliminar registro
                c.execute('DELETE FROM background_videos WHERE id = ?', (video_id,))
                
                # Reordenar videos restantes
                c.execute('''
                    UPDATE background_videos 
                    SET orden = (SELECT COUNT(*) 
                               FROM background_videos b2 
                               WHERE b2.orden <= background_videos.orden 
                                 AND b2.id != ?)
                    WHERE id != ?
                ''', (video_id, video_id))
                
                conn.commit()
                return jsonify({'success': True})
                
        return jsonify({'error': 'Video no encontrado'}), 404
        
    except Exception as e:
        app.logger.error(f"Error eliminando video: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sensor_status')
def sensor_status():
    try:
        status = {pin: GPIO.input(pin) for pin in SENSOR_PINS}
        active_sensors = [pin for pin, state in status.items() if state == 1]
        
        global previous_active_sensors
        if active_sensors != previous_active_sensors:
            register_sensor_activity(active_sensors, previous_active_sensors)
            previous_active_sensors = active_sensors
        
        return jsonify({
            'active_sensors': active_sensors,
            'status': status
        })
    except Exception as e:
        app.logger.error(f"Error en sensor_status: {str(e)}")
        return jsonify({
            'error': 'Error al leer sensores',
            'active_sensors': []
        }), 500

@app.route('/api/etiquetas-sensores', methods=['GET'])
def obtener_etiquetas_sensores():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT 
                gpio_pin,
                sensor_numero,
                nombre_fantasia,
                silenciado
            FROM etiquetas_sensores
        ''')
        resultados = c.fetchall()
        etiquetas = [
            {
                'gpio_pin': gpio_pin,
                'sensor_numero': sensor_numero,
                'nombre_fantasia': nombre_fantasia,
                'silenciado': silenciado
            }
            for gpio_pin, sensor_numero, nombre_fantasia, silenciado in resultados
        ]
        return jsonify(etiquetas)

@app.route('/api/actualizar-etiqueta', methods=['POST'])
@login_required
def actualizar_etiqueta_sensor():
    datos = request.json
    gpio_pin = datos.get('gpio_pin')
    nombre_fantasia = datos.get('nombre_fantasia')
    
    if not gpio_pin:
        return jsonify({'error': 'Falta el número de GPIO'}), 400
        
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            UPDATE etiquetas_sensores 
            SET nombre_fantasia = ?
            WHERE gpio_pin = ?
        ''', (nombre_fantasia, gpio_pin))
        conn.commit()
    return jsonify({'success': True})


@app.route('/api/sensor_video/<int:sensor_id>')
def get_sensor_video(sensor_id):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT sv.video_path, sn.nombre_fantasia 
            FROM sensor_videos sv 
            LEFT JOIN etiquetas_sensores sn ON sv.sensor_id = sn.gpio_pin 
            WHERE sv.sensor_id = ?
        ''', (sensor_id,))
        result = c.fetchone()
        return jsonify({
            'video_path': result[0] if result else None,
            'nombre_sensor': result[1] if result and len(result) > 1 else None
        })

@app.route('/api/background_videos')
def get_background_videos():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        # Añadir COALESCE para manejar valores NULL en orden
        c.execute('''
            SELECT id, video_path, COALESCE(orden, 0) as orden 
            FROM background_videos 
            ORDER BY orden ASC
        ''')
        videos = [
            {
                'id': row[0], 
                'video_path': row[1], 
                'orden': row[2]
            } 
            for row in c.fetchall()
        ]
        # Añadir logging para debug
        print("Returning background videos:", videos)
        return jsonify(videos)

@app.route('/api/sensor_videos')
@login_required
def get_all_sensor_videos():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT 
                sv.sensor_id, 
                sv.video_path,
                COALESCE(es.nombre_fantasia, es.sensor_numero) as nombre_sensor,
                es.nombre_fantasia
            FROM sensor_videos sv 
            LEFT JOIN etiquetas_sensores es ON sv.sensor_id = es.gpio_pin
            ORDER BY sv.sensor_id
        ''')
        videos = [{
            'sensor_id': row[0],
            'video_path': row[1],
            'nombre_sensor': row[2],
            'nombre_fantasia': row[3]
        } for row in c.fetchall()]
        return jsonify(videos)

@app.route('/api/upload_video', methods=['POST'])
@login_required
def upload_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file'}), 400
    
    file = request.files['video']
    sensor_id = request.form.get('sensor_id')
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('INSERT OR REPLACE INTO sensor_videos (sensor_id, video_path) VALUES (?, ?)',
                     (sensor_id, os.path.join('videos', filename)))
            conn.commit()
            
        return jsonify({'success': True})
    

@app.route('/api/update-versus-mode', methods=['POST'])
@login_required 
def update_versus_mode():
    global current_mode
    try:
        data = request.json
        mode = int(data.get('mode', 1))
        if not 1 <= mode <= 4:
            return jsonify({'error': 'Modo inválido. Debe ser entre 1 y 4'}), 400
            
        with sqlite3.connect('vitrina.db') as conn:  
            c = conn.cursor()
            c.execute('UPDATE system_config SET value = ? WHERE key = ?', (str(mode), 'versus_mode'))
            conn.commit()
            current_mode = mode
        return jsonify({'success': True, 'mode': mode})
    except Exception as e:
        print(f"Error al actualizar modo versus: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/get-current-mode')
def get_current_mode():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT value FROM system_config WHERE key = ?', ('versus_mode',))
            result = c.fetchone()
            mode = int(result[0]) if result else current_mode
            return jsonify({'mode': mode})
    except Exception as e:
        print(f"Error al obtener modo actual: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/system-config')
def get_system_config():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT key, value FROM system_config')
            config = dict(c.fetchall())
            app.logger.info(f"Configuración actual del sistema: {config}")
            return jsonify(config)
    except Exception as e:
        app.logger.error(f"Error en system_config: {str(e)}")
        return jsonify({'error': 'Error al obtener configuración'}), 500

def register_sensor_activity(active_sensors, previous_sensors):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        for sensor in active_sensors:
            if sensor not in previous_sensors:
                c.execute('INSERT INTO activaciones (sensor_id) VALUES (?)', (sensor,))
        
        if len(active_sensors) >= 2:
            sorted_sensors = sorted(active_sensors[:2])
            c.execute('INSERT INTO versus (sensor1_id, sensor2_id) VALUES (?, ?)',
                     (sorted_sensors[0], sorted_sensors[1]))
        conn.commit()

def load_system_config():
    global current_mode
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT value FROM system_config WHERE key = ?', ('versus_mode',))
            result = c.fetchone()
            if result:
                current_mode = int(result[0])
    except Exception as e:
        print(f"Error al cargar configuración: {str(e)}")

@app.route('/api/stats')
@login_required
def get_stats():
    try:
        conn = sqlite3.connect('vitrina.db')
        cursor = conn.cursor()
        
        # Total activaciones
        cursor.execute('SELECT COUNT(*) FROM activaciones')
        total_activations = cursor.fetchone()[0]
        
        # Activaciones hoy
        cursor.execute('''
            SELECT COUNT(*) 
            FROM activaciones 
            WHERE date(timestamp, 'localtime') = date('now', 'localtime')
        ''')
        today_activations = cursor.fetchone()[0]
        
        # Activaciones esta semana
        cursor.execute('''
            SELECT COUNT(*) 
            FROM activaciones 
            WHERE timestamp >= datetime('now', '-7 days', 'localtime')
        ''')
        week_activations = cursor.fetchone()[0]
        
        # Activaciones este mes
        cursor.execute('''
            SELECT COUNT(*) 
            FROM activaciones 
            WHERE strftime('%Y-%m', timestamp, 'localtime') = strftime('%Y-%m', 'now', 'localtime')
        ''')
        month_activations = cursor.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'stats': {
                'total_activations': total_activations,
                'today_activations': today_activations,
                'week_activations': week_activations,
                'month_activations': month_activations
            }
        })
        
    except Exception as e:
        print(f"Error en /api/stats: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/toggle-debug', methods=['POST'])
@login_required
def toggle_debug():
    try:
        data = request.json
        enabled = data.get('enabled', False)
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('UPDATE system_config SET value = ? WHERE key = ?', 
                     (str(enabled).lower(), 'debug_enabled'))
            conn.commit()
        
        return jsonify({'success': True, 'debug_enabled': enabled})
    except Exception as e:
        app.logger.error(f"Error en toggle_debug: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/public/sensor_videos')
def get_public_sensor_videos():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT 
                sv.sensor_id, 
                sv.video_path,
                COALESCE(es.nombre_fantasia, es.sensor_numero) as nombre
            FROM sensor_videos sv 
            LEFT JOIN etiquetas_sensores es ON sv.sensor_id = es.gpio_pin
        ''')
        videos = [{'sensor_id': row[0], 
                  'video_path': row[1],
                  'nombre': row[2]} for row in c.fetchall()]
        return jsonify(videos)

@app.route('/api/public/background_videos')
def get_public_background_videos():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT id, video_path, orden FROM background_videos ORDER BY orden')
        videos = [{'id': row[0], 'video_path': row[1], 'orden': row[2]} 
                 for row in c.fetchall()]
        return jsonify(videos)

@app.route('/api/move_background', methods=['POST'])
@login_required
def move_background_video():
    try:
        data = request.json
        video_id = data.get('video_id')
        direction = data.get('direction')
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Obtener orden actual
            c.execute('SELECT orden FROM background_videos WHERE id = ?', (video_id,))
            current_order = c.fetchone()[0]
            
            if direction == 'up' and current_order > 1:
                # Intercambiar con el video anterior
                c.execute('''
                    UPDATE background_videos 
                    SET orden = CASE
                        WHEN orden = ? THEN orden - 1
                        WHEN orden = ? - 1 THEN orden + 1
                    END
                    WHERE orden IN (?, ? - 1)
                ''', (current_order, current_order, current_order, current_order))
            elif direction == 'down':
                c.execute('''
                    UPDATE background_videos 
                    SET orden = CASE
                        WHEN orden = ? THEN orden + 1
                        WHEN orden = ? + 1 THEN orden - 1
                    END
                    WHERE orden IN (?, ? + 1)
                ''', (current_order, current_order, current_order, current_order))
            
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error moviendo video: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/extra-content')
def get_extra_content():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''SELECT content_path, position, content_type 
                        FROM extra_content 
                        ORDER BY id DESC LIMIT 1''')
            result = c.fetchone()
            
            if result:
                return jsonify({
                    'path': result[0],
                    'position': result[1],
                    'type': result[2]
                })
            return jsonify({
                'path': None,
                'position': None,
                'type': None
            })
    except Exception as e:
        app.logger.error(f"Error en get_extra_content: {str(e)}")
        return jsonify({'error': str(e)}), 500


#monitor de recursos 
@app.route('/api/system_info')
def system_info():
    cpu_percent = psutil.cpu_percent()
    mem = psutil.virtual_memory()
    mem_percent = mem.percent
    disk = psutil.disk_usage('/')
    disk_percent = disk.percent
    temp = get_cpu_temperature()
    uptime = get_uptime()
    swap = psutil.swap_memory()
    swap_percent = swap.percent

    return jsonify({
        'cpu_percent': cpu_percent,
        'mem_percent': mem_percent,
        'disk_percent': disk_percent,
        'cpu_temp': temp,
        'uptime': uptime,
        'swap_percent': swap_percent
    })

def get_cpu_temperature():
    try:
        # Comando para obtener la temperatura en Raspberry Pi
        output = subprocess.check_output(['vcgencmd', 'measure_temp']).decode('utf-8')
        temp_str = output.replace("temp=", "").replace("'C\n", "")
        return float(temp_str)
    except FileNotFoundError:
        return "N/A"
    except subprocess.CalledProcessError:
        return "N/A"
    except ValueError:
        return "N/A"


def get_uptime():
    try:
        with open('/proc/uptime', 'r') as f:
            uptime_seconds = float(f.readline().split()[0])
            days = int(uptime_seconds // (60 * 60 * 24))
            hours = int((uptime_seconds % (60 * 60 * 24)) // (60 * 60))
            minutes = int((uptime_seconds % (60 * 60)) // 60)

            return f"{days} días, {hours} horas, {minutes} minutos"
    except FileNotFoundError:
        return "N/A"


@app.route('/api/dashboard-stats')
@login_required
def get_dashboard_stats():
    try:
        from_date = request.args.get('from', '')
        to_date = request.args.get('to', '')
        
        # Si no se proporcionan fechas, usar el día actual
        if not from_date or not to_date:
            today = datetime.now()
            from_date = today.replace(hour=0, minute=0, second=0).strftime('%Y-%m-%d 00:00:00')
            to_date = today.replace(hour=23, minute=59, second=59).strftime('%Y-%m-%d 23:59:59')
            
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            
            # Total de activaciones en el período
            c.execute('''
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE timestamp BETWEEN ? AND ?
            ''', (from_date, to_date))
            total_activaciones = c.fetchone()[0]
            
            # Activaciones de hoy
            today_start = datetime.now().strftime('%Y-%m-%d 00:00:00')
            today_end = datetime.now().strftime('%Y-%m-%d 23:59:59')
            c.execute('''
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE timestamp BETWEEN ? AND ?
            ''', (today_start, today_end))
            activaciones_hoy = c.fetchone()[0]
            
            # Activaciones de la semana
            week_start = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d 00:00:00')
            c.execute('''
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE timestamp >= ?
            ''', (week_start,))
            activaciones_semana = c.fetchone()[0]
            
            # Activaciones del mes
            month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0).strftime('%Y-%m-%d 00:00:00')
            c.execute('''
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE timestamp >= ?
            ''', (month_start,))
            activaciones_mes = c.fetchone()[0]
            
            # Activaciones por día
            c.execute('''
                SELECT 
                    date(timestamp) as fecha,
                    COUNT(*) as total
                FROM activaciones 
                WHERE timestamp BETWEEN ? AND ?
                GROUP BY date(timestamp)
                ORDER BY fecha
            ''', (from_date, to_date))
            activaciones_por_dia = [{
                'fecha': row[0],
                'total': row[1]
            } for row in c.fetchall()]
            
            # Activaciones por sensor con nombre fantasia
            c.execute('''
                SELECT 
                    a.sensor_id,
                    COALESCE(es.nombre_fantasia, es.sensor_numero) as nombre,
                    COUNT(*) as total
                FROM activaciones a
                LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
                WHERE a.timestamp BETWEEN ? AND ?
                GROUP BY a.sensor_id, es.nombre_fantasia, es.sensor_numero
                ORDER BY total DESC
            ''', (from_date, to_date))
            activaciones_por_sensor = [{
                'sensor_id': row[0],
                'nombre_fantasia': row[1] or f'Sensor {row[0]}',
                'total': row[2]
            } for row in c.fetchall()]
            
            # Ranking de sensores
            c.execute('''
                SELECT 
                    a.sensor_id,
                    COALESCE(es.nombre_fantasia, es.sensor_numero) as nombre,
                    COUNT(*) as total,
                    MAX(a.timestamp) as ultima_activacion
                FROM activaciones a
                LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
                WHERE a.timestamp BETWEEN ? AND ?
                GROUP BY a.sensor_id, es.nombre_fantasia, es.sensor_numero
                ORDER BY total DESC
            ''', (from_date, to_date))
            ranking = [{
                'sensor_id': row[0],
                'nombre_fantasia': row[1] or f'Sensor {row[0]}',
                'total': row[2],
                'ultima_activacion': row[3]
            } for row in c.fetchall()]
            
            # Historial de asignaciones de videos
            c.execute('''
                SELECT 
                    sv.sensor_id,
                    COALESCE(es.nombre_fantasia, es.sensor_numero) as nombre,
                    sv.video_path,
                    MIN(a.timestamp) as fecha_inicio,
                    MAX(a.timestamp) as fecha_fin,
                    COUNT(*) as total_activaciones,
                    ROUND(
                        CAST(COUNT(*) AS FLOAT) / (
                        JULIANDAY(MAX(a.timestamp)) - JULIANDAY(MIN(a.timestamp)) + 1
                    ), 2) as promedio_diario
                FROM sensor_videos sv
                LEFT JOIN etiquetas_sensores es ON sv.sensor_id = es.gpio_pin
                LEFT JOIN activaciones a ON sv.sensor_id = a.sensor_id
                WHERE a.timestamp BETWEEN ? AND ?
                GROUP BY sv.sensor_id, sv.video_path, es.nombre_fantasia, es.sensor_numero
                ORDER BY total_activaciones DESC
            ''', (from_date, to_date))
            historial = [{
                'sensor_id': row[0],
                'nombre_fantasia': row[1] or f'Sensor {row[0]}',
                'video_path': row[2],
                'fecha_inicio': row[3],
                'fecha_fin': row[4],
                'total_activaciones': row[5],
                'promedio_diario': row[6]
            } for row in c.fetchall()]

            return jsonify({
                'total_activaciones': total_activaciones,
                'activaciones_hoy': activaciones_hoy,
                'activaciones_semana': activaciones_semana,
                'activaciones_mes': activaciones_mes,
                'activaciones_por_dia': activaciones_por_dia,
                'activaciones_por_sensor': activaciones_por_sensor,
                'ranking': ranking,
                'historial': historial
            })
            
    except Exception as e:
        app.logger.error(f"Error getting dashboard stats: {str(e)}")
        return jsonify({'error': str(e)}), 500
@app.route('/api/update-extra-content', methods=['POST'])
@login_required
def update_extra_content():
    try:
        if 'content' not in request.files:
            return jsonify({'error': 'No se encontró archivo de contenido'}), 400
            
        file = request.files['content']
        position = request.form.get('position')
        
        if file.filename == '':
            return jsonify({'error': 'No se seleccionó ningún archivo'}), 400

        if not position:
            return jsonify({'error': 'No se especificó la posición'}), 400

        # Determinar el tipo de contenido
        filename = secure_filename(file.filename)
        file_extension = filename.rsplit('.', 1)[1].lower()
        
        if file_extension in {'jpg', 'jpeg', 'png', 'gif'}:
            content_type = 'image'
        elif file_extension in {'mp4', 'webm', 'mov'}:
            content_type = 'video'
        else:
            return jsonify({'error': 'Tipo de archivo no soportado'}), 400

        # Guardar el archivo
        content_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(content_path)
        
        # Actualizar la base de datos
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''
                INSERT INTO extra_content (content_path, position, content_type) 
                VALUES (?, ?, ?)
            ''', (os.path.join('videos', filename), position, content_type))
            conn.commit()
            
        return jsonify({
            'success': True,
            'message': 'Contenido extra actualizado correctamente'
        })
        
    except Exception as e:
        app.logger.error(f"Error updating extra content: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/register_activation', methods=['POST'])
def register_activation():
    try:
        data = request.get_json()
        sensor_id = data.get('sensor_id')
        duration = data.get('duration', 0)
        
        if not sensor_id:
            return jsonify({'error': 'Sensor ID required'}), 400
            
        if duration < 5000:  # Menos de 5 segundos
            return jsonify({'success': False, 'message': 'Duration too short'}), 200
            
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''
                INSERT INTO activaciones (sensor_id, duration) 
                VALUES (?, ?)
            ''', (sensor_id, duration))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error registering activation: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/reset_stats', methods=['POST'])
@login_required
def reset_stats():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('DELETE FROM activaciones')
            conn.commit()
        return jsonify({'success': True, 'message': 'Estadísticas reiniciadas'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/activations')
@login_required
def get_activations():
    try:
        conn = sqlite3.connect('vitrina.db')
        cursor = conn.cursor()
        
        # Obtener activaciones de los últimos 7 días
        cursor.execute('''
            SELECT 
                strftime('%Y-%m-%d', timestamp) as fecha,
                sensor_id,
                COUNT(*) as activaciones
            FROM activaciones
            WHERE timestamp >= date('now', '-7 days')
            GROUP BY fecha, sensor_id
            ORDER BY fecha DESC, sensor_id
        ''')
        
        rows = cursor.fetchall()
        activations = []
        
        for row in rows:
            activations.append({
                'date': row[0],
                'sensor_id': row[1],
                'count': row[2]
            })
        
        conn.close()
        return jsonify({'success': True, 'activations': activations})
        
    except Exception as e:
        print(f"Error en /api/activations: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    setup_gpio()
    init_db()
    load_system_config()  # Cargar configuración al inicio
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(host='0.0.0.0', port=5000, debug=True)