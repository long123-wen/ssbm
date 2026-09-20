const C = '86f84e31-0501-4f53-a5d1-38af13a1390a';
const host = process.argv[2];
const BASE = 'https://' + host;
async function login(role, u, p) {
  const r = await fetch(`${BASE}/api/auth/${role}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  return decodeURIComponent(sc.find(x => x && x.startsWith('__Host-rj_')).match(/__Host-rj_[a-z_]*session=([^;]+)/)[1]);
}
async function q(t, p, tok) {
  const r = await fetch(`${BASE}/api/data/${t}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: '__Host-rj_session=' + tok }, body: JSON.stringify(p) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(t + ' ' + JSON.stringify(j).slice(0, 150));
  return j.data;
}
const a = await login('admin', '17653420201', 'Dztsbmxt@2026');
const cl = await login('club', 'e2e_club_a', 'E2eClubA@2026');
await q('competitions', { action: 'update', filters: [{ op: 'eq', column: 'id', value: C }], payload: { registration_deadline: '2026-09-20T12:00' } }, a);
const clubs = await q('clubs', { action: 'select', columns: 'id', filters: [{ op: 'eq', column: 'username', value: 'e2e_club_a' }] }, a);
const evs = await q('events', { action: 'select', columns: 'id', filters: [{ op: 'eq', column: 'competition_id', value: C }] }, a);
const gs = await q('event_groups', { action: 'select', columns: 'id', filters: [{ op: 'eq', column: 'event_id', value: evs[0].id }] }, a);
const ath = await q('athletes', { action: 'select', columns: 'id', filters: [{ op: 'eq', column: 'club_id', value: clubs[0].id }] }, a);
const r = await fetch(`${BASE}/api/club/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: '__Host-rj_session=' + cl }, body: JSON.stringify({ competitionId: C, eventId: evs[0].id, groupId: gs[0].id, athleteIds: [ath[0].id] }) });
const j = await r.json().catch(() => ({}));
console.log(host, 'create →', r.status, (j.error && j.error.code) || 'OK(confirmed)');
await q('competitions', { action: 'update', filters: [{ op: 'eq', column: 'id', value: C }], payload: { registration_deadline: '2026-09-19', force_open: 0 } }, a);
await fetch(`${BASE}/api/club/registrations`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: '__Host-rj_session=' + cl }, body: JSON.stringify({ competitionId: C }) });
console.log('restored+cleaned');
