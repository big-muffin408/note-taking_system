import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const options = [
  { value: 'light', label: '浅色', icon: '☀' },
  { value: 'dark', label: '深色', icon: '☾' },
  { value: 'system', label: '系统', icon: '◐' },
] as const;

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="主题模式">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={mode === option.value ? 'active' : ''}
          onClick={() => setMode(option.value)}
          title={`${option.label}模式`}
          aria-pressed={mode === option.value}
        >
          <span aria-hidden="true">{option.icon}</span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
