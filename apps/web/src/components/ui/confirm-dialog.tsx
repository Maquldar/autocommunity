'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** `danger` for destructive, irreversible actions (delete account, remove member). */
  tone?: 'default' | 'danger';
  /** May return a promise: the confirm button shows a spinner and the dialog closes when it resolves. */
  onConfirm: () => void | Promise<unknown>;
};

/**
 * Yes/no confirmation. Focus starts on Cancel so Enter never confirms a destructive action by accident.
 * If onConfirm rejects, the dialog stays open (show the error via toast in the caller).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations('common');
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller reports the error; keep the dialog open so the user can retry or cancel.
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent role="alertdialog" hideClose className="max-w-sm">
        <DialogHeader className="pe-0">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending} autoFocus>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={handleConfirm} loading={pending}>
            {confirmLabel ?? t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
