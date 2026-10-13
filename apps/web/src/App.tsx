import React from 'react';

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
              R
            </div>
            <span className="font-semibold text-lg tracking-tight">ReachInbox</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Job Scheduler
            </span>
          </div>
          <div className="flex items-center space-x-3 text-sm text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Infrastructure Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-16 flex-1 w-full">
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
            <span>● Phase 2 Scaffolding Active</span>
          </div>

          <h1 id="main-heading" className="text-3xl font-bold tracking-tight text-white mb-4">
            ReachInbox Full-Stack Email Scheduler
          </h1>

          <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-2xl">
            Distributed email job scheduling platform built with BullMQ, Redis delayed queues,
            PostgreSQL transactional persistence, and Elasticsearch search.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">
                Database
              </div>
              <div className="text-sm font-medium text-slate-200">PostgreSQL 16</div>
              <div className="text-xs text-slate-500 mt-1">Transactional persistence & outbox</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">
                Queue & Cache
              </div>
              <div className="text-sm font-medium text-slate-200">Redis 7 (Appendonly)</div>
              <div className="text-xs text-slate-500 mt-1">BullMQ delayed scheduling & limits</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">
                Search Engine
              </div>
              <div className="text-sm font-medium text-slate-200">Elasticsearch 8.11</div>
              <div className="text-xs text-slate-500 mt-1">High-performance full-text search</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        ReachInbox.ai Software Development Intern Assignment &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default App;
