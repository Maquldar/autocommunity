import { normalizeHours } from '@autoc/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { DEFAULT_HOURS } from './hours';
import { HoursTable } from './hours-table';
import { OpenStateLine } from './open-state';

const almaty = (iso: string) => new Date(`${iso}+05:00`);

describe('<OpenStateLine>', () => {
  it.each([
    ['2026-10-05T12:00:00', 'Open until 19:00'],
    ['2026-10-05T07:00:00', 'Closed · opens at 09:00'],
    ['2026-10-05T21:00:00', 'Closed · opens tomorrow at 09:00'],
    ['2026-10-10T18:00:00', 'Closed · opens Mon at 09:00'],
  ])('%s → %s', (at, text) => {
    renderWithIntl(<OpenStateLine hours={DEFAULT_HOURS} now={almaty(at)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows unknown hours', () => {
    renderWithIntl(<OpenStateLine hours={normalizeHours({})} now={new Date()} />);
    expect(screen.getByText('Hours not specified')).toBeInTheDocument();
  });
});

describe('<HoursTable>', () => {
  it('lists the week with today highlighted and closed days', () => {
    renderWithIntl(<HoursTable hours={{ ...DEFAULT_HOURS, sat: '00:00-24:00' }} now={almaty('2026-10-07T10:00:00')} />);
    const today = screen.getByRole('row', { current: 'date' });
    expect(today).toHaveTextContent('Wednesday(today)09:00–19:00');
    expect(screen.getByRole('row', { name: /Saturday/ })).toHaveTextContent('24 hours');
    expect(screen.getByRole('row', { name: /Sunday/ })).toHaveTextContent('Closed');
    expect(screen.getAllByRole('row')).toHaveLength(7);
  });
});
