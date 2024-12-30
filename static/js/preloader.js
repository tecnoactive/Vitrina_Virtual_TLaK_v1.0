// /static/js/preloader.js

class VideoPreloader {
    constructor() {
        this.videoCache = new Map();
        this.loadingPromises = new Map();
        this.totalVideos = 0;
        this.loadedVideos = 0;
        this.loadingMessages = [
            "Iniciando sistema...",
            "Cargando videos de sensores...",
            "Preparando contenido interactivo...",
            "Configurando playlist de fondo...",
            "Optimizando experiencia...",
            "Estamos casi Listos...",
            "Vale La pena la Espera, te lo aseguro ...",
            "¡Casi listo! ",
            "¿Qué le dijo Batman a Robin antes de subir al coche? Robin, sube al coche.",
            "¿Cómo se despiden los químicos? Ácido un placer.",
            "¿Cómo se llama el campeón de buceo japonés? Tokofondo.",

        ];
        this.currentMessageIndex = 0;
        this.messageInterval = null;
    }

    createLoadingScreen() {
        const loadingScreen = document.createElement('div');
        loadingScreen.id = 'loading-screen';
        loadingScreen.innerHTML = `
            <div class="loading-content">
                <div class="logo-container">
                    <img src="/static/images/logo_.png" alt="Logo" class="loading-logo">
                </div>
                <h1>Vitrina Digital Dermocoaching</h1>
                <h2>by TecnoActive</h2>
                <div class="loading-animation">
                    <div class="loading-circle"></div>
                    <div class="loading-circle"></div>
                    <div class="loading-circle"></div>
                </div>
                <div id="loading-message" class="loading-message">Iniciando sistema...</div>
                <div class="loading-bar">
                    <div class="loading-bar-progress"></div>
                </div>
                <div id="loading-text" class="loading-percentage">0%</div>
            </div>
        `;
        return loadingScreen;
    }

    startMessageRotation() {
        this.messageInterval = setInterval(() => {
            const messageElement = document.getElementById('loading-message');
            if (messageElement) {
                this.currentMessageIndex = (this.currentMessageIndex + 1) % this.loadingMessages.length;
                messageElement.style.opacity = '0';
                setTimeout(() => {
                    messageElement.textContent = this.loadingMessages[this.currentMessageIndex];
                    messageElement.style.opacity = '1';
                }, 200);
            }
        }, 3000);
    }

    showLoadingScreen() {
        if (!document.getElementById('loading-screen')) {
            document.body.appendChild(this.createLoadingScreen());
            this.startMessageRotation();
        }
        document.getElementById('loading-screen').style.display = 'flex';
    }

    hideLoadingScreen() {
        clearInterval(this.messageInterval);
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.remove();
            }, 500);
        }
    }

    showInterface() {
        const container = document.querySelector('.video-container');
        if (container) {
            container.style.display = 'block';
        }
    }

    showError(message) {
        const loadingContent = document.querySelector('.loading-content');
        if (loadingContent) {
            // Limpiar errores anteriores
            const previousError = loadingContent.querySelector('.error');
            if (previousError) {
                previousError.remove();
            }

            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = message;
            loadingContent.appendChild(errorDiv);
        }
    }

    updateProgress() {
        const progress = Math.min((this.loadedVideos / this.totalVideos) * 100, 100);
        const progressBar = document.querySelector('.loading-bar-progress');
        const loadingText = document.getElementById('loading-text');
        
        if (progressBar) {
            progressBar.style.setProperty('--progress', `${progress}%`);
        }
        if (loadingText) {
            loadingText.textContent = `${Math.round(progress)}%`;
            
            // Actualizar mensaje basado en el progreso
            const messageIndex = Math.floor((progress / 100) * (this.loadingMessages.length - 1));
            const messageElement = document.getElementById('loading-message');
            if (messageElement) {
                messageElement.textContent = this.loadingMessages[messageIndex];
            }
        }
    }

    isValidVideoPath(path) {
        const validExtensions = ['.mp4', '.webm', '.mov'];
        return validExtensions.some(ext => path.toLowerCase().endsWith(ext));
    }

    async preloadVideo(id, path) {
        if (!this.isValidVideoPath(path)) {
            console.log(`Saltando recurso no válido: ${path}`);
            return null;
        }

        if (this.videoCache.has(id)) {
            return this.videoCache.get(id);
        }

        if (this.loadingPromises.has(id)) {
            return this.loadingPromises.get(id);
        }

        const loadingPromise = new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'auto';

            video.onloadeddata = () => {
                this.loadedVideos++;
                this.videoCache.set(id, video);
                this.updateProgress();
                resolve(video);
            };

            video.onerror = () => {
                console.warn(`Error cargando video: ${path}`);
                resolve(null);
            };

            video.src = path;
        });

        this.loadingPromises.set(id, loadingPromise);

        try {
            return await loadingPromise;
        } finally {
            this.loadingPromises.delete(id);
        }
    }

    async fetchVideos(url) {
        try {
            if (url.includes('/api/public/sensor_videos')) {
                url = '/api/public/sensor_videos';
            } else if (url.includes('/api/public/background_videos')) {
                url = '/api/public/background_videos';
            }

            console.log('Fetching from:', url);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error en ${url}: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('Received data:', data);
            return data;
        } catch (error) {
            console.warn(`Error obteniendo videos de ${url}:`, error);
            return [];
        }
    }

    async init() {
        this.showLoadingScreen();
        
        try {
            const [sensorVideos, backgroundVideos] = await Promise.all([
                this.fetchVideos('/api/public/sensor_videos'),
                this.fetchVideos('/api/public/background_videos')
            ]);

            let videosToLoad = [];

            if (Array.isArray(sensorVideos)) {
                const validSensorVideos = sensorVideos
                    .filter(v => v.video_path && this.isValidVideoPath(v.video_path))
                    .map(v => ({
                        id: `sensor-${v.sensor_id}`,
                        path: `/static/${v.video_path}`
                    }));
                videosToLoad.push(...validSensorVideos);
            }

            if (Array.isArray(backgroundVideos)) {
                const validBackgroundVideos = backgroundVideos
                    .filter(v => v.video_path && this.isValidVideoPath(v.video_path))
                    .map(v => ({
                        id: `background-${v.id}`,
                        path: `/static/${v.video_path}`
                    }));
                videosToLoad.push(...validBackgroundVideos);
            }

            this.totalVideos = videosToLoad.length;
            
            if (this.totalVideos === 0) {
                console.log('No se encontraron videos para cargar');
                this.hideLoadingScreen();
                this.showInterface();
                return;
            }
            
            const loadedVideos = await Promise.all(
                videosToLoad.map(video => this.preloadVideo(video.id, video.path))
            );

            const successfullyLoaded = loadedVideos.filter(v => v !== null);
            console.log(`Videos cargados exitosamente: ${successfullyLoaded.length}/${this.totalVideos}`);
            
            this.hideLoadingScreen();
            this.showInterface();
            
        } catch (error) {
            console.error('Error precargando videos:', error);
            this.showError('Error cargando videos. Intentando de nuevo...');
            setTimeout(() => this.init(), 5000);
        }
    }
}

// Estilos para la pantalla de carga
const styles = `
    #loading-screen {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #1a1a1a, #2c3e50);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        transition: opacity 0.5s;
    }

    .loading-content {
        text-align: center;
        color: white;
        font-family: 'Helvetica Neue', Arial, sans-serif;
        padding: 2rem;
    }

    .logo-container {
        margin-bottom: 2rem;
    }

    .loading-logo {
        width: 200px;
        height: auto;
        margin-bottom: 1rem;
    }

    .loading-content h1 {
        font-size: 2.5rem;
        margin: 0;
        background: linear-gradient(45deg, #fff, #7dd3fc);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .loading-content h2 {
        font-size: 1.5rem;
        margin: 0.5rem 0 2rem;
        opacity: 0.8;
    }

    .loading-animation {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        margin: 2rem 0;
    }

    .loading-circle {
        width: 12px;
        height: 12px;
        background: #fff;
        border-radius: 50%;
        animation: bounce 0.5s ease-in-out infinite;
    }

    .loading-circle:nth-child(2) {
        animation-delay: 0.1s;
    }

    .loading-circle:nth-child(3) {
        animation-delay: 0.2s;
    }

    .loading-message {
        font-size: 1.2rem;
        margin: 1rem 0;
        min-height: 1.5em;
        transition: opacity 0.2s;
    }

    .loading-bar {
        width: 300px;
        height: 6px;
        background: rgba(255,255,255,0.1);
        margin: 1.5rem auto;
        border-radius: 3px;
        overflow: hidden;
    }

    .loading-bar-progress {
        width: var(--progress, 0%);
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #7dd3fc);
        transition: width 0.3s ease-out;
    }

    .loading-percentage {
        font-size: 1.2rem;
        font-weight: bold;
        color: #7dd3fc;
    }

    @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
    }

    .error {
        color: #ff4444;
        margin-top: 1rem;
        padding: 1rem;
        background: rgba(255,0,0,0.1);
        border-radius: 8px;
        font-size: 0.9rem;
    }
`;

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    // Crear y exponer la instancia global
    window.videoPreloader = new VideoPreloader();
});