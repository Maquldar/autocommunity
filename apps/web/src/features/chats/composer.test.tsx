import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { Composer } from './composer';

describe('<Composer>', () => {
  it('Enter sends the trimmed text, Shift+Enter does not, and typing is reported', () => {
    const onSend = vi.fn();
    const onTyping = vi.fn();
    renderWithIntl(<Composer disabled={false} onSend={onSend} onTyping={onTyping} />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: '  hello\nthere ' } });
    expect(onTyping).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith({ type: 'text', text: 'hello\nthere' });
    expect(input).toHaveValue('');
  });

  it('shows the send button only with text, the mic otherwise, and nothing sends while offline', () => {
    const onSend = vi.fn();
    renderWithIntl(<Composer disabled onSend={onSend} onTyping={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeDisabled();
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a character counter near the 4000 limit', () => {
    renderWithIntl(<Composer disabled={false} onSend={vi.fn()} onTyping={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    expect(input).toHaveAttribute('maxLength', '4000');
    fireEvent.change(input, { target: { value: 'x'.repeat(3500) } });
    expect(screen.getByText('3500 of 4000 characters used')).toBeInTheDocument();
  });
});
