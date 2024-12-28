
// debe solicitarse al servidor y almacenarse en la Raspi Local (solo una vez)
// y luego enviarlo al servidor cada minuto

function beacon() {
    const DEVICE_ID = "nEans3"
    const url = "https://clientes.tecnoactive.cl/liftandlearn2/api.php?action=device_beacon"
    const data = new URLSearchParams({ device_id: DEVICE_ID })

    function sendBeacon() {
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: data.toString(),
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }
            return response.json()
        })
        .then(result => {
            console.log("Beacon sent successfully:", result)
        })
        .catch(error => {
            console.error("Error sending beacon:", error)
        })
    }

    sendBeacon()
    setInterval(sendBeacon, 60000) // 1 min
}

window.addEventListener("load", beacon)
