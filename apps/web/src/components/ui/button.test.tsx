import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { Button } from './button';
import { IconButton } from './icon-button';

describe('<Button>', () => {
  it('defaults to type="button" and fires clicks', () => {
    const onClick = vi.fn();
    renderWithIntl(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).not.toHaveAttribute('aria-busy');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading disables the button, sets aria-busy and keeps the label', () => {
    const onClick = vi.fn();
    renderWithIntl(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled without loading is not busy', () => {
    renderWithIntl(<Button disabled>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('asChild renders the child element with button styles', () => {
    renderWithIntl(
      <Button asChild variant="secondary">
        <a href="/login">Get started</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).not.toHaveAttribute('type');
    expect(link.className).toContain('bg-secondary');
  });
});

describe('<IconButton>', () => {
  it('exposes its aria-label as the accessible name', () => {
    renderWithIntl(
      <IconButton aria-label="Close">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
