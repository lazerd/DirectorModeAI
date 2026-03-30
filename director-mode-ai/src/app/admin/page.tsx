'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Lock, LogOut, BarChart3, Package, Sparkles, Monitor, RefreshCw } from 'lucide-react';
import OverviewTab from '@/components/admin/OverviewTab';
import ProductsTab from '@/components/admin/ProductsTab';
import FeaturesTab from '@/components/admin/FeaturesTab';
import SessionsTab from '@/components/admin/SessionsTab';

type Tab = 'overview' | 'products' | 'features' | 'sessions';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'features', label: 'Features', icon: Sparkles },
  { id: 'sessions', label: 'Sessions', icon: Monitor },
];

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [checking, setChecking] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Check existing session on mount
  useEffect(() => {
    fetch('/api/admin/auth')
      .then((r) => {
        if (r.ok) setAuthenticated(true);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setAuthenticated(true);
        setError('');
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    setAuthenticated(false);
    setPassword('');
  };

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!autoRefresh || !authenticated) return;
    const interval = setInterval(handleRefresh, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, authenticated, handleRefresh]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#001820] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D3FB52] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Password Gate
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#001820] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#D3FB52]/10 mb-4">
              <Shield className="w-8 h-8 text-[#D3FB52]" />
            </div>
            <h1 className="text-2xl font-bold text-white">Admin Access</h1>
            <p className="text-white/40 mt-2">ClubMode AI Control Panel</p>
          </div>

          <form onSubmit={handleLogin} className="rounded-xl border border-white/10 bg-[#002838] p-6 space-y-4">
            <div>
              <label className="block text-sm text-white/50 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-[#001820] border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-[#D3FB52]/50 focus:ring-1 focus:ring-[#D3FB52]/50 transition-colors"
                  placeholder="Enter admin password"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3 bg-[#D3FB52] text-[#001820] font-semibold rounded-lg hover:bg-[#D3FB52]/90 transition-colors disabled:opacity-50"
            >
              {loginLoading ? 'Verifying...' : 'Enter Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-[#001820]">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#002838]/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-[#D3FB52]" />
              <h1 className="text-lg font-bold text-white">ClubMode AI <span className="text-[#D3FB52]">Analytics</span></h1>
            </div>
            <div className="flex items-center gap-4">
              {/* Auto-refresh toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  autoRefresh
                    ? 'border-[#D3FB52]/50 text-[#D3FB52] bg-[#D3FB52]/10'
                    : 'border-white/10 text-white/40 hover:text-white/60'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-[#D3FB52] animate-pulse' : 'bg-white/30'}`} />
                {autoRefresh ? 'Live' : 'Auto'}
              </button>
              {/* Manual refresh */}
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
                title="Refresh data"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              {/* Logout */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-[#D3FB52] text-[#D3FB52]'
                      : 'border-transparent text-white/40 hover:text-white/60 hover:border-white/20'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && <OverviewTab key={`overview-${refreshKey}`} />}
        {activeTab === 'products' && <ProductsTab key={`products-${refreshKey}`} />}
        {activeTab === 'features' && <FeaturesTab key={`features-${refreshKey}`} />}
        {activeTab === 'sessions' && <SessionsTab key={`sessions-${refreshKey}`} />}
      </main>
    </div>
  );
}
