import http.client
import urllib.parse
import json

url_local = "http://localhost:9999/api.php?action=request_device_id&mac="
url_remote = "https://clientes.tecnoactive.cl/liftandlearn2/api.php?action=request_device_id&mac="

def request_device_id(mac_address):
    parsed_url = urllib.parse.urlsplit(url_remote + mac_address)
    conn = http.client.HTTPSConnection(parsed_url.netloc)
    conn.request("GET", parsed_url.path + "?" + parsed_url.query)
    response = conn.getresponse()
    
    if response.status == 200:
        data = response.read()
        return json.loads(data)
    else:
        raise ValueError("Unable to retrieve the device ID.")
