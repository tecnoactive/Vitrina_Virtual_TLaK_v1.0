import sqlite3
import http.client
from flask import jsonify
import os
import json
import requests
from credential_manager import credential_manager as credentials

def POST_JSON(url, data):
    try:
        json_data = json.dumps(data)

        headers = {
            'Content-Type': 'application/json'
        }
        print('posting activation data...')
        response = requests.post(url, data=json_data, headers=headers)
        
        if response.status_code == 200:
            return response.status_code, response.json()
        else:
            print(f"Error: Received status code {response.status_code}")
            return response.status_code, response.text
    except Exception as e:
        print(f"Error sending data: {e}")
        return None, None

def get_activaciones_recientes():
    try:
        print('getting data from db')
        credentials_data = credentials.get_credentials()
        with sqlite3.connect('/home/pi/vitrina/vitrina.db') as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM v_activaciones WHERE timestamp >= DATETIME('now', '-12 minute', 'localtime') AND completed = 1") # cambiar a -1 hour
            rows = c.fetchall()
            
            result = [dict(row) for row in rows]
            print('assigning ids')
            for item in result:
                item['device_id'] = credentials_data["device_id"]

            with open(os.path.join(os.path.dirname(__file__), 'result.json'), 'w') as f:
                json.dump(result, f, indent=4)

            return result

    except Exception as e:
        return False

def send_data_to_server():
    activaciones_recientes = get_activaciones_recientes()
    status, response_body = POST_JSON("https://clientes.tecnoactive.cl/liftandlearn2/api.php?action=report_activations", activaciones_recientes)
    with open(os.path.join(os.path.dirname(__file__), 'response.json'), 'w') as f:
        json.dump(response_body, f, indent=4)

    if status == 200:
        print("OK, Server response:", response_body)
    else:
        print(f"Error Server response: {response_body}")
    return status, response_body

if __name__ == "__main__":
    send_data_to_server()
