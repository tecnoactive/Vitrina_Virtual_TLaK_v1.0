// Configuración
const SENSOR_PINS = [17, 27, 4, 5, 6, 13, 18, 22, 26, 19];
let currentUploads = new Set();

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadSensorList();
        await loadBackgroundVideos();
        setupEventListeners();
    } catch (error) {
        console.error('Error en inicialización:', error);
        showError('Error inicializando el panel');
    }
});

// Event Listeners
function setupEventListeners() {
    document.getElementById('logout')?.addEventListener('click', handleLogout);
    
    // Prevenir arrastre de archivos fuera de las zonas de upload
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());
}

// Gestión de sensores
async function loadSensorList() {
    const sensorList = document.getElementById('sensor-list');
    if (!sensorList) return;

    showLoading('Cargando sensores...');
    try {
        const response = await fetch('/api/sensor_videos');
        const currentVideos = await response.json();
        const videoMap = new Map(currentVideos.map(v => [v.sensor_id, v]));

        sensorList.innerHTML = '';
        SENSOR_PINS.forEach(sensorId => {
            const videoInfo = videoMap.get(sensorId);
            const card = createSensorCard(sensorId, videoInfo);
            sensorList.appendChild(card);
        });
    } catch (error) {
        console.error('Error:', error);
        showError('Error cargando sensores');
    } finally {
        hideLoading();
    }
}

// Modificar la función que crea la card de sensor
function createSensorCard(sensorId, videoInfo) {
    const card = document.createElement('div');
    card.className = 'sensor-card';
    
    card.innerHTML = `
        <h3>Sensor ${sensorId}</h3>
        <div class="sensor-info">
            <input type="text" 
                   id="sensor-name-${sensorId}" 
                   placeholder="Nombre del producto"
                   value="${videoInfo?.product_name || ''}"
                   onchange="updateSensorName(${sensorId}, this.value)">
        </div>
        <div>
            <p>Video actual: ${videoInfo ? videoInfo.video_path.split('/').pop() : 'Sin video'}</p>
            <p>Nombre: ${videoInfo?.product_name || 'Sin nombre'}</p>
            <input type="file" id="video-${sensorId}" accept="video/*">
            <button class="button" onclick="assignVideo(${sensorId})">
                ${videoInfo ? 'Cambiar Video' : 'Asignar Video'}
            </button>
            ${videoInfo ? `
                <button class="button preview" onclick="showPreview('/static/${videoInfo.video_path}')">
                    Ver Preview
                </button>
                <button class="button delete" onclick="removeVideo(${sensorId})">
                    Eliminar
                </button>
            ` : ''}
            ${videoInfo ? `
                <div class="audio-control">
                    <label>
                        <input type="checkbox" onchange="toggleMute(${sensorId}, this.checked)">
                        Silenciar
                    </label>
                </div>
            ` : ''}
        </div>
    `;
    return card;
}

// Modificar la función de preview
function showPreview(videoPath) {
    const modal = document.getElementById('preview-modal');
    const video = document.getElementById('preview-video');
    
    if (!modal || !video) {
        console.error('Elementos de preview no encontrados');
        return;
    }
    
    video.src = videoPath;
    modal.style.display = 'block';
    video.play();
}

function closePreview() {
    const modal = document.getElementById('video-preview-modal');
    const video = document.getElementById('preview-video');
    
    video.pause();
    video.src = '';
    modal.style.display = 'none';
}

// Gestión de videos
async function assignVideo(sensorId) {
    const fileInput = document.getElementById(`video-${sensorId}`);
    if (!fileInput?.files.length) {
        showError('Por favor selecciona un video');
        return;
    }

    showLoading('Subiendo video...');
    try {
        const formData = new FormData();
        formData.append('video', fileInput.files[0]);
        formData.append('sensor_id', sensorId);

        const response = await fetch('/api/upload_video', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showSuccess('Video asignado correctamente');
            await loadSensorList();
        } else {
            throw new Error('Error en la subida');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al asignar el video');
    } finally {
        hideLoading();
    }
}

async function removeVideo(sensorId) {
    if (!confirm('¿Estás seguro de eliminar este video?')) return;

    showLoading('Eliminando video...');
    try {
        const response = await fetch(`/api/remove_video/${sensorId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showSuccess('Video eliminado correctamente');
            await loadSensorList();
        } else {
            throw new Error('Error al eliminar');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al eliminar el video');
    } finally {
        hideLoading();
    }
}

// Gestión de playlist de fondo
async function loadBackgroundVideos() {
    const container = document.getElementById('background-video-list');
    if (!container) return;

    showLoading('Cargando playlist...');
    try {
        const response = await fetch('/api/background_videos');
        const videos = await response.json();

        container.innerHTML = '';
        videos.forEach((video, index) => {
            const item = createPlaylistItem(video, index === 0, index === videos.length - 1);
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error:', error);
        showError('Error cargando playlist');
    } finally {
        hideLoading();
    }
}

// Modificar la función que crea el item de playlist
function createPlaylistItem(video, isFirst, isLast) {
    const fileName = video.video_path.split('/').pop();
    const div = document.createElement('div');
    div.className = 'playlist-item';
    div.innerHTML = `
        <div class="playlist-info">
            <h4>${fileName}</h4>
            <p>Orden: ${video.orden}</p>
            <div class="audio-control">
                <label>
                    <input type="checkbox" onchange="toggleMuteBackground(${video.id}, this.checked)">
                    Silenciar
                </label>
            </div>
        </div>
        <div class="playlist-controls">
            <button class="button" onclick="showPreview('/static/${video.video_path}')">Preview</button>
            ${!isFirst ? `<button class="button" onclick="moveVideo(${video.id}, 'up')">↑</button>` : ''}
            ${!isLast ? `<button class="button" onclick="moveVideo(${video.id}, 'down')">↓</button>` : ''}
            <button class="button delete" onclick="removeBackgroundVideo(${video.id})">Eliminar</button>
        </div>
    `;
    return div;
}

// Funciones de control de audio
function toggleMute(sensorId, muted) {
    localStorage.setItem(`sensor_${sensorId}_muted`, muted);
    // El estado se aplicará cuando el video se active
}

function toggleMuteBackground(videoId, muted) {
    localStorage.setItem(`background_${videoId}_muted`, muted);
    // El estado se aplicará cuando el video se reproduzca
}
async function uploadBackgroundVideo() {
    const fileInput = document.getElementById('background-video-upload');
    if (!fileInput?.files.length) {
        showError('Por favor selecciona un video');
        return;
    }

    showLoading('Subiendo video...');
    try {
        const formData = new FormData();
        formData.append('video', fileInput.files[0]);

        const response = await fetch('/api/upload_background', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showSuccess('Video subido correctamente');
            await loadBackgroundVideos();
            fileInput.value = '';
        } else {
            throw new Error('Error en la subida');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al subir el video');
    } finally {
        hideLoading();
    }
}

async function moveVideo(videoId, direction) {
    showLoading('Reordenando playlist...');
    try {
        const response = await fetch('/api/reorder_background', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: videoId, direction })
        });

        if (response.ok) {
            await loadBackgroundVideos();
        } else {
            throw new Error('Error al reordenar');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al reordenar los videos');
    } finally {
        hideLoading();
    }
}

async function removeBackgroundVideo(videoId) {
    if (!confirm('¿Estás seguro de eliminar este video?')) return;

    showLoading('Eliminando video...');
    try {
        const response = await fetch(`/api/remove_background/${videoId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showSuccess('Video eliminado correctamente');
            await loadBackgroundVideos();
        } else {
            throw new Error('Error al eliminar');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al eliminar el video');
    } finally {
        hideLoading();
    }
}

// Utilidades
function showLoading(message = 'Procesando...') {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.querySelector('h3').textContent = message;
        loading.style.display = 'block';
    }
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
}

function showError(message) {
    alert(message);
}

function showSuccess(message) {
    alert(message);
}

async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cerrar sesión');
    }
}



function updateDebugStatus() {
    const enabled = localStorage.getItem('debugEnabled') === 'true';
    document.getElementById('debug-status').textContent = enabled ? 'Desactivar' : 'Activar';
}

// Control del modo Versus
function updateVersusMode() {
    const mode = document.getElementById('versus-mode').value;
    const extraSection = document.getElementById('extra-content-section');
    
    extraSection.style.display = mode === '3' ? 'block' : 'none';
    
    fetch('/api/update-versus-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: parseInt(mode) })
    });
}

// Manejo del contenido extra
async function uploadExtraContent() {
    const fileInput = document.getElementById('extra-content');
    if (!fileInput.files.length) {
        showError('Por favor selecciona un archivo');
        return;
    }

    const formData = new FormData();
    formData.append('content', fileInput.files[0]);

    showLoading();
    try {
        const response = await fetch('/api/upload-extra-content', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showSuccess('Contenido extra subido correctamente');
            loadExtraContent();
        } else {
            throw new Error('Error al subir el contenido');
        }
    } catch (error) {
        showError('Error al subir el contenido extra');
    } finally {
        hideLoading();
    }
}

function updateVersusMode() {
    const mode = document.getElementById('versus-mode').value;
    const extraSection = document.getElementById('extra-content-section');
    
    extraSection.style.display = mode === '3' ? 'block' : 'none';
    
    fetch('/api/update-versus-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: parseInt(mode) })
    });
}

async function uploadExtraContent() {
    const fileInput = document.getElementById('extra-content');
    if (!fileInput.files.length) {
        showError('Por favor selecciona un archivo');
        return;
    }

    const formData = new FormData();
    formData.append('content', fileInput.files[0]);

    showLoading();
    try {
        const response = await fetch('/api/upload-extra-content', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showSuccess('Contenido extra subido correctamente');
        } else {
            throw new Error('Error al subir el contenido');
        }
    } catch (error) {
        showError('Error al subir el contenido extra');
    } finally {
        hideLoading();
    }
}

async function toggleDebugPanel() {
    const debugEnabled = localStorage.getItem('debugEnabled') === 'true';
    const newState = !debugEnabled;
    
    try {
        const response = await fetch('/api/toggle-debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newState })
        });
        
        if (response.ok) {
            localStorage.setItem('debugEnabled', newState);
            document.getElementById('debug-status').textContent = 
                newState ? 'Desactivar' : 'Activar';
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cambiar estado del debug');
    }
}

// Inicializar estado al cargar
document.addEventListener('DOMContentLoaded', () => {
    const debugEnabled = localStorage.getItem('debugEnabled') === 'true';
    document.getElementById('debug-status').textContent = 
        debugEnabled ? 'Desactivar' : 'Activar';
});

// Actualización de nombres de sensores
async function updateSensorName(sensorId, name) {
    try {
        const response = await fetch('/api/update-sensor-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensorId, name })
        });

        if (response.ok) {
            showSuccess('Nombre actualizado');
        } else {
            throw new Error('Error al actualizar el nombre');
        }
    } catch (error) {
        showError('Error al actualizar el nombre');
    }
}