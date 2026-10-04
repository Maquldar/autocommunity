'use client';

import type { OtpRequestResult } from '@autoc/shared';
import { useState } from 'react';

export type OtpFlowState =
  | { step: 'phone' }
  | { step: 'code'; phone: string; devCode: string | null; resendAt: number };

type Options<T> = {
  requestCode: (phone: string) => Promise<OtpRequestResult>;
  verifyCode: (phone: string, code: string) => Promise<T>;
  onVerified: (result: T) => void | Promise<void>;
};

/**
 * Phone → code state machine shared by sign-in and phone linking. Errors are rethrown so each
 * step's form can show them on the right field.
 */
export function useOtpFlow<T>({ requestCode, verifyCode, onVerified }: Options<T>) {
  const [state, setState] = useState<OtpFlowState>({ step: 'phone' });
  // Kept when going back so "Change number" starts from what was typed.
  const [phone, setPhone] = useState('');

  async function sendCode(nextPhone: string): Promise<void> {
    const result = await requestCode(nextPhone);
    setPhone(nextPhone);
    setState({
      step: 'code',
      phone: nextPhone,
      devCode: result.devCode ?? null,
      resendAt: Date.now() + result.retryAfterSec * 1000,
    });
  }

  async function verify(code: string): Promise<void> {
    if (state.step !== 'code') return;
    const result = await verifyCode(state.phone, code);
    await onVerified(result);
  }

  function changeNumber() {
    setState({ step: 'phone' });
  }

  return {
    state,
    phone,
    sendCode,
    resend: () => (state.step === 'code' ? sendCode(state.phone) : Promise.resolve()),
    verify,
    changeNumber,
  };
}

/** "0:42" */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
