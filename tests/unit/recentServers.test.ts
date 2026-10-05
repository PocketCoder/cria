import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_RECENT_SERVERS, useSettings } from '@/stores/settings';

describe('recent servers', () => {
  beforeEach(() => useSettings.setState({ recentServers: [] }));

  it('puts the latest server first and de-duplicates by url', () => {
    const { rememberServer } = useSettings.getState();
    rememberServer('https://a.example', 'jane');
    rememberServer('https://b.example');
    rememberServer('https://a.example');
    expect(useSettings.getState().recentServers).toEqual([
      { url: 'https://a.example' },
      { url: 'https://b.example' },
    ]);
  });

  it('keeps the username only when given', () => {
    useSettings.getState().rememberServer('https://a.example', 'jane');
    expect(useSettings.getState().recentServers[0]).toEqual({
      url: 'https://a.example',
      username: 'jane',
    });
  });

  it('caps the list and supports forgetting', () => {
    const { rememberServer, forgetServer } = useSettings.getState();
    for (let i = 0; i < MAX_RECENT_SERVERS + 3; i++) rememberServer(`https://s${i}.example`);
    expect(useSettings.getState().recentServers).toHaveLength(MAX_RECENT_SERVERS);
    forgetServer(`https://s${MAX_RECENT_SERVERS + 2}.example`);
    expect(useSettings.getState().recentServers).toHaveLength(MAX_RECENT_SERVERS - 1);
  });
});
