from .get_mac_address import get_mac_address as get_mac
from .request_device_id import request_device_id as request_id
import json
import os
import http.client
import urllib.parse
import json

def validate_device_id(device_id):
    url = "https://clientes.tecnoactive.cl/liftandlearn2/api.php?action=validate_device_id&device_id=" + device_id
    parsed_url = urllib.parse.urlsplit(url)
    conn = http.client.HTTPConnection(parsed_url.netloc)
    
    try:
        conn.request("GET", parsed_url.path + "?" + parsed_url.query)
        response = conn.getresponse()
        
        if response.status == 200:
            data = response.read()
            return json.loads(data)
        else:
            raise ValueError("Unable to verify the device ID.")
    except Exception as e:
        print(f"Error validating device ID: {e}")
        raise
    finally:
        conn.close()

def create_credentials():
    mac = get_mac()
    return {
        "device_mac": mac,
        "device_id": request_id(mac)
    }

def get_credentials():
    filename = '/home/pi/vitrina/credentials.json'

    if not os.path.exists(filename):
        estructura_inicial = create_credentials()
        with open(filename, 'w') as file:
            json.dump(estructura_inicial, file)
        return estructura_inicial
    else:
        if os.stat(filename).st_size == 0:
            estructura_inicial = create_credentials()
            with open(filename, 'w') as file:
                json.dump(estructura_inicial, file)
            return estructura_inicial

        with open(filename, 'r') as file:
            data = json.load(file)

        if "device_mac" not in data or not data["device_mac"]:
            data["device_mac"] = get_mac()
        if "device_id" not in data or not data["device_id"] or not validate_device_id(data["device_id"]):
            data["device_id"] = request_id(data["device_mac"])

        with open(filename, 'w') as file:
            json.dump(data, file)

        return data

def clear_credentials():
    filename = '/home/pi/vitrina/credentials.json'
    if os.path.exists(filename):
        try:
            os.remove(filename)
        except OSError as e:
            print(f" ~~~ Error deleting file: {e}")
            return False
        return True
    else:
        return False

if __name__ == '__main__':
    print(get_credentials())

