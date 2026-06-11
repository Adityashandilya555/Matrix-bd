import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('vitest harness', () => {
  it('runs assertions', () => {
    expect(1 + 1).toBe(2);
  });

  it('renders React + jest-dom matchers work', () => {
    render(<div>hello matrix</div>);
    expect(screen.getByText('hello matrix')).toBeInTheDocument();
  });
});
