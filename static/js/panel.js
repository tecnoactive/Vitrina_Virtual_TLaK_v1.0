// Configuración
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
let currentUploads = new Set();
let previewInterval = null;
let notificationTimeout;


// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadSensorList();
        await loadBackgroundVideos();
        await loadCurrentMode();
        
        const debugEnabled = localStorage.getItem('debugEnabled') === 'true';
        const debugStatus = document.getElementById('debug-status');
        if (debugStatus) {
            debugStatus.textContent = debugEnabled ? 'Desactivar' : 'Activar';
        }
        
        setupEventListeners();
        showExtraContentInfo();
    } catch (error) {
        console.error('Error en inicialización:', error);
        showError('Error inicializando el panel');
    }
});

async function moveVideo(videoId, direction) {
    try {
        const response = await fetch('/api/move_background', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ video_id: videoId, direction: direction })
        });

        if (response.ok) {
            await loadBackgroundVideos();
        } else {
            throw new Error('Error al mover video');
        }
    } catch (error) {
        showError('Error al cambiar el orden del video');
    }
}



function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Remover notificaciones existentes
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => n.remove());
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

async function updateSensorName(sensorId, newName) {
    try {
        const response = await fetch('/api/update-sensor-name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sensor_id: sensorId,
                name: newName
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
            // Actualizar la UI
            const nameElement = document.querySelector(`#sensor-${sensorId} .sensor-name`);
            if (nameElement) {
                nameElement.textContent = newName;
            }
            
            // Mostrar mensaje de éxito
            showNotification('✅ Nombre guardado correctamente', 'success');
        } else {
            throw new Error(data.error || 'Error al actualizar el nombre');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('❌ Error al guardar el nombre', 'error');
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
    try {
        // Obtener información de videos de sensores
        const videosResponse = await fetch('/api/sensor_videos');
        const videos = await videosResponse.json();
        
        // Obtener información de etiquetas de sensores
        const etiquetasResponse = await fetch('/api/etiquetas-sensores');
        const etiquetas = await etiquetasResponse.json();
        
        // Crear un mapa de videos por sensor_id
        const videoMap = new Map(videos.map(v => [v.sensor_id, v]));
        // Crear un mapa de etiquetas por gpio_pin
        const etiquetaMap = new Map(etiquetas.map(e => [e.gpio_pin, e]));
        
        // Obtener el contenedor
        const container = document.getElementById('sensor-list');
        if (!container) return;
        
        // Limpiar el contenedor
        container.innerHTML = '';
        
        // Crear y agregar tarjetas para cada sensor
        SENSOR_PINS.forEach(sensorId => {
            const videoInfo = videoMap.get(sensorId) || {};
            const etiqueta = etiquetaMap.get(sensorId) || {};
            const card = createSensorCard(sensorId, videoInfo, etiqueta);
            container.appendChild(card);
        });

        showSuccess('Sensores cargados correctamente');
    } catch (error) {
        console.error('Error cargando lista de sensores:', error);
        showError('Error al cargar la lista de sensores');
    } finally {
        hideLoading();
    }
}

function createSensorCard(sensorId, videoInfo = {}, etiqueta = {}) {
    const card = document.createElement('div');
    card.className = 'sensor-card';
    
    // Escapar la ruta del video para usarla en el onclick
    const videoPath = videoInfo?.video_path ? videoInfo.video_path.replace(/'/g, "\\'") : '';
    
    card.innerHTML = `
        <div class="sensor-info">
            <h3>${etiqueta?.sensor_numero || `Sensor ${sensorId}`}</h3>
            <div class="gpio-info">GPIO ${sensorId}</div>
            <div class="form-group">
                <label>Nombre de fantasía:</label>
                <input type="text" 
                       class="sensor-name" 
                       value="${etiqueta?.nombre_fantasia || ''}" 
                       placeholder="Nombre personalizado">
                <button class="save-name btn btn-primary">Guardar</button>
            </div>
            <div class="video-info">
                <p>Video actual: ${videoInfo?.video_path ? videoInfo.video_path.split('/').pop() : 'Sin video'}</p>
                <input type="file" id="video-${sensorId}" accept="video/*">
                <div class="file-name">Ningún archivo seleccionado</div>
                <div class="button-group">
                    <button onclick="assignVideo(${sensorId})" class="btn btn-primary">Subir y Asignar Video</button>
                    ${videoInfo?.video_path ? `
                        <button onclick="showPreview('${videoPath}')" class="btn btn-success">Ver Preview</button>
                        <button onclick="removeVideo(${sensorId})" class="btn btn-danger">Quitar Video</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Configurar el guardado del nombre
    const nameInput = card.querySelector('.sensor-name');
    const saveButton = card.querySelector('.save-name');
    
    if (saveButton && nameInput) {
        saveButton.addEventListener('click', async () => {
            await updateSensorName(sensorId, nameInput.value);
        });
    }

    return card;
}




function showExtraContentInfo() {
    const extraContentSection = document.getElementById('extra-content-section');
    if (!extraContentSection) return;
    
    const existingInfo = extraContentSection.querySelector('.extra-content-info');
    if (existingInfo) existingInfo.remove();
    
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
        })
        .catch(error => console.error('Error cargando contenido extra:', error));
}

// Funciones de Preview de Video
function showPreview(videoPath) {
    const previewContainer = document.getElementById('videoModal');
    const previewVideo = document.getElementById('previewVideo');
    
    if (!previewContainer || !previewVideo) {
        console.error('Elementos de preview no encontrados');
        showError('Error al mostrar el preview');
        return;
    }

    // Asegurar que la ruta del video sea correcta
    const fullPath = videoPath.startsWith('/static/') ? videoPath : `/static/${videoPath}`;
    
    previewVideo.src = fullPath;
    previewContainer.style.display = 'block';
    
    // Intentar reproducir el video
    previewVideo.play().catch(error => {
        console.error('Error reproduciendo video:', error);
        showError('Error al reproducir el video');
    });
}

function closePreview() {
    const previewContainer = document.getElementById('videoModal');
    const previewVideo = document.getElementById('previewVideo');
    
    if (previewVideo) {
        previewVideo.pause();
        previewVideo.src = '';
    }
    
    if (previewContainer) {
        previewContainer.style.display = 'none';
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

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Error en la subida');
        }

        if (data.success) {
            showSuccess('Video asignado correctamente');
            // Actualizar el nombre del video en la interfaz
            const videoNameElement = document.getElementById(`current-video-${sensorId}`);
            if (videoNameElement) {
                videoNameElement.textContent = fileInput.files[0].name;
            }
            // Limpiar el input
            fileInput.value = '';
            // Actualizar la lista de sensores
            await loadSensorList();
        } else {
            throw new Error(data.error || 'Error desconocido');
        }
    } catch (error) {
        console.error('Error:', error);
        showError(`Error al asignar el video: ${error.message}`);
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
    const currentModeElement = document.getElementById('current-mode');
    
    showLoading('Actualizando modo...');
    
    try {
        const response = await fetch('/api/update-versus-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: parseInt(mode) })
        });
        
        if (response.ok) {
            if (extraSection) {
                extraSection.style.display = (mode === '3' || mode === '4') ? 'block' : 'none';
            }
            
            // Actualizar el texto del modo actual
            if (currentModeElement) {
                const modeTexts = {
                    '1': 'Video Individual',
                    '2': 'Comparación (2 Videos)',
                    '3': 'Triple con Contenido Extra',
                    '4': 'Cuádruple'
                };
                currentModeElement.innerHTML = `
                    <div class="current-mode-display">
                        <strong>Estado Actual:</strong>
                        <span>Sistema en Modo ${modeTexts[mode] || mode}</span>
                    </div>
                `;
            }
            
            showSuccess(`Modo actualizado: ${mode} sensores`);
        } else {
            throw new Error('Error al actualizar');
        }
    } catch (error) {
        showError('Error al actualizar modo de visualización');
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

            if (versusModeElement) {
                versusModeElement.value = data.mode;
            }

            if (currentModeElement) {
                currentModeElement.textContent = `Vitrina en Modo ${data.mode} Sensores`;
            }

            if (extraContentSection) {
                extraContentSection.style.display = ['3', '4'].includes(data.mode.toString()) ? 'block' : 'none';
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
    showNotification(message, 'error');
}

function showSuccess(message) {
    showNotification(message, 'success');
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

document.addEventListener('DOMContentLoaded', () => {
    // Cerrar con el botón X
    const closeButton = document.querySelector('.close');
    if (closeButton) {
        closeButton.addEventListener('click', closePreview);
    }

    // Cerrar con la tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePreview();
        }
    });

    // Cerrar haciendo clic fuera del modal
    const modal = document.getElementById('videoModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closePreview();
            }
        });
    }
});