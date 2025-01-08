import uuid
import re

def get_mac_address():
    try:
        mac = uuid.getnode()
        if (mac >> 40) % 2:
            raise ValueError("Invalid MAC address (may be a random generated one).")

        mac_address = ':'.join(f'{(mac >> i) & 0xff:02x}' for i in range(0, 48, 8)[::-1])
        return mac_address

    except Exception:
        try:
            import subprocess
            result = subprocess.run(['ifconfig'], capture_output=True, text=True)
            output = result.stdout

            mac_regex = r"([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})"
            mac_addresses = re.findall(mac_regex, output)
            if mac_addresses:
                return mac_addresses[0]  #  primera mac
        except Exception as e:
            raise RuntimeError("Unable to retrieve the MAC address.") from e
