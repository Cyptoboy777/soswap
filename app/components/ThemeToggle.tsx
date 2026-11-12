'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const enabled = localStorage.getItem('soswap-theme') !== 'light';
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
  }, []);
  const toggle = () => {
    const enabled = !dark;
    setDark(enabled);
    localStorage.setItem('soswap-theme', enabled ? 'dark' : 'light');
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
  };
  return <button className="ss-theme-toggle" type="button" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} title={`${dark ? 'Light' : 'Dark'} mode`}>{dark ? <Sun size={16}/> : <Moon size={16}/>}<span>{dark ? 'Light' : 'Dark'}</span></button>;
}
