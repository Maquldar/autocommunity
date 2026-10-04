'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CodeStep } from '@/features/auth/code-step';
import { PhoneStep } from '@/features/auth/phone-step';
import { useOtpFlow } from '@/features/auth/use-otp-flow';
import { api } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/auth/auth-provider';
import { notify } from '@/lib/toast';

/** Link a phone number to an account created with Google/Apple (POST /me/phone/request + verify). */
export function LinkPhoneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <LinkPhoneBody onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function LinkPhoneBody({ onDone }: { onDone: () => void }) {
  const t = useTranslations('settings.phone');
  const queryClient = useQueryClient();
  const flow = useOtpFlow({
    requestCode: api.me.requestPhone,
    verifyCode: api.me.verifyPhone,
    onVerified: (me) => {
      queryClient.setQueryData(ME_QUERY_KEY, me);
      notify.success(t('linked'));
      onDone();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{flow.state.step === 'code' ? t('codeTitle') : t('linkTitle')}</DialogTitle>
        {flow.state.step === 'phone' ? <DialogDescription>{t('linkDescription')}</DialogDescription> : null}
      </DialogHeader>
      {flow.state.step === 'code' ? (
        <CodeStep
          key={flow.state.phone}
          phone={flow.state.phone}
          devCode={flow.state.devCode}
          resendAt={flow.state.resendAt}
          onVerify={flow.verify}
          onResend={flow.resend}
          onChangeNumber={flow.changeNumber}
          submitLabel={t('confirm')}
        />
      ) : (
        <PhoneStep defaultPhone={flow.phone} onSubmit={flow.sendCode} submitLabel={t('getCode')} />
      )}
    </div>
  );
}
