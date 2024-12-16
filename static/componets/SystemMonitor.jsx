import React, { useState, useEffect } from 'react';
import { LineChart, XAxis, YAxis, Tooltip, CartesianGrid, Line } from 'recharts';
import { Activity, CircuitBoard, Thermometer, Monitor, HardDrive } from 'lucide-react';

const SystemMonitor = () => {


const SystemMonitor = () => {
  const [systemInfo, setSystemInfo] = useState({
    cpu_percent: 0,
    mem_percent: 0,
    cpu_temp: 0,
    disk_percent: 0,
    uptime: '',
    swap_percent: 0
  });
  const [historicalData, setHistoricalData] = useState([]);

  useEffect(() => {
    const updateInfo = async () => {
      try {
        const response = await fetch('/api/system_info');
        const data = await response.json();
        setSystemInfo(data);
        setHistoricalData(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          cpu: data.cpu_percent,
          memory: data.mem_percent
        }].slice(-20));
      } catch (error) {
        console.error('Error fetching system info:', error);
      }
    };

    updateInfo();
    const interval = setInterval(updateInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  const StatCard = ({ title, value, icon: Icon, color }) => (
    <div className="bg-white rounded-lg p-4 shadow-md">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-gray-500 text-sm mb-1">{title}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <div className={`${color} rounded-full p-2`}>
          <Icon className="text-white" size={24} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-xl font-bold mb-4">System Monitor</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard 
          title="CPU Usage" 
          value={`${systemInfo.cpu_percent}%`} 
          icon={CircuitBoard}
          color="bg-blue-500"
        />
        <StatCard 
          title="Memory Usage" 
          value={`${systemInfo.mem_percent}%`} 
          icon={Activity}
          color="bg-green-500"
        />
        <StatCard 
          title="Temperature" 
          value={`${systemInfo.cpu_temp}°C`} 
          icon={Thermometer}
          color="bg-red-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard 
          title="Disk Usage" 
          value={`${systemInfo.disk_percent}%`} 
          icon={HardDrive}
          color="bg-purple-500"
        />
        <StatCard 
          title="System Uptime" 
          value={systemInfo.uptime} 
          icon={Monitor}
          color="bg-orange-500"
        />
        <StatCard 
          title="Swap Usage" 
          value={`${systemInfo.swap_percent}%`} 
          icon={Activity}
          color="bg-teal-500"
        />
      </div>

      <div className="bg-white p-4 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-4">Performance History</h3>
        <div className="w-full overflow-hidden">
          <LineChart width={800} height={300} data={historicalData}>
            <XAxis dataKey="time" />
            <YAxis />
            <CartesianGrid strokeDasharray="3 3" />
            <Tooltip />
            <Line 
              type="monotone" 
              dataKey="cpu" 
              stroke="#3b82f6" 
              name="CPU Usage" 
            />
            <Line 
              type="monotone" 
              dataKey="memory" 
              stroke="#10b981" 
              name="Memory Usage" 
            />
          </LineChart>
        </div>
      </div>
    </div>
  );
};

};

export default SystemMonitor;