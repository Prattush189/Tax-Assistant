/** Circuit-breaker smoke test. Run: npx tsx scripts/smoke-circuit-breaker.mts */
const { withBreaker, isOutageError, BreakerOpenError, _resetBreaker, getBreakerStatus } = await import('../server/lib/circuitBreaker.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const httpErr = (status: number, msg = 'AI vision service error ' + status) => Object.assign(new Error(msg), { status });
const stateOf = (u: string) => getBreakerStatus().find(b => b.upstream === u)?.state ?? 'closed';
const failWith = (u: string, e: Error) => withBreaker(u, async () => { throw e; }).catch(err => err);

ok(!isOutageError(httpErr(400)), '400 invalid argument is not an outage');
ok(!isOutageError(httpErr(403)), '403 is not an outage');
ok(isOutageError(httpErr(429)), '429 is an outage');
ok(isOutageError(httpErr(503)), '503 is an outage');
ok(isOutageError(httpErr(408)), '408 is an outage');
ok(!isOutageError(new Error('Failed to parse AI response')), 'unparseable model reply is not an outage');
ok(isOutageError(new Error('This operation was aborted')), 'abort/timeout is an outage');

// The 2026-09-03 incident: one bad PDF, retried six times.
_resetBreaker('t400');
for (let i = 0; i < 6; i++) await failWith('t400', httpErr(400));
ok(stateOf('t400') === 'closed', 'six 400s leave the breaker CLOSED (was OPEN after 5)');

_resetBreaker('t503');
for (let i = 0; i < 5; i++) await failWith('t503', httpErr(503));
ok(stateOf('t503') === 'open', 'five 503s open the breaker');
const blocked = await failWith('t503', httpErr(503));
ok(blocked instanceof BreakerOpenError, 'open breaker fails fast');

_resetBreaker('tmix');
for (let i = 0; i < 4; i++) await failWith('tmix', httpErr(503));
await failWith('tmix', httpErr(400));
await failWith('tmix', httpErr(503));
ok(stateOf('tmix') === 'closed', 'a 4xx reply proves the upstream is up and resets the count');

const passthrough = await failWith('t400', httpErr(400, 'bad file'));
ok((passthrough as Error).message === 'bad file', 'caller still receives the original 4xx error');

console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
