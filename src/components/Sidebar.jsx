import React, { useMemo } from 'react';
import { BrainCircuit, LayoutDashboard, Wand2, Calendar as CalendarIcon, MessageSquareQuote, ImageIcon, X, Menu } from 'lucide-react';

const Sidebar = ({ navigateTo, currentView, isSidebarOpen, setIsSidebarOpen, setModal, handleCreateNewProject, AskTheFathersModal, VisualInsightsModal }) => {
  const navItems = useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'studio', label: '✨ Content Studio', icon: Wand2 },
    { id: 'scheduler', label: '✨ Scheduler', icon: CalendarIcon },
    { id: 'ask-the-fathers', label: '✨ Ask the Fathers', icon: MessageSquareQuote, isModal: true },
    { id: 'visual-insights', label: '✨ Visual Insights', icon: ImageIcon, isModal: true },
  ], []);

  const contentTypes = useMemo(() => [
    { id: 'blog', label: 'Blog Posts' },
    { id: 'sermon', label: 'Sermons' },
    { id: 'podcast', label: 'Podcasts' },
    { id: 'series', label: 'Series' },
    { id: 'devotional', label: 'Devotionals' },
    { id: 'ebooks', label: 'E-books' },
    { id: 'courses', label: 'Courses' },
    { id: 'videos', label: 'Videos' },
    { id: 'lyrics', label: 'Lyrics' },
  ], []);

  const NavLink = ({ id, label, icon: Icon, isModal }) => (
    <button
      onClick={() => {
        if (isModal) {
          if (id === 'ask-the-fathers') {
            setModal({ isOpen: true, content: <AskTheFathersModal onClose={() => setModal({ isOpen: false, content: null })} setModal={setModal} handleCreateNewProject={handleCreateNewProject} /> });
          } else if (id === 'visual-insights') {
            setModal({ isOpen: true, content: <VisualInsightsModal onClose={() => setModal({ isOpen: false, content: null })} setModal={setModal} handleCreateNewProject={handleCreateNewProject} /> });
          }
        } else {
          navigateTo(id);
        }
      }}
      className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors duration-200 ${
        currentView === id ? 'bg-[#800020] text-white' : 'text-gray-300 hover:bg-[#800020]/50 hover:text-white'
      }`}
    >
      {Icon ? <Icon size={20} className="mr-4 flex-shrink-0" /> : <span className="w-5 mr-4" />}<span>{label}</span>
    </button>
  );

  return (
    <>
      <aside className={`absolute md:relative z-30 flex-shrink-0 w-64 bg-[#002244]/50 backdrop-blur-lg border-r border-[#D4AF37]/20 flex flex-col transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="flex items-center justify-center h-20 border-b border-[#D4AF37]/20">
          <div className="flex items-center gap-3">
            <BrainCircuit className="text-[#D4AF37] h-8 w-8" />
            <h1 className="text-xl font-bold text-white">ATMT Creator Hub</h1>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tools</p>
          {navItems.map(item => <NavLink key={item.id} {...item} />)}
          <p className="px-4 pt-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Content Types</p>
          {contentTypes.map(item => <NavLink key={item.id} {...item} />)}
        </nav>
        <div className="p-4 border-t border-[#D4AF37]/20 text-xs text-gray-500">
          <p>Powered by Gemini</p>
          <p>&copy; {new Date().getFullYear()} Ancient Truths, Modern Times</p>
        </div>
      </aside>
      {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/60 z-20 md:hidden" />}
    </>
  );
};

export default Sidebar;

