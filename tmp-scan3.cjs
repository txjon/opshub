require('dotenv').config({ path: '.env.local' });
(async () => {
  const { google } = require('googleapis');
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64,'base64').toString() : (process.env.GOOGLE_SERVICE_ACCOUNT_KEY||'');
  const key = JSON.parse(raw);
  const gmail = google.gmail({ version:'v1', auth: new google.auth.GoogleAuth({
    credentials: key, scopes:['https://www.googleapis.com/auth/gmail.modify'], clientOptions:{ subject:'info@housepartydistro.com' } }) });

  // Target mail that indicates an ACCOUNT exists, rather than general traffic.
  const QUERIES = [
    'subject:(password OR "reset your" OR "verify your" OR "confirm your email" OR "two-factor" OR "verification code" OR "sign-in" OR "new device")',
    'subject:("welcome to" OR "your account" OR "account created" OR "activate your")',
    'subject:(invoice OR receipt OR subscription OR renewal OR billing)',
  ];
  const seen = new Map();
  for (const q of QUERIES) {
    let pageToken=null, pages=0;
    do {
      const r = await gmail.users.messages.list({ userId:'me', q, maxResults:200, pageToken: pageToken||undefined });
      const msgs = r.data.messages||[];
      for (const m of msgs) {
        if (seen.has(m.id)) continue;
        seen.set(m.id, q);
      }
      pageToken = r.data.nextPageToken; pages++;
    } while (pageToken && pages < 3);
  }
  const ids = [...seen.keys()];
  console.log('account-signal messages found:', ids.length, '\n');
  const doms = new Map();
  for (const id of ids.slice(0, 700)) {
    try {
      const m = await gmail.users.messages.get({ userId:'me', id, format:'metadata', metadataHeaders:['From','Subject','Date'] });
      const h = Object.fromEntries((m.data.payload?.headers||[]).map(x=>[x.name,x.value]));
      const em = (String(h.From||'').match(/<([^>]+)>/)?.[1] || String(h.From||'')).toLowerCase().trim();
      let dom = (em.split('@')[1]||em).replace(/^(mail|email|e|notifications?|no-?reply|info|news|updates?)\./,'');
      const rec = doms.get(dom) || { n:0, subs:new Set(), last:'' };
      rec.n++;
      if (rec.subs.size < 2 && h.Subject) rec.subs.add(String(h.Subject).slice(0,60));
      const d = h.Date ? new Date(h.Date).toISOString().slice(0,10) : '';
      if (d > rec.last) rec.last = d;
      doms.set(dom, rec);
    } catch {}
  }
  const rows = [...doms.entries()].filter(([d])=>!d.includes('housepartydistro')).sort((a,b)=>b[1].n-a[1].n);
  console.log('SERVICES THAT MAIL info@  (sorted by volume)\n');
  for (const [d,r] of rows.slice(0,45)) {
    console.log(`${String(r.n).padStart(4)}x  ${d.padEnd(34)} last ${r.last}`);
    for (const s of r.subs) console.log(`         · ${s}`);
  }
  console.log('\ndistinct domains:', rows.length);
})();
