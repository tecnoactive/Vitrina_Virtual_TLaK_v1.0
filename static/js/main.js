// Variables globales y de estado (coloca esto al inicio del archivo)
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
const SENSOR_CHECK_INTERVAL = 300;
const DEBOUNCE_DELAY = 500;

// Variables de conexión
let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// Variables de estado de reproducción
let currentMode = 'background';
let currentSensorId = null;
let backgroundPlayer = null;
let autoplayInitialized = false;

// Variables de monitoreo
let lastActiveSensors = [];
let isTransitioning = false;
let lastCheckTime = 0;
let debounceTimeout = null;
let debounceTimer = null;
let assignedSensors = new Set();

// Variables de activación y timers
let activationTimers = new Map();

// Debug
const DEBUG = localStorage.getItem('debugEnabled') === 'true';
const debugPanel = document.getElementById('debug-panel');

function debugLog(message) {
    const time = new Date().toLocaleTimeString(); // Mover declaración aquí
    
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
            
            panel.innerHTML = `${time}: ${message}<br>${panel.innerHTML}`
                .split('<br>').slice(0, 50).join('<br>');
            console.log(`[DEBUG] ${time}: ${message}`);
        }
    } else if (debugPanel) {
        debugPanel.style.display = 'none';
    }
}

function logError(error, context) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error in ${context}:`, error);
    debugLog(`Error en ${context}: ${errorMessage}`);
}


// Inicialización del debug panel
function initDebugPanel() {
    if (debugPanel) {
        debugPanel.style.display = DEBUG ? 'block' : 'none';
    }
}

// Wrapper para fetch con logging
async function fetchWithLogging(url, options = {}) {
    try {
        debugLog(`Realizando fetch a: ${url}`);
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        debugLog(`Respuesta recibida de ${url}`);
        return data;
    } catch (error) {
        logError(error, `fetch a ${url}`);
        throw error;
    }
}

// Clase BackgroundPlaylist mejorada
class BackgroundPlaylist {
    constructor() {
        this.playlist = [];
        this.currentIndex = 0;
        this.video = null;
        this.isPlaying = false;
        this.isLoading = false;
    }

    init(video) {
        this.video = video;
        this.video.removeAttribute('loop');
        this.video.preload = "auto";
        
        this.video.addEventListener('ended', () => {
            if (!this.isLoading) this.playNext();
        });
        
        this.video.addEventListener('error', (e) => {
            console.error('Error playing video:', e);
            if (!this.isLoading) this.playNext();
        });

        this.video.addEventListener('canplay', () => {
            this.isLoading = false;
        });

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
            if (this.playlist.length > 0) {
                await this.play();
            }
        } catch (error) {
            console.error('Error loading playlist:', error);
        }
    }

    async play() {
        if (!this.playlist.length || !this.video || this.isLoading) return;
        
        try {
            this.isLoading = true;
            const currentVideo = this.playlist[this.currentIndex];
            
            if (this.video.src === `/static/${currentVideo.video_path}`) {
                this.isLoading = false;
                return;
            }

            this.video.style.objectFit = 'contain';
            this.video.playsInline = true;
            this.video.muted = true;
            this.video.src = `/static/${currentVideo.video_path}`;
            this.video.load();
            
            const playPromise = this.video.play();
            if (playPromise !== undefined) {
                await playPromise;
                this.isPlaying = true;
            }
        } catch (error) {
            console.error('Error playing video:', error);
            this.isLoading = false;
            setTimeout(() => this.playNext(), 1000);
        }
    }

    playNext() {
        if (this.isLoading) return;
        this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
        this.play();
    }
}

// Funciones de monitoreo de sensores
async function loadAssignedSensors() {
    try {
        const response = await fetch('/api/sensor_videos');
        const videos = await response.json();
        assignedSensors = new Set(videos.map(v => v.sensor_id));
        debugLog(`Sensores con videos asignados: ${Array.from(assignedSensors).join(', ')}`);
    } catch (error) {
        debugLog(`Error cargando sensores asignados: ${error.message}`);
    }
}

async function checkSensors() {
    if (isTransitioning) return;

    try {
        const response = await fetch('/api/sensor_status');
        const data = await response.json();
        const activeSensors = data.active_sensors || [];
        
        // Filtrar solo sensores que tienen videos asignados
        const relevantSensors = activeSensors.filter(sensor => assignedSensors.has(sensor));

        // Si hay un cambio, actualizar inmediatamente
        if (JSON.stringify(relevantSensors) !== JSON.stringify(lastActiveSensors)) {
            // Solo usar debounce si hay múltiples sensores activos
            if (relevantSensors.length > 1) {
                if (debounceTimer) clearTimeout(debounceTimer);
                
                debounceTimer = setTimeout(async () => {
                    await handleSensorChange(relevantSensors);
                    lastActiveSensors = relevantSensors;
                }, DEBOUNCE_DELAY);
            } else {
                // Para un solo sensor, actualizar inmediatamente
                await handleSensorChange(relevantSensors);
                lastActiveSensors = relevantSensors;
            }
        }
    } catch (error) {
        debugLog(`Error en checkSensors: ${error.message}`);
    }
}


async function handleSensorChange(activeSensors) {
    if (isTransitioning) return;
    isTransitioning = true;

    try {
        const config = await fetch('/api/system-config').then(r => r.json());
        const versusMode = parseInt(config.versus_mode) || 1;
        debugLog(`Modo actual: ${versusMode}, Sensores activos: ${activeSensors.length}`);

        // Si no hay sensores activos, mostrar video de fondo
        if (activeSensors.length === 0) {
            debugLog('No hay sensores activos, cambiando a modo fondo');
            await switchToBackgroundMode();
            return;
        }

        // Manejar los diferentes modos
        try {
            switch (versusMode) {
                case 1: // Modo único
                    const lastSensor = activeSensors[activeSensors.length - 1];
                    debugLog(`Cambiando a modo único con sensor: ${lastSensor}`);
                    await switchToSingleMode(lastSensor);
                    break;
                case 2: // Modo versus
                    if (activeSensors.length >= 2) {
                        const lastTwo = activeSensors.slice(-2);
                        debugLog(`Cambiando a modo versus con sensores: ${lastTwo.join(', ')}`);
                        await switchToVersusMode(lastTwo[0], lastTwo[1]);
                    } else {
                        debugLog(`Cambiando a modo único (en versus) con sensor: ${activeSensors[0]}`);
                        await switchToSingleMode(activeSensors[0]);
                    }
                    break;
                default:
                    debugLog(`Modo no soportado: ${versusMode}, cambiando a modo fondo`);
                    await switchToBackgroundMode();
            }
        } catch (error) {
            debugLog(`Error cambiando modo: ${error.message}`);
            await switchToBackgroundMode();
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
    
    // Detener otros videos
    stopAllVideos();
    
    // Mostrar y reproducir video de fondo
    if (backgroundPlayer && backgroundPlayer.video) {
        backgroundPlayer.video.style.display = 'block';
        await backgroundPlayer.play();
    }
    
    // Ocultar otros contenedores
    if (splitScreen) splitScreen.style.display = 'none';
    if (quadScreen) quadScreen.style.display = 'none';
    
    currentMode = 'background';
}

async function switchToSingleMode(sensorId) {
    if (currentMode === 'single' && currentSensorId === sensorId) return;

    debugLog(`Modo único - Sensor ${sensorId}`);
    try {
        const [videoResponse] = await Promise.all([
            fetch(`/api/sensor_video/${sensorId}`),
            handleSensorActivation(sensorId) // Registrar activación en paralelo
        ]);
        
        const videoData = await videoResponse.json();
        
        if (!videoData.video_path) {
            throw new Error('Video no encontrado');
        }

        stopAllVideos();
        hideAllContainers();

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


document.addEventListener('DOMContentLoaded', async () => {
    try {
        initDebugPanel();
        debugLog('Iniciando aplicación...');

        await loadAssignedSensors();
        
        backgroundPlayer = new BackgroundPlaylist();
        await checkServerConnection();
        
        const config = await fetchWithLogging('/api/system-config');
        const currentMode = parseInt(config.versus_mode || '1');
        
        setupVideoEventListeners();
        
        // Iniciar monitoreo de sensores sin esperar
        initSensorMonitoring().catch(error => {
            debugLog(`Error en monitoreo inicial: ${error.message}`);
        });
        
        await handleAutoplay();
        debugLog(`Sistema iniciado en modo: ${currentMode}`);
    } catch (error) {
        logError(error, 'inicialización');
        showConnectionError();
    }
});


// Se mantienen el resto de las funciones auxiliares igual...
function hideAllContainers() {
    const splitScreen = document.querySelector('.split-screen');
    const quadScreen = document.querySelector('.quad-screen');
    if (splitScreen) splitScreen.style.display = 'none';
    if (quadScreen) quadScreen.style.display = 'none';
}

function startSensorMonitoring() {
    debugLog('Configurando intervalo de monitoreo');
    if (window.sensorInterval) {
        clearInterval(window.sensorInterval);
    }
    window.sensorInterval = setInterval(checkSensors, SENSOR_CHECK_INTERVAL);
}

// Funciones auxiliares de video
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

// Funciones de autoplay
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

// Funciones de configuración
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

// Funciones de registro de actividad


async function handleSensorActivation(sensorId) {
    if (!activationTimers) {
        activationTimers = new Map();
    }

    if (activationTimers.has(sensorId)) return;
    
    const startTime = Date.now();
    activationTimers.set(sensorId, startTime);
    
    try {
        // Registrar la activación inmediatamente
        const response = await fetch('/api/register_activation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sensor_id: sensorId,
                duration: 0 // La duración se calculará en el backend
            })
        });
        
        if (!response.ok) {
            throw new Error(`Error registrando activación: ${response.status}`);
        }
    } catch (error) {
        debugLog(`Error en activación: ${error.message}`);
    } finally {
        // Limpiar el timer después de un breve retraso
        setTimeout(() => {
            activationTimers.delete(sensorId);
        }, 1000);
    }
}


// Funciones de UI
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

// Funciones para modos múltiples
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
        
        // Registrar activaciones
        handleSensorActivation(sensor1);
        handleSensorActivation(sensor2);
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

async function initSensorMonitoring() {
    debugLog('Iniciando monitoreo de sensores...');
    try {
        // Verificar estado inicial de sensores
        const response = await fetch('/api/sensor_status');
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Error de servidor: ${response.status}`);
        }

        debugLog(`Estado inicial de sensores: ${JSON.stringify(data.status)}`);
        
        // Iniciar monitoreo periódico
        startSensorMonitoring();
        debugLog('Monitoreo de sensores iniciado exitosamente');
        
        return true;
    } catch (error) {
        debugLog(`Error iniciando monitoreo: ${error.message}`);
        // No lanzar error, solo registrarlo y continuar
        return false;
    }
}



async function switchToTripleMode(sensors) {
    debugLog(`Iniciando modo triple con sensores: ${sensors.join(', ')}`);
    try {
        stopAllVideos();
        
        // Obtener videos para los tres sensores
        const videos = await Promise.all(
            sensors.map(sensor => getVideoForSensor(sensor))
        );
        
        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.split-screen').style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'grid';
        
        // Configurar los tres videos principales
        const videoElements = ['quad1', 'quad2', 'quad3'].map(id => document.getElementById(id));
        
        for (let i = 0; i < videos.length; i++) {
            const video = videoElements[i];
            if (video && videos[i]) {
                video.src = `/static/${videos[i].video_path}`;
                video.muted = localStorage.getItem(`sensor_${sensors[i]}_muted`) === 'true';
                video.loop = true;
                video.style.display = 'block';
            }
        }

        // Cargar contenido extra si existe
        await loadExtraContent();
        
        await Promise.all(videoElements.map(video => video && tryPlayVideo(video)));
        currentMode = 'triple';
        
        // Registrar activaciones
        sensors.forEach(sensor => handleSensorActivation(sensor));
    } catch (error) {
        debugLog(`Error en modo triple: ${error.message}`);
        await switchToBackgroundMode();
    }
}

async function switchToQuadMode(sensors) {
    debugLog(`Iniciando modo quad con sensores: ${sensors.join(', ')}`);
    try {
        stopAllVideos();
        
        const videos = await Promise.all(
            sensors.map(sensor => getVideoForSensor(sensor))
        );
        
        backgroundPlayer.video.style.display = 'none';
        document.querySelector('.split-screen').style.display = 'none';
        document.querySelector('.quad-screen').style.display = 'grid';
        
        const videoElements = ['quad1', 'quad2', 'quad3', 'quad4']
            .map(id => document.getElementById(id));
        
        for (let i = 0; i < videos.length; i++) {
            const video = videoElements[i];
            if (video && videos[i]) {
                video.src = `/static/${videos[i].video_path}`;
                video.muted = localStorage.getItem(`sensor_${sensors[i]}_muted`) === 'true';
                video.loop = true;
                video.style.display = 'block';
            }
        }
        
        await Promise.all(videoElements.map(video => video && tryPlayVideo(video)));
        currentMode = 'quad';
        
        // Registrar activaciones
        sensors.forEach(sensor => handleSensorActivation(sensor));
    } catch (error) {
        debugLog(`Error en modo quad: ${error.message}`);
        await switchToBackgroundMode();
    }
}

async function loadExtraContent() {
    try {
        const response = await fetch('/api/extra-content');
        const data = await response.json();
        
        if (data.path) {
            const extraContainer = document.getElementById('extra-content');
            if (!extraContainer) return;
            
            extraContainer.style.display = 'block';
            
            if (data.type === 'video') {
                extraContainer.innerHTML = `
                    <video autoplay loop muted playsinline>
                        <source src="/static/${data.path}" type="video/mp4">
                    </video>`;
            } else if (data.type === 'image') {
                extraContainer.innerHTML = `<img src="/static/${data.path}" alt="Extra content">`;
            }
            
            if (data.position) {
                extraContainer.className = `extra-content ${data.position}`;
            }
        }
    } catch (error) {
        debugLog(`Error cargando contenido extra: ${error.message}`);
    }
}

// Inicialización principal
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Inicializar debug panel
        initDebugPanel();
        debugLog('Iniciando aplicación...');

        // Cargar sensores con videos asignados
        await loadAssignedSensors();
        
        // Inicializar reproductor de fondo
        backgroundPlayer = new BackgroundPlaylist();
        
        // Verificar conexión con el servidor
        await checkServerConnection();
        
        // Cargar configuración
        const config = await fetchWithLogging('/api/system-config');
        const currentMode = parseInt(config.versus_mode || '1');
        
        // Configurar videos y monitoreo
        setupVideoEventListeners();
        await initSensorMonitoring();
        await handleAutoplay();

        debugLog(`Sistema iniciado en modo: ${currentMode}`);
    } catch (error) {
        logError(error, 'inicialización');
        showConnectionError();
    }
});