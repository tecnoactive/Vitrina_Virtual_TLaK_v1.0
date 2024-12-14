// Configuración global
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
const SENSOR_CHECK_INTERVAL = 100;
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
        await initSensorMonitoring();
        await handleAutoplay();
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
async function playCurrentVideo() {
    if (!backgroundPlayer.playlist.length) return;
    
    const currentVideo = backgroundPlayer.playlist[backgroundPlayer.currentIndex];
    debugLog(`Reproduciendo video ${backgroundPlayer.currentIndex + 1}/${backgroundPlayer.playlist.length}: ${currentVideo.video_path}`);
    
    try {
        backgroundPlayer.video.src = `/static/${currentVideo.video_path}`;
        backgroundPlayer.video.load();
        
        await new Promise((resolve) => {
            const onCanPlay = () => {
                backgroundPlayer.video.removeEventListener('canplay', onCanPlay);
                resolve();
            };
            backgroundPlayer.video.addEventListener('canplay', onCanPlay);
        });
        
        await backgroundPlayer.video.play();
        backgroundPlayer.isPlaying = true;
        
        backgroundPlayer.video.onended = () => {
            if (currentMode === 'background') {
                backgroundPlayer.currentIndex = (backgroundPlayer.currentIndex + 1) % backgroundPlayer.playlist.length;
                setTimeout(playCurrentVideo, 100);
            }
        };
    } catch (error) {
        debugLog(`Error reproduciendo video: ${error.message}`);
        backgroundPlayer.currentIndex = (backgroundPlayer.currentIndex + 1) % backgroundPlayer.playlist.length;
        setTimeout(playCurrentVideo, 1000);
    }
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
    
    try {
        video.muted = true;
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
        const activeSensors = data.active_sensors || [];

        if (JSON.stringify(activeSensors) !== JSON.stringify(lastActiveSensors)) {
            // Eliminar el debounce para respuesta más rápida
            debugLog(`Cambio en sensores: ${activeSensors.join(', ')}`);
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
        const versusMode = parseInt(config.versus_mode || '1');
        debugLog(`Modo actual: ${versusMode}, Sensores activos: ${activeSensors.length}`);

        if (activeSensors.length === 0) {
            await switchToBackgroundMode();
        } else if (versusMode === 1) {
            // En modo 1, siempre mostrar solo el primer sensor activo
            await switchToSingleMode(activeSensors[0]);
        } else if (versusMode === 2 && activeSensors.length >= 2) {
            await switchToVersusMode(activeSensors[0], activeSensors[1]);
        } else if (versusMode === 3 && activeSensors.length >= 3) {
            await switchToTripleMode(activeSensors.slice(0, 3));
        } else if (versusMode === 4 && activeSensors.length >= 4) {
            await switchToQuadMode(activeSensors.slice(0, 4));
        } else {
            // Si no cumple ninguna condición, mostrar modo single con el primer sensor
            await switchToSingleMode(activeSensors[0]);
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
        
        // Ocultar todas las vistas alternativas
        const splitScreen = document.querySelector('.split-screen');
        const quadScreen = document.querySelector('.quad-screen');
        splitScreen.style.display = 'none';
        quadScreen.style.display = 'none';

        // Configurar video principal
        const mainVideo = document.getElementById('background-video');
        mainVideo.style.display = 'block';
        mainVideo.src = `/static/${videoData.video_path}`;
        mainVideo.muted = localStorage.getItem(`sensor_${sensorId}_muted`) === 'true';
        mainVideo.loop = true;
        
        await tryPlayVideo(mainVideo);
        currentMode = 'single';
    } catch (error) {
        debugLog(`Error en modo único: ${error.message}`);
        await switchToBackgroundMode();
    }
}


async function switchToVersusMode(sensor1, sensor2) {
    debugLog(`Iniciando versus: ${sensor1} vs ${sensor2}`);
    try {
        stopAllVideos();
        const videos = await Promise.all([
            getVideoForSensor(sensor1), 
            getVideoForSensor(sensor2)
        ]);
 
        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'none';
        document.querySelector('.split-screen').style.display = 'flex';
 
        const video1 = document.getElementById('video1');
        const video2 = document.getElementById('video2');
 
        video1.src = `/static/${videos[0].video_path}`;
        video2.src = `/static/${videos[1].video_path}`;
 
        video1.muted = localStorage.getItem(`sensor_${sensor1}_muted`) === 'true';
        video2.muted = localStorage.getItem(`sensor_${sensor2}_muted`) === 'true';
 
        [video1, video2].forEach(v => {
            v.loop = true;
            v.style.display = 'block';
        });
 
        await Promise.all([tryPlayVideo(video1), tryPlayVideo(video2)]);
        currentMode = 'versus';
    } catch (error) {
        debugLog(`Error en versus: ${error.message}`);
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

// Continúa con switchToTripleMode y switchToQuadMode...

async function switchToTripleMode(sensors) {
    debugLog(`Iniciando triple: ${sensors.join(' vs ')}`);
    try {
        stopAllVideos();
        const [videos, extraContentResponse] = await Promise.all([
            Promise.all(sensors.map(getVideoForSensor)),
            fetch('/api/extra-content').then(r => r.json())
        ]);

        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.split-screen').style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'grid';

        // Mapear posiciones a índices
        const positionMap = {
            'top-left': 0,
            'top-right': 1,
            'bottom-left': 2,
            'bottom-right': 3
        };

        // Obtener el índice para el contenido extra
        const extraContentIndex = positionMap[extraContentResponse.position] || 3;
        const videoElements = ['quad1', 'quad2', 'quad3', 'quad4'].map(id => document.getElementById(id));
        
        // Limpiar todos los videos
        videoElements.forEach(v => {
            v.style.display = 'none';
            v.src = '';
        });

        // Asignar videos principales evitando la posición del contenido extra
        let videoIndex = 0;
        for (let i = 0; i < 4; i++) {
            if (i === extraContentIndex) continue;
            if (videoIndex < videos.length) {
                videoElements[i].src = `/static/${videos[videoIndex].video_path}`;
                videoElements[i].style.display = 'block';
                await tryPlayVideo(videoElements[i]);
                videoIndex++;
            }
        }

        // Configurar contenido extra
        if (extraContentResponse.path) {
            const extraVideo = videoElements[extraContentIndex];
            if (extraContentResponse.type === 'video') {
                extraVideo.src = `/static/${extraContentResponse.path}`;
                extraVideo.style.display = 'block';
                await tryPlayVideo(extraVideo);
            }
        }

        currentMode = 'triple';
    } catch (error) {
        debugLog(`Error en modo triple: ${error.message}`);
        await switchToBackgroundMode();
    }
}


async function getVideoForSensor(sensorId) {
    const response = await fetch(`/api/sensor_video/${sensorId}`);
    if (!response.ok) throw new Error(`Error obteniendo video para sensor ${sensorId}`);
    return response.json();
}


async function switchToQuadMode(sensors) {
    debugLog(`Iniciando quad: ${sensors.join(' vs ')}`);
    try {
        stopAllVideos();
        const videos = await Promise.all(sensors.map(getVideoForSensor));
 
        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.split-screen').style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'grid';
        document.getElementById('extra-content').style.display = 'none';
 
        for (let i = 0; i < 4; i++) {
            const video = document.getElementById(`quad${i+1}`);
            video.src = `/static/${videos[i].video_path}`;
            video.muted = localStorage.getItem(`sensor_${sensors[i]}_muted`) === 'true';
            video.loop = true;
            video.style.display = 'block';
            await tryPlayVideo(video);
        }
 
        currentMode = 'quad';
    } catch (error) {
        debugLog(`Error en modo quad: ${error.message}`);
        await switchToBackgroundMode();
    }
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