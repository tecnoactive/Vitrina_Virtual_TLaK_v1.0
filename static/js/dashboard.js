// Constantes y configuraciones globales
const gpioToFantasyMap = {
    '27': '1',
    '17': '2',
    '5': '3',
    '6': '4',
    '13': '5',
    '18': '6',
    '23': '7',
    '24': '8'
};

// Funciones auxiliares
function getFantasyNumber(gpio) {
    return gpioToFantasyMap[gpio] || gpio;
}

function formatNumber(number) {
    return new Intl.NumberFormat('es-AR').format(number);
}

function formatDateTime(timestamp) {
    if (!timestamp) return '-';
    // Asegurarnos de que la fecha se interprete en la zona horaria local
    const date = new Date(timestamp.replace(' ', 'T') + '03:00'); // Agregamos el offset de Chile
    return date.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.innerHTML = `
            <div class="alert alert-danger">
                ${message}
                <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
            </div>
        `;
    }
}

// Funciones de inicialización
function initializeDatePickers() {
    const dateConfig = {
        locale: 'es',
        dateFormat: 'Y-m-d',
        altFormat: 'd/m/Y',
        altInput: true
    };

    flatpickr('#date-from', dateConfig);
    flatpickr('#date-to', dateConfig);
}

function setupEventListeners() {
    const periodSelect = document.getElementById('period-select');
    const customDates = document.getElementById('custom-dates');

    if (periodSelect) {
        periodSelect.addEventListener('change', function() {
            if (this.value === 'custom') {
                customDates.style.display = 'block';
            } else {
                customDates.style.display = 'none';
            }
        });
    }
}

function updateDashboard(data) {
    // Actualizar contadores con los IDs correctos
    const totalActivations = document.getElementById('total-activations');
    const todayActivations = document.getElementById('today-activations');
    const weekActivations = document.getElementById('week-activations');
    const monthActivations = document.getElementById('month-activations');

    if (totalActivations) totalActivations.textContent = data.total_activaciones || 0;
    if (todayActivations) todayActivations.textContent = data.activaciones_hoy || 0;
    if (weekActivations) weekActivations.textContent = data.activaciones_semana || 0;
    if (monthActivations) monthActivations.textContent = data.activaciones_mes || 0;

    // Actualizar gráficos
    if (data.activaciones_por_dia) {
        updateActivationsChart(data.activaciones_por_dia);
    }

    // Actualizar gráfico de sensores
    if (data.activaciones_por_sensor) {
        updateSensorChart(data.activaciones_por_sensor);
    }

    // Actualizar ranking
    const rankingBody = document.getElementById('ranking-table-body');
    if (rankingBody) {
        if (data.ranking && data.ranking.length > 0) {
            rankingBody.innerHTML = data.ranking.map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.nombre || 'Sin nombre'}</td>
                    <td>${item.total || 0}</td>
                    <td>${formatDateTime(item.ultima_activacion) || 'N/A'}</td>
                </tr>
            `).join('');
        } else {
            rankingBody.innerHTML = '<tr><td colspan="4" class="text-center">No hay datos de ranking disponibles</td></tr>';
        }
    }

    // Actualizar producto más popular
    const popularProductName = document.getElementById('popular-product-name');
    const popularProductActivations = document.getElementById('popular-product-activations');
    
    if (data.activaciones_por_sensor && data.activaciones_por_sensor.length > 0) {
        const masPopular = data.activaciones_por_sensor.reduce((prev, current) => 
            (prev.total > current.total) ? prev : current
        );
        
        if (popularProductName) {
            popularProductName.textContent = masPopular.nombre_fantasia || 
                (masPopular.video_path ? masPopular.video_path.split('/').pop().replace('.mp4', '') : 'Sin nombre');
        }
        if (popularProductActivations) {
            popularProductActivations.textContent = masPopular.total || 0;
        }
    } else {
        if (popularProductName) popularProductName.textContent = 'Sin datos';
        if (popularProductActivations) popularProductActivations.textContent = '0';
    }

    // Actualizar activaciones recientes
    updateRecentActivations(data);

    // Actualizar historial de asignaciones
    const historialBody = document.querySelector('#assignment-history tbody');
    if (historialBody) {
        if (data.activaciones_por_sensor && data.activaciones_por_sensor.length > 0) {
            historialBody.innerHTML = data.activaciones_por_sensor.map(item => {
                const videoName = item.video_path ? item.video_path.split('/').pop().replace('.mp4', '') : 'Sin video';
                const sensorName = item.nombre_fantasia || `Sensor ${item.sensor_id}`;
                return `
                    <tr>
                        <td>${sensorName}</td>
                        <td>${videoName}</td>
                        <td>${formatDateTime(item.primera_activacion || '')}</td>
                        <td>Actual</td>
                        <td>${item.total || 0}</td>
                        <td>${Math.round((item.total || 0) / 7)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            historialBody.innerHTML = '<tr><td colspan="6" class="text-center">No hay historial de asignaciones disponible</td></tr>';
        }
    }
}
// Funciones de actualización de datos
async function loadDashboardData(params) {
    try {
        const response = await fetch(`/api/dashboard-stats?${params.toString()}`);
        if (!response.ok) throw new Error('Error al cargar los datos');
        const data = await response.json();
        console.log("Datos recibidos:", data);
        updateDashboard(data);
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar los datos del dashboard');
    }
}
function updateCharts(data) {
    updateActivationsChart(data.activaciones_por_dia);
    updateSensorChart(data.activaciones_por_sensor);
}

function updateActivationsChart(activacionesPorDia) {
    const ctx = document.getElementById('activationsChart');
    if (!ctx) return;

    // Destruir el gráfico existente si hay uno
    if (window.activationsChart instanceof Chart) {
        window.activationsChart.destroy();
    }

    const labels = activacionesPorDia.map(item => {
        const date = new Date(item.fecha);
        return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    });

    const data = activacionesPorDia.map(item => item.total);

    window.activationsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Activaciones',
                data: data,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#2563eb',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    titleFont: {
                        size: 14,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 13
                    },
                    callbacks: {
                        label: function(context) {
                            return `Activaciones: ${formatNumber(context.parsed.y)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        callback: function(value) {
                            return formatNumber(value);
                        }
                    }
                }
            }
        }
    });
}

function updateSensorChart(activacionesPorSensor) {
    const ctx = document.getElementById('sensorChart');
    if (!ctx) return;

    // Destruir el gráfico existente si hay uno
    if (window.sensorChart instanceof Chart) {
        window.sensorChart.destroy();
    }

    // Modificar cómo se generan las etiquetas para incluir el nombre de fantasía
    const labels = activacionesPorSensor.map(item => {
        const sensorNum = getFantasyNumber(item.sensor_id);
        const nombreFantasia = item.nombre_fantasia || 
                             (item.video_path ? item.video_path.split('/').pop().replace('.mp4', '') : '');
        return nombreFantasia ? `Sensor ${sensorNum} - ${nombreFantasia}` : `Sensor ${sensorNum}`;
    });

    const data = activacionesPorSensor.map(item => item.total);

    const backgroundColors = [
        'rgba(37, 99, 235, 0.8)',   // Azul
        'rgba(16, 185, 129, 0.8)',  // Verde
        'rgba(245, 158, 11, 0.8)',  // Amarillo
        'rgba(239, 68, 68, 0.8)',   // Rojo
        'rgba(139, 92, 246, 0.8)',  // Púrpura
        'rgba(14, 165, 233, 0.8)',  // Celeste
        'rgba(249, 115, 22, 0.8)',  // Naranja
        'rgba(168, 85, 247, 0.8)'   // Violeta
    ];

    window.sensorChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Activaciones por Sensor',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: backgroundColors,
                borderWidth: 1,
                borderRadius: 4,
                maxBarThickness: 50
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Activaciones: ${formatNumber(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        callback: function(value, index) {
                            const label = this.getLabelForValue(index);
                            // Dividir la etiqueta en múltiples líneas si es muy larga
                            if (label.length > 20) {
                                return label.split(' - ').join('\n');
                            }
                            return label;
                        }
                    }
                },
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}



function updateAssignmentHistory(data) {
    const tbody = document.querySelector('#assignment-history tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    if (!data.historial_asignaciones || data.historial_asignaciones.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay historial de asignaciones disponible</td></tr>';
        return;
    }

    data.historial_asignaciones.forEach((asignacion, index) => {
        const row = document.createElement('tr');
        row.className = 'animate-fade-in';
        row.style.animationDelay = `${index * 0.1}s`;
        
        const fechaInicio = asignacion.fecha_inicio ? formatDateTime(asignacion.fecha_inicio) : '-';
        const fechaFin = asignacion.fecha_fin === 'Actual' ? 'Actual' : 
                        asignacion.fecha_fin ? formatDateTime(asignacion.fecha_fin) : '-';
        
        // Obtener el nombre del video sin la extensión y la ruta
        const videoName = asignacion.video_path ? 
            asignacion.video_path.split('/').pop().replace('.mp4', '') : 
            'Sin video asignado';

        const sensorName = asignacion.nombre_fantasia ? 
            `Sensor ${getFantasyNumber(asignacion.sensor_id)} - ${asignacion.nombre_fantasia}` : 
            `Sensor ${getFantasyNumber(asignacion.sensor_id)}`;

        row.innerHTML = `
            <td>
                <div class="sensor-info">
                    <span class="sensor-badge">${sensorName}</span>
                </div>
            </td>
            <td>
                <div class="video-info">
                    <i class="fas fa-video text-primary me-2"></i>
                    <span class="video-name">${videoName}</span>
                </div>
            </td>
            <td class="text-nowrap">${fechaInicio}</td>
            <td class="text-nowrap">${fechaFin}</td>
            <td class="text-center">
                <div class="total-activations">
                    <span class="number">${formatNumber(asignacion.total_activaciones)}</span>
                </div>
            </td>
            <td class="text-center">
                <div class="daily-average">
                    <span class="number">${formatNumber(asignacion.promedio_diario)}</span>
                    <small class="text-muted">por día</small>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function updateRecentActivations(data) {
    const recentBody = document.querySelector('#recent-activations tbody');
    if (!recentBody) return;

    if (!data.activaciones_recientes || data.activaciones_recientes.length === 0) {
        recentBody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center">
                    <div class="alert alert-info m-3">
                        <i class="fas fa-info-circle me-2"></i>
                        No hay activaciones en la última hora
                    </div>
                </td>
            </tr>`;
        return;
    }

    recentBody.innerHTML = data.activaciones_recientes.map(item => `
        <tr class="align-middle">
            <td>
                <div class="d-flex align-items-center">
                    <div class="sensor-icon me-2">
                        <i class="fas fa-broadcast-tower text-primary"></i>
                    </div>
                    <div class="sensor-info">
                        <span class="badge bg-primary rounded-pill">
                            ${item.sensor}
                        </span>
                    </div>
                </div>
            </td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="product-icon me-2">
                        <i class="fas fa-cube text-secondary"></i>
                    </div>
                    <div class="product-info">
                        <span class="product-name fw-bold">
                            ${item.producto}
                        </span>
                    </div>
                </div>
            </td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="time-icon me-2">
                        <i class="far fa-clock text-muted"></i>
                    </div>
                    <div class="time-info">
                        <span class="timestamp">
                            ${formatDateTime(item.timestamp)}
                        </span>
                    </div>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateRanking(data) {
    const tbody = document.querySelector('#ranking-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay datos de ranking disponibles</td></tr>';
        return;
    }

    data.forEach((item, index) => {
        const row = document.createElement('tr');
        row.className = 'animate-fade-in';
        row.style.animationDelay = `${index * 0.1}s`;
        
        const positionBadgeClass = index === 0 ? 'position-first' : 
                                  index === 1 ? 'position-second' : 
                                  index === 2 ? 'position-third' : 'position-other';
        
        row.innerHTML = `
            <td class="text-center">
                <span class="position-badge ${positionBadgeClass}">${index + 1}</span>
            </td>
            <td>
                <div class="sensor-info">
                    <span class="sensor-badge">Sensor ${getFantasyNumber(item.sensor_id)}</span>
                    <span class="sensor-name">${item.nombre_fantasia || ''}</span>
                </div>
            </td>
            <td class="text-center">
                <div class="total-activations">
                    <span class="number">${formatNumber(item.total)}</span>
                    <small class="text-muted">activaciones</small>
                </div>
            </td>
            <td>
                <div class="last-activation">
                    <span class="date">${formatDateTime(item.ultima_activacion)}</span>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function downloadStats() {
    try {
        const periodSelect = document.getElementById('period-select');
        const dateFrom = document.getElementById('date-from');
        const dateTo = document.getElementById('date-to');
        
        let params = new URLSearchParams();
        
        if (periodSelect.value === 'custom') {
            params.append('from', `${dateFrom.value}T00:00:00`);
            params.append('to', `${dateTo.value}T23:59:59`);
        } else {
            const now = new Date();
            let from = new Date();
            
            switch (periodSelect.value) {
                case 'today':
                    from.setHours(0, 0, 0, 0);
                    break;
                case 'week':
                    from.setDate(from.getDate() - 7);
                    break;
                case 'month':
                    from.setDate(1);
                    break;
                case 'year':
                    from.setMonth(0, 1);
                    break;
            }
            
            params.append('from', from.toISOString().split('.')[0]);
            params.append('to', now.toISOString().split('.')[0]);
        }

        const response = await fetch(`/api/download-stats?${params.toString()}`);
        if (!response.ok) throw new Error('Error al descargar estadísticas');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `estadisticas_${periodSelect.value}_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

    } catch (error) {
        console.error('Error:', error);
        showError('Error al descargar las estadísticas');
    }
}

async function applyFilters() {
    const periodSelect = document.getElementById('period-select');
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');
    
    let params = new URLSearchParams();
    
    if (periodSelect.value === 'custom') {
        if (!dateFrom.value || !dateTo.value) {
            showError('Por favor seleccione ambas fechas');
            return;
        }
        params.append('from', `${dateFrom.value}T00:00:00`);
        params.append('to', `${dateTo.value}T23:59:59`);
    } else {
        const now = new Date();
        let from = new Date();
        
        switch (periodSelect.value) {
            case 'today':
                // Cambiamos para que tome desde las 00:00 del día actual hasta ahora
                from.setHours(0, 0, 0, 0);
                params.append('from', from.toISOString().split('.')[0]);
                params.append('to', now.toISOString().split('.')[0]);
                break;
            case 'week':
                from.setDate(from.getDate() - 7);
                params.append('from', from.toISOString().split('.')[0]);
                params.append('to', now.toISOString().split('.')[0]);
                break;
            case 'month':
                from.setDate(1);
                params.append('from', from.toISOString().split('.')[0]);
                params.append('to', now.toISOString().split('.')[0]);
                break;
            case 'year':
                from.setMonth(0, 1);
                params.append('from', from.toISOString().split('.')[0]);
                params.append('to', now.toISOString().split('.')[0]);
                break;
        }
    }
    
    await loadDashboardData(params);
}


function animateCounter(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const startValue = parseInt(element.textContent) || 0;
    const duration = 1000; // 1 segundo
    const steps = 60;
    const stepValue = (targetValue - startValue) / steps;
    let currentStep = 0;

    const animation = setInterval(() => {
        currentStep++;
        const currentValue = Math.floor(startValue + (stepValue * currentStep));
        element.textContent = formatNumber(currentValue);

        if (currentStep >= steps) {
            clearInterval(animation);
            element.textContent = formatNumber(targetValue);
        }
    }, duration / steps);
}

async function resetStats() {
    if (!confirm('¿Estás seguro de que deseas resetear todas las estadísticas? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        const response = await fetch('/api/reset-stats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al resetear las estadísticas');
        }

        const data = await response.json();
        
        if (data.success) {
            // Mostrar mensaje de éxito
            const errorDiv = document.getElementById('error-message');
            if (errorDiv) {
                errorDiv.innerHTML = `
                    <div class="alert alert-success">
                        Estadísticas reseteadas correctamente
                        <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
                    </div>
                `;
            }

            // Recargar los datos del dashboard
            const params = new URLSearchParams();
            const periodSelect = document.getElementById('period-select');
            if (periodSelect) {
                periodSelect.value = 'week'; // Resetear al período por defecto
            }
            await loadDashboardData(params);
        } else {
            throw new Error(data.error || 'Error al resetear las estadísticas');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al resetear las estadísticas: ' + error.message);
    }
}


function formatProductName(name) {
    if (!name) return '';
    return name.charAt(0).toUpperCase() + name.slice(1);
}
// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', () => {
    initializeDatePickers();
    setupEventListeners();
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
        periodSelect.value = 'week';
        applyFilters();
    }
});