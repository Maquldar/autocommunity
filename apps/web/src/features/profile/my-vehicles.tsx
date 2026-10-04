'use client';

import { LIMITS, type VehicleDto } from '@autoc/shared';
import { CarFront, EllipsisVertical, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { ListGroup } from '@/components/ui/list-item';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { notify } from '@/lib/toast';
import { useDeleteVehicle, useMyVehicles, useUpdateVehicle } from './queries';
import { VehicleDialog } from './vehicle-dialog';
import { VehicleRow } from './vehicle-row';

/** The signed-in user's vehicles with add / edit / delete / make primary. */
export function MyVehicles() {
  const t = useTranslations('vehicles');
  const errorMessage = useErrorMessage();
  const vehicles = useMyVehicles();
  const update = useUpdateVehicle();
  const remove = useDeleteVehicle();
  const [editing, setEditing] = useState<VehicleDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<VehicleDto | null>(null);

  const count = vehicles.data?.length ?? 0;
  const atLimit = count >= LIMITS.vehiclesPerUser;

  function openDialog(vehicle: VehicleDto | null) {
    setEditing(vehicle);
    setDialogOpen(true);
  }

  async function makePrimary(vehicle: VehicleDto) {
    try {
      await update.mutateAsync({ id: vehicle.id, input: { isPrimary: true } });
      notify.success(t('primarySet', { name: `${vehicle.brand} ${vehicle.model}` }));
    } catch (error) {
      notify.error(errorMessage(error), { retry: { label: t('retry'), onClick: () => void makePrimary(vehicle) } });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting);
      notify.success(t('deleted'));
    } catch (error) {
      notify.error(errorMessage(error));
      throw error; // keeps the dialog open
    }
  }

  const addButton = (
    <Button size="sm" variant="outline" leadingIcon={<Plus aria-hidden="true" />} onClick={() => openDialog(null)} disabled={atLimit}>
      {t('add')}
    </Button>
  );

  return (
    <section aria-labelledby="vehicles-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="vehicles-heading" className="text-xl font-semibold tracking-tight">
          {t('title')}
        </h2>
        {vehicles.data && count > 0 ? addButton : null}
      </div>

      {vehicles.isPending ? (
        <div aria-busy="true" className="overflow-hidden rounded-2xl border bg-card [&>*+*]:border-t">
          <span className="sr-only">{t('loading')}</span>
          <ListItemSkeleton />
          <ListItemSkeleton />
        </div>
      ) : vehicles.isError ? (
        <ErrorState compact onRetry={() => void vehicles.refetch()} retrying={vehicles.isFetching} className="rounded-2xl border bg-card" />
      ) : count === 0 ? (
        <div className="rounded-2xl border bg-card">
          <EmptyState
            icon={CarFront}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => openDialog(null)}>
                {t('add')}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ListGroup>
            {vehicles.data.map((vehicle) => (
              <VehicleRow
                key={vehicle.id}
                vehicle={vehicle}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton aria-label={t('actionsFor', { name: `${vehicle.brand} ${vehicle.model}` })} variant="ghost">
                        <EllipsisVertical />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openDialog(vehicle)}>
                        <Pencil aria-hidden="true" />
                        {t('edit')}
                      </DropdownMenuItem>
                      {vehicle.isPrimary ? null : (
                        <DropdownMenuItem onSelect={() => void makePrimary(vehicle)}>
                          <Star aria-hidden="true" />
                          {t('makePrimary')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(vehicle)}>
                        <Trash2 aria-hidden="true" />
                        {t('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            ))}
          </ListGroup>
          <p className="px-1 text-sm text-muted-foreground">
            {atLimit ? t('limitReached', { max: LIMITS.vehiclesPerUser }) : t('count', { count, max: LIMITS.vehiclesPerUser })}
          </p>
        </>
      )}

      <VehicleDialog open={dialogOpen} onOpenChange={setDialogOpen} vehicle={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        tone="danger"
        title={t('deleteTitle')}
        description={deleting ? t('deleteDescription', { name: `${deleting.brand} ${deleting.model}` }) : undefined}
        confirmLabel={t('delete')}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
