import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform();

/** Expected-failure result shape for adapters (see architecture conventions). */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(reason: string): Result<T> => ({ ok: false, reason });
