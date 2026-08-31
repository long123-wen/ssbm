import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    const cls = document.documentElement.classList;
    if (dark) {
      cls.add('dark');
      localStorage.setItem('rj-theme', 'dark');
    } else {
      cls.remove('dark');
      localStorage.setItem('rj-theme', 'light');
    }
  }, [dark]);

  // 初始化时读取本地存储
  useEffect(() => {
    const saved = localStorage.getItem('rj-theme');
    if (saved === 'dark') setDark(true);
    else if (saved === 'light') setDark(false);
    else {
      // 跟随系统偏好
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => setDark(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, []);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
      title={dark ? '切换亮色模式' : '切换暗色模式'}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
