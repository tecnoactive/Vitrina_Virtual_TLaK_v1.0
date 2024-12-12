let charts = {};
let productNames = {};

document.addEventListener('DOMContentLoaded', async () => {
    await initializeDashboard();
    await refreshStats();
    setInterval(refreshStats, 60000);
});

async function initializeDashboard() {
    await loadProductNames();
    setupDateDefaults();
    handlePeriodChange();
}

async function loadProductNames() {
    try {
        const response = await fetch('/api/sensor-names');
        productNames = await response.json();
    } catch (error) {
        console.error('Error cargando nombres:', error);
    }
}

function setupDateDefaults() {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    document.getElementById('dateFrom').value = formatDateForInput(lastMonth);
    document.getElementById('dateTo').value = formatDateForInput(today);
}

function handlePeriodChange() {
    const period = document.getElementById('period').value;
    document.getElementById('dateInputs').style.display = 
        period === 'custom' ? 'block' : 'none';
}

async function refreshStats() {
    const params = getFilterParams();
    showLoading();
    
    try {
        const response = await fetch(`/api/stats?${params}`);
        if (!response.ok) throw new Error('Error en la respuesta del servidor');
        
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Error:', error);
        alert('Error cargando estadísticas');
    } finally {
        hideLoading();
    }
}

function getFilterParams() {
    const period = document.getElementById('period').value;
    const params = new URLSearchParams({ period });
    
    if (period === 'custom') {
        params.append('from', document.getElementById('dateFrom').value);
        params.append('to', document.getElementById('dateTo').value);
    }
    
    return params;
}

function updateDashboard(data) {
    updateStats(data);
    updateCharts(data);
    updateTables(data);
}

function updateStats(data) {
  document.getElementById('total-activations').textContent = data.total_activations;
  document.getElementById('total-versus').textContent = data.total_versus;
  document.getElementById('most-popular').textContent = 
      productNames[data.most_popular_sensor] || `Sensor ${data.most_popular_sensor}` || '-';
  document.getElementById('most-common').textContent = 
      data.most_common_versus ? formatVersus(data.most_common_versus) : '-';
}

function updateCharts(data) {
  if (data.product_stats) updateProductsChart(data.product_stats);
  if (data.versus_stats) updateVersusChart(data.versus_stats);
  if (data.hourly_stats) updateHourlyChart(data.hourly_stats);
  if (data.trend_stats) updateTrendChart(data.trend_stats);
}

function updateProductsChart(stats) {
    const ctx = document.getElementById('products-chart').getContext('2d');
    
    if (charts.products) charts.products.destroy();
    
    charts.products = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stats.map(s => productNames[s.sensor_id] || `Sensor ${s.sensor_id}`),
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
            }
        }
    });
}

function updateVersusChart(stats) {
  if (!stats || !stats.length) return;
  const ctx = document.getElementById('versus-chart').getContext('2d');
  
  if (charts.versus) charts.versus.destroy();
  
  charts.versus = new Chart(ctx, {
      type: 'bar',
      data: {
          labels: stats.map(s => formatVersus(`${s.sensor1_id} vs ${s.sensor2_id}`)),
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
          }
      }
  });
}

function updateHourlyChart(stats) {
    const ctx = document.getElementById('hourly-chart').getContext('2d');
    
    if (charts.hourly) charts.hourly.destroy();
    
    charts.hourly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Activaciones',
                data: stats,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function updateTrendChart(stats) {
  const ctx = document.getElementById('trend-chart').getContext('2d');
  
  if (charts.trend) charts.trend.destroy();
  
  charts.trend = new Chart(ctx, {
      type: 'line',
      data: {
          labels: stats.map(s => formatDate(s.date)),
          datasets: [{
              label: 'Activaciones',
              data: stats.map(s => s.count),
              borderColor: '#8b5cf6',
              backgroundColor: 'rgba(139, 92, 246, 0.1)',
              tension: 0.4,
              fill: true
          }]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
              tooltip: {
                  mode: 'index',
                  intersect: false
              }
          }
      }
  });
}

function updateTables(data) {
  if (data.product_stats) updateProductsTable(data.product_stats);
  if (data.versus_stats) updateVersusTable(data.versus_stats);
}


function updateProductsTable(stats) {
  if (!stats || !stats.length) return;
  const tbody = document.getElementById('products-table');
  tbody.innerHTML = stats.map(stat => `
      <tr>
          <td>${productNames[stat.sensor_id] || `Sensor ${stat.sensor_id}`}</td>
          <td>${stat.activations}</td>
          <td>${formatDate(stat.last_activation)}</td>
      </tr>
  `).join('');
}



function updateVersusTable(stats) {
  if (!stats || !stats.length) return;
  const tbody = document.getElementById('versus-table');
  tbody.innerHTML = stats.map(stat => `
      <tr>
          <td>${formatVersus(`${stat.sensor1_id} vs ${stat.sensor2_id}`)}</td>
          <td>${stat.count}</td>
          <td>${formatDate(stat.last_versus)}</td>
      </tr>
  `).join('');
}

function formatVersus(versusString) {
  if (!versusString) return '-';
  return versusString.replace(/(\d+)/g, id => 
      productNames[id] || `Sensor ${id}`
  );
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
  document.getElementById('loading').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

async function handleLogout() {
  try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/';
  } catch (error) {
      console.error('Error:', error);
      alert('Error al cerrar sesión');
  }
}