// Plays a lab PC on the offline network: proves there is no internet, then signs in and reads results.
const base = 'https://ict-test:7700/api/v1';
const net = await fetch('https://www.google.com').then(() => 'YES (not offline!)').catch(() => 'NO');
console.log('Internet on lab PC:', net);
const login = await fetch(`${base}/auth/staff`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
});
const { token } = await login.json();
console.log('Signed in to server:', token ? 'yes' : 'NO');
const h = { authorization: `Bearer ${token}` };
const o = await (await fetch(`${base}/results/overview`, { headers: h })).json();
console.log(`Class average: ${o.classAverage}%`);
for (const s of o.students) console.log(`  ${s.name}: ${s.average ?? '-'}% (${s.band})`);
const ai = await fetch(`${base}/ai/status`, { headers: h });
if (ai.ok) console.log('AI:', JSON.stringify(await ai.json()));
