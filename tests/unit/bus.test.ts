import { describe, it, expect, beforeEach } from 'vitest';
import {
  subscribe,
  notify,
  _clearAllListeners,
} from '@/db/bus';
import type { Topic } from '@/db/bus';

describe('db/bus', () => {
  beforeEach(() => {
    _clearAllListeners();
  });

  it('subscribe adds a listener that gets called on notify', () => {
    const calls: string[] = [];
    subscribe('tasks', () => calls.push('called'));
    notify('tasks');
    expect(calls).toEqual(['called']);
  });

  it('subscribe returns an unsubscribe function that stops notifications', () => {
    const calls: string[] = [];
    const unsub = subscribe('tasks', () => calls.push('called'));
    unsub();
    notify('tasks');
    expect(calls).toEqual([]);
  });

  it('unsubscribe is idempotent', () => {
    const fn = () => {};
    const unsub = subscribe('tasks', fn);
    unsub();
    unsub(); // second call should not throw
  });

  it('notify calls all listeners for the topic', () => {
    const order: number[] = [];
    subscribe('tasks', () => order.push(1));
    subscribe('tasks', () => order.push(2));
    notify('tasks');
    expect(order).toEqual([1, 2]);
  });

  it('notify only fires listeners for the matching topic', () => {
    const calls: string[] = [];
    subscribe('tasks', () => calls.push('tasks'));
    subscribe('projects', () => calls.push('projects'));
    notify('tasks');
    expect(calls).toEqual(['tasks']);
  });

  it('notify does not throw if a listener throws (catches error)', () => {
    subscribe('tasks', () => { throw new Error('boom'); });
    subscribe('tasks', () => { /* survives */ });
    expect(() => notify('tasks')).not.toThrow();
  });

  it('notify is a no-op when no listeners exist', () => {
    expect(() => notify('labels')).not.toThrow();
  });

  it('_clearAllListeners removes all listeners', () => {
    const calls: string[] = [];
    subscribe('tasks', () => calls.push('called'));
    _clearAllListeners();
    notify('tasks');
    expect(calls).toEqual([]);
  });

  it('supports all topic types', () => {
    const topics: Topic[] = [
      'user', 'tasks', 'projects', 'labels', 'task_labels',
      'task_assignees', 'outbox', 'conflicts', 'sync_state',
    ];
    for (const t of topics) {
      let called = false;
      const unsub = subscribe(t, () => { called = true; });
      notify(t);
      expect(called, `topic "${t}" should notify`).toBe(true);
      unsub();
    }
  });

  it('snapshot iteration — listeners added during notify are not called this round', () => {
    const calls: string[] = [];
    subscribe('tasks', () => {
      calls.push('first');
      subscribe('tasks', () => calls.push('late'));
    });
    notify('tasks');
    expect(calls).toEqual(['first']);
    notify('tasks');
    expect(calls).toEqual(['first', 'first', 'late']);
  });
});
