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

# Configuración GPIO
def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    for pin in SENSOR_PINS:
        GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

# Base de datos
def init_db():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        # Tabla para videos de sensores
        c.execute('''CREATE TABLE IF NOT EXISTS sensor_videos 
                    (sensor_id INTEGER PRIMARY KEY,
                     video_path TEXT,
                     description TEXT)''')
        
        # Tabla para videos de fondo
        c.execute('''CREATE TABLE IF NOT EXISTS background_videos 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     video_path TEXT,
                     orden INTEGER)''')
        
        # Tabla para registro de activaciones
        c.execute('''CREATE TABLE IF NOT EXISTS activaciones 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     sensor_id INTEGER,
                     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
        
        # Tabla para registro de versus
        c.execute('''CREATE TABLE IF NOT EXISTS versus 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     sensor1_id INTEGER,
                     sensor2_id INTEGER,
                     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

        # Tabla para nombres de productos
        c.execute('''CREATE TABLE IF NOT EXISTS sensor_names
                    (sensor_id INTEGER PRIMARY KEY,
                     product_name TEXT)''')
                     
        # Tabla para configuración del sistema
        c.execute('''CREATE TABLE IF NOT EXISTS system_config
                    (key TEXT PRIMARY KEY,
                     value TEXT)''')

        # Configuración inicial del sistema
        c.execute('''INSERT OR IGNORE INTO system_config (key, value) 
                    VALUES 
                    ('versus_mode', '2'),
                    ('debug_enabled', 'true')''')
        
        conn.commit()

def login_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

# Rutas de autenticación
@app.route('/login')
def login_page():
    if session.get('logged_in'):
        return redirect(url_for('panel'))
    return render_template('login.html')

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

# Rutas principales
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/panel')
@login_required
def panel():
    return render_template('panel.html')

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')

# API endpoints
@app.route('/api/sensor_status')
def sensor_status():
    status = {pin: GPIO.input(pin) for pin in SENSOR_PINS}
    active_sensors = [pin for pin, state in status.items() if state == 1]
    
    # Registrar actividad si hay cambios
    global previous_active_sensors
    if active_sensors != previous_active_sensors:
        register_sensor_activity(active_sensors, previous_active_sensors)
        previous_active_sensors = active_sensors
    
    return jsonify({'active_sensors': active_sensors})

@app.route('/api/sensor_video/<int:sensor_id>')
def get_sensor_video(sensor_id):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT sv.video_path, sn.product_name 
            FROM sensor_videos sv 
            LEFT JOIN sensor_names sn ON sv.sensor_id = sn.sensor_id 
            WHERE sv.sensor_id = ?
        ''', (sensor_id,))
        result = c.fetchone()
        return jsonify({
            'video_path': result[0] if result else None,
            'product_name': result[1] if result and len(result) > 1 else None
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
            SELECT sv.sensor_id, sv.video_path, sn.product_name 
            FROM sensor_videos sv 
            LEFT JOIN sensor_names sn ON sv.sensor_id = sn.sensor_id
        ''')
        videos = [{'sensor_id': row[0], 
                  'video_path': row[1],
                  'product_name': row[2]} for row in c.fetchall()]
        return jsonify(videos)

@app.route('/api/upload_video', methods=['POST'])
@login_required
def upload_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file'}), 400
    
    file = request.files['video']
    sensor_id = request.form.get('sensor_id')
    product_name = request.form.get('product_name', '')
    
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
            if product_name:
                c.execute('INSERT OR REPLACE INTO sensor_names (sensor_id, product_name) VALUES (?, ?)',
                         (sensor_id, product_name))
            conn.commit()
            
        return jsonify({'success': True})

@app.route('/api/update-product-name', methods=['POST'])
@login_required
def update_product_name():
    data = request.json
    sensor_id = data.get('sensorId')
    name = data.get('name')
    
    if not sensor_id or not name:
        return jsonify({'error': 'Datos incompletos'}), 400
        
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('INSERT OR REPLACE INTO sensor_names (sensor_id, product_name) VALUES (?, ?)',
                 (sensor_id, name))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/upload_background', methods=['POST'])
@login_required
def upload_background_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file'}), 400
    
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT MAX(orden) FROM background_videos')
            max_orden = c.fetchone()[0] or 0
            c.execute('INSERT INTO background_videos (video_path, orden) VALUES (?, ?)',
                     (os.path.join('videos', filename), max_orden + 1))
            conn.commit()
            
        return jsonify({'success': True})

@app.route('/api/reorder_background', methods=['POST'])
@login_required
def reorder_background():
    data = request.json
    video_id = data.get('video_id')
    direction = data.get('direction')
    
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT orden FROM background_videos WHERE id = ?', (video_id,))
        current_order = c.fetchone()[0]
        
        if direction == 'up' and current_order > 1:
            c.execute('''
                UPDATE background_videos 
                SET orden = CASE
                    WHEN orden = ? THEN ? 
                    WHEN orden = ? - 1 THEN ?
                END
                WHERE orden IN (?, ? - 1)
            ''', (current_order, current_order - 1, current_order, current_order, current_order, current_order))
        elif direction == 'down':
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

@app.route('/api/remove_video/<int:sensor_id>', methods=['DELETE'])
@login_required
def remove_sensor_video(sensor_id):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT video_path FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
        result = c.fetchone()
        if result:
            video_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(result[0]))
            if os.path.exists(video_path):
                os.remove(video_path)
            c.execute('DELETE FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
            conn.commit()
            return jsonify({'success': True})
        return jsonify({'error': 'Video no encontrado'}), 404

@app.route('/api/remove_background/<int:video_id>', methods=['DELETE'])
@login_required
def remove_background_video(video_id):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT video_path FROM background_videos WHERE id = ?', (video_id,))
        result = c.fetchone()
        if result:
            video_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(result[0]))
            if os.path.exists(video_path):
                os.remove(video_path)
            c.execute('DELETE FROM background_videos WHERE id = ?', (video_id,))
            c.execute('''
                UPDATE background_videos 
                SET orden = (
                    SELECT COUNT(*) 
                    FROM background_videos b2 
                    WHERE b2.orden <= background_videos.orden 
                    AND b2.id != ?
                )
                WHERE id != ?
            ''', (video_id, video_id))
            conn.commit()
            return jsonify({'success': True})
        return jsonify({'error': 'Video no encontrado'}), 404

def register_sensor_activity(active_sensors, previous_sensors):
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        
        # Registrar activaciones individuales
        for sensor in active_sensors:
            if sensor not in previous_sensors:
                c.execute('INSERT INTO activaciones (sensor_id) VALUES (?)', (sensor,))
        
        # Registrar versus si hay exactamente 2 sensores
        if len(active_sensors) == 2:
            sensor1, sensor2 = sorted(active_sensors)
            c.execute('INSERT INTO versus (sensor1_id, sensor2_id) VALUES (?, ?)',
                     (sensor1, sensor2))
        
        conn.commit()

@app.route('/api/system-config')
@login_required
def get_system_config():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT key, value FROM system_config')
        config = dict(c.fetchall())
    return jsonify(config)
# En app.py, agregar:

@app.route('/api/stats')
@login_required
def get_stats():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        
        # Estadísticas generales
        c.execute('SELECT COUNT(*) FROM activaciones')
        total_activations = c.fetchone()[0]
        
        c.execute('SELECT COUNT(*) FROM versus')
        total_versus = c.fetchone()[0]
        
        # Sensor más popular
        c.execute('''
            SELECT sensor_id, COUNT(*) as count 
            FROM activaciones 
            GROUP BY sensor_id 
            ORDER BY count DESC 
            LIMIT 1
        ''')
        most_popular = c.fetchone()
        
        # Versus más común
        c.execute('''
            SELECT sensor1_id, sensor2_id, COUNT(*) as count 
            FROM versus 
            GROUP BY sensor1_id, sensor2_id 
            ORDER BY count DESC 
            LIMIT 1
        ''')
        most_common_versus = c.fetchone()

        # Estadísticas por hora
        c.execute('''
            SELECT strftime('%H', timestamp) as hour, COUNT(*) 
            FROM activaciones 
            GROUP BY hour 
            ORDER BY hour
        ''')
        hourly_stats = [0] * 24
        for row in c.fetchall():
            hourly_stats[int(row[0])] = row[1]

        return jsonify({
            'general_stats': {
                'total_activations': total_activations,
                'total_versus': total_versus,
                'most_popular_sensor': most_popular[0] if most_popular else None,
                'most_common_versus': f"{most_common_versus[0]} vs {most_common_versus[1]}" if most_common_versus else None
            },
            'hourly_stats': hourly_stats,
            'product_stats': get_product_stats(),
            'versus_stats': get_versus_stats()
        })

def get_product_stats():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT 
                a.sensor_id,
                COUNT(*) as activations,
                MAX(a.timestamp) as last_activation,
                sn.product_name
            FROM activaciones a
            LEFT JOIN sensor_names sn ON a.sensor_id = sn.sensor_id
            GROUP BY a.sensor_id
            ORDER BY activations DESC
        ''')
        return [{
            'sensor_id': row[0],
            'activations': row[1],
            'last_activation': row[2],
            'product_name': row[3]
        } for row in c.fetchall()]

def get_versus_stats():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT 
                sensor1_id,
                sensor2_id,
                COUNT(*) as count,
                MAX(timestamp) as last_versus
            FROM versus
            GROUP BY sensor1_id, sensor2_id
            ORDER BY count DESC
        ''')
        return [{
            'sensor1_id': row[0],
            'sensor2_id': row[1],
            'count': row[2],
            'last_versus': row[3]
        } for row in c.fetchall()]
    
    
@app.route('/api/sensor-names')
@login_required
def get_sensor_names():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT sensor_id, product_name FROM sensor_names')
        names = dict(c.fetchall())
        return jsonify(names)
    

@app.route('/api/update-system-config', methods=['POST'])
@login_required
def update_system_config():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
        
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        for key, value in data.items():
            c.execute('UPDATE system_config SET value = ? WHERE key = ?',
                     (str(value), key))
        conn.commit()
    return jsonify({'success': True})

if __name__ == '__main__':
    setup_gpio()
    init_db()
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(host='0.0.0.0', port=5000, debug=True)