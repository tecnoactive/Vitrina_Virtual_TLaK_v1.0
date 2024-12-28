// Variables globales y de estado (coloca esto al inicio del archivo)
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
const SENSOR_CHECK_INTERVAL = 100; // Reducido de 250 a 100ms
const DEBOUNCE_DELAY = 200; // Reducido de 500 a 200ms

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
let sensorActivationOrder = [];
let previousActiveSensors = new Set(); 
let lastTriggerTime = {}; // Objeto para almacenar el último tiempo de activación de cada sensor


// Debug
localStorage.setItem('debugEnabled', 'false');

function debugLog(message) {
    if (localStorage.getItem('debugEnabled') === 'true') {
        console.log(`[DEBUG] ${new Date().toLocaleTimeString()}: ${message}`);
    }
}

function logError(error, context) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error in ${context}:`, error);
}

// Reemplazar initDebugPanel con una función vacía ya que no la necesitamos
function initDebugPanel() {
    // No hacer nada
}

// Wrapper para fetch con logging

async function fetchWithLogging(url, options = {}) {
    try {
        debugLog(`Realizando fetch a: ${url}`);
        const response = await fetch(url, options);
        const contentType = response.headers.get("content-type");
        
        if (!response.ok) {
            debugLog(`Error HTTP: ${response.status} ${response.statusText}`);
            const text = await response.text();
            debugLog(`Respuesta de error: ${text.substring(0, 200)}...`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        if (!contentType || !contentType.includes("application/json")) {
            debugLog(`Tipo de contenido inesperado: ${contentType}`);
            const text = await response.text();
            debugLog(`Respuesta no-JSON: ${text.substring(0, 200)}...`);
            throw new Error(`Respuesta no es JSON: ${contentType}`);
        }
        
        const data = await response.json();
        debugLog(`Respuesta recibida de ${url}: ${JSON.stringify(data).substring(0, 200)}...`);
        return data;
    } catch (error) {
        logError(error, `fetch a ${url}`);
        throw error;
    }
}


class BackgroundPlaylist {
    constructor() {
        this.playlist = [];
        this.currentIndex = 0;
        this.video = null;
        this.isTransitioning = false;
    }

    init(video) {
        this.video = video;
        this.video.removeAttribute('loop');
        this.video.muted = true;
        this.video.playsInline = true;
        
        this.video.addEventListener('ended', () => {
            if (!this.isTransitioning) {
                this.playNext();
            }
        });

        this.video.addEventListener('error', (e) => {
            debugLog(`Error en video de fondo: ${e.message}`);
            this.playNext();
        });

        this.load();
    }

    async load() {
        try {
            const response = await fetch('/api/public/background_videos');
            if (!response.ok) throw new Error('Error loading playlist');
            
            const videos = await response.json();
            if (Array.isArray(videos) && videos.length > 0) {
                this.playlist = videos.sort((a, b) => a.orden - b.orden);
                await this.play();
            }
        } catch (error) {
            debugLog(`Error cargando playlist: ${error.message}`);
        }
    }

    async play() {
        if (!this.playlist.length || !this.video || this.isTransitioning) return;
        
        try {
            this.isTransitioning = true;
            const currentVideo = this.playlist[this.currentIndex];
            
            // Precargar el video antes de reproducirlo
            const videoPath = `/static/${currentVideo.video_path}`;
            await new Promise((resolve, reject) => {
                this.video.src = videoPath;
                this.video.load();
                
                const onCanPlay = () => {
                    this.video.removeEventListener('canplay', onCanPlay);
                    resolve();
                };
                
                this.video.addEventListener('canplay', onCanPlay);
                
                // Timeout por si el video tarda demasiado en cargar
                setTimeout(resolve, 3000);
            });

            this.video.style.display = 'block';
            await this.video.play();
            debugLog(`Reproduciendo video de fondo: ${currentVideo.video_path}`);
        } catch (error) {
            debugLog(`Error reproduciendo video de fondo: ${error.message}`);
            setTimeout(() => this.playNext(), 1000);
        } finally {
            this.isTransitioning = false;
        }
    }

    async playNext() {
        if (this.isTransitioning) return;
        
        this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
        await this.play();
    }
}

// Funciones de monitoreo de sensores

async function handleSensorChange(activeSensors) {
    if (isTransitioning) return;
    isTransitioning = true;

    try {
        // Si no hay sensores activos, cambiar a modo fondo inmediatamente
        if (activeSensors.length === 0) {
            debugLog('No hay sensores activos, cambiando a modo fondo');
            lastTriggerTime = {}; // Resetear tiempos
            await switchToBackgroundMode();
            return;
        }

        // Actualizar tiempos de activación para nuevos sensores
        const currentTime = Date.now();
        activeSensors.forEach(sensor => {
            if (!lastTriggerTime[sensor]) {
                lastTriggerTime[sensor] = currentTime;
                debugLog(`Nuevo sensor activado: ${sensor} en tiempo ${currentTime}`);
            }
        });

        // Limpiar tiempos de sensores inactivos
        Object.keys(lastTriggerTime).forEach(sensor => {
            if (!activeSensors.includes(parseInt(sensor))) {
                delete lastTriggerTime[sensor];
            }
        });

        // Ordenar sensores por tiempo de activación (más reciente primero)
        const orderedSensors = activeSensors
            .sort((a, b) => lastTriggerTime[b] - lastTriggerTime[a]);

        // Obtener configuración del sistema en paralelo con otras operaciones
        const configPromise = fetch('/api/system-config').then(r => r.json());
        
        try {
            const config = await configPromise;
            const versusMode = parseInt(config.versus_mode) || 1;

            switch (versusMode) {
                case 1: // Modo único
                    const mostRecentSensor = orderedSensors[0];
                    if (currentSensorId !== mostRecentSensor) {
                        debugLog(`Cambiando a sensor más reciente: ${mostRecentSensor}`);
                        await switchToSingleMode(mostRecentSensor);
                    } else {
                        debugLog(`Manteniendo sensor actual: ${currentSensorId}`);
                        isTransitioning = false;
                    }
                    break;

                case 2: // Modo versus
                    if (orderedSensors.length >= 2) {
                        const [first, second] = orderedSensors;
                        debugLog(`Modo versus con sensores: ${first}, ${second}`);
                        await switchToVersusMode(first, second);
                    } else {
                        debugLog(`Modo único en versus con sensor: ${orderedSensors[0]}`);
                        await switchToSingleMode(orderedSensors[0]);
                    }
                    break;
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

async function loadAssignedSensors() {
    try {
        debugLog('Intentando cargar sensores asignados...');
        const response = await fetch('/api/public/sensor_videos');
        
        if (!response.ok) {
            const text = await response.text();
            debugLog(`Error en respuesta: ${text.substring(0, 200)}...`);
            throw new Error(`Error HTTP: ${response.status}`);
        }

        const videos = await response.json();
        debugLog(`Videos recibidos: ${JSON.stringify(videos)}`);
        
        assignedSensors = new Set(videos.map(v => v.sensor_id));
        debugLog(`Sensores con videos asignados: ${Array.from(assignedSensors).join(', ')}`);
        
        if (assignedSensors.size === 0) {
            debugLog('ADVERTENCIA: No hay sensores con videos asignados');
        }
    } catch (error) {
        debugLog(`Error cargando sensores asignados: ${error.message}`);
        assignedSensors = new Set();
        debugLog('Inicializando con conjunto vacío de sensores');
    }
}

async function checkSensors() {
    if (isTransitioning) {
        debugLog('Saltando checkSensors porque hay una transición en curso');
        return;
    }

    try {
        const response = await fetch('/api/public/sensor_status');
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Error en sensor_status: ${response.status}`);
        }

        const activeSensors = data.active_sensors || [];
        debugLog(`Estado actual de sensores: ${JSON.stringify(data.status)}`);
        debugLog(`Sensores activos: ${activeSensors.join(', ')}`);
        
        // Filtrar solo sensores que tienen videos asignados
        const relevantSensors = activeSensors.filter(sensor => assignedSensors.has(sensor));
        debugLog(`Sensores relevantes: ${relevantSensors.join(', ')}`);

        if (relevantSensors.length > 0) {
            debugLog(`Detectados sensores relevantes: ${relevantSensors.join(', ')}`);
            await handleSensorChange(relevantSensors);
            lastActiveSensors = relevantSensors;
        } else if (lastActiveSensors.length > 0) {
            debugLog('No hay sensores relevantes activos, volviendo a modo background');
            await switchToBackgroundMode();
            lastActiveSensors = [];
        }
    } catch (error) {
        debugLog(`Error en checkSensors: ${error.message}`);
    }
}

async function switchToSingleMode(sensorId) {
    debugLog(`Modo único - Iniciando cambio a sensor ${sensorId}`);
    
    try {
        // Obtener datos del video y preparar el elemento de video en paralelo
        const [videoData] = await Promise.all([
            fetch(`/api/public/sensor_video/${sensorId}`).then(r => r.json()),
            new Promise(resolve => {
                if (backgroundPlayer && backgroundPlayer.video) {
                    backgroundPlayer.video.style.display = 'none';
                }
                resolve();
            })
        ]);
        
        if (!videoData.video_path) {
            throw new Error('Video no encontrado');
        }

        const mainVideo = document.getElementById('background-video');
        if (!mainVideo) {
            throw new Error('Elemento background-video no encontrado');
        }

        // Configuración básica
        mainVideo.src = `/static/${videoData.video_path}`;
        mainVideo.style.display = 'block';
        mainVideo.muted = true;
        mainVideo.loop = true;
        mainVideo.playsInline = true;

        // Reproducir inmediatamente
        const playPromise = mainVideo.play();
        
        // Actualizar estado inmediatamente
        currentMode = 'single';
        currentSensorId = sensorId;
        
        // Configurar tracking en paralelo con la reproducción
        setupVideoTracking(mainVideo, sensorId);
        
        // Esperar a que termine de cargar el video
        await playPromise;

    } catch (error) {
        debugLog(`Error en switchToSingleMode: ${error.message}`);
        await switchToBackgroundMode();
    }
}

async function switchToBackgroundMode() {
    debugLog('Cambiando a modo fondo');
    
    const splitScreen = document.querySelector('.split-screen');
    const quadScreen = document.querySelector('.quad-screen');
    
    if (splitScreen) splitScreen.style.display = 'none';
    if (quadScreen) quadScreen.style.display = 'none';
    
    // Solo cambiar al video de fondo si no estamos ya en modo fondo
    if (currentMode !== 'background') {
        stopAllVideos();
        
        if (backgroundPlayer && backgroundPlayer.video) {
            // Asegurarse de que el video esté listo antes de mostrarlo
            try {
                backgroundPlayer.video.style.opacity = '0';
                backgroundPlayer.video.style.display = 'block';
                backgroundPlayer.video.style.transition = 'opacity 0.5s ease-in-out';
                
                // Esperar a que el video esté listo
                await new Promise((resolve) => {
                    const onCanPlay = () => {
                        backgroundPlayer.video.removeEventListener('canplay', onCanPlay);
                        resolve();
                    };
                    
                    if (backgroundPlayer.video.readyState >= 3) {
                        resolve();
                    } else {
                        backgroundPlayer.video.addEventListener('canplay', onCanPlay);
                    }
                });

                await backgroundPlayer.play();
                backgroundPlayer.video.style.opacity = '1';
                currentMode = 'background';
                currentSensorId = null;
                
            } catch (error) {
                debugLog(`Error cambiando a modo fondo: ${error.message}`);
            }
        }
    }
}

async function setupVideoTracking(video, sensorId) {
    if (!video) return;

    let startTime = null;
    let videoDuration = null;

    video.addEventListener('play', () => {
        startTime = Date.now();
        videoDuration = video.duration * 1000; // Convertir a milisegundos
        debugLog(`Video iniciado para sensor ${sensorId}. Duración: ${videoDuration}ms`);
    });

    video.addEventListener('ended', async () => {
        if (startTime) {
            const duration = Date.now() - startTime;
            await registerActivation(sensorId, duration, true);
            debugLog(`Video completado para sensor ${sensorId}. Duración: ${duration}ms`);
        }
    });

    video.addEventListener('pause', async () => {
        if (startTime) {
            const duration = Date.now() - startTime;
            if (duration >= 5000) { // 5 segundos mínimo
                await registerActivation(sensorId, duration, false);
                debugLog(`Video pausado para sensor ${sensorId}. Duración: ${duration}ms`);
            }
            startTime = null;
        }
    });
}

async function registerActivation(sensorId, duration, completed) {
    try {
        const response = await fetch('/api/register_activation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sensor_id: sensorId,
                duration: duration,
                completed: completed
            })
        });

        if (!response.ok) {
            throw new Error('Error registering activation');
        }
    } catch (error) {
        debugLog(`Error registrando activación: ${error.message}`);
    }
}




// Se mantienen el resto de las funciones auxiliares igual...
function hideAllContainers() {
    const splitScreen = document.querySelector('.split-screen');
    const quadScreen = document.querySelector('.quad-screen');
    if (splitScreen) splitScreen.style.display = 'none';
    if (quadScreen) quadScreen.style.display = 'none';
}

function startSensorMonitoring() {
    debugLog('Iniciando monitoreo de sensores');
    if (window.sensorInterval) {
        clearInterval(window.sensorInterval);
        debugLog('Intervalo anterior limpiado');
    }
    
    // Primer chequeo inmediato
    checkSensors();
    
    // Configurar intervalo
    window.sensorInterval = setInterval(checkSensors, SENSOR_CHECK_INTERVAL);
    debugLog(`Monitoreo configurado cada ${SENSOR_CHECK_INTERVAL}ms`);
}

// Funciones auxiliares de video
function stopAllVideos() {
    document.querySelectorAll('video').forEach(video => {
        try {
            video.pause();
            video.style.display = 'none';
        } catch (e) {
            debugLog(`Error deteniendo video ${video.id}: ${e.message}`);
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
    const response = await fetch(`/api/public/sensor_video/${sensorId}`);
    if (!response.ok) throw new Error(`Error obteniendo video para sensor ${sensorId}`);
    return response.json();
}


async function initSensorMonitoring() {
    debugLog('Iniciando monitoreo de sensores...');
    try {
        // Verificar estado inicial de sensores
        const response = await fetch('/api/public/sensor_status');
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
        initDebugPanel();
        debugLog('Iniciando aplicación...');

        // Cargar sensores
        await loadAssignedSensors();
        
        // Inicializar reproductor de fondo
        const mainVideo = document.getElementById('background-video');
        if (mainVideo) {
            backgroundPlayer = new BackgroundPlaylist();
            backgroundPlayer.init(mainVideo);
        }
        
        // Iniciar monitoreo
        await initSensorMonitoring();
        
        debugLog('Sistema iniciado completamente');
    } catch (error) {
        logError(error, 'inicialización');
        showConnectionError();
    }
});