import type { VoteTraitsDto } from '@autoc/shared';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ru from '../../../messages/ru.json';
import { renderWithIntl } from '../../../test/render';
import { lowerFirst, VoteTraitsLine } from './vote-traits';

const renderRu = (traits: VoteTraitsDto) =>
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <VoteTraitsLine traits={traits} />
    </NextIntlClientProvider>,
  );

describe('VoteTraitsLine', () => {
  it('ru: "Часто отмечают: подрезает · не включает поворотники · хвалят: пропускает"', () => {
    renderRu({
      negative: [
        { reason: 'cuts_off', count: 5 },
        { reason: 'no_turn_signals', count: 3 },
      ],
      positive: [{ reason: 'lets_merge', count: 2 }],
    });
    const line = screen.getByTestId('vote-traits');
    expect(line.textContent).toBe('Часто отмечают: подрезает · не включает поворотники · хвалят: пропускает');
    expect(line).toHaveTextContent('Часто отмечают: подрезает · не включает поворотники · хвалят: пропускает', { normalizeWhitespace: true });
  });

  it('negative chips are danger-tinted, positive ones success-tinted; no counts and no voters', () => {
    renderWithIntl(
      <VoteTraitsLine
        traits={{
          negative: [{ reason: 'phone_while_driving', count: 4 }],
          positive: [
            { reason: 'careful_driver', count: 3 },
            { reason: 'signals_properly', count: 2 },
          ],
        }}
      />,
    );
    const neg = document.querySelector('[data-reason="phone_while_driving"]')!;
    expect(neg).toHaveAttribute('data-tone', 'negative');
    expect(neg.className).toContain('bg-danger-soft');
    expect(neg).toHaveTextContent('on the phone while driving');
    for (const r of ['careful_driver', 'signals_properly']) {
      const chip = document.querySelector(`[data-reason="${r}"]`)!;
      expect(chip).toHaveAttribute('data-tone', 'positive');
      expect(chip.className).toContain('bg-success-soft');
    }
    expect(screen.getByTestId('vote-traits')).toHaveTextContent('Often noted: on the phone while driving · praised for: drives carefully · always uses turn signals');
    expect(screen.getByTestId('vote-traits').textContent).not.toMatch(/\d/);
  });

  it('only praise → capitalised lead; nothing at all without traits', () => {
    const { rerender, container } = renderRu({ negative: [], positive: [{ reason: 'lets_merge', count: 3 }] });
    expect(screen.getByTestId('vote-traits')).toHaveTextContent('Хвалят: пропускает');
    expect(document.querySelector('[data-tone="negative"]')).toBeNull();
    rerender(
      <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
        <VoteTraitsLine traits={{ negative: [], positive: [] }} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
        <VoteTraitsLine traits={undefined} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lowerFirst only touches the first letter', () => {
    expect(lowerFirst('Не включает поворотники', 'ru')).toBe('не включает поворотники');
    expect(lowerFirst('', 'ru')).toBe('');
  });
});
