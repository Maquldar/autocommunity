'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const vehicleKeys = {
  all: ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
};

/** GET /vehicles/:id (API.md §9.4): a vehicle with its owner and the approved violation count. */
export function useVehicle(id: string) {
  return useQuery({ queryKey: vehicleKeys.detail(id), queryFn: () => api.vehicles.get(id) });
}
