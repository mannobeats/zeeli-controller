import { expect, test } from 'vitest';
import {
  allowRule,
  blockRule,
  cleanDomain,
  describeProfile,
  domainAction,
  newProfile,
  parseRule,
  profileIds,
  profileName,
  rewriteProblem,
} from './adguard.ts';

test('rules are read back as block, allow or something else', () => {
  expect(parseRule(blockRule('Example.com'))).toEqual({ kind: 'block', domain: 'example.com' });
  expect(parseRule(allowRule('x.org'))).toEqual({ kind: 'allow', domain: 'x.org' });
  expect(parseRule('/ads[0-9]+/').kind).toBe('other');
  expect(parseRule('||example.com^$important').kind).toBe('other');
});

test('a click on a domain adds the opposite rule or takes your own back', () => {
  expect(domainAction([], 'ads.net', false)).toMatchObject({ label: 'Block', rules: ['||ads.net^'] });
  expect(domainAction([], 'ads.net', true)).toMatchObject({ label: 'Allow', rules: ['@@||ads.net^'] });
  expect(domainAction(['||ads.net^', 'x'], 'ADS.net', true)).toMatchObject({ label: 'Unblock', rules: ['x'] });
  expect(domainAction(['@@||ads.net^'], 'ads.net', false)).toMatchObject({ label: 'Remove allow', rules: [] });
  // a rule for the parent domain is not "yours" for the subdomain
  expect(domainAction(['||ads.net^'], 'a.ads.net', true).label).toBe('Allow');
});

test('names and rewrites are checked', () => {
  expect(cleanDomain(' https://Example.com/a?b ')).toBe('example.com');
  expect(rewriteProblem('nas.home', '192.168.8.20')).toBe('');
  expect(rewriteProblem('*.home', 'nas.lan')).toBe('');
  expect(rewriteProblem('nas.home', '::1')).toBe('');
  expect(rewriteProblem('bad name', '192.168.8.20')).toMatch(/domain name/);
  expect(rewriteProblem('nas.home', '10.0.0.999!')).toMatch(/IP address or a name/);
});

test('a profile keeps each address and MAC once', () => {
  expect(
    profileIds([
      { ip: '192.168.8.2', mac: 'AA:BB:CC:00:00:01' },
      { ip: '', mac: 'AA:BB:CC:00:00:02' },
      { ip: '192.168.8.2', mac: 'AA:BB:CC:00:00:01' },
    ]),
  ).toEqual(['192.168.8.2', 'aa:bb:cc:00:00:01', 'aa:bb:cc:00:00:02']);
  expect(profileName('Kids')).toBe('Zeeli: Kids');
});

test('a profile is described in a sentence', () => {
  const name = (id: string) => ({ tiktok: 'TikTok', youtube: 'YouTube', roblox: 'Roblox', steam: 'Steam' })[id] ?? id;
  const p = newProfile('Zeeli: Kids', ['1.2.3.4']);
  expect(describeProfile(p, name)).toBe('Same protection as everyone else');
  const kids = {
    ...p,
    use_global_settings: false,
    parental_enabled: true,
    use_global_blocked_services: false,
    blocked_services: ['tiktok', 'youtube'],
  };
  expect(describeProfile(kids, name)).toBe('Parental control on, TikTok and YouTube blocked');
  const many = { ...kids, blocked_services: ['tiktok', 'youtube', 'roblox', 'steam'] };
  expect(describeProfile(many, name)).toBe('Parental control on, TikTok, YouTube, Roblox and 1 more blocked');
  // settings that are not overridden do not show, whatever they hold
  expect(describeProfile({ ...kids, use_global_settings: true, blocked_services: [] }, name)).toBe('Same protection as everyone else');
});
