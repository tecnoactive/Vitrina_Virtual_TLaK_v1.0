class VideoPreloader {
    constructor() {
        this.videoCache = new Map();
        this.loadingPromises = new Map();
        this.totalVideos = 0;
        this.loadedVideos = 0;
    }
 
    createLoadingScreen() {
        const loadingScreen = document.createElement('div');
        loadingScreen.id = 'loading-screen';
        loadingScreen.innerHTML = `
            <div class="loading-content">
                <h1>Iniciando Sistema TecnoActive</h1><br>
                <h2>Vitrina Digital</h2>
                <div class="loading-bar">
                    <div class="loading-bar-progress"></div>
                </div>
                <div id="loading-text">0%</div>
            </div>
        `;
        return loadingScreen;
    }
 
    showLoadingScreen() {
        if (!document.getElementById('loading-screen')) {
            document.body.appendChild(this.createLoadingScreen());
        }
        document.getElementById('loading-screen').style.display = 'flex';
    }
 
    hideLoadingScreen() {
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
        this.loadedVideos++;
        const progress = (this.loadedVideos / this.totalVideos) * 100;
        const progressBar = document.querySelector('.loading-bar-progress');
        const loadingText = document.getElementById('loading-text');
        
        if (progressBar) {
            progressBar.style.setProperty('--progress', `${progress}%`);
        }
        if (loadingText) {
            loadingText.textContent = `${Math.round(progress)}%`;
        }
    }
 
    isValidVideoPath(path) {
        // Verificar si la ruta termina con una extensión de video válida
        const validExtensions = ['.mp4', '.webm', '.mov'];
        return validExtensions.some(ext => path.toLowerCase().endsWith(ext));
    }
 
    async preloadVideo(id, path) {
        // Verificar si es un video válido
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
                this.videoCache.set(id, video);
                this.updateProgress();
                resolve(video);
            };
 
            video.onerror = () => {
                console.warn(`Error cargando video: ${path}`);
                resolve(null); // Resolvemos con null en lugar de rechazar
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
            // Modificar URLs para usar rutas públicas
            if (url.includes('/api/sensor_videos')) {
                url = '/api/public/sensor_videos';
            } else if (url.includes('/api/background_videos')) {
                url = '/api/public/background_videos';
            }
    
            console.log('Fetching from:', url); // Debug
    
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error en ${url}: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('Received data:', data); // Debug
            return data;
        } catch (error) {
            console.warn(`Error obteniendo videos de ${url}:`, error);
            return [];
        }
    }
 
    async init() {
        this.showLoadingScreen();
        
        try {
            // Obtener solo los videos necesarios
            const [sensorVideos, backgroundVideos] = await Promise.all([
                this.fetchVideos('/api/sensor_videos'),
                this.fetchVideos('/api/background_videos')
            ]);
 
            let videosToLoad = [];
 
            // Filtrar y agregar solo videos válidos
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
 
            // Filtrar videos que no se pudieron cargar
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
        background: #000;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        transition: opacity 0.5s;
    }
 
    .loading-content {
        text-align: center;
        color: white;
        font-family: Arial, sans-serif;
    }
 
    .loading-content h2 {
        margin-bottom: 20px;
        font-size: 24px;
    }
 
    .loading-bar {
        width: 300px;
        height: 4px;
        background: #333;
        margin: 20px auto;
        border-radius: 2px;
        overflow: hidden;
    }
 
    .loading-bar-progress {
        width: var(--progress, 0%);
        height: 100%;
        background: #007bff;
        transition: width 0.3s;
    }
 
    .error {
        color: #ff4444;
        margin-top: 10px;
        padding: 10px;
        background: rgba(255,0,0,0.1);
        border-radius: 4px;
    }
 `;
 
 // Inicialización
 const styleSheet = document.createElement('style');
 styleSheet.textContent = styles;
 document.head.appendChild(styleSheet);
 
 // Crear y exponer la instancia global 
 window.videoPreloader = new VideoPreloader();