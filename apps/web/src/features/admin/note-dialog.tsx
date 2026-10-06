'use client';

import { ADMIN_LIMITS } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { notify } from '@/lib/toast';
import { noteError } from './view-models';

export type NoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  tone?: 'default' | 'danger';
  /** Called with the trimmed note; reject to keep the dialog open (the error is toasted here). */
  onConfirm: (note: string) => Promise<unknown>;
  /** Shown after success. */
  successMessage: ReactNode;
  /** Extra fields above the note (duration, "remove content"). */
  children?: ReactNode;
};

/**
 * Every admin action goes through this: a confirmation with a required note (3–500 characters, audited).
 * Built on ConfirmDialog, so focus starts on Cancel and Enter never confirms by accident.
 */
export function NoteDialog({ open, onOpenChange, title, description, confirmLabel, tone = 'default', onConfirm, successMessage, children }: NoteDialogProps) {
  const t = useTranslations('admin.note');
  const errorMessage = useErrorMessage();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setTouched(false);
    }
  }, [open]);

  const error = noteError(note);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      confirmDisabled={error !== null}
      onConfirm={async () => {
        try {
          await onConfirm(note.trim());
          notify.success(successMessage);
        } catch (err) {
          notify.error(errorMessage(err));
          throw err;
        }
      }}
    >
      <div className="flex flex-col gap-4">
        {children}
        <FormField
          label={t('label')}
          required
          hint={t('hint')}
          error={touched && error ? t(error, { min: ADMIN_LIMITS.noteMin, max: ADMIN_LIMITS.noteMax }) : undefined}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={ADMIN_LIMITS.noteMax}
            showCount
            rows={3}
            data-testid="admin-note"
          />
        </FormField>
      </div>
    </ConfirmDialog>
  );
}
