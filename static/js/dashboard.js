let charts = {};

// Inicializar Flatpickr para los selectores de fecha
document.addEventListener('DOMContentLoaded', () => {
    initializeDatePickers();
    setupEventListeners();
    // Cargar datos con el período "week" por defecto
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
        periodSelect.value = 'week';
        applyFilters();
    }
});

function initializeDatePickers() {
    const dateConfig = {
        locale: 'es',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        maxDate: 'today'
    };

    flatpickr('#date-from', dateConfig);
    flatpickr('#date-to', dateConfig);
}

function setupEventListeners() {
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
        periodSelect.addEventListener('change', handlePeriodChange);
    }
}

function handlePeriodChange() {
    const periodSelect = document.getElementById('period-select');
    const customDates = document.getElementById('custom-dates');
    
    if (customDates) {
        customDates.style.display = periodSelect.value === 'custom' ? 'block' : 'none';
    }

    if (periodSelect.value !== 'custom') {
        applyFilters();
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
                from = new Date(now.setHours(0, 0, 0, 0));
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
    
    await loadDashboardData(params);
}

async function loadDashboardData(params = new URLSearchParams()) {
    try {
        const response = await fetch(`/api/dashboard-stats?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Error al obtener los datos');
        }
        
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar los datos del dashboard');
    }
}

function updateDashboard(data) {
    // Actualizar contadores principales
    document.getElementById('total-activations').textContent = formatNumber(data.total_activaciones || 0);
    document.getElementById('today-activations').textContent = formatNumber(data.activaciones_hoy || 0);
    document.getElementById('week-activations').textContent = formatNumber(data.activaciones_semana || 0);
    document.getElementById('month-activations').textContent = formatNumber(data.activaciones_mes || 0);

    // Actualizar producto más popular
    const popularProduct = document.getElementById('popular-product-name');
    const popularActivations = document.getElementById('popular-product-activations');
    
    if (data.ranking && data.ranking.length > 0) {
        popularProduct.textContent = data.ranking[0].nombre_fantasia || `Sensor ${data.ranking[0].sensor_id}`;
        popularActivations.textContent = formatNumber(data.ranking[0].total);
    } else {
        popularProduct.textContent = 'Sin datos';
        popularActivations.textContent = '0';
    }

    // Actualizar gráficos
    updateCharts(data);
    
    // Actualizar ranking
    updateRanking(data.ranking || []);
    
    // Actualizar historial
    updateHistory(data.historial || []);
}


function updateCharts(data) {
    // Gráfico de activaciones por día
    updateDailyChart(data.activaciones_por_dia);
    
    // Gráfico de sensores
    updateSensorChart(data.activaciones_por_sensor);
}

function updateDailyChart(data) {
    const ctx = document.getElementById('activationsChart');
    if (!ctx) return;

    if (charts.daily) {
        charts.daily.destroy();
    }

    charts.daily = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => formatDate(d.fecha)),
            datasets: [{
                label: 'Activaciones por Día',
                data: data.map(d => d.total),
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
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
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

function updateSensorChart(data) {
    const ctx = document.getElementById('sensorChart');
    if (!ctx) return;

    if (charts.sensor) {
        charts.sensor.destroy();
    }

    charts.sensor = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.nombre_fantasia || `Sensor ${d.sensor_id}`),
            datasets: [{
                label: 'Activaciones por Sensor',
                data: data.map(d => d.total),
                backgroundColor: 'rgba(52, 152, 219, 0.8)',
                borderColor: '#2980b9',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

function updateRanking(data) {
    const tbody = document.getElementById('ranking-table-body');
    if (!tbody) return;

    tbody.innerHTML = data.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.nombre_fantasia || `Sensor ${item.sensor_id}`}</td>
            <td>${formatNumber(item.total)}</td>
            <td>${formatDate(item.ultima_activacion)}</td>
        </tr>
    `).join('');
}

function updateHistory(data) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = data.map(item => `
        <tr>
            <td>${item.nombre_fantasia || `Sensor ${item.sensor_id}`}</td>
            <td>${item.video_path.split('/').pop()}</td>
            <td>${formatDate(item.fecha_inicio)}</td>
            <td>${formatDate(item.fecha_fin)}</td>
            <td>${formatNumber(item.total_activaciones)}</td>
            <td>${item.promedio_diario.toFixed(2)}</td>
        </tr>
    `).join('');
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    }
}

async function handleLogout() {
    try {
        await fetch('/api/logout', {
            method: 'POST'
        });
        window.location.href = '/login';
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        showError('Error al cerrar sesión');
    }
}