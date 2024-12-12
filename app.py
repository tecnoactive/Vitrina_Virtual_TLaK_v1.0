from flask import Flask, render_template, jsonify, request, session, redirect, url_for
import sqlite3
import os
import json
from datetime import datetime
import functools
from functools import wraps
from werkzeug.utils import secure_filename

from sensor_manager import SensorManager  # Solo importamos SensorManager

app = Flask(__name__)
app.secret_key = 'admin'

UPLOAD_FOLDER = 'static/videos'
ALLOWED_EXTENSIONS = {'mp4', 'webm', 'mov'}
SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19]
DEFAULT_SENSORS = [17, 27, 5, 6, 13, 18]

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
previous_active_sensors = []


def init_db():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        
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
                     enabled INTEGER DEFAULT 0)''')

        c.execute('''CREATE TABLE IF NOT EXISTS system_config
                    (key TEXT PRIMARY KEY,
                     value TEXT)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS extra_content 
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content_path TEXT,
                    position TEXT,
                    content_type TEXT)''')

        # Insertar nombres y estados predeterminados de sensores
        for pin in SENSOR_PINS:
            enabled = 1 if pin in DEFAULT_SENSORS else 0
            sensor_num = SENSOR_PINS.index(pin) + 1
            c.execute('''INSERT OR REPLACE INTO etiquetas_sensores (pin, nombre, enabled) 
                        VALUES (?, ?, ?)''', (pin, f'Sensor {sensor_num}', enabled))

        # Configuración inicial
        c.execute('''INSERT OR REPLACE INTO system_config (key, value) 
                    VALUES ('versus_mode', '1'),
                    ('debug_enabled', 'false')''')
        
        conn.commit()


@app.route('/api/sensor_status')
def sensor_status():
    try:
        global previous_active_sensors
        with open('sensor_data.json', 'r') as f:
            data = json.load(f)
        
        # Procesar activaciones
        if set(data['active_sensors']) != set(previous_active_sensors):
            register_sensor_activity(data['active_sensors'], previous_active_sensors)
            previous_active_sensors = data['active_sensors'].copy()
        
        return jsonify(data)
    except Exception as e:
        print(f"Error leyendo sensor_data.json: {str(e)}")
        return jsonify({
            'error': str(e),
            'active_sensors': [],
            'status': {}
        }), 500

        
@app.route('/api/dashboard-stats')
def get_dashboard_stats():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            
            # Total activaciones
            c.execute('SELECT COUNT(*) FROM activaciones')
            total_activaciones = c.fetchone()[0]
            
            # Total versus
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
            
            return jsonify({
                'total_activations': total_activaciones,
                'total_versus': total_versus,
                'most_popular_sensor': most_popular[0] if most_popular else None,
                'hourly_stats': [0] * 24  # Placeholder para estadísticas por hora
            })
    except Exception as e:
        print(f"Error en dashboard stats: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/sensor-names')
def get_sensor_names():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT pin, nombre FROM etiquetas_sensores')
            nombres = dict(c.fetchall())
            return jsonify(nombres)
    except Exception as e:
        return jsonify({'error': str(e)}), 500  


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


@app.route('/api/upload_background', methods=['POST'])
@login_required
def upload_background_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No se encontró archivo de video'}), 400
    
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó ningún archivo'}), 400

    if file:
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
    
    return jsonify({'error': 'Error al procesar el archivo'}), 400

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
        print(f"Error en toggle_debug: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/system-config')
def get_system_config():
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT key, value FROM system_config')
            config = dict(c.fetchall())
            return jsonify(config)
    except Exception as e:
        print(f"Error en system_config: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/remove_background/<int:video_id>', methods=['DELETE'])
@login_required
def remove_background_video(video_id):
    try:
        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            # Obtener la ruta del video
            c.execute('SELECT video_path FROM background_videos WHERE id = ?', (video_id,))
            result = c.fetchone()
            
            if result:
                video_path = os.path.join(app.config['UPLOAD_FOLDER'], 
                                        os.path.basename(result[0]))
                # Eliminar archivo si existe
                if os.path.exists(video_path):
                    os.remove(video_path)
                    
                # Eliminar registro de la base de datos
                c.execute('DELETE FROM background_videos WHERE id = ?', (video_id,))
                
                # Reordenar videos restantes
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
        
    except Exception as e:
        print(f"Error al eliminar video de fondo: {str(e)}")
        return jsonify({'error': str(e)}), 500
    


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
        period = request.args.get('period', 'month')
        date_from = request.args.get('from')
        date_to = request.args.get('to')

        # Construir query base
        date_filter = ''
        if period == 'today':
            date_filter = 'WHERE DATE(timestamp) = DATE("now")'
        elif period == 'week':
            date_filter = 'WHERE timestamp >= datetime("now", "-7 days")'
        elif period == 'month':
            date_filter = 'WHERE timestamp >= datetime("now", "-1 month")'
        elif date_from and date_to:
            date_filter = f'WHERE DATE(timestamp) BETWEEN "{date_from}" AND "{date_to}"'

        with sqlite3.connect('vitrina.db') as conn:
            c = conn.cursor()
            
            # Estadísticas generales
            c.execute(f'SELECT COUNT(*) FROM activaciones {date_filter}')
            total_activations = c.fetchone()[0]
            
            c.execute(f'SELECT COUNT(*) FROM versus {date_filter}')
            total_versus = c.fetchone()[0]
            
            # Producto más popular
            c.execute(f'''
                SELECT a.sensor_id, es.nombre, COUNT(*) as count 
                FROM activaciones a
                JOIN etiquetas_sensores es ON a.sensor_id = es.pin
                {date_filter}
                GROUP BY a.sensor_id 
                ORDER BY count DESC 
                LIMIT 1
            ''')
            most_popular = c.fetchone()
            
            # Estadísticas por producto
            c.execute(f'''
                SELECT a.sensor_id, es.nombre, COUNT(*) as count 
                FROM activaciones a
                JOIN etiquetas_sensores es ON a.sensor_id = es.pin
                {date_filter}
                GROUP BY a.sensor_id
            ''')
            product_stats = [{
                'sensor_id': row[0],
                'name': row[1],
                'activations': row[2]
            } for row in c.fetchall()]
            
            # Actividad por hora
            c.execute(f'''
                SELECT strftime('%H', timestamp) as hour, COUNT(*) 
                FROM activaciones 
                {date_filter}
                GROUP BY hour
            ''')
            hourly_data = dict(c.fetchall())
            hourly_stats = [int(hourly_data.get(str(h).zfill(2), 0)) for h in range(24)]
            
            return jsonify({
                'total_activations': total_activations,
                'total_versus': total_versus,
                'most_popular_product': most_popular[1] if most_popular else None,
                'product_stats': product_stats,
                'hourly_stats': hourly_stats
            })
            
    except Exception as e:
        print(f"Error en stats: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
    
@app.route('/api/sensor_video/<int:sensor_id>', methods=['DELETE'])
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
        return jsonify({'error': str(e)}), 500
 
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
            content_type = 'video' if filename.endswith(('.mp4','.webm','.mov')) else 'image'
            c.execute('''INSERT INTO extra_content 
                        (content_path, position, content_type) 
                        VALUES (?, ?, ?)''',
                     (os.path.join('videos', filename), position, content_type))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e:
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
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    init_db()
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(host='0.0.0.0', port=5000, debug=True)