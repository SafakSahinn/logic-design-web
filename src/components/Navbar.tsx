import React from 'react';
import { Binary, Grid, Table, HelpCircle, BookOpen, ExternalLink, Home, Cpu } from 'lucide-react';

export type UnitTab =
  | 'home'
  | 'circuit-simulator'
  | 'kmap-solver'
  | 'number-converter'
  | 'truth-table-tool'
  | 'quiz'
  | 'unit1'
  | 'unit2'
  | 'unit3'
  | 'unit4';

interface NavbarProps {
  activeTab: UnitTab;
  setActiveTab: (tab: UnitTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const navItems = [
    { id: 'home' as UnitTab, title: 'Ana Sayfa', icon: Home },
    { id: 'circuit-simulator' as UnitTab, title: 'Devre Simülatörü', icon: Cpu },
    { id: 'kmap-solver' as UnitTab, title: 'K-Map Çözücü', icon: Grid },
    { id: 'number-converter' as UnitTab, title: 'Sayı Dönüştürücü', icon: Binary },
    { id: 'truth-table-tool' as UnitTab, title: 'Doğruluk Tablosu', icon: Table },
    { id: 'quiz' as UnitTab, title: 'Alıştırmalar', icon: HelpCircle },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-[70px]">
          {/* Brand Logo & Title */}
          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => setActiveTab('home')}
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base sm:text-lg text-slate-900 tracking-tight leading-tight">
                Sıfırdan İşlemciye
              </span>
              <span className="text-[11px] font-medium text-slate-400 -mt-0.5 hidden xs:inline">
                Mantık Tasarımı & Devre Laboratuvarı
              </span>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100/90 p-1 rounded-2xl border border-slate-200/80 shadow-2xs">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-[13px] font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer ${
                    isActive
                      ? 'bg-white text-blue-700 shadow-xs border border-slate-200/90 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
                  <span>{item.title}</span>
                </button>
              );
            })}
          </nav>

          {/* GitHub Repo Button */}
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/SafakSahinn/sifirdan-islemciye"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-slate-50 hover:bg-blue-50/70 px-3.5 py-2 rounded-xl border border-slate-200 transition-colors shadow-2xs"
            >
              <BookOpen className="w-4 h-4 text-blue-600" />
              <span>GitHub Kitap</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="lg:hidden flex items-center justify-between pb-3 pt-1 gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.title.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
