from flask import Flask, render_template, jsonify, request, session, redirect, url_for, Response, send_file
import RPi.GPIO as GPIO
import sqlite3
import os
from datetime import datetime, timedelta, time
from functools import wraps
import time
import csv
from io import StringIO, BytesIO
from werkzeug.utils import secure_filename
import functools
import psutil
import subprocess
import pandas as pd
import json
import pytz
import logging


logging.basicConfig(level=logging.INFO)


app = Flask(__name__)
app.secret_key = 'admin'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

santiago_tz = pytz.timezone('America/Santiago')

# Configuración
UPLOAD_FOLDER = '/home/pi/vitrina/static/videos'
ALLOWED_EXTENSIONS = {'mp4', 'webm', 'mov'}
SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19]

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Variables globales
previous_active_sensors = []
current_mode = 1  # Valor por defecto

def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    for pin in SENSOR_PINS:
        GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

def get_db_connection():
    try:
        conn = sqlite3.connect('/home/pi/vitrina/vitrina.db')
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"Error al conectar con la base de datos: {e}")
        raise

def init_db():
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
        
        
        # Agregar columnas a activaciones solo si no existen
        try:
            c.execute("SELECT start_time FROM activaciones LIMIT 1")
        except sqlite3.OperationalError:
            c.execute('ALTER TABLE activaciones ADD COLUMN start_time DATETIME')
            
        try:
            c.execute("SELECT end_time FROM activaciones LIMIT 1")
        except sqlite3.OperationalError:
            c.execute('ALTER TABLE activaciones ADD COLUMN end_time DATETIME')
            
        try:
            c.execute("SELECT video_path FROM activaciones LIMIT 1")
        except sqlite3.OperationalError:
            c.execute('ALTER TABLE activaciones ADD COLUMN video_path TEXT')

        # Vista de activaciones
        c.execute('DROP VIEW IF EXISTS v_activaciones')
        c.execute('''CREATE VIEW v_activaciones AS
            SELECT 
                a.*,
                es.nombre_fantasia,
                sv.video_path,
                ROUND(CAST((strftime('%s', end_time) - strftime('%s', start_time)) AS FLOAT), 2) as duration_seconds
            FROM activaciones a
            LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
            LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
        ''')
        c.execute('''CREATE TABLE IF NOT EXISTS video_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sensor_id INTEGER,
                    video_path TEXT,
                    start_date DATETIME,
                    end_date DATETIME,
                    total_activations INTEGER,
                    total_duration INTEGER,
                    avg_view_time FLOAT
                )''')
        c.execute('''CREATE TABLE IF NOT EXISTS sensor_stats_hourly (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sensor_id INTEGER,
                    hour INTEGER,
                    date DATE,
                    total_activations INTEGER,
                    avg_duration FLOAT,
                    peak_hour BOOLEAN DEFAULT 0,
                    UNIQUE(sensor_id, hour, date)
                )''')
        c.execute('''CREATE TABLE IF NOT EXISTS metrics_daily (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE,
                sensor_id INTEGER,
                total_activations INTEGER,
                total_duration INTEGER,
                avg_duration FLOAT,
                peak_hour INTEGER,
                peak_hour_activations INTEGER,
                completion_rate FLOAT,
                video_path TEXT,
                UNIQUE(date, sensor_id)
            )''')
        

        # Verificar y agregar columnas si no existen
        try:
            c.execute("SELECT duration FROM activaciones LIMIT 1")
        except sqlite3.OperationalError:
            c.execute('ALTER TABLE activaciones ADD COLUMN duration INTEGER DEFAULT 0')
            print("Columna duration agregada a activaciones")

        try:
            c.execute("SELECT completed FROM activaciones LIMIT 1")
        except sqlite3.OperationalError:
            c.execute('ALTER TABLE activaciones ADD COLUMN completed BOOLEAN DEFAULT 0')
            print("Columna completed agregada a activaciones")

        # Configuración inicial
        c.execute('''INSERT OR IGNORE INTO system_config (key, value) 
                 VALUES 
                 ('versus_mode', '1'),
                 ('debug_enabled', 'false')''')
        
        # Insertar nombres predeterminados de sensores
        for pin, nombre in sensor_mapping.items():
            c.execute('''INSERT OR IGNORE INTO etiquetas_sensores 
                        (gpio_pin, sensor_numero) 
                        VALUES (?, ?)''', (pin, nombre))

        # Tabla de activaciones
        c.execute('''CREATE TABLE IF NOT EXISTS activaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_id INTEGER,
            timestamp DATETIME,
            start_time DATETIME,
            end_time DATETIME,
            duration INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT 0,
            video_path TEXT
        )''')
        
        # Tabla de métricas diarias
        c.execute('''CREATE TABLE IF NOT EXISTS metrics_daily (
            date TEXT PRIMARY KEY,
            total_activations INTEGER,
            sensor_data TEXT
        )''')
        
        # Tabla de estadísticas por hora
        c.execute('''CREATE TABLE IF NOT EXISTS sensor_stats_hourly (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_id INTEGER,
            hour INTEGER,
            date DATE,
            total_activations INTEGER,
            avg_duration FLOAT,
            peak_hour BOOLEAN DEFAULT 0,
            UNIQUE(sensor_id, hour, date)
        )''')
        
        # Vista de activaciones
        c.execute('DROP VIEW IF EXISTS v_activaciones')
        c.execute('''CREATE VIEW v_activaciones AS
            SELECT 
                a.*,
                es.nombre_fantasia,
                sv.video_path,
                ROUND(CAST((strftime('%s', end_time) - strftime('%s', start_time)) AS FLOAT), 2) as duration_seconds
            FROM activaciones a
            LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
            LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
        ''')


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
        conn = sqlite3.connect('/home/pi/vitrina/vitrina.db')
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

# para exportar estadisticas

@app.route('/api/download-stats')
def download_stats():
    try:
        from_date = request.args.get('from')
        to_date = request.args.get('to')
        
        conn = get_db_connection()
        cursor = conn.cursor()

        # Mapeo de GPIO a números de fantasía
        gpio_to_fantasy = {
            '27': '1', '17': '2', '5': '3', '6': '4',
            '13': '5', '18': '6', '23': '7', '24': '8'
        }

        # Consulta para obtener las activaciones con información completa del sensor
        query_activaciones = """
        SELECT 
            a.sensor_id,
            datetime(a.timestamp, 'localtime') as timestamp,
            s.nombre_fantasia,
            sv.video_path
        FROM activaciones a
        LEFT JOIN sensores s ON a.sensor_id = s.gpio_pin
        LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
        WHERE a.timestamp BETWEEN ? AND ?
        ORDER BY a.timestamp DESC
        """
        
        cursor.execute(query_activaciones, (from_date, to_date))
        results = cursor.fetchall()

        # Crear DataFrame principal
        df = pd.DataFrame(results, columns=['Sensor GPIO', 'Fecha/Hora', 'Nombre Fantasia', 'Video Path'])
        
        # Función para obtener el nombre del sensor
        def get_sensor_name(row):
            gpio_str = str(row['Sensor GPIO'])
            fantasy_num = gpio_to_fantasy.get(gpio_str, gpio_str)
            
            # Primero intentar usar el nombre de fantasía del sensor
            nombre = row['Nombre Fantasia']
            
            # Si no hay nombre de fantasía, intentar usar el nombre del video
            if pd.isna(nombre) or nombre == '':
                video_path = row['Video Path']
                if pd.notna(video_path) and video_path:
                    # Extraer el nombre del archivo sin la extensión
                    video_name = video_path.split('/')[-1]
                    nombre = video_name.rsplit('.', 1)[0]  # Eliminar la extensión .mp4
            
            # Si aún no hay nombre, usar solo el número del sensor
            if pd.isna(nombre) or nombre == '':
                return f"Sensor {fantasy_num}"
            
            return f"Sensor {fantasy_num} - {nombre}"

        # Aplicar la función para obtener el nombre del sensor
        df['Sensor'] = df.apply(get_sensor_name, axis=1)
        
        # Convertir la columna de fecha explícitamente
        df['Fecha/Hora'] = pd.to_datetime(df['Fecha/Hora'], format='%Y-%m-%d %H:%M:%S', errors='coerce')
        
        # Crear resumen por sensor
        resumen_sensor = df.groupby(['Sensor']).agg({
            'Fecha/Hora': [
                ('Total Activaciones', 'count'),
                ('Primera Activación', 'min'),
                ('Última Activación', 'max')
            ]
        }).reset_index()
        
        # Aplanar las columnas multiíndice
        resumen_sensor.columns = ['Sensor', 'Total Activaciones', 'Primera Activación', 'Última Activación']
        
        # Formatear las fechas después de los cálculos
        df['Fecha/Hora'] = df['Fecha/Hora'].dt.strftime('%d/%m/%Y %H:%M:%S')
        resumen_sensor['Primera Activación'] = pd.to_datetime(resumen_sensor['Primera Activación']).dt.strftime('%d/%m/%Y %H:%M:%S')
        resumen_sensor['Última Activación'] = pd.to_datetime(resumen_sensor['Última Activación']).dt.strftime('%d/%m/%Y %H:%M:%S')
        
        resumen_sensor = resumen_sensor.sort_values('Total Activaciones', ascending=False)

        # Crear Excel con formato
        output = BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            workbook = writer.book
            
            # Formato para títulos
            title_format = workbook.add_format({
                'bold': True,
                'font_size': 14,
                'align': 'center',
                'valign': 'vcenter',
                'bg_color': '#2c3e50',
                'font_color': 'white'
            })
            
            # Formato para encabezados
            header_format = workbook.add_format({
                'bold': True,
                'bg_color': '#34495e',
                'font_color': 'white',
                'border': 1
            })

            # Formato para datos
            data_format = workbook.add_format({
                'align': 'center',
                'border': 1
            })

            # Hoja de Resumen
            worksheet_resumen = workbook.add_worksheet('Resumen')
            
            # Título del reporte
            periodo = f"Período: {pd.to_datetime(from_date).strftime('%d/%m/%Y')} - {pd.to_datetime(to_date).strftime('%d/%m/%Y')}"
            worksheet_resumen.merge_range('A1:D1', 'REPORTE DE ACTIVACIONES VITRINA DIGITAL', title_format)
            worksheet_resumen.merge_range('A2:D2', periodo, header_format)
            
            # Estadísticas generales
            worksheet_resumen.write('A4', 'Estadísticas Generales', header_format)
            worksheet_resumen.write('A5', 'Total Activaciones:', data_format)
            worksheet_resumen.write('B5', len(df), data_format)
            
            # Sensor más activo
            if not resumen_sensor.empty:
                sensor_mas_activo = resumen_sensor.iloc[0]
                worksheet_resumen.write('A7', 'Sensor Más Activo:', header_format)
                worksheet_resumen.write('B7', sensor_mas_activo['Sensor'], data_format)
                worksheet_resumen.write('A8', 'Activaciones:', data_format)
                worksheet_resumen.write('B8', sensor_mas_activo['Total Activaciones'], data_format)

            # Guardar los DataFrames
            df[['Sensor', 'Fecha/Hora']].to_excel(
                writer, 
                sheet_name='Activaciones Detalle', 
                index=False,
                startrow=1
            )
            
            resumen_sensor[['Sensor', 'Total Activaciones', 'Primera Activación', 'Última Activación']].to_excel(
                writer, 
                sheet_name='Resumen por Sensor', 
                index=False,
                startrow=1
            )

            # Ajustar columnas en todas las hojas
            for worksheet in writer.sheets.values():
                worksheet.set_column('A:Z', 15)

        output.seek(0)

        # Nombre del archivo con timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'estadisticas_vitrina_{timestamp}.xlsx'

        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename
        )

    except Exception as e:
        print(f"Error en download_stats: {str(e)}")
        return jsonify({
            'error': 'Error al generar el archivo de estadísticas',
            'details': str(e)
        }), 500
    finally:
        if 'conn' in locals():
            conn.close()

@app.route('/api/export-stats')
@login_required
def export_stats():
    try:
        from_date = request.args.get('from', '')
        to_date = request.args.get('to', '')
        format = request.args.get('format', 'csv')
        
        if not from_date or not to_date:
            today = datetime.now()
            from_date = today.replace(hour=0, minute=0, second=0).strftime('%Y-%m-%d %H:%M:%S')
            to_date = today.replace(hour=23, minute=59, second=59).strftime('%Y-%m-%d %H:%M:%S')
        
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            query = '''
                SELECT 
                    es.sensor_numero,
                    es.nombre_fantasia,
                    a.timestamp,
                    a.start_time,
                    a.end_time,
                    ROUND(CAST(a.duration AS FLOAT) / 1000, 2) as duracion_segundos,
                    a.completed,
                    sv.video_path,
                    date(a.timestamp) as fecha,
                    time(a.timestamp) as hora
                FROM activaciones a
                LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
                LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
                WHERE a.timestamp BETWEEN ? AND ?
                ORDER BY a.timestamp DESC
            '''
            
            df = pd.read_sql_query(query, conn, params=(from_date, to_date))
            
            filename = f'estadisticas_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
            
            if format == 'excel':
                output = BytesIO()
                with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                    df.to_excel(writer, sheet_name='Activaciones', index=False)
                    workbook = writer.book
                    worksheet = writer.sheets['Activaciones']
                    
                    header_format = workbook.add_format({
                        'bold': True,
                        'bg_color': '#0066cc',
                        'color': 'white'
                    })
                    
                    for col_num, value in enumerate(df.columns.values):
                        worksheet.write(0, col_num, value, header_format)
                        worksheet.set_column(col_num, col_num, 15)
                
                output.seek(0)
                return send_file(
                    output,
                    mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    as_attachment=True,
                    download_name=f'{filename}.xlsx'
                )
            
            output = StringIO()
            df.to_csv(output, index=False)
            return Response(
                output.getvalue(),
                mimetype='text/csv',
                headers={
                    'Content-Disposition': f'attachment; filename={filename}.csv'
                }
            )
            
    except Exception as e:
        app.logger.error(f"Error exportando estadísticas: {str(e)}")
        return jsonify({'error': str(e)}), 500



def update_hourly_stats():
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
        c = conn.cursor()
        today = datetime.now().date()
        
        # Calcular estadísticas por hora para el día actual
        c.execute('''
            INSERT OR REPLACE INTO sensor_stats_hourly 
            (sensor_id, hour, date, total_activations, avg_duration)
            SELECT 
                sensor_id,
                CAST(strftime('%H', timestamp) AS INTEGER) as hour,
                date(timestamp) as date,
                COUNT(*) as total_activations,
                AVG(CASE WHEN duration > 0 
                    THEN CAST(duration AS FLOAT) / 1000 
                    ELSE NULL END) as avg_duration
            FROM activaciones
            WHERE date(timestamp) = date('now')
            GROUP BY sensor_id, hour, date(timestamp)
        ''')
        
        # Marcar horas pico
        c.execute('''
            WITH HourlyRank AS (
                SELECT 
                    *,
                    RANK() OVER (PARTITION BY sensor_id, date 
                               ORDER BY total_activations DESC) as rank
                FROM sensor_stats_hourly
                WHERE date = ?
            )
            UPDATE sensor_stats_hourly 
            SET peak_hour = (
                SELECT CASE WHEN rank = 1 THEN 1 ELSE 0 END 
                FROM HourlyRank hr 
                WHERE hr.sensor_id = sensor_stats_hourly.sensor_id
                AND hr.hour = sensor_stats_hourly.hour
                AND hr.date = sensor_stats_hourly.date
            )
            WHERE date = ?
        ''', (today, today))
        
        conn.commit()

@app.route('/api/hourly-analysis')
@login_required
def get_hourly_analysis():
    try:
        date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
        
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Análisis por hora
            c.execute('''
                SELECT 
                    s.hour,
                    s.sensor_id,
                    es.nombre_fantasia,
                    s.total_activations,
                    s.avg_duration,
                    s.peak_hour
                FROM sensor_stats_hourly s
                LEFT JOIN etiquetas_sensores es ON s.sensor_id = es.gpio_pin
                WHERE s.date = ?
                ORDER BY s.hour, s.total_activations DESC
            ''', (date,))
            
            hourly_stats = {}
            for row in c.fetchall():
                hour = f"{row[0]:02d}:00"
                if hour not in hourly_stats:
                    hourly_stats[hour] = []
                    
                hourly_stats[hour].append({
                    'sensor_id': row[1],
                    'nombre': row[2] or f'Sensor {row[1]}',
                    'activaciones': row[3],
                    'duracion_promedio': round(row[4] or 0, 2),
                    'hora_pico': bool(row[5])
                })
            
            return jsonify({
                'date': date,
                'hourly_stats': hourly_stats
            })
            
    except Exception as e:
        app.logger.error(f"Error en análisis horario: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
def update_daily_metrics():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Crear tabla si no existe
            c.execute('''CREATE TABLE IF NOT EXISTS metrics_daily
                        (date TEXT PRIMARY KEY,
                         total_activations INTEGER,
                         sensor_data TEXT)''')
            
            # Obtener fecha actual en Santiago
            santiago_tz = pytz.timezone('America/Santiago')
            today = datetime.now(santiago_tz).strftime('%Y-%m-%d')
            
            # Calcular métricas del día
            c.execute('''
                SELECT sensor_id, COUNT(*) as count
                FROM activaciones
                WHERE date(timestamp) = date(?)
                AND completed = 1
                GROUP BY sensor_id
            ''', (today,))
            
            sensor_data = dict(c.fetchall())
            total_activations = sum(sensor_data.values())
            
            # Actualizar o insertar métricas
            c.execute('''
                INSERT OR REPLACE INTO metrics_daily (date, total_activations, sensor_data)
                VALUES (?, ?, ?)
            ''', (today, total_activations, json.dumps(sensor_data)))
            
            conn.commit()
            
    except Exception as e:
        app.logger.error(f"Error updating daily metrics: {str(e)}")


@app.route('/api/metrics/daily-summary', methods=['GET'])
@login_required
def get_daily_metrics_summary():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            today = datetime.now().date()
            
            # Calcular métricas diarias
            c.execute('''
                INSERT OR REPLACE INTO metrics_daily 
                (date, sensor_id, total_activations, total_duration, avg_duration, 
                 peak_hour, peak_hour_activations, completion_rate, video_path)
                SELECT 
                    DATE(a.timestamp) as date,
                    a.sensor_id,
                    COUNT(*) as total_activations,
                    SUM(duration) as total_duration,
                    AVG(CASE WHEN duration > 0 THEN duration ELSE NULL END) as avg_duration,
                    CAST(strftime('%H', timestamp) as INTEGER) as peak_hour,
                    MAX(hourly_counts.count) as peak_activations,
                    ROUND(CAST(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as FLOAT) / 
                          COUNT(*) * 100, 2) as completion_rate,
                    sv.video_path
                FROM activaciones a
                LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
                LEFT JOIN (
                    SELECT 
                        sensor_id,
                        strftime('%H', timestamp) as hour,
                        COUNT(*) as count
                    FROM activaciones
                    WHERE DATE(timestamp) = ?
                    GROUP BY sensor_id, hour
                ) hourly_counts ON a.sensor_id = hourly_counts.sensor_id
                WHERE DATE(a.timestamp) = ?
                GROUP BY DATE(a.timestamp), a.sensor_id
            ''', (today, today))
            
            # Obtener resumen del día
            c.execute('''
                SELECT 
                    m.*,
                    es.nombre_fantasia,
                    es.sensor_numero
                FROM metrics_daily m
                LEFT JOIN etiquetas_sensores es ON m.sensor_id = es.gpio_pin
                WHERE m.date = ?
                ORDER BY m.total_activations DESC
            ''', (today,))
            
            columns = [col[0] for col in c.description]
            metrics = [dict(zip(columns, row)) for row in c.fetchall()]
            
            # Calcular tendencias comparando con día anterior
            c.execute('''
                WITH YesterdayMetrics AS (
                    SELECT sensor_id, total_activations
                    FROM metrics_daily
                    WHERE date = date('now', '-1 day')
                )
                SELECT 
                    m.sensor_id,
                    ROUND(((m.total_activations - COALESCE(y.total_activations, 0)) * 100.0) / 
                          NULLIF(y.total_activations, 0), 2) as trend
                FROM metrics_daily m
                LEFT JOIN YesterdayMetrics y ON m.sensor_id = y.sensor_id
                WHERE m.date = date('now')
            ''')
            
            trends = {row[0]: row[1] for row in c.fetchall()}
            
            for metric in metrics:
                metric['trend'] = trends.get(metric['sensor_id'], 0)
            
            return jsonify({
                'date': today.strftime('%Y-%m-%d'),
                'metrics': metrics
            })
            
    except Exception as e:
        app.logger.error(f"Error obteniendo métricas diarias: {str(e)}")
        return jsonify({'error': str(e)}), 500

def load_system_config():
    global current_mode
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT value FROM system_config WHERE key = ?', ('versus_mode',))
            result = c.fetchone()
            if result:
                current_mode = int(result[0])
    except Exception as e:
        print(f"Error al cargar configuración: {str(e)}")

@app.route('/api/detailed-report')
@login_required
def get_detailed_report():
    try:
        from_date = request.args.get('from', '')
        to_date = request.args.get('to', '')
        
        if not from_date or not to_date:
            today = datetime.now()
            from_date = today.replace(hour=0, minute=0, second=0).strftime('%Y-%m-%d %H:%M:%S')
            to_date = today.replace(hour=23, minute=59, second=59).strftime('%Y-%m-%d %H:%M:%S')
            
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Estadísticas por hora
            c.execute('''
                SELECT 
                    strftime('%H', timestamp) as hora,
                    COUNT(*) as total_activaciones,
                    ROUND(AVG(CASE WHEN duration > 0 
                        THEN CAST(duration AS FLOAT) / 1000 
                        ELSE NULL END), 2) as duracion_promedio
                FROM activaciones
                WHERE timestamp BETWEEN ? AND ?
                GROUP BY hora
                ORDER BY hora
            ''', (from_date, to_date))
            
            stats_por_hora = [{
                'hora': f"{int(row[0]):02d}:00",
                'activaciones': row[1],
                'duracion_promedio': row[2] or 0
            } for row in c.fetchall()]
            
            return jsonify({
                'stats_por_hora': stats_por_hora,
                'periodo': {
                    'desde': from_date,
                    'hasta': to_date
                }
            })
            
    except Exception as e:
        app.logger.error(f"Error en reporte detallado: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/register_activation', methods=['POST'])
def register_activation():
    try:
        data = request.get_json()
        sensor_id = data.get('sensor_id')
        duration = data.get('duration', 0)
        completed = data.get('completed', False)
        
        if not sensor_id:
            return jsonify({'error': 'sensor_id es requerido'}), 400

        # Obtener el video_path asociado al sensor
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT video_path FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
            result = c.fetchone()
            video_path = result[0] if result else None

            # Registrar la activación
            current_time = datetime.now(santiago_tz)
            c.execute('''
                INSERT INTO activaciones 
                (sensor_id, timestamp, start_time, end_time, duration, completed, video_path)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                sensor_id,
                current_time,
                current_time - timedelta(milliseconds=duration),
                current_time,
                duration,
                completed,
                video_path
            ))
            conn.commit()

        return jsonify({'success': True, 'message': 'Activación registrada correctamente'})
    
    except Exception as e:
        logging.error(f"Error en register_activation: {str(e)}")
        return jsonify({'error': str(e)}), 500

def register_video_change(sensor_id, old_video, new_video):
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
        c = conn.cursor()
        current_time = datetime.now()
        
        # Cerrar registro anterior
        if old_video:
            c.execute('''
                UPDATE video_history 
                SET end_date = ?,
                    total_activations = (
                        SELECT COUNT(*) FROM activaciones 
                        WHERE sensor_id = ? AND completed = 1
                        AND timestamp BETWEEN start_date AND ?
                    )
                WHERE sensor_id = ? AND end_date IS NULL
            ''', (current_time, sensor_id, current_time, sensor_id))
            
        # Crear nuevo registro
        c.execute('''
            INSERT INTO video_history (sensor_id, video_path, start_date)
            VALUES (?, ?, ?)
        ''', (sensor_id, new_video, current_time))
        conn.commit()

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

@app.route('/api/metrics')
@login_required
def get_detailed_metrics():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Métricas por video
            c.execute('''
                SELECT 
                    vh.video_path,
                    COUNT(DISTINCT vh.sensor_id) as total_sensors,
                    SUM(vh.total_activations) as total_views,
                    AVG(vh.avg_view_time) as avg_view_duration,
                    MIN(vh.start_date) as first_use,
                    MAX(vh.end_date) as last_use
                FROM video_history vh
                GROUP BY vh.video_path
            ''')
            
            video_metrics = [{
                'video': row[0],
                'sensors': row[1],
                'views': row[2],
                'avg_duration': row[3],
                'period': f"{row[4]} - {row[5] or 'Actual'}"
            } for row in c.fetchall()]

            # Métricas por sensor
            c.execute('''
                SELECT 
                    es.nombre_fantasia,
                    COUNT(*) as total_activations,
                    AVG(duration_seconds) as avg_duration,
                    MAX(timestamp) as last_active,
                    COUNT(DISTINCT date(timestamp)) as active_days
                FROM v_activaciones
                LEFT JOIN etiquetas_sensores es ON sensor_id = es.gpio_pin
                WHERE completed = 1
                GROUP BY sensor_id
            ''')

            return jsonify({
                'video_metrics': video_metrics,
                'sensor_stats': cursor.fetchall()
            })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('logged_in', None)
    return jsonify({'success': True})

def update_sensor_name():
    try:
        data = request.get_json()
        sensor_id = data.get('sensor_id')
        new_name = data.get('new_name')
        
        if not sensor_id or new_name is None:
            return jsonify({'error': 'Se requiere sensor_id y new_name'}), 400
            
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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


@app.route('/api/remove_sensor_video/<int:sensor_id>', methods=['DELETE', 'POST'])
@login_required
def remove_sensor_video(sensor_id):
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
#@login_required
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
        
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            # Obtener el máximo orden actual
            c.execute('SELECT MAX(orden) FROM background_videos')
            max_orden = c.fetchone()[0] or 0
            
            # Insertar el nuevo video
            c.execute('INSERT INTO background_videos (video_path, orden) VALUES (?, ?)',
                     (os.path.join('videos', filename), max_orden + 1))
            inserted_id = c.lastrowid 
            conn.commit()

        return jsonify({'success': True, 'id': inserted_id})
    except Exception as e:
        app.logger.error(f"Error subiendo video de fondo: {str(e)}")
        return jsonify({'error': str(e)}), 500

    
@app.route('/api/remove_background/<int:video_id>', methods=['DELETE'])
#@login_required
def remove_background_video(video_id):
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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


@app.route('/api/check_activaciones')
@login_required
def check_activaciones():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Obtener las últimas 50 activaciones
            c.execute('''
                SELECT 
                    a.id,
                    a.sensor_id,
                    es.nombre_fantasia,
                    a.timestamp,
                    a.completed
                FROM activaciones a
                LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
                ORDER BY a.timestamp DESC
                LIMIT 50
            ''')
            
            activaciones = [{
                'id': row[0],
                'sensor_id': row[1],
                'nombre': row[2] or f'Sensor {row[1]}',
                'timestamp': row[3],
                'completed': row[4]
            } for row in c.fetchall()]
            
            return jsonify({
                'total': len(activaciones),
                'activaciones': activaciones
            })
            
    except Exception as e:
        app.logger.error(f"Error checking activaciones: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/etiquetas-sensores', methods=['GET'])
def obtener_etiquetas_sensores():
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
# @login_required
def actualizar_etiqueta_sensor():
    datos = request.json
    gpio_pin = datos.get('gpio_pin')
    nombre_fantasia = datos.get('nombre_fantasia')
    if not gpio_pin:
        return jsonify({'error': 'Falta el número de GPIO'}), 400
        
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            UPDATE etiquetas_sensores 
            SET nombre_fantasia = ?
            WHERE gpio_pin = ?
        ''', (nombre_fantasia, gpio_pin))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/background_videos')
def get_background_videos():
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
# @login_required   
def upload_video():
    try:
        if 'video' not in request.files:
            return jsonify({'error': 'No video file in request'}), 400
            
        file = request.files['video']
        sensor_id = request.form.get('sensor_id')
        
        if not sensor_id:
            return jsonify({'error': 'Sensor ID is required'}), 400
            
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
            
        if file:
            # Asegurarse de que el directorio existe
            os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
            
            # Asegurar el nombre del archivo
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            
            # Simplemente sobrescribir el archivo si existe
            file.save(filepath)
            
            # Actualizar la base de datos
            with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
                c = conn.cursor()
                
                # Actualizar o insertar el nuevo video
                video_path = os.path.join('videos', filename)
                c.execute('''INSERT OR REPLACE INTO sensor_videos (sensor_id, video_path) 
                           VALUES (?, ?)''', (sensor_id, video_path))
                
                conn.commit()
                
            return jsonify({
                'success': True,
                'message': 'Video uploaded successfully',
                'video_path': video_path
            })
            
    except Exception as e:
        app.logger.error(f"Error in upload_video: {str(e)}")
        return jsonify({
            'error': f'Error uploading video: {str(e)}'
        }), 500

    return jsonify({'error': 'Unknown error occurred'}), 500
@app.route('/api/update_versus_mode', methods=['POST'])
@login_required
def update_versus_mode():
    try:
        data = request.get_json()
        mode = data.get('mode')
        
        if mode is None:
            return jsonify({'error': 'Mode is required'}), 400

        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('UPDATE system_config SET value = ? WHERE key = ?', 
                     (str(mode), 'versus_mode'))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Error updating versus mode: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/get-current-mode')
def get_current_mode():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT value FROM system_config WHERE key = ?', ('versus_mode',))
            result = c.fetchone()
            mode = int(result[0]) if result else current_mode
            return jsonify({'mode': mode})
    except Exception as e:
        print(f"Error al obtener modo actual: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/reset_stats', methods=['POST'])
@login_required
def reset_stats():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            # Limpiar tabla de activaciones
            c.execute('DELETE FROM activaciones')
            # Limpiar tabla de versus
            c.execute('DELETE FROM versus')
            conn.commit()
            
        return jsonify({
            'success': True, 
            'message': 'Estadísticas reiniciadas correctamente'
        })
    
    
    except Exception as e:
        app.logger.error(f"Error resetting stats: {str(e)}")
        return jsonify({
            'success': False, 
            'error': str(e)
        }), 500


@app.route('/api/system-config')
def get_system_config():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT key, value FROM system_config')
            config = dict(c.fetchall())
            app.logger.info(f"Configuración actual del sistema: {config}")
            return jsonify(config)
    except Exception as e:
        app.logger.error(f"Error en system_config: {str(e)}")
        return jsonify({'error': 'Error al obtener configuración'}), 500

@app.route('/api/update-sensor-name', methods=['POST'])
@login_required
def update_sensor_name():
    try:
        data = request.get_json()
        sensor_id = data.get('sensor_id')
        new_name = data.get('name')
        
        if not sensor_id or not new_name:
            return jsonify({'error': 'Faltan datos requeridos'}), 400
            
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''
                UPDATE etiquetas_sensores 
                SET nombre_fantasia = ? 
                WHERE gpio_pin = ?
            ''', (new_name, sensor_id))
            conn.commit()
            
        app.logger.info(f"Nombre de sensor actualizado: {sensor_id} -> {new_name}")
        return jsonify({'success': True, 'message': 'Nombre actualizado correctamente'})
        
    except Exception as e:
        app.logger.error(f"Error al actualizar nombre del sensor: {str(e)}")
        return jsonify({'error': str(e)}), 500

def handleSensorChange(activeSensors):
    if isTransitioning:
        return

    try:
        register_sensor_activity(activeSensors, lastActiveSensors)
    except Exception as e:
        print(f"Error registering activity: {e}")



@app.route('/api/stats')
@login_required
def get_stats():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Obtener fecha actual en Santiago
            today = datetime.now(santiago_tz).strftime('%Y-%m-%d')
            
            # Obtener total de activaciones
            c.execute('SELECT COUNT(*) FROM activaciones WHERE completed = 1')
            total_activations = c.fetchone()[0]
            
            # Obtener activaciones de hoy
            c.execute('SELECT COUNT(*) FROM activaciones WHERE date(timestamp) = ? AND completed = 1', (today,))
            today_activations = c.fetchone()[0]
            
            # Obtener activaciones por sensor
            c.execute('''
                SELECT sensor_id, COUNT(*) as count
                FROM activaciones
                WHERE completed = 1
                GROUP BY sensor_id
            ''')
            sensor_data = dict(c.fetchall())
            
            # Obtener activaciones por día (últimos 7 días)
            c.execute('''
                SELECT date(timestamp) as date, COUNT(*) as count
                FROM activaciones
                WHERE completed = 1
                AND date(timestamp) >= date('now', '-7 days')
                GROUP BY date(timestamp)
                ORDER BY date(timestamp)
            ''')
            daily_data = dict(c.fetchall())
            
            stats = {
                'total_activations': total_activations,
                'today_activations': today_activations,
                'sensor_data': sensor_data,
                'daily_data': daily_data
            }
            
            return jsonify({'success': True, 'stats': stats})
            
    except Exception as e:
        app.logger.error(f"Error getting stats: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/toggle-debug', methods=['POST'])
@login_required
def toggle_debug():
    try:
        data = request.json
        enabled = data.get('enabled', False)
        
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('UPDATE system_config SET value = ? WHERE key = ?', 
                     (str(enabled).lower(), 'debug_enabled'))
            conn.commit()
        
        return jsonify({'success': True, 'debug_enabled': enabled})
    except Exception as e:
        app.logger.error(f"Error en toggle_debug: {str(e)}")
        return jsonify({'error': str(e)}), 500


last_status_update = {}  # Variable global para trackear última actualización por sensor

@app.route('/api/public/sensor_videos')
def get_public_sensor_videos():
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
    
@app.route('/api/public/sensor_video/<int:sensor_id>')
def get_public_sensor_video(sensor_id):
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
        c = conn.cursor()
        c.execute('''
            SELECT sv.video_path, COALESCE(es.nombre_fantasia, es.sensor_numero) as nombre
            FROM sensor_videos sv 
            LEFT JOIN etiquetas_sensores es ON sv.sensor_id = es.gpio_pin 
            WHERE sv.sensor_id = ?
        ''', (sensor_id,))
        result = c.fetchone()
        return jsonify({
            'video_path': result[0] if result else None,
            'nombre': result[1] if result else None
        })

@app.route('/api/public/background_videos')
def get_public_background_videos():
    with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
        c = conn.cursor()
        c.execute('SELECT id, video_path, orden FROM background_videos ORDER BY orden')
        videos = [{'id': row[0], 'video_path': row[1], 'orden': row[2]} 
                 for row in c.fetchall()]
        return jsonify(videos)

@app.route('/api/move_background', methods=['POST'])
#@login_required
def move_background_video():
    try:
        data = request.json
        video_id = data.get('video_id')
        direction = data.get('direction')
        
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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

@app.route('/api/dashboard-stats', methods=['GET'])
@login_required
def get_dashboard_stats():
    try:
        from_date = request.args.get('from')
        to_date = request.args.get('to')
        
        if not from_date or not to_date:
            to_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')

        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            cursor = conn.cursor()

            # 1. Total activaciones en el período
            cursor.execute("""
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE timestamp BETWEEN ? AND ?
            """, (from_date, to_date))
            total_activaciones = cursor.fetchone()[0]

            # 2. Activaciones de hoy
            cursor.execute("""
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE date(timestamp) = date('now')
            """)
            activaciones_hoy = cursor.fetchone()[0]

            # 3. Activaciones última semana
            cursor.execute("""
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE timestamp >= datetime('now', '-7 days')
            """)
            activaciones_semana = cursor.fetchone()[0]

            # 4. Activaciones este mes
            cursor.execute("""
                SELECT COUNT(*) 
                FROM activaciones 
                WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
            """)
            activaciones_mes = cursor.fetchone()[0]

            # 5. Activaciones por sensor
            cursor.execute("""
                SELECT 
                    a.sensor_id,
                    s.nombre_fantasia,
                    sv.video_path,
                    COUNT(*) as total
                FROM activaciones a
                LEFT JOIN sensores s ON a.sensor_id = s.gpio_pin
                LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
                WHERE a.timestamp BETWEEN ? AND ?
                GROUP BY a.sensor_id, s.nombre_fantasia, sv.video_path
                ORDER BY total DESC
            """, (from_date, to_date))
            
            activaciones_por_sensor = []
            for row in cursor.fetchall():
                sensor_id, nombre_fantasia, video_path, total = row
                nombre_display = nombre_fantasia if nombre_fantasia else (
                    video_path.split('/')[-1].replace('.mp4', '') if video_path else f'Sensor {sensor_id}'
                )
                activaciones_por_sensor.append({
                    'sensor_id': sensor_id,
                    'nombre_fantasia': nombre_display,
                    'total': total
                })

            # 6. Activaciones por día
            cursor.execute("""
                SELECT 
                    date(timestamp) as fecha,
                    COUNT(*) as total
                FROM activaciones
                WHERE timestamp BETWEEN ? AND ?
                GROUP BY date(timestamp)
                ORDER BY fecha
            """, (from_date, to_date))
            
            activaciones_por_dia = [
                {'fecha': row[0], 'total': row[1]}
                for row in cursor.fetchall()
            ]

            # 7. Ranking de sensores (nuevo)
            cursor.execute("""
                SELECT 
                    a.sensor_id,
                    s.nombre_fantasia,
                    sv.video_path,
                    COUNT(*) as total,
                    MAX(datetime(a.timestamp, 'localtime')) as ultima_activacion
                FROM activaciones a
                LEFT JOIN sensores s ON a.sensor_id = s.gpio_pin
                LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
                WHERE a.timestamp BETWEEN ? AND ?
                GROUP BY a.sensor_id, s.nombre_fantasia, sv.video_path
                ORDER BY total DESC
                LIMIT 10
            """, (from_date, to_date))
            
            ranking = []
            for row in cursor.fetchall():
                sensor_id, nombre_fantasia, video_path, total, ultima_activacion = row
                nombre_display = nombre_fantasia if nombre_fantasia else (
                    video_path.split('/')[-1].replace('.mp4', '') if video_path else f'Sensor {sensor_id}'
                )
                ranking.append({
                    'nombre': nombre_display,
                    'total': total,
                    'ultima_activacion': ultima_activacion
                })

            # 8. Activaciones recientes (actualizado)
            cursor.execute("""
                SELECT 
                    a.sensor_id,
                    s.nombre_fantasia,
                    sv.video_path,
                    datetime(a.timestamp, 'localtime') as timestamp
                FROM activaciones a
                LEFT JOIN sensores s ON a.sensor_id = s.gpio_pin
                LEFT JOIN sensor_videos sv ON a.sensor_id = sv.sensor_id
                WHERE a.timestamp >= datetime('now', '-1 hour', 'localtime')
                ORDER BY a.timestamp DESC
                LIMIT 20
            """)

            activaciones_recientes = []
            for row in cursor.fetchall():
                sensor_id, nombre_fantasia, video_path, timestamp = row
                
                # Mapeo de GPIO a número de sensor
                gpio_to_sensor = {
                    '27': '1',
                    '17': '2',
                    '5': '3',
                    '6': '4',
                    '13': '5',
                    '18': '6',
                    '23': '7',
                    '24': '8'
                }
                
                sensor_numero = gpio_to_sensor.get(str(sensor_id), str(sensor_id))
                nombre_sensor = f'Sensor {sensor_numero}'
                
                # Obtener el nombre del producto desde nombre_fantasia o video_path
                producto_nombre = nombre_fantasia if nombre_fantasia else (
                    video_path.split('/')[-1].replace('.mp4', '') if video_path else 'Sin nombre'
                )
                
                activaciones_recientes.append({
                    'sensor': nombre_sensor,
                    'producto': producto_nombre,
                    'timestamp': timestamp
                })
                
        return jsonify({
            'total_activaciones': total_activaciones,
            'activaciones_hoy': activaciones_hoy,
            'activaciones_semana': activaciones_semana,
            'activaciones_mes': activaciones_mes,
            'activaciones_por_sensor': activaciones_por_sensor,
            'activaciones_por_dia': activaciones_por_dia,
            'ranking': ranking,
            'activaciones_recientes': activaciones_recientes
        })

    except Exception as e:
        print(f"Error en get_dashboard_stats: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/assignment-history')
@login_required
def get_assignment_history():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('''
                WITH RankedAssignments AS (
                    SELECT 
                        sv.sensor_id,
                        es.nombre_fantasia,
                        sv.video_path,
                        a.timestamp as start_date,
                        LEAD(a.timestamp) OVER (
                            PARTITION BY sv.sensor_id 
                            ORDER BY a.timestamp
                        ) as end_date,
                        COUNT(a.id) as total_activations
                    FROM sensor_videos sv
                    LEFT JOIN etiquetas_sensores es ON sv.sensor_id = es.gpio_pin
                    LEFT JOIN activaciones a ON sv.sensor_id = a.sensor_id
                    GROUP BY sv.sensor_id, sv.video_path
                    ORDER BY start_date DESC
                )
                SELECT * FROM RankedAssignments
                WHERE start_date IS NOT NULL
            ''')
            
            history = [{
                'sensor_id': row[0],
                'nombre': row[1],
                'video': row[2],
                'fecha_inicio': row[3],
                'fecha_fin': row[4] or 'Actual',
                'total_activaciones': row[5]
            } for row in c.fetchall()]
            
            return jsonify(history)
            
    except Exception as e:
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
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
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

@app.route('/api/activations')
@login_required
def get_activations():
    try:
        conn = sqlite3.connect('/home/pi/vitrina/vitrina.db')
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


@app.route('/api/recent-activations')
@login_required
def get_recent_activations():
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Obtener activaciones de la última hora
            one_hour_ago = (datetime.now() - timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
            
            c.execute('''
                SELECT 
                    a.sensor_id,
                    es.nombre_fantasia,
                    a.timestamp,
                    a.completed
                FROM activaciones a
                LEFT JOIN etiquetas_sensores es ON a.sensor_id = es.gpio_pin
                WHERE a.timestamp >= ?
                ORDER BY a.timestamp DESC
            ''', (one_hour_ago,))
            
            rows = c.fetchall()
            activations = []
            
            for row in rows:
                activations.append({
                    'sensor_id': row[0],
                    'nombre_fantasia': row[1],
                    'timestamp': row[2],
                    'completed': bool(row[3])
                })
            
            return jsonify({
                'success': True,
                'activations': activations
            })
            
    except Exception as e:
        app.logger.error(f"Error getting recent activations: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/sensor_activity', methods=['POST'])
def register_sensor_activity():
    try:
        data = request.get_json()
        active_sensors = data.get('active_sensors', [])
        previous_sensors = data.get('previous_sensors', [])
        
        current_time = datetime.now(santiago_tz)
        current_set = set(active_sensors)
        previous_set = set(previous_sensors)
        
        # Sensores que fueron retirados
        sensors_removed = previous_set - current_set
        
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            
            # Completar activaciones de sensores retirados
            for sensor_id in sensors_removed:
                c.execute('''
                    SELECT id, start_time 
                    FROM activaciones 
                    WHERE sensor_id = ? 
                    AND completed = 0 
                    ORDER BY timestamp DESC 
                    LIMIT 1
                ''', (sensor_id,))
                
                result = c.fetchone()
                if result:
                    activation_id, start_time = result
                    if start_time:
                        start_dt = datetime.strptime(start_time, '%Y-%m-%d %H:%M:%S')
                        duration = int((current_time - start_dt).total_seconds() * 1000)
                    else:
                        duration = 0
                        
                    c.execute('''
                        UPDATE activaciones 
                        SET end_time = ?, 
                            duration = ?,
                            completed = 1 
                        WHERE id = ?
                    ''', (current_time.strftime('%Y-%m-%d %H:%M:%S'), duration, activation_id))
                    app.logger.info(f"✅ Activación completada: Sensor {sensor_id}, Duración {duration}ms")
            
            # Registrar nuevas activaciones
            sensors_activated = current_set - previous_set
            for sensor_id in sensors_activated:
                c.execute('''
                    INSERT INTO activaciones 
                    (sensor_id, timestamp, start_time) 
                    VALUES (?, ?, ?)
                ''', (
                    sensor_id, 
                    current_time.strftime('%Y-%m-%d %H:%M:%S'),
                    current_time.strftime('%Y-%m-%d %H:%M:%S')
                ))
                app.logger.info(f"📝 Nueva activación registrada: Sensor {sensor_id}")
            
            conn.commit()
        
        return jsonify({'success': True})
        
    except Exception as e:
        app.logger.error(f"❌ Error al registrar activación: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/public/sensor_status')
def sensor_status():
    try:
        global previous_active_sensors
        current_time = datetime.now(santiago_tz)
        active_sensors = []
        
        for pin in SENSOR_PINS:
            state = GPIO.input(pin)
            # Ahora activamos cuando es HIGH (cuando NO hay obstáculo)
            if state == GPIO.HIGH:
                active_sensors.append(pin)
                app.logger.info(f"Producto retirado en sensor {pin}")
        
        # Logging para debug
        app.logger.info(f"Sensores activos (productos retirados): {active_sensors}")
        
        # Registrar actividad si hay cambios
        if set(active_sensors) != set(previous_active_sensors):
            app.logger.info(f"Cambio en vitrina - Anterior: {previous_active_sensors}, Actual: {active_sensors}")
            register_sensor_activity(active_sensors, previous_active_sensors)
            
        previous_active_sensors = active_sensors
        
        return jsonify({
            'active_sensors': active_sensors,
            'status': {str(pin): GPIO.input(pin) for pin in SENSOR_PINS},
            'timestamp': current_time.strftime('%Y-%m-%d %H:%M:%S')
        })
    except Exception as e:
        app.logger.error(f"Error en sensor_status: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/vitrina_status')
def vitrina_status():
    status = {}
    for pin in SENSOR_PINS:
        state = GPIO.input(pin)
        status[pin] = {
            'estado': 'Producto retirado' if state == GPIO.HIGH else 'Producto en vitrina',
            'valor_sensor': 'HIGH' if state == GPIO.HIGH else 'LOW',
            'debe_mostrar_video': state == GPIO.HIGH
        }
    return jsonify(status)

def register_sensor_activity(active_sensors, previous_sensors):
    conn = None
    try:
        current_time = datetime.now(santiago_tz)
        current_set = set(active_sensors)
        previous_set = set(previous_sensors)
        
        conn = sqlite3.connect('/home/pi/vitrina/vitrina.db')
        c = conn.cursor()
        
        # Completar activaciones de sensores que ya no están activos
        sensors_removed = previous_set - current_set
        for sensor_id in sensors_removed:
            c.execute('''
                SELECT id, start_time 
                FROM activaciones 
                WHERE sensor_id = ? AND completed = 0 
                ORDER BY timestamp DESC LIMIT 1
            ''', (sensor_id,))
            
            result = c.fetchone()
            if result:
                activation_id, start_time = result
                if start_time:
                    # Convertir start_time a datetime con zona horaria
                    start_dt = datetime.strptime(start_time, '%Y-%m-%d %H:%M:%S')
                    start_dt = santiago_tz.localize(start_dt)
                    duration = int((current_time - start_dt).total_seconds() * 1000)
                    
                    c.execute('''
                        UPDATE activaciones 
                        SET end_time = ?, 
                            duration = ?,
                            completed = 1 
                        WHERE id = ?
                    ''', (current_time.strftime('%Y-%m-%d %H:%M:%S'), duration, activation_id))
                    app.logger.info(f"Activación completada: Sensor {sensor_id}, Duración {duration}ms")
        
        # Registrar nuevas activaciones
        sensors_activated = current_set - previous_set
        for sensor_id in sensors_activated:
            c.execute('''
                INSERT INTO activaciones 
                (sensor_id, timestamp, start_time) 
                VALUES (?, ?, ?)
            ''', (
                sensor_id, 
                current_time.strftime('%Y-%m-%d %H:%M:%S'),
                current_time.strftime('%Y-%m-%d %H:%M:%S')
            ))
            app.logger.info(f"Nueva activación registrada: Sensor {sensor_id}")
        
        conn.commit()
        return True
        
    except Exception as e:
        app.logger.error(f"Error al registrar actividad: {str(e)}")
        if conn:
            conn.rollback()
        return False
        
    finally:
        if conn:
            conn.close()

@app.route('/api/sensor-activation', methods=['POST'])
def sensor_activation():
    try:
        data = request.get_json()
        sensor_id = data.get('sensor_id')
        
        if not sensor_id:
            return jsonify({'error': 'sensor_id es requerido'}), 400

        # Obtener la hora actual
        current_time = datetime.now()

        # Conectar a la base de datos
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()

            # Buscar video asociado al sensor
            c.execute('SELECT video_path FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
            video_result = c.fetchone()
            video_path = video_result[0] if video_result else None

            # Registrar activación en la tabla de activaciones
            c.execute('''
                INSERT INTO activaciones 
                (sensor_id, timestamp, start_time, video_path) 
                VALUES (?, ?, ?, ?)
            ''', (sensor_id, current_time, current_time, video_path))
            
            # Obtener el ID de la última activación insertada
            activation_id = c.lastrowid

            conn.commit()

        # Logging de la activación
        debugLog(f"Sensor {sensor_id} activado. Video: {video_path}")

        return jsonify({
            "status": "success", 
            "sensor_id": sensor_id, 
            "video_path": video_path,
            "activation_id": activation_id
        }), 200

    except sqlite3.Error as e:
        app.logger.error(f"Error de base de datos al activar sensor: {str(e)}")
        return jsonify({'error': 'Error de base de datos', 'details': str(e)}), 500
    except Exception as e:
        app.logger.error(f"Error general al activar sensor: {str(e)}")
        return jsonify({'error': 'Error interno del servidor', 'details': str(e)}), 500

@app.route('/api/get_sensor_video/<int:sensor_id>')
def get_sensor_video(sensor_id):
    try:
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            c = conn.cursor()
            c.execute('SELECT video_path FROM sensor_videos WHERE sensor_id = ?', (sensor_id,))
            result = c.fetchone()
            
            if result and result[0]:
                return jsonify({'video_path': result[0]})
            return jsonify({'error': 'No video found'}), 404
            
    except Exception as e:
        app.logger.error(f"Error getting video path: {str(e)}")
        return jsonify({'error': str(e)}), 500
            
    except Exception as e:
        app.logger.error(f"Error al registrar actividad: {str(e)}")
        return False

@app.route('/credentials')
def servir_json():
    ruta_json = os.path.join(os.path.dirname(__file__), 'credentials.json')
    if os.path.exists(ruta_json):
        return send_file(ruta_json, mimetype='application/json')
    else:
        return jsonify({'mensaje': 'No existen credenciales'}), 404

import threading
from workers import send_data_to_server
from cms import get_media

def run_server():
    try:
        setup_gpio()
        init_db()
        app.run(host='0.0.0.0', port=5000, debug=False)
    except Exception as e:
        app.logger.error(f"Error en el servidor: {str(e)}")
        print(f"Error in Flask thread: {e}")

def report_to_server():
    try:
        while True:
            resp = send_data_to_server()
            app.logger.error(str(resp))
            time.sleep(600) # 10 minutos
    except Exception as e:
        app.logger.error(f"Error al reportar datos: {str(e)}")
        print(f"Error in additional tasks thread: {e}")

def sync_cms():
    try:
        while True:
            get_media()
            time.sleep(600)
    except Exception as e:
        app.logger.error(f"Error descargar media: {str(e)}")
        print(f"Error descargar media: {e}")

if __name__ == '__main__':
 
    from credential_manager import credential_manager
    CREDENTIALS = credential_manager.get_credentials() 
    print(CREDENTIALS)

    flask_thread = threading.Thread(target=run_server, daemon=True)
    flask_thread.start()

    additional_tasks_thread = threading.Thread(target=report_to_server, daemon=True)
    additional_tasks_thread.start()

    sync_cms_thread = threading.Thread(target=sync_cms, daemon=True)
    sync_cms_thread.start()

    flask_thread.join()
    additional_tasks_thread.join()
    sync_cms_thread.join()
