// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSourceModule } from '../../../../scripts/sw-source.mjs';
import { SW_SOURCE } from './swSource';

describe('swSource.ts', () => {
  it('is exactly what scripts/sw-source.mjs writes for the current sw.js', () => {
    const sw = readFileSync(resolve(__dirname, 'sw.js'), 'utf8');
    // A Windows checkout (core.autocrlf) has CRLF where the script writes LF.
    const written = readFileSync(resolve(__dirname, 'swSource.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(written).toBe(renderSourceModule(sw));
    expect(SW_SOURCE).toBe(sw.replace(/\r\n/g, '\n'));
  });

  it('carries the placeholder the route stamps the build id into', () => {
    expect(SW_SOURCE).toContain('__DESKDEV_BUILD_ID__');
  });
});
