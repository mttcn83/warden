export const LOGIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Warden login</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 36%22%3E%3Cpath d=%22M16 2 29 7v10c0 8-6 13-13 17C9 30 3 25 3 17V7L16 2Z%22 fill=%22%238fb4ff%22/%3E%3Cpath d=%22m9 13 3 10 4-7 4 7 3-10%22 fill=%22none%22 stroke=%22%2312161c%22 stroke-width=%222.6%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E">
<style>
:root{color-scheme:light;--bg:#fff;--surface:#fff;--soft:#f4f6f8;--hover:#e9edf2;--text:#19212e;--muted:#556171;--line:#dce1e7;--input-line:#7e8997;--accent:#245bce;--on-accent:#fff;--danger:#a62f3c;--danger-bg:#fff0f1;--warn:#795014;--shadow:0 8px 32px #16244014;--ease:cubic-bezier(.22,1,.36,1);--spring:cubic-bezier(.34,1.56,.64,1)}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#12161c;--surface:#191e26;--soft:#1e252f;--hover:#2b3441;--text:#eef2f8;--muted:#aeb9c9;--line:#343e4c;--input-line:#798698;--accent:#a9c5ff;--on-accent:#172339;--danger:#ffb3bc;--danger-bg:#40242c;--warn:#f0cb8c;--shadow:0 8px 32px #0005}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(380px,100%);animation:rise .6s var(--ease) both}
.brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:28px;font-weight:800;font-size:1.6rem;letter-spacing:-.04em}
.logo{width:38px;height:42px;color:var(--accent)}
form{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:26px;box-shadow:var(--shadow)}
h1{margin:0 0 4px;font-size:1.125rem;letter-spacing:-.02em}
.sub{margin:0 0 20px;color:var(--muted);font-size:.9375rem}
label{display:block;font-weight:650;margin-bottom:8px}
.field{position:relative}
input{width:100%;min-height:46px;padding:10px 46px 10px 12px;border:1px solid var(--input-line);border-radius:9px;background:var(--bg);color:inherit;font:inherit;transition:border-color .18s,box-shadow .2s}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 24%,transparent)}
.eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:38px;height:38px;border:0;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center;transition:background .18s,color .18s}
.eye:hover{background:var(--hover);color:var(--text)}
.eye:focus-visible,button.go:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.eye svg{width:20px;height:20px}
.eye .off{display:none}.eye[aria-pressed=true] .on{display:none}.eye[aria-pressed=true] .off{display:block}
.msg{min-height:22px;margin:10px 0 0;font-size:.9375rem}
.msg.err{color:var(--danger)}
.msg.warn{color:var(--warn)}
button.go{width:100%;min-height:46px;margin-top:8px;border:0;border-radius:9px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:filter .18s,transform .14s var(--ease),box-shadow .2s}
button.go:hover:not(:disabled){filter:brightness(.94);box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 35%,transparent)}
button.go:active:not(:disabled){transform:scale(.98)}
button.go:disabled{opacity:.7;cursor:default}
.spin{width:16px;height:16px;border:2px solid color-mix(in srgb,var(--on-accent) 35%,transparent);border-top-color:var(--on-accent);border-radius:50%;animation:spin .7s linear infinite;display:none}
button.go.busy .spin{display:block}
.hint{margin:18px 4px 0;text-align:center;color:var(--muted);font-size:.875rem}
code{font:600 .8125rem ui-monospace,SFMono-Regular,Consolas,monospace;padding:2px 7px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--text)}
.shake{animation:shake .45s var(--ease)}
button.go.done{background:#2e9e68;color:#fff;animation:popbtn .5s var(--spring)}.check{display:none;width:18px;height:18px}.check path{stroke-dasharray:24;stroke-dashoffset:24}button.go.done .check{display:block}button.go.done .check path{animation:draw .45s .1s var(--ease) forwards}button.go.done .spin{display:none}.leaving main{animation:leave .55s var(--ease) both}.leaving .logo{animation:glow .55s var(--ease)}@keyframes leave{to{opacity:0;transform:translateY(-18px) scale(.97)}}@keyframes glow{50%{transform:scale(1.18);filter:drop-shadow(0 0 14px var(--accent))}}@keyframes draw{to{stroke-dashoffset:0}}@keyframes popbtn{50%{transform:scale(1.04)}}@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes shake{20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
</style></head><body>
<main>
<div class="brand"><svg class="logo" viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M16 2 29 7v10c0 8-6 13-13 17C9 30 3 25 3 17V7L16 2Z" fill="currentColor"/><path d="m9 13 3 10 4-7 4 7 3-10" stroke="var(--bg)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>Warden</div>
<form id="f" autocomplete="on">
<h1>Sign in</h1>
<p class="sub">Control panel for your Discord bot</p>
<label for="p">Password</label>
<div class="field"><input id="p" name="password" type="password" autocomplete="current-password" autofocus required aria-describedby="msg">
<button class="eye" id="eye" type="button" aria-label="Show password" aria-pressed="false"><svg class="on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button></div>
<p class="msg" id="msg" role="status" aria-live="polite"></p>
<button class="go" id="go" type="submit"><span class="spin" aria-hidden="true"></span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg><span id="gotext">Log in</span></button>
</form>
<p class="hint">No password? Run <code>warden --open</code> in a terminal.<br>This page is only reachable from this computer.</p>
</main>
<script>
(function(){
var f=document.getElementById('f'),p=document.getElementById('p'),msg=document.getElementById('msg'),go=document.getElementById('go'),gotext=document.getElementById('gotext'),eye=document.getElementById('eye');
function say(t,cls){msg.textContent=t||'';msg.className='msg'+(cls?' '+cls:'');}
eye.addEventListener('click',function(){var show=p.type==='password';p.type=show?'text':'password';eye.setAttribute('aria-pressed',String(show));eye.setAttribute('aria-label',show?'Hide password':'Show password');p.focus();});
function caps(e){if(e.getModifierState&&e.getModifierState('CapsLock')){say('Caps Lock is on','warn');}else if(msg.classList.contains('warn')){say('');}}
p.addEventListener('keydown',caps);p.addEventListener('keyup',caps);
p.addEventListener('input',function(){if(msg.classList.contains('err'))say('');});
f.addEventListener('submit',function(e){
  e.preventDefault();
  if(go.disabled||!p.value)return;
  go.disabled=true;go.classList.add('busy');gotext.textContent='Signing in';say('');
  fetch('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:p.value}),credentials:'same-origin'})
   .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});})
   .then(function(res){
     if(res.ok){go.classList.remove('busy');go.classList.add('done');gotext.textContent='Welcome';try{sessionStorage.setItem('warden.arrive','1');}catch(x){}setTimeout(function(){document.body.classList.add('leaving');setTimeout(function(){location.reload();},480);},620);return;}
     var m=res.j&&res.j.error?String(res.j.error):'Could not sign in';
     say(m.charAt(0).toUpperCase()+m.slice(1)+'.','err');
     f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');
     p.value='';p.focus();
   })
   .catch(function(){say('Could not reach the bot. Is it running?','err');})
   .then(function(){if(!/Welcome/.test(gotext.textContent)){go.disabled=false;go.classList.remove('busy');gotext.textContent='Log in';}});
});
})();
</script></body></html>`;
