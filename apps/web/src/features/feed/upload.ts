'use client';

import type { UploadDto } from '@autoc/shared';
import { session } from '@/lib/api';
import { API_BASE_URL } from '@/lib/api/config';
import { ApiError, networkError, parseApiError } from '@/lib/api/errors';

type Progress = (fraction: number) => void;

function send(file: File, purpose: 'post' | 'video', token: string, onProgress: Progress, signal?: AbortSignal, durationSec?: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/uploads?purpose=${purpose}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () =>
      resolve(new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, headers: { 'Content-Type': 'application/json', 'Retry-After': xhr.getResponseHeader('Retry-After') ?? '' } }));
    xhr.onerror = () => reject(networkError(new Error('Upload failed')));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('purpose', purpose);
    if (durationSec !== undefined) form.append('durationSec', String(Math.round(durationSec * 10) / 10));
    form.append('file', file, file.name || 'upload');
    xhr.send(form);
  });
}

/**
 * POST /uploads with upload progress (fetch can't report it, so this uses XMLHttpRequest). Refreshes the
 * access token once on 401, like the shared API client.
 */
export async function uploadWithProgress(
  file: File,
  purpose: 'post' | 'video',
  onProgress: Progress,
  { signal, durationSec }: { signal?: AbortSignal; durationSec?: number } = {},
): Promise<UploadDto> {
  let token = session.getAccessToken() ?? (await session.refresh(null));
  if (!token) throw new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'Not signed in' });
  let response = await send(file, purpose, token, onProgress, signal, durationSec);
  if (response.status === 401) {
    token = await session.refresh(token);
    if (!token) throw await parseApiError(response);
    onProgress(0);
    response = await send(file, purpose, token, onProgress, signal, durationSec);
  }
  if (!response.ok) throw await parseApiError(response);
  onProgress(1);
  return (await response.json()) as UploadDto;
}

/** Duration of a local video file in seconds (best effort; undefined if the browser can't tell). */
export function videoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : undefined);
    video.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 5000);
    video.src = url;
  });
}
