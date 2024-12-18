// Variables globales
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
const SENSOR_CHECK_INTERVAL = 100;
let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// Variables de estado
let currentMode = 'background';
let currentSensorId = null;
let lastActiveSensors = [];
let isTransitioning = false;
let autoplayInitialized = false;
let lastCheckTime = 0;
let debounceTimeout = null;
let backgroundPlayer = null;
let activationTimers = new Map();
let debounceTimer = null;
const DEBOUNCE_DELAY = 1000; // 1 segundo



// Debug
const DEBUG = localStorage.getItem('debugEnabled') === 'true';
const debugPanel = document.getElementById('debug-panel');

class BackgroundPlaylist {
    constructor() {
        this.playlist = [];
        this.currentIndex = 0;
        this.video = null;
        this.isPlaying = false;
    }

    init(video) {
        this.video = video;
        
        // Remover el atributo loop para asegurar que los eventos 'ended' se disparen
        this.video.removeAttribute('loop');
        
        // Configurar el evento ended
        this.video.addEventListener('ended', () => {
            console.log('Video ended, playing next');
            this.playNext();
        });
        
        // Manejar errores de reproducción
        this.video.addEventListener('error', (e) => {
            console.error('Error playing video:', e);
            this.playNext();
        });
        
        // Iniciar la carga
        this.load();
    }

    async load() {
        try {
            const response = await fetch('/api/background_videos');
            if (!response.ok) throw new Error('Error loading playlist');
            
            const videos = await response.json();
            if (!Array.isArray(videos) || videos.length === 0) {
                throw new Error('No videos in playlist');
            }
            
            this.playlist = videos.sort((a, b) => a.orden - b.orden);
            console.log('Playlist loaded:', this.playlist);
            
            if (this.playlist.length > 0) {
                await this.play();
            }
        } catch (error) {
            console.error('Error loading playlist:', error);
        }
    }

    async play() {
        if (!this.playlist.length || !this.video) return;
        
        try {
            console.log('Playing video index:', this.currentIndex);
            const currentVideo = this.playlist[this.currentIndex];
            
            // Prevenir que se reproduzca el mismo video
            if (this.video.src === `/static/${currentVideo.video_path}`) {
                this.playNext();
                return;
            }

            this.video.src = `/static/${currentVideo.video_path}`;
            this.video.load();
            
            const playPromise = this.video.play();
            if (playPromise !== undefined) {
                await playPromise;
                this.isPlaying = true;
            }
        } catch (error) {
            console.error('Error playing video:', error);
            setTimeout(() => this.playNext(), 1000);
        }
    }

    playNext() {
        this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
        console.log('Moving to next video, index:', this.currentIndex);
        this.play();
    }
}

// Funciones de Debug
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
            panel.innerHTML = `${time}: ${message}<br>${panel.innerHTML}`
                .split('<br>').slice(0, 50).join('<br>');
            console.log(`[DEBUG] ${time}: ${message}`);
        }
    } else {
        debugPanel.style.display = 'none';
    }
}

// Inicialización principal
document.addEventListener('DOMContentLoaded', async () => {
    backgroundPlayer = new BackgroundPlaylist();
    try {
        await checkServerConnection();
        
        const configResponse = await fetch('/api/system-config');
        const config = await configResponse.json();
        const currentMode = parseInt(config.versus_mode || '1');
        
        setupVideoEventListeners();
        debugPanel.style.display = localStorage.getItem('debugEnabled') === 'true' ? 'block' : 'none';
        await initSensorMonitoring();
        await handleAutoplay();

        const versusMode = document.getElementById('versus-mode');
        if (versusMode) {
            versusMode.value = currentMode;
        }

        debugLog(`Sistema iniciado en modo: ${currentMode}`);
    } catch (error) {
        debugLog(`Error en inicialización: ${error.message}`);
        showConnectionError();
    }
});

async function handleSensorActivation(sensorId) {
    // Si ya hay un timer para este sensor, lo ignoramos
    if (activationTimers.has(sensorId)) return;
    
    const startTime = Date.now();
    activationTimers.set(sensorId, startTime);
    
    // Esperar 5 segundos
    setTimeout(async () => {
        const currentTime = Date.now();
        const duration = currentTime - startTime;
        
        // Si el video se reprodujo por más de 5 segundos
        if (duration >= 5000) {
            try {
                // Registrar la activación
                const response = await fetch('/api/register_activation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        sensor_id: sensorId,
                        duration: duration
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Error registering activation');
                }
            } catch (error) {
                console.error('Error:', error);
            }
        }
        
        // Limpiar el timer
        activationTimers.delete(sensorId);
    }, 5000);
}

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
    
    const mainVideo = videos[0];
    if (mainVideo) {
        backgroundPlayer.init(mainVideo);
    }

    videos.forEach(video => {
        if (!video) return;
        video.addEventListener('play', () => debugLog(`Video iniciado: ${video.id}`));
        video.addEventListener('error', (e) => debugLog(`Error en video ${video.id}: ${e.message}`));
    });
}

// Funciones de manejo de videos
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

async function tryPlayVideo(video) {
    if (!video || !video.src) return;
    
    try {
        video.muted = true;
        await video.play();
    } catch (error) {
        debugLog(`Error reproduciendo video ${video.id}: ${error.message}`);
    }
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

        // Solo actualizar si realmente hay un cambio
        if (JSON.stringify(activeSensors) !== JSON.stringify(lastActiveSensors)) {
            // Limpiar timer existente
            if (debounceTimer) clearTimeout(debounceTimer);
            
            // Establecer nuevo timer
            debounceTimer = setTimeout(async () => {
                debugLog(`Cambio en sensores: ${activeSensors.join(', ')}`);
                await handleSensorChange(activeSensors);
                lastActiveSensors = activeSensors;
            }, DEBOUNCE_DELAY);
        }
    } catch (error) {
        debugLog(`Error en monitoreo: ${error.message}`);
    }
}

async function handleSensorChange(activeSensors) {
    if (isTransitioning) return;
    isTransitioning = true;

    try {
        // Si ya hay un video reproduciéndose y los sensores activos incluyen
        // el sensor actual, no hacer nada
        if (currentMode === 'single' && activeSensors.includes(currentSensorId)) {
            isTransitioning = false;
            return;
        }

        const config = await fetch('/api/system-config').then(r => r.json());
        const versusMode = parseInt(config.versus_mode) || 1;
        debugLog(`Modo actual: ${versusMode}, Sensores activos: ${activeSensors.length}`);

        // En modo 1, solo consideramos el primer sensor activo
        if (versusMode === 1) {
            if (activeSensors.length > 0) {
                currentSensorId = activeSensors[0];
                await switchToSingleMode(currentSensorId);
            } else {
                await switchToBackgroundMode();
            }
        } else {
            // Resto de la lógica para otros modos...
        }
    } catch (error) {
        debugLog(`Error en handleSensorChange: ${error.message}`);
        await switchToBackgroundMode();
    } finally {
        isTransitioning = false;
    }
}

async function switchToBackgroundMode() {
    debugLog('Cambiando a modo fondo');
    
    const splitScreen = document.querySelector('.split-screen');
    const quadScreen = document.querySelector('.quad-screen');
    
    stopAllVideos();
    
    backgroundPlayer.video.style.display = 'block';
    splitScreen.style.display = 'none';
    quadScreen.style.display = 'none';
    
    currentMode = 'background';
    await backgroundPlayer.load();
}

async function switchToSingleMode(sensorId) {
    if (currentMode === 'single' && currentSensorId === sensorId) {
        return; // No cambiar si ya estamos mostrando el video de este sensor
    }

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

        const mainVideo = document.getElementById('background-video');
        mainVideo.style.display = 'block';
        mainVideo.src = `/static/${videoData.video_path}`;
        mainVideo.muted = localStorage.getItem(`sensor_${sensorId}_muted`) === 'true';
        mainVideo.loop = true;
        
        await tryPlayVideo(mainVideo);
        currentMode = 'single';
        currentSensorId = sensorId;
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

async function getVideoForSensor(sensorId) {
    const response = await fetch(`/api/sensor_video/${sensorId}`);
    if (!response.ok) throw new Error(`Error obteniendo video para sensor ${sensorId}`);
    return response.json();
}

// Funciones de utilidad UI
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