import os
import requests
from urllib.parse import urljoin
from credential_manager import credential_manager as credentials

CMS_JSON_URL = "https://clientes.tecnoactive.cl/cms_content/json/json_contenidos.php?pantalla_id="

def generate_sensors_id(base_string):
    return [base_string] + [f"{base_string}_{i}" for i in range(1, 11)]

base_folder = "cms"
os.makedirs(base_folder, exist_ok=True)

def download_file(url, dest_path):
    """Descarga un archivo desde una URL y lo guarda en dest_path."""
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        with open(dest_path, 'wb') as file:
            for chunk in response.iter_content(chunk_size=8192):
                file.write(chunk)
        print(f"Descargado: {url} -> {dest_path}")
    except Exception as e:
        print(f"Error descargando {url}: {e}")

def process_url(url):
    try:
        pantalla_id = url.split("=")[-1]
        pantalla_folder = os.path.join(base_folder, pantalla_id)
        os.makedirs(pantalla_folder, exist_ok=True)

        response = requests.get(url)
        response.raise_for_status()
        data = response.json()

        expected_files = []

        playlist = data.get("Playlist", [])
        for item in playlist:
            items = item.get("Item", [])
            for content in items:
                content_url = urljoin("https://clientes.tecnoactive.cl/cms_content/", content["url"])
                dest_path = os.path.join(pantalla_folder, os.path.basename(content["url"]))
                expected_files.append(dest_path)

                if not os.path.exists(dest_path):
                    download_file(content_url, dest_path)

        existing_files = [os.path.join(pantalla_folder, f) for f in os.listdir(pantalla_folder)]
        for file in existing_files:
            if file not in expected_files:
                os.remove(file)
                print(f"Eliminado archivo no esperado: {file}")

    except Exception as e:
        print(f"Error procesando {url}: {e}")

def get_media():
    CREDENTIALS = credentials.get_credentials()
    sensors_ids = generate_sensors_id(CREDENTIALS['device_id'])
    for sensor_id in sensors_ids:
        url = CMS_JSON_URL + sensor_id
        process_url(url)
