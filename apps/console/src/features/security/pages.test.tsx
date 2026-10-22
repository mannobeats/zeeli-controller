import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import { AccessPage, ContentPage, ForwardingPage, RemotePage } from './pages.tsx';

const form = async (title: string) => within((await screen.findByRole('heading', { name: title })).closest('form') as HTMLElement);
const rowOf = async (table: string, name: string) =>
  within(await screen.findByRole('table', { name: table }))
    .getByText(name)
    .closest('tr') as HTMLElement;

test('a new port forward is checked, then added', async () => {
  const user = await renderPage(<ForwardingPage />);
  await user.click(await screen.findByRole('button', { name: 'New rule' }));
  const s = await sheet();
  await user.type(s.getByLabelText('Name'), 'Web');
  await user.type(s.getByLabelText(/^Outside port/), '8080');
  await user.type(s.getByLabelText('Device port'), '80-90');
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  expect((await s.findByRole('alert')).textContent).toBe('A single outside port can’t go to a range.');
  await user.clear(s.getByLabelText('Device port'));
  await user.type(s.getByLabelText('Device port'), '80');
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter a valid device IP.');
  const device = s.getByLabelText('Device');
  await user.selectOptions(device, within(device).getAllByRole('option')[1] as HTMLOptionElement);
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  await expectToast(/^Forwarding port 8080 to 192\.168\./);
  expect((await api.security.forwards()).find((f) => f.name === 'Web')).toMatchObject({ srcPort: '8080', destPort: '80' });
});

test('editing a port forward saves it under its new name', async () => {
  const user = await renderPage(<ForwardingPage />);
  await user.click(await rowOf('Port forwards', 'Plex'));
  const s = await sheet();
  await user.type(s.getByLabelText('Name'), ' TV');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Plex TV');
  expect((await api.security.forwards()).map((f) => f.name)).toContain('Plex TV');
});

test('port forwards turn on from their switch and delete after a confirm', async () => {
  const user = await renderPage(<ForwardingPage />);
  await user.click(await screen.findByRole('checkbox', { name: 'Minecraft on' }));
  await expectToast('Minecraft turned on');
  await user.click(within(await rowOf('Port forwards', 'Minecraft')).getByRole('checkbox', { name: /^Select row/ }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted Minecraft');
  expect((await api.security.forwards()).map((f) => f.name)).not.toContain('Minecraft');
});

test('the DMZ needs a device IP', async () => {
  const user = await renderPage(<ForwardingPage />);
  await user.click(await screen.findByRole('button', { name: 'Set up DMZ' }));
  const s = await sheet();
  await user.click(s.getByRole('checkbox', { name: 'DMZ on' }));
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter the device IP.');
  await user.type(s.getByLabelText('Device IP'), '192.168.8.10');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('DMZ on for 192.168.8.10');
  expect(await api.security.dmz.get()).toMatchObject({ enabled: true, dest_ip: '192.168.8.10' });
});

test('the content filter refuses a bad domain and saves categories', async () => {
  const user = await renderPage(<ContentPage />);
  const f = await form('Block for every device');
  await user.click(f.getByRole('checkbox', { name: 'Gambling' }));
  await user.type(f.getByLabelText(/^Also block these domains/), 'not a domain');
  await user.click(f.getByRole('button', { name: 'Save' }));
  expect((await f.findByRole('alert')).textContent).toBe('not a domain isn’t a domain name.');
  await user.clear(f.getByLabelText(/^Also block these domains/));
  await user.type(f.getByLabelText(/^Also block these domains/), 'example.com');
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Content filter saved');
  expect(await api.security.content.get()).toMatchObject({ category_list: ['malware', 'adult', 'gambling'], domain_list: ['example.com'] });
});

test('a new access rule needs a name and valid addresses', async () => {
  const user = await renderPage(<AccessPage />);
  await user.click(await screen.findByRole('button', { name: 'New rule' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  expect((await s.findByRole('alert')).textContent).toBe('Give the rule a name.');
  await user.type(s.getByLabelText('Name'), 'No TV at night');
  await user.type(s.getByLabelText('From address'), 'tv');
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  expect((await s.findByRole('alert')).textContent).toBe('tv isn’t an IPv4 address or range.');
  await user.clear(s.getByLabelText('From address'));
  await user.type(s.getByLabelText('From address'), '192.168.8.20');
  await user.selectOptions(s.getByLabelText('Protocol'), 'tcp');
  await user.type(s.getByLabelText('Port'), '443');
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  await expectToast('Added No TV at night');
  const added = (await api.security.accessRules()).find((r) => r.name === 'No TV at night');
  expect(added).toMatchObject({ srcIps: ['192.168.8.20'], proto: 'tcp', destPort: '443', target: 'DROP' });
});

test('an access rule edits, turns off and deletes', async () => {
  const user = await renderPage(<AccessPage />);
  await user.click(await rowOf('Access rules', 'Keep IoT off the NAS'));
  const s = await sheet();
  await user.selectOptions(s.getByLabelText('Action'), 'ACCEPT');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Keep IoT off the NAS');
  expect((await api.security.accessRules())[0]).toMatchObject({ target: 'ACCEPT', destIps: ['192.168.8.10'] });
  await user.click(await screen.findByRole('checkbox', { name: 'Keep IoT off the NAS on' }));
  await expectToast('Keep IoT off the NAS turned off');
  // with the rule the previous test added
  await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted 2 rules');
  expect(await api.security.accessRules()).toEqual([]);
});

test('remote access asks before opening to everyone', async () => {
  const user = await renderPage(<RemotePage />);
  const f = await form('Reach the router from the internet');
  await user.click(f.getByRole('checkbox', { name: 'Only from these addresses' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  expect((await f.findByRole('alert')).textContent).toBe('Add at least one allowed address, or turn the list off.');
  await user.click(f.getByRole('checkbox', { name: 'Only from these addresses' }));
  await user.click(f.getByRole('checkbox', { name: 'SSH' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Open it anyway' }));
  await expectToast('Remote access saved');
  expect(await api.security.wanAccess.get()).toMatchObject({ enable_ssh: true, enable_whitelist: false });
});

test('local access checks ports and confirms risky changes', async () => {
  const user = await renderPage(<RemotePage />);
  const f = await form('On your network');
  await user.clear(f.getByLabelText('SSH port'));
  await user.type(f.getByLabelText('SSH port'), '80');
  await user.click(f.getByRole('button', { name: 'Save' }));
  expect((await f.findByRole('alert')).textContent).toBe('Each service needs its own port.');
  await user.clear(f.getByLabelText('SSH port'));
  await user.type(f.getByLabelText('SSH port'), '2222');
  await user.clear(f.getByLabelText('HTTPS port'));
  await user.type(f.getByLabelText('HTTPS port'), '8443');
  await user.click(f.getByRole('checkbox', { name: 'SSH on' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Change ports' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Turn off' }));
  await expectToast('Local access saved');
  expect(await api.security.localAccess.get()).toMatchObject({ https_port: 8443, ssh_port: 2222, ssh_enabled: false });
});
