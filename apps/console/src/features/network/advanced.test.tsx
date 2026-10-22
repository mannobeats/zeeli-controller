import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage } from '../../test/render.tsx';
import { Ipv6Page, QosPage, SqmPage } from './advanced.tsx';

const save = () => screen.getByRole('button', { name: 'Save' });
const alertText = async () => (await screen.findByRole('alert')).textContent;

test('QoS needs line speeds, then stores the priorities', async () => {
  const user = await renderPage(<QosPage />);
  await user.click(await screen.findByRole('checkbox', { name: 'QoS on' }));
  await user.clear(screen.getByLabelText(/^Your download speed/));
  await user.click(save());
  expect(await alertText()).toBe('Enter your line speeds, 1 to 10000 Mbps.');
  await user.type(screen.getByLabelText(/^Your download speed/), '500');
  await user.selectOptions(screen.getByLabelText('Shopping'), 'high');
  await user.click(save());
  await expectToast('QoS saved');
  const qos = await api.traffic.qos.get();
  expect(qos).toMatchObject({ enable: true, download: '500' });
  expect(qos.high).toContain('shopping');
  await user.click(screen.getByRole('checkbox', { name: 'QoS on' }));
  await user.click(save());
  await expectToast('QoS off');
});

test('SQM checks its limits', async () => {
  const user = await renderPage(<SqmPage />);
  await user.click(await screen.findByRole('checkbox', { name: 'SQM on' }));
  await user.clear(screen.getByLabelText(/^Upload limit/));
  await user.type(screen.getByLabelText(/^Upload limit/), '0');
  await user.click(save());
  expect(await alertText()).toBe('Enter limits from 1 to 10000 Mbps.');
  await user.clear(screen.getByLabelText(/^Upload limit/));
  await user.type(screen.getByLabelText(/^Upload limit/), '30');
  await user.selectOptions(screen.getByLabelText('Queue'), 'fq_codel');
  await user.click(save());
  await expectToast('SQM on');
  expect(await api.traffic.sqm.get()).toMatchObject({ enable: true, upload: '30', qdisc: 'fq_codel' });
  await user.click(screen.getByRole('checkbox', { name: 'SQM on' }));
  await user.click(save());
  await expectToast('SQM off');
});

test('IPv6 with a static prefix and its own DNS servers', async () => {
  const user = await renderPage(<Ipv6Page />);
  await user.selectOptions(await screen.findByLabelText('Give LAN devices IPv6 by'), 'static');
  await user.type(screen.getByLabelText('LAN prefix'), 'fd00:1::1/64');
  await user.click(screen.getByRole('checkbox', { name: 'Hand out the router as the IPv6 DNS server' }));
  await user.type(screen.getByLabelText('DNS server 1'), '1.1.1.1');
  await user.click(save());
  expect(await alertText()).toBe('Enter at least one IPv6 DNS server.');
  await user.clear(screen.getByLabelText('DNS server 1'));
  await user.type(screen.getByLabelText('DNS server 1'), '2606:4700::1111');
  await user.type(screen.getByLabelText('DNS server 2'), '2606:4700::1001');
  await user.click(save());
  await expectToast('IPv6 saved');
  expect(await api.networkExtras.ipv6.get()).toMatchObject({
    lan_mode: 'static',
    lan_ip: 'fd00:1::1/64',
    lan_dns_mode: false,
    lan_dns2: '2606:4700::1001',
  });
  await user.click(screen.getByRole('checkbox', { name: 'IPv6 on' }));
  await user.click(save());
  await expectToast('IPv6 off');
  expect(await api.networkExtras.ipv6.get()).toMatchObject({ enable: false });
});
