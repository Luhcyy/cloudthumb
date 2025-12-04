import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar
} from 'recharts';
import { MetricPoint } from '../types';

interface ChartProps {
  data: MetricPoint[];
}

export const InvocationsChart: React.FC<ChartProps> = ({ data }) => (
  <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 shadow-sm">
    <h3 className="text-slate-400 text-sm font-medium mb-4">Invocações Lambda (Contagem)</h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} allowDecimals={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f1f5f9' }}
            itemStyle={{ color: '#38bdf8' }}
          />
          <Bar dataKey="invocations" fill="#38bdf8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export const DurationChart: React.FC<ChartProps> = ({ data }) => (
  <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 shadow-sm">
    <h3 className="text-slate-400 text-sm font-medium mb-4">Duração (ms)</h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f1f5f9' }}
          />
          <Area type="monotone" dataKey="duration" stroke="#818cf8" fill="#818cf8" fillOpacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export const ErrorChart: React.FC<ChartProps> = ({ data }) => (
  <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 shadow-sm">
    <h3 className="text-slate-400 text-sm font-medium mb-4">Contagem de Erros</h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} allowDecimals={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f1f5f9' }}
          />
          <Line type="step" dataKey="errors" stroke="#f87171" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
);