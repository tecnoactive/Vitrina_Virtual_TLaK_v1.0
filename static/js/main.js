// Configuración global
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
const SENSOR_CHECK_INTERVAL = 250;
let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// Variables de estado
let currentMode = 'background';
let lastActiveSensors = [];
let isTransitioning = false;
let autoplayInitialized = false;
let lastCheckTime = 0;
let debounceTimeout = null;

// Sistema de reproducción de fondo
let backgroundPlayer = {
    video: null,
    playlist: [],
    currentIndex: 0,
    isPlaying: false
};

// Debug
const DEBUG = localStorage.getItem('debugEnabled') === 'true';
const debugPanel = document.getElementById('debug-panel');

function debugLog(message) {
    if (localStorage.getItem('debugEnabled') === 'true') {
        const panel = document.getElementById('debug-panel');
        if (panel) {
            panel.style.display = 'block';
            panel.style.width = '300px';
            panel.style.maxHeight = '300px';
            panel.style.backgroundColor = 'rgba(0,0,0,0.8)';
            panel.style.color = '#fff';
            panel.style.fontSize = '12px';
            panel.style.padding = '10px';
            panel.style.fontFamily = 'monospace';
            
            const time = new Date().toLocaleTimeString();
            panel.innerHTML = `${time}: ${message}<br>${panel.innerHTML}`.split('<br>').slice(0, 50).join('<br>');
            console.log(`[DEBUG] ${time}: ${message}`);
        }
    } else {
        debugPanel.style.display = 'none';
    }
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkServerConnection();
        setupVideoEventListeners();
        debugPanel.style.display = localStorage.getItem('debugEnabled') === 'true' ? 'block' : 'none';
        await initBackgroundPlaylist();
        await initializeVideoPlayback();
    } catch (error) {
        debugLog(`Error en inicialización: ${error.message}`);
        showConnectionError();
    }
});

// Configuración inicial
async function checkServerConnection() {
    try {
        const response = await fetch('/api/system-config');
        if (!response.ok) throw new Error('Error de conexión con el servidor');
        isConnected = true;
        debugLog('Conexión establecida con el servidor');
    } catch (error) {
        throw new Error('No se pudo conectar con el servidor');
    }
}

function setupVideoEventListeners() {
    const videos = ['background-video', 'video1', 'video2', 'quad1', 'quad2', 'quad3', 'quad4']
        .map(id => document.getElementById(id));
    
    backgroundPlayer.video = videos[0];

    videos.forEach(video => {
        if (!video) return;
        video.addEventListener('play', () => debugLog(`Video iniciado: ${video.id}`));
        video.addEventListener('error', (e) => debugLog(`Error en video ${video.id}: ${e.message}`));
    });
}
// Manejo de reproducción de videos


const handleVideoPlayback = async (video) => {
    video.muted = true; // Siempre iniciar muteado
    try {
      await video.play();
    } catch (error) {
      // Intentar reproducir en loop hasta que funcione
      const playAttempt = setInterval(() => {
        video.play()
        .then(() => {
          clearInterval(playAttempt);
        })
        .catch(() => {
          console.log("Intentando reproducir...");
        });
      }, 1000);
    }
  };

  const syncWithPanel = () => {
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'config_changed') {
        window.location.reload();
      }
    };
  };


async function playCurrentVideo() {
    if (!backgroundPlayer.playlist.length || isTransitioning) return;
    
    const currentVideo = backgroundPlayer.playlist[backgroundPlayer.currentIndex];
    const video = backgroundPlayer.video;
    
    try {
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        
        // Prevenir múltiples cargas
        if (video.src !== `/static/${currentVideo.video_path}`) {
            video.src = `/static/${currentVideo.video_path}`;
            await new Promise(resolve => {
                video.onloadeddata = resolve;
            });
        }

        await video.play();
        backgroundPlayer.isPlaying = true;
        
        video.onended = () => {
            if (currentMode === 'background' && !isTransitioning) {
                backgroundPlayer.currentIndex = (backgroundPlayer.currentIndex + 1) % backgroundPlayer.playlist.length;
                playCurrentVideo();
            }
        };
    } catch (error) {
        console.error(`Error reproduciendo video: ${error.message}`);
        if (!isTransitioning) {
            setTimeout(() => playCurrentVideo(), 1000);
        }
    }
}

async function initializeVideoPlayback() {
    const video = backgroundPlayer.video;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('data-power-mode', 'high-performance');
    await playCurrentVideo();
}

async function handleAutoplay() {
    try {
        await autoplayWithRetry();
    } catch (error) {
        debugLog('Autoplay falló, reproduciendo de todos modos');
        await backgroundPlayer.video.play();
        autoplayInitialized = true;
    }
}

async function autoplayWithRetry(attempts = 0) {
    try {
        await backgroundPlayer.video.play();
        autoplayInitialized = true;
    } catch (error) {
        if (attempts < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return autoplayWithRetry(attempts + 1);
        }
        throw error;
    }
}

async function initBackgroundPlaylist() {
    await loadBackgroundVideos();
    if (backgroundPlayer.playlist.length > 0) {
        await playCurrentVideo();
    }
}

async function loadBackgroundVideos() {
    try {
        const response = await fetch('/api/background_videos');
        const videos = await response.json();
        
        if (videos?.length > 0) {
            backgroundPlayer.playlist = videos.sort((a, b) => a.orden - b.orden);
            debugLog(`Playlist cargada: ${videos.length} videos`);
            if (currentMode === 'background' && !backgroundPlayer.isPlaying) {
                backgroundPlayer.currentIndex = 0;
                await playCurrentVideo();
            }
        }
    } catch (error) {
        debugLog(`Error cargando playlist: ${error.message}`);
    }
}

// Funciones auxiliares para videos
async function tryPlayVideo(video) {
    if (!video || !video.src) return;
    video.muted = true;
    try {
        await video.play();
    } catch (error) {
        debugLog(`Error reproduciendo video ${video.id}: ${error.message}`);
    }
}

function stopAllVideos() {
    document.querySelectorAll('video').forEach(video => {
        try {
            video.pause();
            video.currentTime = 0;
            video.src = '';
            video.style.display = 'none';
        } catch (e) {
            debugLog(`Error deteniendo video: ${e.message}`);
        }
    });
}
// Monitoreo de sensores
async function initSensorMonitoring() {
    try {
        const response = await fetch('/api/sensor_status');
        if (!response.ok) throw new Error('Error obteniendo estado de sensores');
        startSensorMonitoring();
        debugLog('Monitoreo de sensores iniciado');
    } catch (error) {
        throw new Error('Error iniciando monitoreo de sensores');
    }
}

function startSensorMonitoring() {
    setInterval(checkSensors, SENSOR_CHECK_INTERVAL);
}

async function checkSensors() {
    if (isTransitioning) return;
    
    try {
        const response = await fetch('/api/sensor_status');
        const data = await response.json();
        
        if (!response.ok) throw new Error('Error en respuesta del servidor');
        
        // Los sensores activos son los que NO están detectando (valor 0)
        const activeSensors = Object.entries(data.status)
            .filter(([_, value]) => value === 0)
            .map(([pin]) => parseInt(pin));

        if (JSON.stringify(activeSensors) !== JSON.stringify(lastActiveSensors)) {
            debugLog(`Sensores activos: ${activeSensors.join(', ')}`);
            await handleSensorChange(activeSensors);
            lastActiveSensors = activeSensors;
        }
    } catch (error) {
        debugLog(`Error en monitoreo: ${error.message}`);
    }
}

// Manejo de cambios de modo
async function handleSensorChange(activeSensors) {
    if (isTransitioning) return;
    isTransitioning = true;

    try {
        const config = await fetch('/api/system-config').then(r => r.json());
        const versusMode = parseInt(config.versus_mode);

        if (activeSensors.length === 0) {
            await switchToBackgroundMode();
        } else if (activeSensors.length === 1) {
            await switchToSingleMode(activeSensors[0]);
        } else if (activeSensors.length === 2) {
            await switchToVersusMode(activeSensors[0], activeSensors[1]);
        } else if (activeSensors.length === 3 && versusMode >= 3) {
            await switchToTripleMode(activeSensors);
        } else if (activeSensors.length >= 4 && versusMode === 4) {
            await switchToQuadMode(activeSensors.slice(0, 4));
        } else {
            await switchToVersusMode(activeSensors[0], activeSensors[1]);
        }
    } catch (error) {
        debugLog(`Error en cambio de modo: ${error.message}`);
        await switchToBackgroundMode();
    } finally {
        isTransitioning = false;
    }
}

// Modos de visualización
async function switchToBackgroundMode() {
    debugLog('Cambiando a modo fondo');
    
    const splitScreen = document.querySelector('.split-screen');
    const quadScreen = document.querySelector('.quad-screen');
    
    stopAllVideos();
    
    backgroundPlayer.video.style.display = 'block';
    splitScreen.style.display = 'none';
    quadScreen.style.display = 'none';
    
    currentMode = 'background';
    backgroundPlayer.isPlaying = false;
    backgroundPlayer.currentIndex = 0;
    
    await loadBackgroundVideos();
}

async function switchToSingleMode(sensorId) {
    debugLog(`Modo único - Sensor ${sensorId}`);
    try {
        const videoResponse = await fetch(`/api/sensor_video/${sensorId}`);
        const videoData = await videoResponse.json();
        
        if (!videoData.video_path) {
            throw new Error('Video no encontrado');
        }

        stopAllVideos();
        
        const splitScreen = document.querySelector('.split-screen');
        const quadScreen = document.querySelector('.quad-screen');
        
        splitScreen.style.display = 'none';
        quadScreen.style.display = 'none';
        backgroundPlayer.video.style.display = 'block';
        backgroundPlayer.video.src = `/static/${videoData.video_path}`;
        backgroundPlayer.video.muted = false;
        backgroundPlayer.video.loop = false;
        
        await backgroundPlayer.video.play();
        currentMode = 'single';
        
        // Volver a modo background cuando termine el video
        backgroundPlayer.video.onended = () => {
            switchToBackgroundMode();
        };
    } catch (error) {
        debugLog(`Error: ${error.message}`);
        await switchToBackgroundMode();
    }
}

async function switchToVersusMode(sensor1, sensor2) {
    debugLog(`Versus: ${sensor1} vs ${sensor2}`);
    try {
        const videos = await Promise.all([
            fetch(`/api/sensor_video/${sensor1}`).then(r => r.json()),
            fetch(`/api/sensor_video/${sensor2}`).then(r => r.json())
        ]);
        
        if (!videos[0].video_path || !videos[1].video_path) {
            throw new Error('Videos no encontrados');
        }

        stopAllVideos();
        backgroundPlayer.video.style.display = 'none';
        
        const splitScreen = document.querySelector('.split-screen');
        splitScreen.style.display = 'flex';
        
        const video1 = document.getElementById('video1');
        const video2 = document.getElementById('video2');
        
        video1.src = `/static/${videos[0].video_path}`;
        video2.src = `/static/${videos[1].video_path}`;
        video1.loop = false;
        video2.loop = false;
        
        await Promise.all([video1.play(), video2.play()]);
        currentMode = 'versus';
        
        // Volver a modo background cuando terminen ambos videos
        let ended = 0;
        [video1, video2].forEach(video => {
            video.onended = () => {
                ended++;
                if (ended === 2) switchToBackgroundMode();
            };
        });
    } catch (error) {
        debugLog(`Error: ${error.message}`);
        await switchToBackgroundMode();
    }
}


 function getVideoOrderForPosition(position) {
    const positions = {
        'superior-derecha': ['quad1', 'quad3', 'quad2', 'quad4'],
        'superior-izquierda': ['quad2', 'quad3', 'quad1', 'quad4'],
        'inferior-derecha': ['quad1', 'quad2', 'quad3', 'quad4'],
        'inferior-izquierda': ['quad1', 'quad2', 'quad4', 'quad3']
    };
    return positions[position] || positions['inferior-derecha'];
}

// switchToTripleMode y switchToQuadMode

async function switchToTripleMode(sensors) {
    debugLog(`Triple: ${sensors.join(' vs ')}`);
    try {
        const [videos, extraContent] = await Promise.all([
            Promise.all(sensors.map(s => fetch(`/api/sensor_video/${s}`).then(r => r.json()))),
            fetch('/api/extra-content').then(r => r.json())
        ]);
        
        if (videos.some(v => !v.video_path)) {
            throw new Error('Videos no encontrados');
        }

        stopAllVideos();
        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.split-screen').style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'grid';

        const quadVideos = [
            document.getElementById('quad1'),
            document.getElementById('quad2'),
            document.getElementById('quad3'),
            document.getElementById('quad4')
        ];

        // Configurar videos principales
        for (let i = 0; i < 3; i++) {
            const video = quadVideos[i];
            video.src = `/static/${videos[i].video_path}`;
            video.style.display = 'block';
            video.loop = false;
        }

        // Configurar contenido extra
        if (extraContent.path) {
            if (extraContent.type === 'video') {
                quadVideos[3].src = `/static/${extraContent.path}`;
                quadVideos[3].style.display = 'block';
                quadVideos[3].loop = true;
                await quadVideos[3].play();
            }
        }

        await Promise.all(quadVideos.slice(0,3).map(v => v.play()));
        currentMode = 'triple';

        // Control de finalización
        let ended = 0;
        quadVideos.slice(0,3).forEach(video => {
            video.onended = () => {
                ended++;
                if (ended === 3) switchToBackgroundMode();
            };
        });
    } catch (error) {
        debugLog(`Error: ${error.message}`);
        await switchToBackgroundMode();
    }
}

async function switchToQuadMode(sensors) {
    debugLog(`Quad: ${sensors.join(' vs ')}`);
    try {
        const videos = await Promise.all(
            sensors.map(s => fetch(`/api/sensor_video/${s}`).then(r => r.json()))
        );
        
        if (videos.some(v => !v.video_path)) {
            throw new Error('Videos no encontrados');
        }

        stopAllVideos();
        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.split-screen').style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'grid';

        const quadVideos = [
            document.getElementById('quad1'),
            document.getElementById('quad2'),
            document.getElementById('quad3'),
            document.getElementById('quad4')
        ];

        // Configurar videos
        quadVideos.forEach((video, i) => {
            video.src = `/static/${videos[i].video_path}`;
            video.style.display = 'block';
            video.loop = false;
        });

        await Promise.all(quadVideos.map(v => v.play()));
        currentMode = 'quad';

        // Control de finalización
        let ended = 0;
        quadVideos.forEach(video => {
            video.onended = () => {
                ended++;
                if (ended === 4) switchToBackgroundMode();
            };
        });
    } catch (error) {
        debugLog(`Error: ${error.message}`);
        await switchToBackgroundMode();
    }
}



 async function getVideoForSensor(sensorId) {
    const response = await fetch(`/api/sensor_video/${sensorId}`);
    if (!response.ok) throw new Error(`Error obteniendo video para sensor ${sensorId}`);
    return response.json();
}



// Funciones de utilidad y UI
function getVideoOrderForPosition(position) {
    const positions = {
        'top-right': ['quad1', 'quad3', 'quad2', 'quad4'],
        'top-left': ['quad2', 'quad3', 'quad1', 'quad4'],
        'bottom-right': ['quad1', 'quad2', 'quad3', 'quad4'],
        'bottom-left': ['quad1', 'quad2', 'quad4', 'quad3']
    };
    return positions[position] || positions['bottom-right'];
}

function showConnectionError() {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'connection-error';
    errorDiv.innerHTML = `
        <div class="error-message">
            <h2>Error de Conexión</h2>
            <p>No se pudo conectar con el servidor. Intentando reconectar...</p>
            <button onclick="window.location.reload()">Reintentar</button>
        </div>
    `;
    document.body.appendChild(errorDiv);
}

function showPlayPrompt() {
    const promptDiv = document.createElement('div');
    promptDiv.className = 'play-prompt';
    promptDiv.innerHTML = `
        <div class="prompt-message">
            <h2>Click para comenzar</h2>
            <p>Haga click en cualquier lugar para iniciar la reproducción</p>
        </div>
    `;
    document.body.appendChild(promptDiv);
}

function hidePlayPrompt() {
    const prompt = document.querySelector('.play-prompt');
    if (prompt) prompt.remove();
}