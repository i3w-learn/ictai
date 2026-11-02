// Plays a teacher's PC on the offline network: asks the server's AI for a small quiz and waits for it.
const base = 'https://ict-test:7700/api/v1';
const net = await fetch('https://www.google.com').then(() => 'YES (not offline!)').catch(() => 'NO');
console.log('Internet on teacher PC:', net);
const { token } = await (await fetch(`${base}/auth/staff`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})).json();
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
console.log('AI:', JSON.stringify(await (await fetch(`${base}/ai/status`, { headers: h })).json()));
const [cls] = await (await fetch(`${base}/classes`, { headers: h })).json();
const start = Date.now();
let job = await (await fetch(`${base}/ai/quiz`, {
  method: 'POST', headers: h,
  body: JSON.stringify({ classId: cls.id, subject: 'Science', topic: 'Photosynthesis', count: 3, language: 'en' }),
})).json();
console.log(`Asked for 3 questions on Photosynthesis (Class ${cls.name})...`);
while (job.status === 'queued' || job.status === 'running') {
  await new Promise((r) => setTimeout(r, 5000));
  job = await (await fetch(`${base}/ai/jobs/${job.id}`, { headers: h })).json();
}
console.log(`Finished: ${job.status} in ${Math.round((Date.now() - start) / 1000)} s`);
if (job.status !== 'done') { console.log('Error:', job.error); process.exit(1); }
job.result.questions.forEach((q, i) => {
  console.log(`\n${i + 1}. ${q.text}`);
  q.options.forEach((o, j) => console.log(`   ${j === q.correct ? '*' : ' '} ${o}`));
  const f = job.result.flags[i];
  if (!f.ok) console.log(`   check: ${f.note}`);
});
