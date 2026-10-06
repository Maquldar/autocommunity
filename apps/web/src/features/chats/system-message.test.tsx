import { describe, expect, it } from 'vitest';
import { parseSystemMessage } from './system-message';

describe('parseSystemMessage', () => {
  it('reads keys with and without nicknames', () => {
    expect(parseSystemMessage('sos.chat_created')).toEqual({ key: 'chatCreated', nickname: null });
    expect(parseSystemMessage('sos.helper_accepted:aidar_77')).toEqual({ key: 'helperAccepted', nickname: 'aidar_77' });
    expect(parseSystemMessage('sos.helper_arrived:a.b')).toEqual({ key: 'helperArrived', nickname: 'a.b' });
    expect(parseSystemMessage('sos.helper_withdrew:')).toEqual({ key: 'helperWithdrew', nickname: null });
    expect(parseSystemMessage('sos.closed')).toEqual({ key: 'closed', nickname: null });
    expect(parseSystemMessage('sos.cancelled')).toEqual({ key: 'cancelled', nickname: null });
    expect(parseSystemMessage('sos.timed_out')).toEqual({ key: 'timedOut', nickname: null });
  });
  it('treats unknown text as unknown', () => {
    expect(parseSystemMessage('hello')).toEqual({ key: 'unknown', nickname: null });
    expect(parseSystemMessage(null)).toEqual({ key: 'unknown', nickname: null });
  });
});

import { screen } from '@testing-library/react';
import { renderWithIntl } from '../../../test/render';
import { useSystemMessageText } from './format';

function Probe({ text }: { text: string }) {
  return <p>{useSystemMessageText()(text)}</p>;
}

describe('useSystemMessageText', () => {
  it('localizes keys with the nickname', () => {
    renderWithIntl(<Probe text="sos.helper_accepted:aidar" />);
    expect(screen.getByText('@aidar is coming to help')).toBeInTheDocument();
  });
  it('falls back for unknown keys and missing nicknames', () => {
    renderWithIntl(<Probe text="sos.helper_arrived" />);
    expect(screen.getByText('A helper has arrived')).toBeInTheDocument();
  });
});
