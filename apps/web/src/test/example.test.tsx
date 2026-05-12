import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// 一个简单的组件用于测试
function HelloWorld() {
  return <div>Hello World</div>;
}

describe('Example Test', () => {
  it('should render hello world', () => {
    render(<HelloWorld />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('should perform basic arithmetic', () => {
    expect(1 + 1).toBe(2);
  });
});
