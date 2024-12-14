let charts = {};

document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    loadStats();
    // Actualizar cada 5 minutos
    setInterval(loadStats, 300000);
});

function initializeDashboard() {
    setDefaultDates();
    handlePeriodChange();
}

function setDefaultDates() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');
    
    if (dateFrom && dateTo) {
        dateFrom.value = formatDateForInput(firstDay);
        dateTo.value = formatDateForInput(today);
    }
}

function handlePeriodChange() {
    const select = document.getElementById('period-select');
    const customDates = document.getElementById('custom-dates');
    
    if (!select || !customDates) return;
    
    customDates.style.display = select.value === 'custom' ? 'block' : 'none';
    
    if (select.value !== 'custom') {
        loadStats();
    }
}

async function loadStats() {
    const params = getDateParams();
    showLoading();
    
    try {
        console.log('Solicitando datos con parámetros:', params);
        const response = await fetch(`/api/stats?${params}`);
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Datos recibidos:', data);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (!data.product_stats || !data.versus_stats) {
            console.error('Datos incompletos:', data);
            throw new Error('Datos incompletos recibidos del servidor');
        }
        
        updateDashboard(data);
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
        showError(`Error al cargar los datos: ${error.message}`);
    } finally {
        hideLoading();
    }
}



function getDateParams() {
    const select = document.getElementById('period-select');
    const params = new URLSearchParams();
    
    if (select.value === 'custom') {
        const dateFrom = document.getElementById('date-from').value;
        const dateTo = document.getElementById('date-to').value;
        params.append('from', dateFrom);
        params.append('to', dateTo);
    } else {
        const dates = calculateDates(select.value);
        params.append('from', dates.from);
        params.append('to', dates.to);
    }
    
    return params.toString();
}

function calculateDates(period) {
    const today = new Date();
    let from = new Date();
    
    switch (period) {
        case 'current-month':
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'last-month':
            from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            today.setDate(0); // Último día del mes anterior
            break;
        case 'last-3-months':
            from = new Date(today.getFullYear(), today.getMonth() - 3, 1);
            break;
    }
    
    return {
        from: formatDateForInput(from),
        to: formatDateForInput(today)
    };
}

function updateDashboard(data) {
    console.log('Actualizando dashboard con datos:', data);
    try {
        updateStats(data);
        if (data.product_stats) {
            console.log('Actualizando estadísticas de productos:', data.product_stats);
            updateProductsChart(data.product_stats);
        }
        if (data.versus_stats) {
            console.log('Actualizando estadísticas de versus:', data.versus_stats);
            updateVersusChart(data.versus_stats);
        }
        if (data.hourly_stats) {
            console.log('Actualizando estadísticas por hora:', data.hourly_stats);
            updateHourlyChart(data.hourly_stats);
        }
        if (data.history) {
            console.log('Actualizando historial:', data.history);
            updateHistoryTable(data.history);
        }
        updateTables(data);
    } catch (error) {
        console.error('Error en updateDashboard:', error);
    }
}

function updateStats(data) {
    try {
        const elements = {
            'total-activations': data.total_activations || 0,
            'total-versus': data.total_versus || 0,
            'most-popular': data.most_popular_product || '-',
            'most-common-versus': data.most_common_versus || '-'
        };

        for (const [id, value] of Object.entries(elements)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            } else {
                console.warn(`Elemento no encontrado: ${id}`);
            }
        }
    } catch (error) {
        console.error('Error en updateStats:', error);
    }
}

function updateProductsChart(stats) {
    const ctx = document.getElementById('products-chart')?.getContext('2d');
    if (!ctx) return;
    
    if (charts.products) charts.products.destroy();
    
    charts.products = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stats.map(s => s.nombre || `Sensor ${s.sensor_id}`),
            datasets: [{
                label: 'Activaciones',
                data: stats.map(s => s.activations),
                backgroundColor: '#3b82f6',
                borderColor: '#2563eb',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateVersusChart(stats) {
    const ctx = document.getElementById('versus-chart')?.getContext('2d');
    if (!ctx) return;
    
    if (charts.versus) charts.versus.destroy();
    
    charts.versus = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stats.map(s => `${s.nombre1 || s.sensor1_id} vs ${s.nombre2 || s.sensor2_id}`),
            datasets: [{
                label: 'Versus',
                data: stats.map(s => s.count),
                backgroundColor: '#ef4444',
                borderColor: '#dc2626',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateTables(data) {
    updateProductsTable(data.product_stats);
    updateVersusTable(data.versus_stats);
}

function updateProductsTable(stats) {
    const tbody = document.getElementById('products-table');
    if (!tbody || !stats) return;
    
    tbody.innerHTML = stats.map(stat => `
        <tr>
            <td>${stat.nombre || `Sensor ${stat.sensor_id}`}</td>
            <td>${stat.activations}</td>
            <td>${formatDate(stat.last_activation)}</td>
        </tr>
    `).join('');
}

function updateVersusTable(stats) {
    const tbody = document.getElementById('versus-table');
    if (!tbody || !stats) return;
    
    tbody.innerHTML = stats.map(stat => `
        <tr>
            <td>${stat.nombre1 || stat.sensor1_id} vs ${stat.nombre2 || stat.sensor2_id}</td>
            <td>${stat.count}</td>
            <td>${formatDate(stat.last_versus)}</td>
        </tr>
    `).join('');
}

function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function updateHourlyChart(stats) {
    const ctx = document.getElementById('hourly-chart')?.getContext('2d');
    if (!ctx) return;
    
    if (charts.hourly) {
        charts.hourly.destroy();
    }

    const hours = Array.from({length: 24}, (_, i) => 
        `${i.toString().padStart(2, '0')}:00`
    );
    
    charts.hourly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [{
                label: 'Activaciones',
                data: stats.hourly_stats || Array(24).fill(0),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true
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

function updateHistoryTable(history) {
    const tbody = document.getElementById('history-table');
    if (!tbody || !history) return;
    
    tbody.innerHTML = history.map(item => `
        <tr>
            <td>Sensor ${item.sensor_id}</td>
            <td>${item.nombre || 'Sin nombre'}</td>
            <td>${item.video_path?.split('/').pop() || '-'}</td>
            <td>${formatDate(item.fecha_inicio)}</td>
            <td>${formatDate(item.fecha_fin) || 'Actual'}</td>
            <td>${formatNumber(item.total_activaciones)}</td>
            <td>${formatNumber(item.promedio_diario)}</td>
        </tr>
    `).join('');
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

function showLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'flex';
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
}

function showError(message) {
    // Puedes personalizar cómo mostrar los errores
    alert(message);
}

async function handleLogout() {
    try {
        const response = await fetch('/api/logout', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            window.location.href = '/login';
        } else {
            throw new Error('Error al cerrar sesión');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cerrar sesión');
    }
}

// Función de utilidad para formatear números grandes
function formatNumber(num) {
    return new Intl.NumberFormat('es-ES').format(num);
}

// Evento para tecla Escape (cerrar modales, etc)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    }
});