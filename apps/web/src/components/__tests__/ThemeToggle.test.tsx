import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ThemeToggle from '../ThemeToggle';
import { ThemeProvider } from '../../contexts/ThemeContext';

describe('ThemeToggle', () => {
  it('should render theme toggle buttons', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getByText('浅色')).toBeInTheDocument();
    expect(screen.getByText('深色')).toBeInTheDocument();
    expect(screen.getByText('系统')).toBeInTheDocument();
  });

  it('should highlight the active theme', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    // 默认应该是系统模式
    const systemButton = screen.getByText('系统').closest('button');
    expect(systemButton).toHaveClass('active');
  });

  it('should call setMode when clicking a theme button', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const darkButton = screen.getByText('深色');
    fireEvent.click(darkButton);

    // 点击后应该切换到深色模式
    const darkButtonAfterClick = screen.getByText('深色').closest('button');
    expect(darkButtonAfterClick).toHaveClass('active');
  });

  it('should have proper accessibility attributes', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', '主题模式');

    const buttons = screen.getAllByRole('button');
    buttons.forEach(button => {
      expect(button).toHaveAttribute('aria-pressed');
    });
  });
});
