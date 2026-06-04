// Circuit breaker + throttled logging for sync resilience.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import {
  canAttemptRequest,
  recordRequestFailure,
  recordRequestSuccess,
  circuitCooldownRemaining,
  throttledWarn,
  _resetResilience,
} from '@/api/resilience';

describe('circuit breaker', () => {
  beforeEach(() => {
    _resetResilience();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed', () => {
    expect(canAttemptRequest()).toBe(true);
    expect(circuitCooldownRemaining()).toBe(0);
  });

  it('opens after 4 consecutive failures and recovers after the cooldown', () => {
    for (let i = 0; i < 3; i++) recordRequestFailure();
    expect(canAttemptRequest()).toBe(true); // not yet

    recordRequestFailure(); // 4th → trips
    expect(canAttemptRequest()).toBe(false);
    expect(circuitCooldownRemaining()).toBeGreaterThan(0);

    vi.advanceTimersByTime(30_000);
    expect(canAttemptRequest()).toBe(true);
  });

  it('a success resets the failure streak', () => {
    recordRequestFailure();
    recordRequestFailure();
    recordRequestFailure();
    recordRequestSuccess();
    recordRequestFailure(); // streak of 1, well under threshold
    expect(canAttemptRequest()).toBe(true);
  });
});

describe('throttledWarn', () => {
  beforeEach(() => {
    _resetResilience();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs once, suppresses repeats, then re-logs with a count after the window', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    throttledWarn('k', 'boom');
    throttledWarn('k', 'boom');
    throttledWarn('k', 'boom');
    expect(spy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    throttledWarn('k', 'boom');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]!.some((a) => String(a).includes('+2 more'))).toBe(true);

    spy.mockRestore();
  });

  it('throttles each key independently', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    throttledWarn('a', 'x');
    throttledWarn('b', 'y');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
