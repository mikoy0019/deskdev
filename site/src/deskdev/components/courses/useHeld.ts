import { useState } from 'react'

/**
 * The last non-null value. A modal driven by `state | null` closes when the
 * state goes null, but its title and fields must hold still while it plays
 * its exit — read them from here, and `open` from the live value.
 */
export function useHeld<T>(value: T | null): T | null {
  const [held, setHeld] = useState<T | null>(value)
  if (value !== null && value !== held) setHeld(value)
  return value ?? held
}
