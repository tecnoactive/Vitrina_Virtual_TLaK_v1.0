
function beacon() {
    const url = "https://clientes.tecnoactive.cl/liftandlearn2/api.php?action=device_beacon";
    
    function getDeviceId() {
        return fetch("http://localhost:5000/credentials")
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                return data.device_id;
            })
            .catch(error => {
                console.error("Error fetching device credentials:", error);
                throw error;  // Relanzamos el error para que la función beacon lo maneje
            });
    }

    function sendBeacon(deviceId) {
        const data = new URLSearchParams({ device_id: deviceId });
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: data.toString(),
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            console.log("Beacon sent successfully:", result);
        })
        .catch(error => {
            console.error("Error sending beacon:", error);
        });
    }

    getDeviceId()
        .then(deviceId => {
            sendBeacon(deviceId);
            setInterval(() => sendBeacon(deviceId), 60000); // 1 min
        })
        .catch(error => {
            console.error("Failed to get device_id:", error);
        });
}

window.addEventListener("load", beacon);
