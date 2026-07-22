const escapeHtml = (value: unknown) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const renderLoginPage = (error = '') => `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Login Admin · Voidlark</title>
  <script>
    (() => {
      const mode = localStorage.getItem('voidlark-theme') || 'system';
      const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    })();
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
    :root{color-scheme:light;font-family:"IBM Plex Sans","Segoe UI",sans-serif;--bg:#f4f4f0;--panel:#ffffff;--ink:#191c1d;--muted:#646a6c;--line:rgba(0,0,0,0.05);--soft:#f9f8f6;--primary:#006067;--primary-hover:#004d53;--primary-weak:rgba(0,96,103,0.04);--danger:#9c332b;--radius:12px;--radius-sm:8px;--control-h:44px;--shadow:0 4px 20px rgba(0,0,0,0.02),0 2px 10px rgba(0,0,0,0.015)}
    html[data-theme="dark"]{color-scheme:dark;--bg:#090b0c;--panel:#111416;--ink:#ecefec;--muted:#8d9597;--line:rgba(255,255,255,0.05);--soft:#171c1e;--primary:#45c4ce;--primary-hover:#67d4de;--primary-weak:rgba(69,196,206,0.06);--danger:#d96f64;--shadow:0 4px 24px rgba(0,0,0,0.25),0 2px 12px rgba(0,0,0,0.15)}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;overflow-x:clip;display:grid;grid-template-rows:56px 1fr;background:var(--bg);color:var(--ink)}
    .topbar{display:flex;align-items:center;gap:12px;padding:0 22px;border-bottom:1px solid var(--line);background:var(--panel)}
    .logo{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--primary-weak);color:var(--primary);font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:700}
    .brand{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;letter-spacing:.08em}.topbar-meta{margin-left:auto;color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:11px;text-transform:uppercase}
    .stage{display:grid;place-items:center;padding:32px 18px}.login{width:min(440px,100%);border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:0 0 0 5px var(--soft),0 0 0 6px var(--line),var(--shadow);transition:all 0.3s cubic-bezier(0.16,1,0.3,1)}
    .login-head{padding:24px 24px 20px;border-bottom:1px solid var(--line)}.eyebrow{display:block;margin-bottom:8px;color:var(--primary);font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;font-size:24px;line-height:1.2;letter-spacing:-.02em}.intro{margin:8px 0 0;color:var(--muted);font-size:14px;line-height:1.55}
    .login-body{padding:24px}.error{margin:0 0 18px;padding:11px 12px;border-left:3px solid var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger);font-size:13px;line-height:1.45}
    label{display:block;margin-bottom:7px;font-size:13px;font-weight:600}.password-wrap{position:relative}.password-wrap input{width:100%;height:var(--control-h);padding:9px 52px 9px 12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel);color:var(--ink);font:16px "IBM Plex Sans",sans-serif;outline:none;transition:all 0.3s cubic-bezier(0.16,1,0.3,1)}.password-wrap input:focus{border-color:var(--primary);box-shadow:0 0 0 4px var(--primary-weak)}
    .eye{position:absolute;right:1px;top:1px;display:grid;place-items:center;width:42px;height:42px;border:0;border-left:1px solid var(--line);border-radius:0 var(--radius-sm) var(--radius-sm) 0;background:var(--soft);color:var(--muted);cursor:pointer}.eye:hover{color:var(--primary)}.eye:focus-visible,.submit:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.eye svg{width:19px;height:19px}.eye[aria-pressed="true"]:after{content:"";position:absolute;width:21px;height:2px;transform:rotate(-42deg);border-radius:2px;background:currentColor}
    .submit{width:100%;height:var(--control-h);margin-top:16px;border:0;border-radius:var(--radius-sm);background:var(--primary);color:#fff;font:600 14px "IBM Plex Sans",sans-serif;cursor:pointer;transition:all 0.3s cubic-bezier(0.16,1,0.3,1)}.submit:hover{background:var(--primary-hover);box-shadow:0 0 0 4px var(--primary-weak)}.submit:disabled{cursor:wait;opacity:.7}.hint{display:flex;align-items:center;gap:7px;margin:16px 0 0;color:var(--muted);font-size:12px}.hint-dot{width:7px;height:7px;border-radius:50%;background:var(--primary)}
    .login-foot{display:flex;justify-content:space-between;gap:12px;padding:13px 24px;border-top:1px solid var(--line);color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:10px;text-transform:uppercase}
    .auth-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--bg) 90%,transparent);opacity:0;visibility:hidden;transition:opacity .18s ease,visibility .18s ease}.auth-overlay[data-state="loading"],.auth-overlay[data-state="success"]{opacity:1;visibility:visible}.auth-state{display:grid;justify-items:center;gap:13px;color:var(--ink);text-align:center}.auth-state strong{font-size:16px}.auth-state span{color:var(--muted);font-size:13px}.auth-mark{display:grid;place-items:center;width:48px;height:48px;border:1px solid var(--primary);border-radius:50%;color:var(--primary)}.auth-spinner{width:22px;height:22px;border:2px solid var(--line);border-top-color:var(--primary);border-radius:50%;animation:auth-spin .7s linear infinite}.auth-check{display:none;width:23px;height:12px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg) translateY(-2px)}.auth-overlay[data-state="success"] .auth-spinner{display:none}.auth-overlay[data-state="success"] .auth-check{display:block}.auth-overlay[data-state="success"] .auth-mark{background:var(--primary);color:#fff}.login.is-submitting{opacity:.62;transform:translateY(2px);transition:opacity .16s ease,transform .16s ease}@keyframes auth-spin{to{transform:rotate(360deg)}}
    @media(max-width:520px){body{grid-template-rows:52px 1fr}.topbar{padding:0 16px}.topbar-meta{display:none}.stage{align-items:start;padding:22px 14px}.login-head,.login-body{padding:20px}.login-foot{padding:12px 20px;flex-wrap:wrap}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}.auth-spinner{border-color:var(--primary)}}
  </style>
</head>
<body>
  <header class="topbar"><span class="logo">V</span><span class="brand">VOIDLARK ADMIN</span><span class="topbar-meta">Protected workspace</span></header>
  <main class="stage"><section class="login" aria-labelledby="login-title">
    <div class="login-head"><span class="eyebrow">Admin access</span><h1 id="login-title">Masuk ke dashboard</h1><p class="intro">Gunakan password admin untuk mengelola bot, katalog, dan percakapan.</p></div>
    <div class="login-body">${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<form method="post" action="/admin/login" data-login-form><label for="password">Password admin</label><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button class="eye" type="button" aria-label="Tampilkan password" aria-pressed="false" data-password-toggle><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/></svg></button></div><button class="submit" data-login-submit>Masuk</button></form><p class="hint"><span class="hint-dot"></span>Sesi berakhir otomatis setelah 8 jam.</p></div>
    <div class="login-foot"><span>Secure admin</span><span>Voidlark v1</span></div>
  </section></main><div class="auth-overlay" data-auth-overlay aria-live="polite"><div class="auth-state"><div class="auth-mark"><span class="auth-spinner"></span><span class="auth-check"></span></div><strong data-auth-title>Memeriksa akses</strong><span data-auth-copy>Menyiapkan dashboard admin…</span></div></div>
  <script>const b=document.querySelector('[data-password-toggle]'),i=document.querySelector('#password'),f=document.querySelector('[data-login-form]'),s=document.querySelector('[data-login-submit]'),card=document.querySelector('.login'),overlay=document.querySelector('[data-auth-overlay]');b?.addEventListener('click',()=>{const show=i.type==='password';i.type=show?'text':'password';b.setAttribute('aria-pressed',String(show));b.setAttribute('aria-label',show?'Sembunyikan password':'Tampilkan password');i.focus()});f?.addEventListener('submit',()=>{s.disabled=true;s.textContent='Sedang masuk…';card.classList.add('is-submitting');overlay.dataset.state='loading'});</script>
</body></html>`;
