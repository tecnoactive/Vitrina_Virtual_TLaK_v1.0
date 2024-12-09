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
                     nombre TEXT NOT NULL)''')

        c.execute('''CREATE TABLE IF NOT EXISTS system_config
                    (key TEXT PRIMARY KEY,
                     value TEXT)''')

        c.execute('''CREATE TABLE IF NOT EXISTS extra_content
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     content_path TEXT,
                     position TEXT,
                     content_type TEXT)''')

        # Configuración inicial
        c.execute('''INSERT OR REPLACE INTO system_config (key, value) 
                 VALUES 
                 ('versus_mode', '1'),
                 ('debug_enabled', 'false')''')
        
        # Insertar nombres predeterminados de sensores
        c.execute('''INSERT OR IGNORE INTO etiquetas_sensores (pin, nombre) VALUES 
            (17, 'Sensor 1'), 
            (27, 'Sensor 2'), 
            (4, 'Sensor 3'),
            (5, 'Sensor 4'), 
            (6, 'Sensor 5'), 
            (13, 'Sensor 6'),
            (18, 'Sensor 7'), 
            (22, 'Sensor 8'), 
            (26, 'Sensor 9'),
            (19, 'Sensor 10')''')
        
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


@app.route('/api/sensor_status/<int:sensor_id>')
def get_sensor_status(sensor_id):
    try:
        status = GPIO.input(sensor_id)
        return jsonify({'status': status})
    except Exception as e:
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
    date_from = request.args.get('from', '1900-01-01') 
    date_to = request.args.get('to', '2100-12-31')

    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        
        # Estadísticas por producto
        c.execute('''
            SELECT a.sensor_id, COUNT(*) as activaciones, MAX(a.timestamp) as last_activation,
                   es.nombre as nombre_sensor
            FROM activaciones a
            LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.pin
            WHERE a.timestamp BETWEEN ? AND ?
            GROUP BY a.sensor_id
            ORDER BY activaciones DESC
        ''', (date_from, date_to))
        product_stats = [
            {
                'sensor_id': row[0], 
                'activaciones': row[1], 
                'ultima_activacion': row[2],
                'nombre_sensor': row[3]
            }
            for row in c.fetchall()
        ]
        
        # Estadísticas de versus
        c.execute('''
            SELECT v.sensor1_id, v.sensor2_id, COUNT(*) as count, 
                   MAX(v.timestamp) as last_versus,
                   es1.nombre as nombre_sensor1,
                   es2.nombre as nombre_sensor2  
            FROM versus v
            LEFT JOIN etiquetas_sensores es1 ON v.sensor1_id = es1.pin
            LEFT JOIN etiquetas_sensores es2 ON v.sensor2_id = es2.pin
            WHERE v.timestamp BETWEEN ? AND ?
            GROUP BY v.sensor1_id, v.sensor2_id
            ORDER BY count DESC
        ''', (date_from, date_to))
        versus_stats = [
            {
                'sensor1_id': row[0], 
                'sensor2_id': row[1], 
                'count': row[2], 
                'ultimo_versus': row[3],
                'nombre_sensor1': row[4],
                'nombre_sensor2': row[5]
            }
            for row in c.fetchall()
        ]
        
        return jsonify({
            'product_stats': product_stats,
            'versus_stats': versus_stats
        })
    

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
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    setup_gpio()
    init_db()
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(host='0.0.0.0', port=5000, debug=True)