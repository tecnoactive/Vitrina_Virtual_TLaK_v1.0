import os
import requests
from urllib.parse import urljoin
from credential_manager import credential_manager as credentials
from datetime import datetime

CMS_JSON_URL = "https://clientes.tecnoactive.cl/cms_content/json/json_contenidos.php?pantalla_id="
base_folder = "cms"
os.makedirs(base_folder, exist_ok=True)

# archivo .log para guardar los errores
log_file = os.path.join(base_folder, "cms_sync.log")

def log_data(message):
    """
    Logs a message to the log file.
    :param message: The message to log.
    """
    try:
        # Verifica si el archivo de log existe y tiene permisos de escritura
        if not os.path.exists(log_file) or not os.access(log_file, os.W_OK):
            raise PermissionError(f"Log file {log_file} is not writable.")
        with open(log_file, "a") as log:
            log.write(f"{message}\n")
    except Exception as e:
        print(f"Error writing to log file: {e}")
        # Si no se puede escribir en el archivo de log, imprime el error en la consola
        print(message)


def get_gpio(sensor_value):
    sensors = [
        {"sensor": 1, "gpio": 17},
        {"sensor": 2, "gpio": 27},
        {"sensor": 3, "gpio": 5},
        {"sensor": 4, "gpio": 6},
        {"sensor": 5, "gpio": 13},
        {"sensor": 6, "gpio": 18},
        {"sensor": 7, "gpio": 22},
        {"sensor": 8, "gpio": 26},
        {"sensor": 9, "gpio": 19}
    ]
    for sensor in sensors:
        if sensor["sensor"] == sensor_value:
            return sensor["gpio"]
    return None 

def assign_cms_media(video_path: str, sensor_id: int):
    """
    Uploads a video file to the given API endpoint.

    :param video_path: The local path to the video file.
    :param sensor_id: The sensor ID associated with the video.
    :return: The JSON response from the server.
    """
    base_url = 'http://localhost:5000/api/'
    api_url = "upload_video" if '_' in video_path.split('/')[1] else "upload_background"
    
    try:
        with open(video_path, 'rb') as video_file:
            files = {'video': video_file}
            data = {'sensor_id': sensor_id}

            print(f"** Sending file {video_path.split('/')[1]} for sensor {sensor_id} to {api_url}")
            response = requests.post(base_url + api_url, files=files, data=data)

            response.raise_for_status()  # Raise an error for non-200 responses
            print(response.json())
            log_data(f"Response: {response.json()}")
            return response.json()
    except requests.exceptions.RequestException as e:
        print(f"HTTP Request failed: {e}")
        return {'error': f'HTTP request failed: {str(e)}'}
    except Exception as e:
        print(f"Unexpected error: {e}")
        return {'error': f'Unexpected error: {str(e)}'}

def assign_label(sensor_id: int, label: str):
    """
    Assigns a label to the given sensor.

    :param sensor_id: The sensor ID to assign the label to.
    :param label: The label to assign to the sensor.
    :return: The JSON response from the server.
    """
    print('assign_label')
    api_url = "http://localhost:5000/api/actualizar-etiqueta"  # Update with the correct endpoint
    
    try:
        headers = {'Content-Type': 'application/json'}
        data = {'gpio_pin': sensor_id, 'nombre_fantasia': label}

        response = requests.post(api_url, json=data, headers=headers)  # Use `json=data`

        response.raise_for_status()  # Raise an error for non-200 responses
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"HTTP Request failed: {e}")
        return {'error': f'HTTP request failed: {str(e)}'}
    except Exception as e:
        print(f"Unexpected error: {e}")
        return {'error': f'Unexpected error: {str(e)}'}

def move_new_background(video_id, direction):
    """
    Calls the /api/move_background endpoint to move a background video up or down.
    
    Parameters:
        video_id (int): The ID of the video to move.
        direction (str): The direction to move ('up' or 'down').
    
    Returns:
        dict: The response from the API as a dictionary.
    """
    API_URL = "http://localhost:5000/api/move_background"

    payload = {
        "video_id": video_id,
        "direction": direction
    }
    print('moving background')
    try:
        response = requests.post(API_URL, json=payload)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}

def generate_sensors_id(base_string):
    return [base_string] + [f"{base_string}_{i}" for i in range(1, 11)]

def download_file(url, dest_path):
    """Descarga un archivo desde una URL y lo guarda en dest_path."""
    try:
        print('download_file '+url+' '+dest_path)
        log_data(f"Descargando... {url} -> {dest_path}")
        response = requests.get(url, stream=True)
        response.raise_for_status()
        with open(dest_path, 'wb') as file:
            for chunk in response.iter_content(chunk_size=8192):
                file.write(chunk)
        print(f"Descargado: {url} -> {dest_path}")
        log_data(f"Descargado: {url} -> {dest_path}")
    except Exception as e:
        print(f"Error descargando {url}: {e}")
        log_data(f"Error descargando {url}: {e}")

def process_url(url):
    """
    Procesa una URL de un JSON de contenido desde el CMS de TecnoActive
    """
    try:
        pantalla_id = url.split("=")[-1]
        pantalla_folder = os.path.join(base_folder, pantalla_id)
        os.makedirs(pantalla_folder, exist_ok=True)

        response = requests.get(url)
        response.raise_for_status()
        data = response.json()

        log_data(f"Procesando {url}")
        log_data(f"Contenido: {data}")

        expected_files = []
        playlist = data.get("Playlist", [])
        playlist_name = playlist[0]['descripcion']
        for item in playlist:
            items = item.get("Item", [])
            for content in items:
                content_url = urljoin("https://clientes.tecnoactive.cl/cms_content/", content["url"])
                #dest_path = os.path.join(pantalla_folder, os.path.basename(content["url"]))
                dest_path = os.path.join("static/videos", os.path.basename(content["url"]))
                print(f"** {content_url} -> {dest_path}")
                log_data(f"** {content_url} -> {dest_path}")
                expected_files.append(dest_path)
                if not os.path.exists(dest_path):
                    download_file(content_url, dest_path)
                    sensor_number = int(pantalla_id.split('_')[-1]) if '_' in pantalla_id else 0
                    resp = assign_cms_media(dest_path, get_gpio(sensor_number))
                    if "id" in resp: # es un background o un video ?
                        move_new_background(resp["id"], "up")
                    else:
                        assign_label(get_gpio(sensor_number), playlist_name)

        existing_files = [os.path.join(pantalla_folder, f) for f in os.listdir(pantalla_folder)]
        for file in existing_files:
            if file not in expected_files:
                os.remove(file)
                print(f"Eliminado archivo no esperado: {file}")

    except Exception as e:
        log_data(f"Error procesando {url}: {e}")
        print(f"Error procesando {url}: {e}")

def get_media():
    print('** get media')
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_data(f"\n********* get media ({fecha}) *********")
    CREDENTIALS = credentials.get_credentials()
    log_data(f"Credentials: {str(CREDENTIALS)}")
    sensors_ids = generate_sensors_id(CREDENTIALS['device_id'])
    for sensor_id in sensors_ids:
        url = CMS_JSON_URL + sensor_id
        print('** get media '+url)
        process_url(url)

if __name__ == "__main__":
    # Ejecutar la función principal
    get_media()
