// The React Native side of the platform seam. The store and the shared lib
// files (byte-for-byte copies of site/src/deskdev — scripts/check-shared-drift.mjs)
// reach the device only through this module; site/src/deskdev/lib/platform.ts
// exports the same names for the browser. Keep the two in step.

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'

import { disablePush } from './push'

/**
 * The public site's origin, for links customers open (quick forms, the
 * booking page). The app has no origin of its own, so it is configured:
 * EXPO_PUBLIC_SITE_URL, else the live site.
 */
export const SITE_ORIGIN: string | null = (process.env.EXPO_PUBLIC_SITE_URL || 'https://nixgensolutions.com').replace(/\/+$/, '')

/** Where the persisted store lives: AsyncStorage. */
export function persistStorage() {
  return AsyncStorage
}

/**
 * This device's part of signing out: stop pushes to this phone while the
 * session can still delete its row (lib/push.ts). Capped like the web's —
 * sign-out must not hang on a slow network.
 */
export async function signOutCleanup(): Promise<void> {
  await Promise.race([
    disablePush({ forget: false }),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ])
}

/** A random UUID v4 — every row id the app creates (Hermes has no crypto.randomUUID). */
export function newId(): string {
  return Crypto.randomUUID()
}

/** Cryptographically random bytes (expo-crypto: the OS generator). */
export function randomBytes(length: number): Uint8Array {
  return Crypto.getRandomBytes(length)
}

/** Lowercase hex SHA-256 of the UTF-8 text. */
export function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.HEX })
}
