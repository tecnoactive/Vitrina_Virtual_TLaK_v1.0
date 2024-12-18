import sqlite3

def init_db():
    with sqlite3.connect('vitrina.db') as conn:
        c = conn.cursor()
        
        # Eliminar tabla si existe
        c.execute('''
        DROP TABLE IF EXISTS etiquetas_sensores
        ''')
        
        # Tabla de videos de sensores
        c.execute('''
        CREATE TABLE IF NOT EXISTS sensor_videos (
            sensor_id INTEGER PRIMARY KEY,
            video_path TEXT NOT NULL,
            name TEXT
        );
        ''')

        # Tabla de videos de fondo
        c.execute('''
        CREATE TABLE IF NOT EXISTS background_videos (
            id INTEGER PRIMARY KEY,
            video_path TEXT NOT NULL,
            orden INTEGER DEFAULT 0
        );
        ''')

        # Tabla de etiquetas de sensores
        c.execute('''
        CREATE TABLE IF NOT EXISTS etiquetas_sensores (
            gpio_pin INTEGER PRIMARY KEY,
            sensor_numero TEXT NOT NULL,
            nombre_fantasia TEXT,
            silenciado BOOLEAN DEFAULT 0
        )
        ''')
        
        # Tabla de configuración del sistema
        c.execute('''
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        ''')
        
        # Insertar datos iniciales de sensores
        sensores = [
            (17, 'Sensor 1', 'Anti-Pigment'),
            (27, 'Sensor 2', 'Aquaphor'),
            (5, 'Sensor 3', 'Fusion Water'),
            (6, 'Sensor 4', 'Hyaluron-Filler'),
            (13, 'Sensor 5', 'Hydrofluid'),
            (18, 'Sensor 6', 'Sun Face FP50'),
            (22, 'Sensor 7', None),
            (26, 'Sensor 8', None),
            (19, 'Sensor 9', None)
        ]
        
        c.executemany('''
        INSERT OR REPLACE INTO etiquetas_sensores (gpio_pin, sensor_numero, nombre_fantasia)
        VALUES (?, ?, ?)
        ''', sensores)
        
        # Configuración inicial del sistema
        config_inicial = [
            ('versus_mode', '1'),  # 1 = modo normal, 2-4 = modo versus con ese número de sensores
            ('debug_enabled', 'false')
        ]
        
        c.executemany('''
        INSERT OR IGNORE INTO system_config (key, value)
        VALUES (?, ?)
        ''', config_inicial)
        
        conn.commit()

if __name__ == '__main__':
    init_db()
    print("Base de datos inicializada correctamente.")
