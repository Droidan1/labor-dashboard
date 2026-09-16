// The manager approval code, driven in a REAL BROWSER against the Users page.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-approval-pin.mjs
//
// 🔑 WHY IT EXISTS. A source test cannot see that the section renders for the right
// roles, that the field does not carry a code from one user to the next, or that a
// button fits inside the modal. All three are checked here, and the last one caught a
// real overflow: with three controls on one row, "Replace code" pushed Remove outside
// the max-w-md dialog — and only for a user who ALREADY had a code, so the first
// render fit and the second did not.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage, NOT prefers-color-scheme.
// Setting Playwright's colorScheme alone renders LIGHT twice while reporting both
// themes verified. This file made that exact mistake once; the class is now set
// explicitly AND asserted before anything is measured.

// playwright-core is deliberately NOT a devDependency: it pulls ~50 MB and Cloudflare
// Pages runs `npm install` on every deploy. A manual check is not worth that.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-approval-pin.mjs\n\n'
    + 'A Chromium is also needed: this container ships one at /opt/pw-browsers/chromium.\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,s)=>{const f=path.join(root,q.url==='/'?'index.html':q.url.split('?')[0]);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('no');}
 s.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(8095,r));

// Four users covering every state the section can be in.
const USERS=[
 {id:'u1',email:'kevin@bl.com',name:'Kevin R',role:'manager',status:'active',created_at:'2026-01-01',has_approval_pin:0,approval_pin_failures:0,associate:0},
 {id:'u2',email:'wendy@bl.com',name:'Wendy P',role:'manager',status:'active',created_at:'2026-01-02',has_approval_pin:1,approval_pin_failures:0,associate:0},
 {id:'u3',email:'lee@bl.com',  name:'Lee',    role:'manager',status:'active',created_at:'2026-01-03',has_approval_pin:1,approval_pin_failures:10,associate:0},
 {id:'u4',email:'floor@bl.com',name:'Floor',  role:'staff',  status:'active',created_at:'2026-01-04',has_approval_pin:0,approval_pin_failures:0,associate:1},
];
let pass=0,fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++;console.log('  FAIL '+m);} };
const b=await chromium.launch({executablePath:CHROME});

for (const scheme of ['dark','light']) {
  const ctx=await b.newContext({colorScheme:scheme,viewport:{width:1300,height:1000}});
  const page=await ctx.newPage(); const errs=[];
  page.on('pageerror',e=>errs.push(e.message));
  // 🛑 The theme is a `.dark` class from localStorage, not prefers-color-scheme.
  await page.addInitScript(sc=>{try{localStorage.setItem('darkMode',String(sc==='dark'))}catch(e){}},scheme);
  await page.addInitScript(({USERS})=>{
    const real=window.fetch;
    window.fetch=async(u,o)=>{const s=String(u);
      const J=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
      if(s.includes('auth-me'))return J({authenticated:true,email:'a@b.com',name:'Admin',role:'admin',stores:null,pages:{},businesses:['bl']});
      if(s.includes('list-users'))return J({ok:true,users:USERS});
      if(s.includes('user-grants'))return J({ok:true,grants:[]});
      if(s.includes('grant-options'))return J({ok:true,businesses:[]});
      if(s.includes('set-approval-pin')){const bd=JSON.parse(o.body);window.__sent=bd;
        return J({ok:true,id:bd.id,has_approval_pin:bd.pin!==null});}
      return real(u,o);};
  },{USERS});
  await page.goto('http://127.0.0.1:8095/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{const l=document.getElementById('login-page');if(l)l.style.display='none';
    const a=document.getElementById('app');if(a)a.style.display='flex';});
  await page.evaluate(w=>document.documentElement.classList.toggle('dark',w==='dark'),scheme);
  await page.evaluate(()=>window.navigateToPage('users'));
  await page.waitForTimeout(900);
  const t=scheme;
  ok(await page.evaluate(()=>document.documentElement.classList.contains('dark'))===(t==='dark'),
     `[${t}] 🛑 the app is ACTUALLY in ${t} mode before anything is measured`);

  // A manager with NO code.
  await page.evaluate(()=>window.openEditUserModal('u1')); await page.waitForTimeout(400);
  ok(await page.isVisible('#edit-approval'), `[${t}] section shows for a manager`);
  ok((await page.textContent('#edit-approval-state')).includes('No code set'), `[${t}] says no code set`);
  ok((await page.textContent('#edit-approval-save')).trim()==='Set code', `[${t}] button reads "Set code"`);
  ok(!(await page.isVisible('#edit-approval-clear')), `[${t}] no Remove when there is nothing to remove`);

  // Four digits must cost no round trip.
  await page.fill('#edit-approval-pin','1234'); await page.click('#edit-approval-save'); await page.waitForTimeout(300);
  ok((await page.textContent('#edit-approval-msg')).includes('six digits'), `[${t}] four digits refused client-side`);
  ok(await page.evaluate(()=>!window.__sent), `[${t}] ...and nothing was sent`);

  await page.fill('#edit-approval-pin','505017'); await page.click('#edit-approval-save'); await page.waitForTimeout(500);
  const body=await page.evaluate(()=>window.__sent);
  ok(body&&body.pin==='505017'&&body.id==='u1', `[${t}] six digits POSTed correctly`);
  ok((await page.inputValue('#edit-approval-pin'))==='', `[${t}] the field clears after saving`);
  ok((await page.textContent('#edit-approval-state')).includes('A code is set'), `[${t}] state flips without a refetch`);

  // A manager WITH a code.
  await page.evaluate(()=>window.openEditUserModal('u2')); await page.waitForTimeout(400);
  ok((await page.textContent('#edit-approval-save')).trim()==='Replace code', `[${t}] reads "Replace code" when one exists`);
  ok(await page.isVisible('#edit-approval-clear'), `[${t}] Remove offered when one exists`);
  ok((await page.inputValue('#edit-approval-pin'))==='', `[${t}] 🔑 the field does not carry a code between users`);

  // Locked is its own state.
  await page.evaluate(()=>window.openEditUserModal('u3')); await page.waitForTimeout(400);
  ok((await page.textContent('#edit-approval-state')).includes('Locked'), `[${t}] locked is its own state`);

  // 🛑 Nothing may spill outside the dialog. This caught a real overflow: three
  // controls on one row pushed Remove past the max-w-md edge, and ONLY for a user who
  // already had a code — so the first render fit and the second did not.
  const overflow=await page.evaluate(()=>{const m=document.querySelector('#edit-user-modal > div');
    if(!m)return 'no modal'; const mb=m.getBoundingClientRect();
    return [...m.querySelectorAll('#edit-approval *')].filter(e=>{const r=e.getBoundingClientRect();
      return r.width&&(r.right>mb.right+0.5||r.left<mb.left-0.5);}).map(e=>e.id||e.tagName);});
  ok(Array.isArray(overflow)&&overflow.length===0, `[${t}] 🛑 nothing overflows the modal (spilling: ${overflow})`);

  // Contrast measured against the ground it really sits on.
  const c=await page.evaluate(()=>{const g=(s,p)=>{const e=document.querySelector(s);return e?getComputedStyle(e)[p]:null};
    return {fg:g('#edit-approval-state','color'),bg:g('#edit-user-modal > div','backgroundColor')};});
  const rgb=x=>(x.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
  const lum=v=>{const f=v.map(n=>{n/=255;return n<=0.03928?n/12.92:Math.pow((n+0.055)/1.055,2.4)});return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]};
  const [hi,lo]=[lum(rgb(c.fg)),lum(rgb(c.bg))].sort((a,z)=>z-a);
  const ratio=(hi+0.05)/(lo+0.05);
  ok(ratio>=4.5, `[${t}] locked text is ${ratio.toFixed(2)}:1 on the modal — needs >= 4.5:1`);

  // Staff: the worker refuses a code for them, so the field must not be offered.
  await page.evaluate(()=>window.openEditUserModal('u4')); await page.waitForTimeout(400);
  ok(!(await page.isVisible('#edit-approval')), `[${t}] 🔑 hidden for staff — a code there would never work`);

  ok(errs.length===0, `[${t}] no JS errors (${errs.slice(0,2).join('; ')})`);
  await ctx.close();
}
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
