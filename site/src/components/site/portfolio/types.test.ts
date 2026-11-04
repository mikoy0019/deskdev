import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { featureShot, hostedShot, isMshots, leadShot, localShotSet } from './types';

const MSHOT = 'https://s.wordpress.com/mshots/v1/https%3A%2F%2Fexample.com?w=640&h=360';
const STORED = 'https://project.supabase.co/storage/v1/object/public/showcase/site-1280.webp';

describe('capture sizes', () => {
  it('asks mShots for 16:9 on the case study and 4:3 on the lead card', () => {
    expect(isMshots(MSHOT)).toBe(true);
    expect(featureShot(MSHOT)).toBe('https://s.wordpress.com/mshots/v1/https%3A%2F%2Fexample.com?w=1280&h=720');
    expect(leadShot(MSHOT)).toBe('https://s.wordpress.com/mshots/v1/https%3A%2F%2Fexample.com?w=1280&h=960');
  });

  it('leaves a stored capture as it is: it cannot be resized by its address', () => {
    expect(isMshots(STORED)).toBe(false);
    expect(featureShot(STORED)).toBe(STORED);
    expect(leadShot(STORED)).toBe(STORED);
  });
});

describe('hostedShot', () => {
  it('is the capture only when we host it and it is meant to be shown', () => {
    expect(hostedShot({ image: '/products/inbox-ai.png' })).toBe('/products/inbox-ai.png');
    expect(hostedShot({ image: STORED })).toBe(STORED);
    expect(hostedShot({ image: '/products/pos-app.png', preferMockup: true })).toBeNull();
    expect(hostedShot({ image: MSHOT })).toBeNull();
    expect(hostedShot({ image: null })).toBeNull();
  });
});

describe('localShotSet', () => {
  it('lists the WebP twins of a local capture, and nothing for any other image', () => {
    expect(localShotSet('/products/inbox-ai.png')).toBe('/products/inbox-ai-800.webp 800w, /products/inbox-ai-1600.webp 1600w');
    expect(localShotSet('/products/pos-app.png')).toBeNull();
    expect(localShotSet(STORED)).toBeNull();
  });

  // vitest runs from site/. A name in the list without its two files would be a broken image.
  it('only names files that exist in /public/products', () => {
    for (const name of ['inbox-ai', 'invoice-chase', 'stock-sense']) {
      const set = localShotSet(`/products/${name}.png`);
      expect(set).not.toBeNull();
      for (const entry of set!.split(', ')) expect(existsSync(`public${entry.split(' ')[0]}`)).toBe(true);
    }
  });
});
