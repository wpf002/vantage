import {
  db,
  listRulesForUser,
  listEvents,
  getRuleById,
  describeRule,
  fireRule,
  type AlertRuleType,
} from '@vantage/api/lib';

/**
 * `vantage alerts ...` — inspect a user's alert rules + events and fire a rule
 * end-to-end for testing. Operates directly on the DB (no API session); the
 * owning user is identified by --owner <userId>.
 */

export interface AlertsListOpts {
  owner: string;
}
export interface AlertsEventsOpts {
  owner: string;
  limit?: string;
}
export interface AlertsTestDispatchOpts {
  ruleId: string;
}

export async function alertsList(opts: AlertsListOpts): Promise<void> {
  const rules = await listRulesForUser(db, opts.owner);
  process.stdout.write(`\nAlert rules for ${opts.owner}:\n`);
  if (rules.length === 0) process.stdout.write('  (none)\n');
  for (const r of rules) {
    const summary = describeRule(r.ruleType as AlertRuleType, r.config as Record<string, unknown>);
    const ch = r.channels as { web?: boolean; email?: boolean };
    const chans = [ch.web ? 'web' : null, ch.email ? 'email' : null].filter(Boolean).join('+');
    process.stdout.write(
      `  ${r.active ? '●' : '○'} ${r.id}  [${r.ruleType}]  ${summary}  (${chans})\n`,
    );
  }

  const { events } = await listEvents(db, opts.owner, {
    limit: 10,
  });
  process.stdout.write(`\nRecent events:\n`);
  if (events.length === 0) process.stdout.write('  (none)\n');
  for (const e of events) {
    const unread = e.acknowledgedAt ? ' ' : '•';
    process.stdout.write(
      `  ${unread} ${e.dispatchedAt}  ${e.entity}  [${e.ruleType}]\n`,
    );
  }
  process.stdout.write('\n');
  process.exit(0);
}

export async function alertsEvents(opts: AlertsEventsOpts): Promise<void> {
  const limit = Math.min(200, Math.max(1, Number(opts.limit ?? 20)));
  const { events } = await listEvents(db, opts.owner, { limit });
  if (events.length === 0) {
    process.stdout.write('No events.\n');
    process.exit(0);
  }
  for (const e of events) {
    const unread = e.acknowledgedAt ? '   ' : ' • ';
    process.stdout.write(
      `${unread}${e.dispatchedAt}  ${e.entity.padEnd(8)} [${e.ruleType}]  ${JSON.stringify(e.payload)}\n`,
    );
  }
  process.exit(0);
}

export async function alertsTestDispatch(opts: AlertsTestDispatchOpts): Promise<void> {
  const rule = await getRuleById(db, opts.ruleId);
  if (!rule) {
    process.stderr.write(`rule not found: ${opts.ruleId}\n`);
    process.exit(1);
    return;
  }
  const res = await fireRule(rule, {
    entity: 'TEST',
    triggerSignalId: null,
    payload: { test: true, via: 'cli' },
    what: 'Test dispatch (CLI)',
  });
  process.stdout.write(`${JSON.stringify({ dispatched: true, ...res }, null, 2)}\n`);
  process.exit(0);
}
