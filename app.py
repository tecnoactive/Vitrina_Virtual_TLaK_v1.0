from flask import Flask, render_template, jsonify, request, session, redirect, url_for
import RPi.GPIO as GPIO
import sqlite3
import os
from datetime import datetime
from functools import wraps
import time
from werkzeug.utils import secure_filename
import functools

app = Flask(__name__)
app.secret_key = 'admin'

# Configuración
UPLOAD_FOLDER = 'static/videos'
ALLOWED_EXTENSIONS = {'mp4', 'webm', 'mov'}
SENSOR_PINS = [17, 27, 4, 5, 6, 13, 18, 22, 26, 19]

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Variables globales
previous_active_sensors = []

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
            (pin INTEGER PRIMARY KEY,
             nombre TEXT NOT NULL,
             etiqueta TEXT,
             timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

        c.execute('''CREATE TABLE IF NOT EXISTS system_config
                    (key TEXT PRIMARY KEY,
                     value TEXT)''')

        c.execute('''CREATE TABLE IF NOT EXISTS extra_content
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     content_path TEXT,
                     position TEXT,
                     content_type TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS etiquetas_sensores
                    (pin INTEGER PRIMARY KEY,
                     nombre TEXT NOT NULL,
                     etiqueta TEXT)''') 

        # Configuración inicial
        c.execute('''INSERT OR REPLACE INTO system_config (key, value) 
                 VALUES 
                 ('versus_mode', '1'),
                 ('debug_enabled', 'false')''')
        
        # Insertar nombres predeterminados de sensores
        for pin, nombre in sensor_mapping.items():
            c.execute('''INSERT OR REPLACE INTO etiquetas_sensores (pin, nombre) 
                        VALUES (?, ?)''', (pin, nombre))
        try:
            c.execute('ALTER TABLE etiquetas_sensores ADD COLUMN etiqueta TEXT')
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
    return render_template('panel.html')

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
@login_required
def update_sensor_name():
    try:
        data = request.json
        sensor_id = data.get('sensorId')
        etiqueta = data.get('name')

        if not sensor_id or not etiqueta:
            return jsonify({'error': 'Datos incompletos'}), 400

        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''UPDATE etiquetas_sensores 
                        SET etiqueta = ?, 
                            timestamp = CURRENT_TIMESTAMP 
                        WHERE pin = ?''', 
                     (etiqueta, sensor_id))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error en update_sensor_name: {str(e)}")
        return jsonify({'error': str(e)}), 500



@app.route('/api/sensor_status/<int:sensor_id>')
def get_sensor_status(sensor_id):
    try:
        status = GPIO.input(sensor_id)
        return jsonify({'status': status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/remove_video/<int:sensor_id>', methods=['DELETE'])
@login_required
def remove_sensor_video(sensor_id):
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Obtener ruta del video
            c.execute('SELECT video_path FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
            result = c.fetchone()
            
            if result:
                video_path = os.path.join(app.config['UPLOAD_FOLDER'], 
                                        os.path.basename(result[0]))
                # Eliminar archivo si existe
                if os.path.exists(video_path):
                    os.remove(video_path)
                    
                # Eliminar registro
                c.execute('DELETE FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
                conn.commit()
                return jsonify({'success': True})
                
        return jsonify({'error': 'Video no encontrado'}), 404
        
    except Exception as e:
        app.logger.error(f"Error eliminando video: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
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


@app.route('/api/move_background/<int:video_id>', methods=['POST'])
@login_required
def move_background_video(video_id):  # Añadido el parámetro video_id
    data = request.json
    direction = data.get('direction')

    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Obtener orden actual
            c.execute('SELECT orden FROM background_videos WHERE id = ?', (video_id,))
            current_order = c.fetchone()
            
            if not current_order:
                return jsonify({'error': 'Video no encontrado'}), 404
                
            current_order = current_order[0]
            
            if direction == 'up' and current_order > 1:
                # Intercambiar con el video anterior
                c.execute('''
                    UPDATE background_videos 
                    SET orden = CASE
                        WHEN orden = ? THEN ? 
                        WHEN orden = ? - 1 THEN ?
                    END
                    WHERE orden IN (?, ? - 1)
                ''', (current_order, current_order - 1, current_order, current_order, current_order, current_order))
            elif direction == 'down':
                # Intercambiar con el video siguiente
                c.execute('''
                    UPDATE background_videos 
                    SET orden = CASE
                        WHEN orden = ? THEN ? 
                        WHEN orden = ? + 1 THEN ?
                    END
                    WHERE orden IN (?, ? + 1)
                ''', (current_order, current_order + 1, current_order, current_order, current_order, current_order))
            
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error moviendo video: {str(e)}")
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
        c.execute('SELECT pin, nombre FROM etiquetas_sensores')
        etiquetas = dict(c.fetchall())
        return jsonify(etiquetas)

@app.route('/api/actualizar-etiqueta', methods=['POST'])
@login_required
def actualizar_etiqueta_sensor():
    datos = request.json
    pin = datos.get('pin')
    nombre = datos.get('nombre')
    
    if not pin or not nombre:
        return jsonify({'error': 'Faltan datos'}), 400
        
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('UPDATE etiquetas_sensores SET nombre = ? WHERE pin = ?', 
                 (nombre, pin))
        conn.commit()
    return jsonify({'success': True})


@app.route('/api/sensor_video/<int:sensor_id>')
def get_sensor_video(sensor_id):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT sv.video_path, sn.nombre 
            FROM sensor_videos sv 
            LEFT JOIN etiquetas_sensores sn ON sv.sensor_id = sn.pin 
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
        c.execute('SELECT id, video_path, orden FROM background_videos ORDER BY orden')
        videos = [{'id': row[0], 'video_path': row[1], 'orden': row[2]} 
                 for row in c.fetchall()]
        return jsonify(videos)

@app.route('/api/sensor_videos')
@login_required
def get_all_sensor_videos():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT sv.sensor_id, sv.video_path, es.nombre 
            FROM sensor_videos sv 
            LEFT JOIN etiquetas_sensores es ON sv.sensor_id = es.pin
        ''')
        videos = [{'sensor_id': row[0], 
                  'video_path': row[1],
                  'nombre_sensor': row[2]} for row in c.fetchall()]
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
    data = request.json
    mode = data.get('mode')
    with sqlite3.connect('vitrina.db') as conn:  
        c = conn.cursor()
        c.execute('UPDATE system_config SET value = ? WHERE key = ?', (str(mode), 'versus_mode'))
        conn.commit()
    return jsonify({'success': True})


@app.route('/api/update-extra-content', methods=['POST'])
@login_required
def update_extra_content():
    if 'content' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['content']
    position = request.form.get('position', 'bottom-right')
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Determinar el tipo de contenido basado en la extensión
            content_type = 'video' if filename.lower().endswith(('.mp4','.webm','.mov')) else 'image'
            
            # Insertar o actualizar el contenido extra
            c.execute('''INSERT OR REPLACE INTO extra_content 
                        (content_path, position, content_type) 
                        VALUES (?, ?, ?)''',
                     (os.path.join('videos', filename), position, content_type))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error en update_extra_content: {str(e)}")
        return jsonify({'error': str(e)}), 500
    


@app.route('/api/get-current-mode')
def get_current_mode():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM system_config WHERE key = ?', ('versus_mode',))
        result = c.fetchone()
        return jsonify({'mode': int(result[0]) if result else 1})

@app.route('/api/system-config')
def get_system_config():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT key, value FROM system_config')
            config = dict(c.fetchall())
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

@app.route('/api/stats')
def get_stats():
    try:
        date_from = request.args.get('from', '1900-01-01')
        date_to = request.args.get('to', '2100-12-31')

        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            
            # Obtener total de activaciones
            c.execute('''SELECT COUNT(*) FROM activaciones
                        WHERE timestamp BETWEEN ? AND ?''', (date_from, date_to))
            total_activations = c.fetchone()[0]

            # Obtener total de versus
            c.execute('''SELECT COUNT(*) FROM versus
                        WHERE timestamp BETWEEN ? AND ?''', (date_from, date_to))
            total_versus = c.fetchone()[0]

            # Obtener producto más popular y sus estadísticas
            c.execute('''
                SELECT a.sensor_id, es.nombre, COUNT(*) as count
                FROM activaciones a
                LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.pin
                WHERE a.timestamp BETWEEN ? AND ?
                GROUP BY a.sensor_id, es.nombre
                ORDER BY count DESC
            ''', (date_from, date_to))
            
            stats = []
            most_popular = None
            for row in c.fetchall():
                sensor_id, nombre, count = row
                stat = {
                    'sensor_id': sensor_id,
                    'nombre': nombre or f'Sensor {sensor_id}',
                    'activations': count
                }
                stats.append(stat)
                if not most_popular or count > most_popular['count']:
                    most_popular = {'sensor_id': sensor_id, 'nombre': nombre, 'count': count}

            return jsonify({
                'total_activations': total_activations,
                'total_versus': total_versus,
                'most_popular_product': most_popular['nombre'] if most_popular else None,
                'product_stats': stats,
                'versus_stats': [],  # Implementar si es necesario
                'hourly_stats': [0] * 24  # Implementar si es necesario
            })

    except Exception as e:
        app.logger.error(f"Error en stats: {str(e)}")
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






if __name__ == '__main__':
    setup_gpio()
    init_db()
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(host='0.0.0.0', port=5000, debug=True)