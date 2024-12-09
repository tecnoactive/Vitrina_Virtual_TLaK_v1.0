// Configuración
const SENSOR_PINS = [17, 27, 4, 5, 6, 13, 18, 22, 26, 19];
let currentUploads = new Set();
let previewInterval = null;

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Inicializar estado del preview
        const container = document.getElementById('live-preview-container');
        if (container) {
            container.style.display = 'none';
        }
        
        // Inicializar estado del debug
        const debugEnabled = localStorage.getItem('debugEnabled') === 'true';
        document.getElementById('debug-status').textContent = 
            debugEnabled ? 'Desactivar' : 'Activar';

        await loadSensorList();
        await loadBackgroundVideos();
        await loadCurrentMode();
        setupEventListeners();
    } catch (error) {
        console.error('Error en inicialización:', error);
        showError('Error inicializando el panel');
    }
});

async function updateSensorName(sensorId, name) {
    try {
        const response = await fetch('/api/update-sensor-name', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({sensorId, name})
        });
        
        if (response.ok) {
            showSuccess('Nombre del sensor actualizado');
        } else {
            throw new Error('Error al actualizar el nombre del sensor');
        }
    } catch (error) {
        showError('Error al actualizar el nombre del sensor');
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


// Configuración de eventos
function setupEventListeners() {
    document.getElementById('logout')?.addEventListener('click', handleLogout);
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());
    
    // Agregar manejador de tecla Escape para cerrar preview

}

// Funciones de Preview
function togglePreview() {
    const container = document.getElementById('live-preview-container');
    const toggleBtn = document.querySelector('[onclick="togglePreview()"]');
    
    if (container.style.display === 'none') {
        container.style.display = 'block';
        toggleBtn.textContent = 'Desactivar Preview';
        startPreviewUpdates();
    } else {
        container.style.display = 'none';
        toggleBtn.textContent = 'Activar Preview';
        stopPreviewUpdates();
    }
}

function startPreviewUpdates() {
    if (previewInterval) {
        clearInterval(previewInterval);
    }
    updateLivePreview();
    previewInterval = setInterval(updateLivePreview, 10000);
}

function stopPreviewUpdates() {
    if (previewInterval) {
        clearInterval(previewInterval);
        previewInterval = null;
    }
}

function updateLivePreview() {
    const iframe = document.getElementById('live-preview');
    if (iframe && iframe.style.display !== 'none') {
        iframe.src = `/?t=${Date.now()}`;
    }
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

function createSensorCard(sensorId, videoInfo) {
    const card = document.createElement('div');
    card.className = 'sensor-card';
    
    card.innerHTML = `
        <h3>Sensor ${sensorId}</h3>
        <div class="sensor-info">
            <input type="text" 
                   id="sensor-name-${sensorId}" 
                   placeholder="Nombre del sensor"
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
                        <input type="checkbox" 
                               onchange="toggleMute(${sensorId}, this.checked)"
                               ${localStorage.getItem(`sensor_${sensorId}_muted`) === 'true' ? 'checked' : ''}>
                        Silenciar
                    </label>
                </div>
            ` : ''}
        </div>
    `;
    return card;
}

function showExtraContentInfo() {
    const extraContentSection = document.getElementById('extra-content-section');
    const infoDiv = document.createElement('div');
    infoDiv.className = 'extra-content-info';
    
    fetch('/api/extra-content')
        .then(r => r.json())
        .then(data => {
            const positionMap = {
                'top-left': 'superior-izquierda',
                'top-right': 'superior-derecha',
                'bottom-left': 'inferior-izquierda',
                'bottom-right': 'inferior-derecha'
            };
            
            infoDiv.innerHTML = `
                <p>Contenido actual: ${data.path?.split('/').pop() || 'Ninguno'}</p>
                <p>Posición: ${positionMap[data.position] || 'No definida'}</p>
                <p>Tipo: ${data.type || 'No definido'}</p>
            `;
            extraContentSection.appendChild(infoDiv);
        });
}

// Funciones de Preview de Video
function showPreview(videoPath) {
    const modal = document.getElementById('preview-modal');
    const video = document.getElementById('preview-video');
    
    if (!modal || !video) {
        console.error('Elementos de preview no encontrados');
        return;
    }
    
    video.src = videoPath;
    modal.style.display = 'flex';
    video.play().catch(() => {
        console.log('Autoplay no permitido');
    });
}

function closePreview() {
    const modal = document.getElementById('preview-modal');
    const video = document.getElementById('preview-video');
    
    if (video) {
        video.pause();
        video.src = '';
    }
    if (modal) {
        modal.style.display = 'none';
    }
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
                    <input type="checkbox" 
                           onchange="toggleMuteBackground(${video.id}, this.checked)"
                           ${localStorage.getItem(`background_${video.id}_muted`) === 'true' ? 'checked' : ''}>
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
// Control de audio
function toggleMute(sensorId, muted) {
    localStorage.setItem(`sensor_${sensorId}_muted`, muted);
}

function toggleMuteBackground(videoId, muted) {
    localStorage.setItem(`background_${videoId}_muted`, muted);
}

// Gestión de modos y configuración
async function updateVersusMode() {
    const mode = document.getElementById('versus-mode').value;
    const extraSection = document.getElementById('extra-content-section');
    
    showLoading('Updating mode...');
    
    try {
        const response = await fetch('/api/update-versus-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: parseInt(mode) })
        });
        
        if (response.ok) {
            // Show extra content section for modes 3 and 4
            extraSection.style.display = ['3', '4'].includes(mode) ? 'block' : 'none';
            showSuccess(`Mode updated: ${mode} sensors`);
        } else {
            throw new Error('Error updating');
        }
    } catch (error) {
        showError('Error updating versus mode');
    } finally {
        hideLoading();
    }
}

async function loadCurrentMode() {
    try {
        const response = await fetch('/api/get-current-mode');
        if (response.ok) {
            const data = await response.json();
            const currentModeElement = document.getElementById('current-mode');
            const versusModeElement = document.getElementById('versus-mode');
            const extraContentSection = document.getElementById('extra-content-section');

            if (currentModeElement && versusModeElement && extraContentSection) {
                currentModeElement.textContent = `Vitrina en Modo ${data.mode} Sensores`;
                versusModeElement.value = data.mode;
                extraContentSection.style.display = ['3', '4'].includes(data.mode) ? 'block' : 'none';
            } else {
                console.error('Elementos HTML no encontrados.');
            }
        }
    } catch (error) {
        console.error('Error cargando modo actual:', error);
    }
}




document.addEventListener('DOMContentLoaded', loadCurrentMode);

// Debug Panel
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
            showSuccess(`Panel de debug ${newState ? 'activado' : 'desactivado'}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cambiar estado del debug');
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

// Manejo de sesión
async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cerrar sesión');
    }
}

// Agregar a panel.js


async function updateExtraContent() {
    const fileInput = document.getElementById('extra-content');
    const position = document.getElementById('extra-position').value;
    
    if (!fileInput.files.length) {
        showError('Por favor selecciona un archivo');
        return;
    }

    showLoading('Subiendo contenido extra...');
    try {
        const formData = new FormData();
        formData.append('content', fileInput.files[0]);
        formData.append('position', position);

        const response = await fetch('/api/update-extra-content', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showSuccess('Contenido extra actualizado');
            fileInput.value = '';
            showExtraContentInfo(); // Actualizar info del contenido extra
        } else {
            throw new Error('Error al subir el contenido');
        }
    } catch (error) {
        showError('Error al actualizar contenido extra');
    } finally {
        hideLoading();
    }
}


document.addEventListener('DOMContentLoaded', showExtraContentInfo);
