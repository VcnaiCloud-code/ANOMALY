import React from 'react';
import { BarChart3, Download, Headphones, HardDrive } from 'lucide-react';
import { SoundTrack } from '../types/sound';

interface StatsDashboardProps {
  tracks: SoundTrack[];
}

export const StatsDashboard: React.FC<StatsDashboardProps> = ({ tracks }) => {
  const totalPlays = tracks.reduce((acc, t) => acc + (t.playCount || 0), 0);
  const totalDownloads = tracks.reduce((acc, t) => acc + (t.downloadCount || 0), 0);

  const topTracks = [...tracks].sort((a, b) => b.downloadCount - a.downloadCount).slice(0, 5);

  const categoryStats = tracks.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + (t.downloadCount || 0);
    return acc;
  }, {} as Record<string, number>);

  const maxCatDownloads = Math.max(...Object.values(categoryStats), 1);

  return (
    <div className="w-full space-y-6">
      
      {/* Header */}
      <div className="pb-2 border-b border-white/[0.05]">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-slate-300" />
          <span>Estadísticas de la Plataforma</span>
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Métricas de actividad, reproducciones y descargas.
        </p>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-panel p-4 rounded-xl border border-white/[0.05] space-y-1">
          <div className="text-slate-400 text-xs flex items-center justify-between">
            <span>Reproducciones</span>
            <Headphones className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            {totalPlays.toLocaleString()}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.05] space-y-1">
          <div className="text-slate-400 text-xs flex items-center justify-between">
            <span>Descargas</span>
            <Download className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            {totalDownloads.toLocaleString()}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.05] space-y-1">
          <div className="text-slate-400 text-xs flex items-center justify-between">
            <span>Sonidos Activos</span>
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            {tracks.length}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.05] space-y-1">
          <div className="text-slate-400 text-xs flex items-center justify-between">
            <span>Conversión</span>
            <span className="text-[10px] text-slate-500 font-mono">%</span>
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            {totalPlays > 0 ? ((totalDownloads / totalPlays) * 100).toFixed(1) : 0}%
          </div>
        </div>
      </div>

      {/* Details: Top tracks & Category Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Top Tracks */}
        <div className="glass-panel p-5 rounded-2xl border border-white/[0.05] space-y-3">
          <h3 className="text-xs font-semibold text-white uppercase tracking-wider">
            Samples más descargados
          </h3>

          {topTracks.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Sin datos de descarga aún.</p>
          ) : (
            <div className="space-y-2">
              {topTracks.map((t, i) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-slate-500 text-[11px] w-4">
                      {i + 1}
                    </span>
                    <span className="font-medium text-white truncate">{t.title}</span>
                  </div>
                  <span className="font-mono text-slate-400 text-[11px] shrink-0">
                    {t.downloadCount} descargas
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Share */}
        <div className="glass-panel p-5 rounded-2xl border border-white/[0.05] space-y-3">
          <h3 className="text-xs font-semibold text-white uppercase tracking-wider">
            Demanda por categoría
          </h3>

          {Object.keys(categoryStats).length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Sin datos de categoría aún.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(categoryStats).map(([cat, count]) => {
                const pct = Math.round((count / maxCatDownloads) * 100);
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300">{cat}</span>
                      <span className="font-mono text-slate-400 text-[11px]">
                        {count}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div
                        className="h-full bg-white/70 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
