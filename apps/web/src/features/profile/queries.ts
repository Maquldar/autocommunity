'use client';

import type { Me, UpdateMeInput, UpdateSettingsInput, VehicleDto } from '@autoc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { VehicleBody } from '@/lib/api/endpoints';
import { ME_QUERY_KEY } from '@/lib/auth/auth-provider';

export const MY_VEHICLES_KEY = ['me', 'vehicles'] as const;
export const userKey = (id: string) => ['users', id] as const;
export const userVehiclesKey = (id: string) => ['users', id, 'vehicles'] as const;

export function useMyVehicles() {
  return useQuery({ queryKey: MY_VEHICLES_KEY, queryFn: api.vehicles.list });
}

export function useUser(id: string) {
  return useQuery({ queryKey: userKey(id), queryFn: () => api.users.get(id) });
}

export function useUserVehicles(id: string, enabled: boolean) {
  return useQuery({ queryKey: userVehiclesKey(id), queryFn: () => api.users.vehicles(id), enabled });
}

function useSetMe() {
  const queryClient = useQueryClient();
  return (me: Me) => queryClient.setQueryData(ME_QUERY_KEY, me);
}

export function useUpdateMe() {
  const setMe = useSetMe();
  return useMutation({ mutationFn: (input: UpdateMeInput) => api.me.update(input), onSuccess: setMe });
}

/** Settings apply immediately (switches, radio cards), so they update the cache optimistically. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.me.updateSettings(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY, exact: true });
      const previous = queryClient.getQueryData<Me>(ME_QUERY_KEY);
      if (previous) queryClient.setQueryData<Me>(ME_QUERY_KEY, { ...previous, ...input });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(ME_QUERY_KEY, context.previous);
    },
    onSuccess: (me) => queryClient.setQueryData(ME_QUERY_KEY, me),
  });
}

/** Vehicle writes change the list and Me.primaryVehicle. */
function useInvalidateVehicles() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
}

export function useCreateVehicle() {
  const invalidate = useInvalidateVehicles();
  return useMutation({ mutationFn: (input: VehicleBody) => api.vehicles.create(input), onSuccess: invalidate });
}

export function useUpdateVehicle() {
  const invalidate = useInvalidateVehicles();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<VehicleBody> }) => api.vehicles.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteVehicle() {
  const invalidate = useInvalidateVehicles();
  return useMutation({ mutationFn: (vehicle: Pick<VehicleDto, 'id'>) => api.vehicles.remove(vehicle.id), onSuccess: invalidate });
}
