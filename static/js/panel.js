// Configuración
const SENSOR_PINS = [17, 27, 5, 6, 13, 18, 22, 26, 19];
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
        // Get current sensor labels and states
        const etiquetasResponse = await fetch('/api/etiquetas-sensores');
        const etiquetas = await etiquetasResponse.json();

        // Get current videos
        const videosResponse = await fetch('/api/sensor_videos');
        const videos = await videosResponse.json();
        const videoMap = new Map(videos.map(v => [v.sensor_id, v]));

        // New sensor mapping
        const sensorMapping = {
            17: 'Sensor 1',
            27: 'Sensor 2',
            5: 'Sensor 3',
            6: 'Sensor 4',
            13: 'Sensor 5',
            18: 'Sensor 6',
            22: 'Sensor 7',
            26: 'Sensor 8',
            19: 'Sensor 9'
        };
        function getSensorPin(num) {
            const pinMap = {
                1: 17,
                2: 27,
                3: 5,
                4: 6,
                5: 13,
                6: 18,
                7: 22,
                8: 26,
                9: 19
            };
            return pinMap[num];
        }

        sensorList.innerHTML = '';
        [1,2,3,4,5,6,7,8,9].forEach(num => {
            const pin = getSensorPin(num);  // Función auxiliar para mapear número a pin
            const videoInfo = videoMap.get(pin);
            const etiqueta = etiquetas[pin];
            const card = createSensorCard(pin, videoInfo, etiqueta, `Sensor ${num}`);
            sensorList.appendChild(card);
        });
    } catch (error) {
        console.error('Error cargando sensores:', error);
        showError('Error al cargar los sensores');
    } finally {
        hideLoading();
    }
}


const toggleAudio = async (sensorId) => {
    const video = document.querySelector(`#video-${sensorId}`);
    if (video) {
      video.muted = !video.muted;
      localStorage.setItem(`audio_${sensorId}`, video.muted ? 'muted' : 'unmuted');
    }
  };

async function actualizarEtiquetaSensor(pin, nombre) {
    console.log('Actualizando sensor:', pin, 'con nombre:', nombre); // Debug
    try {
        showLoading('Actualizando nombre del sensor...');
        const respuesta = await fetch('/api/actualizar-etiqueta', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                pin: parseInt(pin), // Aseguramos que el pin sea número
                nombre: nombre.trim() // Removemos espacios extras
            })
        });
        
        if (!respuesta.ok) {
            throw new Error('Error en la respuesta del servidor');
        }
        
        const data = await respuesta.json();
        if (data.success) {
            showSuccess('Nombre del sensor actualizado');
            await loadSensorList(); // Recargamos la lista completa
        } else {
            throw new Error(data.error || 'Error al actualizar etiqueta');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al actualizar nombre del sensor: ' + error.message);
    } finally {
        hideLoading();
    }
}

function createSensorCard(sensorId, videoInfo, etiqueta, nombreMapeado) {
    const card = document.createElement('div');
    card.className = 'sensor-card';
    
    const isEnabled = etiqueta?.enabled ?? false;
    const isDefaultSensor = [17, 27, 5, 6, 13, 18].includes(sensorId);
    
    card.innerHTML = `
        <h3>${nombreMapeado}</h3>
        <div class="sensor-info">
            <div class="sensor-controls">
                <label class="switch">
                    <input type="checkbox" 
                           ${isEnabled ? 'checked' : ''} 
                           ${isDefaultSensor ? 'disabled' : ''}
                           onchange="toggleSensor(${sensorId}, this.checked)">
                    <span class="slider"></span>
                </label>
                <span>${isDefaultSensor ? 'Sensor Principal' : (isEnabled ? 'Habilitado' : 'Deshabilitado')}</span>
            </div>
            <div class="video-section">
                <p>Video actual: ${videoInfo ? videoInfo.video_path.split('/').pop() : 'Sin video'}</p>
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
            </div>
        </div>
    `;
    return card;
}

async function toggleSensor(pin, enabled) {
    try {
        const response = await fetch('/api/toggle-sensor', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pin, enabled })
        });
        
        if (response.ok) {
            showSuccess(`Sensor ${enabled ? 'habilitado' : 'deshabilitado'}`);
            await loadSensorList();
        }
    } catch (error) {
        showError('Error al cambiar estado del sensor');
    }
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

// Actualizar función de preview
function showPreview(videoPath) {
    const modal = document.getElementById('preview-modal');
    const video = document.getElementById('preview-video');
    
    if (!modal || !video) return;
    video.src = videoPath;
    modal.style.display = 'flex';
    video.play().catch(console.error);
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
        const response = await fetch('/api/sensor_video/' + sensorId, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Error al eliminar');
        
        showSuccess('Video eliminado correctamente');
        await loadSensorList();
    } catch (error) {
        console.error('Error:', error);
        showError('Error al eliminar el video');
    } finally {
        hideLoading();
    }
}

document.querySelector('.preview-toggle')?.remove();


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
