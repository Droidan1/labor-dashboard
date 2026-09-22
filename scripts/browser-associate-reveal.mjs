// Reading an associate's code back, driven in a REAL BROWSER against the Users page.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-associate-reveal.mjs
//
// 🔑 WHY IT EXISTS. `test-associate.mjs` proves the worker returns the right code and
// refuses the wrong caller. It cannot see that the modal shows the code rather than the
// refusal, that the refusal explains itself, that Copy copies, that closing the modal
// takes the credential back out of the DOM, or that the handoff into the editor carries
// the right associate's id. All of that is here — and two of them were wrong first:
// the modal named whoever the CLIENT thought the row was rather than who the worker
// said it revealed, and the code note kept claiming a code could never be looked up.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage, NOT prefers-color-scheme.
// Setting Playwright's colorScheme alone renders LIGHT twice while reporting both
// themes verified — browser-approval-pin.mjs made exactly that mistake once. The class
// is set through localStorage AND ASSERTED before any colour is measured.

// playwright-core is deliberately NOT a devDependency: it pulls ~50 MB and Cloudflare
// Pages runs `npm install` on every deploy. A manual check is not worth that.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-associate-reveal.mjs\n\n'
    + 'A Chromium is also needed: this container ships one at /opt/pw-browsers/chromium.\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\nNo dist/index.html. Run `bash scripts/build.sh` first.\n');
  process.exit(2);
}
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,s)=>{const f=path.join(root,q.url==='/'?'index.html':q.url.split('?')[0]);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('no');}
 s.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(8096,r));

// Two associates, one in each state — which is the point. After migration-068 both
// coexist on one list for as long as anyone keeps a code set before it shipped.
const USERS=[
 {id:'usr_aaa',email:'assoc_usr_aaa@associate.invalid',name:'Maria Santos',role:'staff',status:'active',
  created_at:'2026-09-20',associate:1,stores:'["BL1"]',pages:'{"bin-dump":"edit"}',
  pin_recoverable:1,pin_set_at:'2026-09-20T10:00:00.000Z',last_login:'2026-09-21T10:00:00.000Z'},
 {id:'usr_bbb',email:'assoc_usr_bbb@associate.invalid',name:'Dave Ruiz',role:'staff',status:'active',
  created_at:'2026-09-09',associate:1,stores:'["BL1"]',pages:'{"bin-dump":"view"}',
  pin_recoverable:0,pin_set_at:'2026-09-09T10:00:00.000Z',pin_reset_requested_at:'2026-09-16T14:00:00.000Z'},
];

let pass=0,fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++;console.log('  FAIL '+m);} };

// Contrast against the REAL composited background — every ancestor background
// composited down, then the text colour composited over that. DESIGN.md §4.8 trap 6:
// measure, don't eyeball, and trap 3: a panel owns more than its table.
const CONTRAST = (sel) => {
  const lin=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  const parse=s=>{const m=String(s).match(/[\d.]+/g);return m?m.map(Number):null;};
  const over=(f,b)=>{const a=f.length>3?f[3]:1;return [0,1,2].map(i=>f[i]*a+b[i]*(1-a));};
  const ground=el=>{let g=[255,255,255],st=[];
    for(let n=el;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(!c)continue;
      const a=c.length>3?c[3]:1;if(a===0)continue;st.push(c);if(a===1){g=c.slice(0,3);break;}}
    for(let i=st.length-1;i>=0;i--)g=over(st[i],g);return g;};
  const out=[];
  for(const el of document.querySelectorAll(sel+' *')){
    if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||!el.getClientRects().length)continue;
    const fg=parse(cs.color);if(!fg)continue;
    const g=ground(el);const [l1,l2]=[lum(over(fg,g)),lum(g)].sort((a,b)=>b-a);
    const px=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight,10)>=700;
    out.push({text:el.textContent.trim().slice(0,40),
              need:(px>=24||(bold&&px>=18.66))?3:4.5,
              ratio:Math.round(((l1+0.05)/(l2+0.05))*100)/100,color:cs.color});
  }
  return out;
};

const b = await chromium.launch({ executablePath: CHROME });

for (const scheme of ['dark','light']) {
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); const errs=[];
  page.on('pageerror', e => errs.push(e.message));

  // 🛑 The theme is a class the app sets from localStorage, not the media query.
  await page.addInitScript(sc=>{try{localStorage.setItem('darkMode',String(sc==='dark'))}catch(e){}},scheme);
  // Stub BEFORE boot, so the app signs itself in as an admin and paints the Users
  // page on its own. Faking it afterwards fights showLoginPage's re-entrant timers.
  await page.addInitScript(({USERS})=>{
    const real=window.fetch; window.__reveals=[]; window.__clip=null;
    try{Object.defineProperty(navigator,'clipboard',{configurable:true,
      value:{writeText:async t=>{window.__clip=t;}}});}catch(e){}
    window.fetch=async(u,o)=>{const s=String(u);
      const J=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
      if(s.includes('auth-me'))return J({authenticated:true,email:'a@b.com',name:'Admin',role:'admin',stores:null,pages:{},businesses:['bl']});
      if(s.includes('list-users'))return J({ok:true,users:USERS});
      if(s.includes('grant-options'))return J({ok:true,businesses:[]});
      if(s.includes('user-grants'))return J({ok:true,grants:[]});
      if(s.includes('associate-reveal-pin')){const id=JSON.parse(o.body).id;window.__reveals.push(id);
        return J(id==='usr_aaa'
          ?{ok:true,recoverable:true,pin:'618240',name:'Maria Santos',set_at:'2026-09-20T10:00:00.000Z'}
          :{ok:true,recoverable:false,code:'NOT_RECOVERABLE',name:'Dave Ruiz',set_at:'2026-09-09T10:00:00.000Z'});}
      return real(u,o);};
  },{USERS});

  await page.goto('http://127.0.0.1:8096/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1400);
  await page.evaluate(()=>{const l=document.getElementById('login-page');if(l)l.style.display='none';
    const a=document.getElementById('app');if(a)a.style.display='flex';
    navigateToPage('users');});
  await page.waitForTimeout(700);

  const t = scheme;
  // 🛑 ASSERTED, not assumed. Without this the whole light pass can silently run dark.
  const isDark = await page.evaluate(()=>document.documentElement.classList.contains('dark'));
  ok(isDark === (scheme==='dark'), `[${t}] the .dark class actually matches the theme under test`);

  // ── The row offers it, once per associate ────────────────────────────────
  const btns = page.locator('#assoc-tbody button:has-text("View code")');
  ok(await btns.count()===2, `[${t}] every associate row gets a View code button (${await btns.count()})`);

  // ── Recoverable ──────────────────────────────────────────────────────────
  await btns.first().click(); await page.waitForTimeout(350);
  ok(await page.isVisible('#assoc-rv-ok'), `[${t}] a recoverable code opens the readable state`);
  ok(await page.locator('#assoc-rv-code').textContent()==='618240', `[${t}] printing the code`);
  // 🔑 From the WORKER's answer, not from usersData: the heading above six digits is
  // the only thing saying whose they are.
  ok(await page.locator('#assoc-rv-who').textContent()==='Maria Santos', `[${t}] under the name the worker returned`);
  let rows = await page.evaluate(CONTRAST,'#assoc-reveal-modal');
  let bad = rows.filter(r=>r.ratio<r.need);
  ok(rows.length>0 && bad.length===0,
     `[${t}] readable state clears AA (${rows.length} nodes, worst ${Math.min(...rows.map(r=>r.ratio))}:1)`
     + bad.map(x=>`\n      ✗ ${x.ratio}:1 need ${x.need} ${x.color} "${x.text}"`).join(''));

  await page.click('#assoc-rv-copy'); await page.waitForTimeout(250);
  ok(await page.evaluate(()=>window.__clip)==='618240', `[${t}] Copy puts the code on the clipboard`);
  await page.click('#assoc-reveal-modal button[aria-label="Close"]'); await page.waitForTimeout(200);
  ok(await page.isHidden('#assoc-reveal-modal'), `[${t}] Close hides the modal`);
  // 🛑 The credential must not outlive the modal.
  ok(await page.locator('#assoc-rv-code').textContent()==='', `[${t}] 🛑 and the code leaves the DOM`);

  // ── Not recoverable — the ordinary case on day one ───────────────────────
  await btns.nth(1).click(); await page.waitForTimeout(350);
  ok(await page.isVisible('#assoc-rv-no'), `[${t}] a pre-migration code opens the refusal state`);
  ok(await page.isHidden('#assoc-rv-ok'), `[${t}] 🛑 with no code panel at all`);
  const why = await page.locator('#assoc-rv-why').textContent();
  ok(/Sep 9, 2026/.test(why), `[${t}] explained with the date it was set (${JSON.stringify(why)})`);
  rows = await page.evaluate(CONTRAST,'#assoc-reveal-modal');
  bad = rows.filter(r=>r.ratio<r.need);
  ok(rows.length>0 && bad.length===0,
     `[${t}] refusal state clears AA (${rows.length} nodes, worst ${Math.min(...rows.map(r=>r.ratio))}:1)`
     + bad.map(x=>`\n      ✗ ${x.ratio}:1 need ${x.need} ${x.color} "${x.text}"`).join(''));

  // ── The way out of it ────────────────────────────────────────────────────
  await page.click('#assoc-rv-no button:has-text("Set a new code instead")'); await page.waitForTimeout(350);
  ok(await page.isHidden('#assoc-reveal-modal'), `[${t}] the handoff closes the reveal modal`);
  ok(await page.isVisible('#assoc-modal'), `[${t}] and opens the editor`);
  const pin = await page.locator('#assoc-m-pin').inputValue();
  ok(/^\d{6}$/.test(pin) && !/^(\d)\1{5}$/.test(pin),
     `[${t}] 🔑 pre-filled with a code the worker would accept (${JSON.stringify(pin)})`);
  ok(await page.locator('#assoc-m-id').inputValue()==='usr_bbb', `[${t}] carrying their id, so it edits rather than creates`);
  ok(/cannot be read back/.test(await page.locator('#assoc-m-pin-note').textContent()),
     `[${t}] and the note says THEIRS cannot be read back`);

  // The other associate's note must say the opposite — one blanket sentence would be
  // false for half the list, which is what it was before migration-068.
  await page.evaluate(()=>{closeAssociateModal();openAssociateModal('usr_aaa');});
  await page.waitForTimeout(250);
  ok(/View code reads it back/.test(await page.locator('#assoc-m-pin-note').textContent()),
     `[${t}] while a recoverable associate's note says it can`);

  ok(JSON.stringify(await page.evaluate(()=>window.__reveals))==='["usr_aaa","usr_bbb"]',
     `[${t}] each click asked the worker for exactly that row`);
  ok(errs.length===0, `[${t}] no JS errors (${errs.slice(0,2).join('; ')})`);
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
