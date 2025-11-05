import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeModeContext = createContext({
  mode: 'light',
  toggleMode: () => {}
});

const STORAGE_KEY = 'portfolio-theme-mode';

const getInitialMode = () => {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
};

export const ThemeModeProvider = ({ children }) => {
  const [mode, setMode] = useState(getInitialMode);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => {
      setMode((current) => {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
          return stored;
        }
        return event.matches ? 'dark' : 'light';
      });
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const toggleMode = () => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const value = useMemo(() => ({ mode, toggleMode }), [mode]);

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);
