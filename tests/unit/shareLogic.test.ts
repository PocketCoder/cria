import { describe, expect, it } from 'vitest';
import {
  availableTeams,
  buildLinkShareInput,
  parseTeamSelection,
  shareErrorMessage,
} from '@/features/projects/shareLogic';

describe('availableTeams', () => {
  const all = [
    { serverId: 1, name: 'A' },
    { serverId: 2, name: 'B' },
  ];
  it('drops teams already shared', () => {
    expect(availableTeams(all, [{ serverId: 1 }])).toEqual([{ serverId: 2, name: 'B' }]);
  });
  it('handles missing data', () => {
    expect(availableTeams(undefined, undefined)).toEqual([]);
    expect(availableTeams(all, undefined)).toEqual(all);
  });
});

describe('shareErrorMessage', () => {
  it('is null without an error', () => {
    expect(shareErrorMessage(null)).toBeNull();
  });
  it('uses the message, else the stringified value', () => {
    expect(shareErrorMessage(new Error('nope'))).toBe('nope');
    expect(shareErrorMessage('plain')).toBe('plain');
  });
});

describe('buildLinkShareInput', () => {
  it('omits blank name and password and trims the name', () => {
    expect(buildLinkShareInput(1, '  ', '')).toEqual({
      permission: 1,
      name: undefined,
      password: undefined,
    });
    expect(buildLinkShareInput(2, ' Team ', 'pw')).toEqual({
      permission: 2,
      name: 'Team',
      password: 'pw',
    });
  });
});

describe('parseTeamSelection', () => {
  it('maps empty to an empty string and others to numbers', () => {
    expect(parseTeamSelection('')).toBe('');
    expect(parseTeamSelection('7')).toBe(7);
  });
});
