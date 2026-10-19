import { describe, it, expect } from 'vitest';
import { appReturnUrl, withOutcome } from '@/lib/utils/app-return';

describe('appReturnUrl — only the app itself can be the way back', () => {
  it('accepts the app and Expo Go addresses', () => {
    expect(appReturnUrl('agenticfactor://connected')).toBe('agenticfactor://connected');
    expect(appReturnUrl('exp://192.168.1.5:8081/--/connected')).toBe('exp://192.168.1.5:8081/--/connected');
  });
  it('refuses websites, scripts and junk', () => {
    expect(appReturnUrl('https://evil.example/steal')).toBeNull();
    expect(appReturnUrl('javascript:alert(1)')).toBeNull();
    expect(appReturnUrl('agenticfactor://x"><script>')).toBeNull();
    expect(appReturnUrl(42)).toBeNull();
  });
  it('adds the outcome to the address', () => {
    expect(withOutcome('agenticfactor://connected', { status: 'connected', provider: 'gmail' })).toBe('agenticfactor://connected?status=connected&provider=gmail');
  });
});
