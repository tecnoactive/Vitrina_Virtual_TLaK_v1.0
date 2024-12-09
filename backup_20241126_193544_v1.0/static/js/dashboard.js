let charts = {};

document.addEventListener('DOMContentLoaded', function() {
    loadStats();
    setupEventListeners();
    // Actualizar cada minuto
    setInterval(loadStats, 60000);
});

function setupEventListeners() {
    document.getElementById('logout')?.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/';
        } catch (error) {
            console.error('Error en logout:', error);
        }
    });
}

async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        updateProductStats(data.product_stats);
        updateVersusStats(data.versus_stats);
        updateHourlyStats(data.hourly_stats);
        updateGeneralStats(data.general_stats);
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

function updateProductStats(stats) {
    // Actualizar tabla
    const tbody = document.querySelector('#productsTable tbody');
    tbody.innerHTML = '';
    
    stats.forEach(stat => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>Sensor ${stat.sensor_id}</td>
            <td>${stat.activations}</td>
            <td>${formatDate(stat.last_activation)}</td>
        `;
    });

    // Actualizar gráfico
    const ctx = document.getElementById('productsChart').getContext('2d');
    
    if (charts.products) {
        charts.products.destroy();
    }
    
    charts.products = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stats.map(s => `Sensor ${s.sensor_id}`),
            datasets: [{
                label: 'Activaciones',
                data: stats.map(s => s.activations),
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateVersusStats(stats) {
    // Actualizar tabla
    const tbody = document.querySelector('#versusTable tbody');
    tbody.innerHTML = '';
    
    stats.forEach(stat => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${stat.sensor1_id} vs ${stat.sensor2_id}</td>
            <td>${stat.count}</td>
            <td>${formatDate(stat.last_versus)}</td>
        `;
    });

    // Actualizar gráfico
    const ctx = document.getElementById('versusChart').getContext('2d');
    
    if (charts.versus) {
        charts.versus.destroy();
    }
    
    charts.versus = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stats.map(s => `${s.sensor1_id} vs ${s.sensor2_id}`),
            datasets: [{
                label: 'Versus',
                data: stats.map(s => s.count),
                backgroundColor: 'rgba(255, 99, 132, 0.5)',
                borderColor: 'rgba(255, 99, 132, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateHourlyStats(stats) {
    const ctx = document.getElementById('hourlyChart').getContext('2d');
    
    if (charts.hourly) {
        charts.hourly.destroy();
    }
    
    charts.hourly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Activaciones por hora',
                data: stats,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateGeneralStats(stats) {
    document.getElementById('totalActivations').textContent = stats.total_activations;
    document.getElementById('totalVersus').textContent = stats.total_versus;
    document.getElementById('mostPopular').textContent = stats.most_popular_sensor ? 
        `Sensor ${stats.most_popular_sensor}` : '-';
    document.getElementById('mostCommonVersus').textContent = stats.most_common_versus || '-';
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