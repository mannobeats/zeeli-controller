import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';

/** flow_statistics only accepts these; anything else is silently ignored and the old value kept. */
export const STAT_PERIODS = { hour: 'Past hour', day: 'Past 24 hours', week: 'Past 7 days' } as const;
export type StatPeriod = keyof typeof STAT_PERIODS;

export interface AppUsage {
  name: string;
  download: number;
  upload: number;
  total: number;
}
export interface DayUsage {
  start: number;
  total: number;
}

export const QOS_CATEGORIES = {
  meeting: 'Video calls',
  education: 'Education',
  work: 'Work',
  webpage: 'Browsing',
  game: 'Games',
  social_entertainment: 'Social and video',
  shopping: 'Shopping',
  other: 'Other',
} as const;
export type QosLevel = 'high' | 'middle' | 'low';

export interface QosConfig {
  enable: boolean;
  download: string;
  upload: string;
  high: string[];
  middle: string[];
  low: string[];
  mode?: string;
}

export interface SqmConfig {
  enable: boolean;
  download: string;
  upload: string;
  qdisc: 'cake' | 'fq_codel';
}

export const traffic = (t: Transport) => ({
  rule: settings<{ enable: boolean; time: StatPeriod; type: 'app' }>(t, 'flow_statistics', {
    get: 'get_statistics_rule',
    set: 'set_statistics_rule',
  }),
  async usage(): Promise<{ total: AppUsage; apps: AppUsage[]; days: DayUsage[] }> {
    const [apps, top] = await Promise.all([
      t
        .call<{ applications?: { label?: string; application_name?: string; download: number; upload: number; total: number }[] }>(
          'flow_statistics',
          'get_flow_statistics',
          {},
          30_000,
        )
        .catch(() => ({}) as { applications?: never[] }),
      t
        .call<{ top_apps?: { time_series: { start_time: number; total: number }[] }[] }>(
          'flow_statistics',
          'get_top_app_flow_statistics',
          {},
          30_000,
        )
        .catch(() => ({}) as { top_apps?: never[] }),
    ]);
    const list = (apps.applications ?? []).map((a) => ({
      name: a.label || a.application_name || 'Unknown',
      download: a.download,
      upload: a.upload,
      total: a.total,
    }));
    const total = list.find((a) => a.name === 'All traffic') ?? { name: 'All traffic', download: 0, upload: 0, total: 0 };
    const series = (top.top_apps ?? []).map((a) => [...a.time_series].reverse());
    const days = (series[0] ?? []).map((d, i) => ({
      start: d.start_time,
      total: series.reduce((n, s) => n + (s[i]?.total ?? 0), 0),
    }));
    return {
      total,
      apps: list.filter((a) => a !== total && a.total > 0).sort((a, b) => b.total - a.total),
      days,
    };
  },
  clear: () => t.call('flow_statistics', 'clear_statistics'),

  qos: settings<QosConfig>(t, 'dpi', { get: 'get_qos', set: 'set_qos' }),
  sqm: settings<SqmConfig>(t, 'sqm'),

  dpi: async () => {
    const [cfg, engine, lib] = await Promise.all([
      t.call<{ ota_version: string; lib_version: string }>('dpi', 'get_dpi_config'),
      t.call<{ upgrade_available: boolean; dpi_new_version?: string }>('dpi', 'check_dpi_upgrade').catch(() => null),
      t.call<{ upgrade_available: boolean; lib_new_version?: string }>('dpi', 'check_lib_upgrade').catch(() => null),
    ]);
    return {
      engine: cfg.ota_version,
      signatures: cfg.lib_version,
      engineUpdate: engine?.upgrade_available ? (engine.dpi_new_version ?? 'new') : null,
      signaturesUpdate: lib?.upgrade_available ? (lib.lib_new_version ?? 'new') : null,
    };
  },
  updateEngine: () => t.call('dpi', 'set_dpi_upgrade', {}, 60_000),
  updateSignatures: () => t.call('dpi', 'set_lib_upgrade', {}, 60_000),
});
