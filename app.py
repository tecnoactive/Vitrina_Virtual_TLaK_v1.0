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

        c.execute('''CREATE TABLE IF NOT EXISTS sensor_names
                    (sensor_id INTEGER PRIMARY KEY,
                     product_name TEXT)''')
                     
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
             ('versus_mode', '2'),
             ('debug_enabled', 'false')''')
        
        conn.commit()

@app.route('/api/sensor_status/<int:sensor_id>')
def get_sensor_status(sensor_id):
    try:
        status = GPIO.input(sensor_id)
        return jsonify({'status': status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/sensor-names')
def get_sensor_names():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT sensor_id, product_name FROM sensor_names')
        sensor_names = {row[0]: row[1] for row in c.fetchall()}
        return jsonify(sensor_names)
    

def login_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

# Rutas principales
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

# API endpoints
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


@app.route('/api/update-sensor-name', methods=['POST'])
@login_required
def update_sensor_name():
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

# Continúa...


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

@app.route('/api/get-current-mode')
def get_current_mode():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM system_config WHERE key = ?', ('versus_mode',))
        result = c.fetchone()
        return jsonify({'mode': int(result[0]) if result else 2})

@app.route('/api/stats')
def get_stats():
    date_from = request.args.get('from', '1900-01-01') 
    date_to = request.args.get('to', '2100-12-31')

    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        
        c.execute('''
            SELECT a.sensor_id, COUNT(*) as activations, MAX(a.timestamp) as last_activation
            FROM activaciones a
            WHERE a.timestamp BETWEEN ? AND ?
            GROUP BY a.sensor_id
            ORDER BY activations DESC
        ''', (date_from, date_to))
        product_stats = [
            {'sensor_id': row[0], 'activations': row[1], 'last_activation': row[2]}
            for row in c.fetchall()
        ]
        
        c.execute('''
            SELECT v.sensor1_id, v.sensor2_id, COUNT(*) as count, MAX(v.timestamp) as last_versus  
            FROM versus v
            WHERE v.timestamp BETWEEN ? AND ?
            GROUP BY v.sensor1_id, v.sensor2_id
            ORDER BY count DESC
        ''', (date_from, date_to))
        versus_stats = [
            {'sensor1_id': row[0], 'sensor2_id': row[1], 'count': row[2], 'last_versus': row[3]}  
            for row in c.fetchall()
        ]
        
        c.execute('''
            SELECT COUNT(*) as total_activations, 
                   COUNT(DISTINCT sensor_id) as total_sensors,
                   (SELECT sensor_id 
                    FROM activaciones
                    WHERE timestamp BETWEEN ? AND ?
                    GROUP BY sensor_id
                    ORDER BY COUNT(*) DESC
                    LIMIT 1) as most_popular_sensor,
                   (SELECT COUNT(*)
                    FROM activaciones 
                    WHERE timestamp BETWEEN ? AND ?) as period_activations
            FROM activaciones
        ''', (date_from, date_to, date_from, date_to))
        general_stats = c.fetchone()

        c.execute('''
            SELECT sensor1_id, sensor2_id, COUNT(*) as count
            FROM versus
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY sensor1_id, sensor2_id
            ORDER BY count DESC
            LIMIT 1
        ''', (date_from, date_to))
        most_common_versus = c.fetchone()
        
        c.execute('''
            SELECT SUBSTR(timestamp, 12, 2) as hour, COUNT(*) as activations
            FROM activaciones
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY hour
        ''', (date_from, date_to))
        hourly_stats = [0] * 24
        for row in c.fetchall():
            hourly_stats[int(row[0])] = row[1]
            
        c.execute('SELECT sensor_id, product_name FROM sensor_names')
        sensor_names = {row[0]: row[1] for row in c.fetchall()}
        
    most_popular_sensor = general_stats[2]  
    most_popular_name = sensor_names.get(most_popular_sensor, f"Sensor {most_popular_sensor}")
        
    most_common_versus_text = '' 
    if most_common_versus:
        versus1 = sensor_names.get(most_common_versus[0], f"Sensor {most_common_versus[0]}")
        versus2 = sensor_names.get(most_common_versus[1], f"Sensor {most_common_versus[1]}")
        most_common_versus_text = f"{versus1} vs {versus2}"
        
    stats = {
        'general_stats': {
            'total_activations': general_stats[0],
            'total_sensors': general_stats[1],  
            'most_popular_sensor': most_popular_name,
            'total_versus': len(versus_stats),
            'period_activations': general_stats[3],
            'most_common_versus': most_common_versus_text
        },
        'product_stats': product_stats,
        'versus_stats': versus_stats,
        'hourly_stats': hourly_stats
    }
    
    return jsonify(stats)


def get_hourly_stats():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT strftime('%H', timestamp) as hour, COUNT(*) 
            FROM activaciones 
            GROUP BY hour 
            ORDER BY hour
        ''')
        hourly_data = {int(row[0]): row[1] for row in c.fetchall()}
        return [hourly_data.get(hour, 0) for hour in range(24)]

@app.route('/api/update-extra-content', methods=['POST'])
@login_required
def update_extra_content():
    if 'content' not in request.files:
        return jsonify({'error': 'No file'}), 400
        
    file = request.files['content']
    position = request.form.get('position', 'bottom-right')
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        content_type = 'video' if filename.lower().endswith(('.mp4', '.webm', '.mov')) else 'image'
        
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''INSERT OR REPLACE INTO extra_content 
                        (content_path, position, content_type) 
                        VALUES (?, ?, ?)''',
                     (os.path.join('videos', filename), position, content_type))
            conn.commit()
        return jsonify({'success': True})
    return jsonify({'error': 'Error saving file'}), 400

@app.route('/api/extra-content')
def get_extra_content():
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
        return jsonify({'error': 'No content'}), 404

@app.route('/api/toggle-debug', methods=['POST'])
@login_required
def toggle_debug():
    data = request.json
    enabled = data.get('enabled', False)
    
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        c.execute('UPDATE system_config SET value = ? WHERE key = ?', 
                 (str(enabled).lower(), 'debug_enabled'))
        conn.commit()
    
    return jsonify({'success': True, 'debug_enabled': enabled})

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

if __name__ == '__main__':
    setup_gpio()
    init_db()
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(host='0.0.0.0', port=5000, debug=True)