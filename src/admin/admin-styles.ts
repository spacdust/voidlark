/** shadcn-inspired native product UI layer. `tsc` ships it with no asset-copy step. */
export const ADMIN_STYLES = String.raw`
@font-face {
  font-family: "Inter";
  src: url("/admin/assets/fonts/InterVariable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/admin/assets/fonts/IBMPlexMono-Regular.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/admin/assets/fonts/IBMPlexMono-SemiBold.woff2") format("woff2");
  font-style: normal;
  font-weight: 600 700;
  font-display: swap;
}
:root {
  --canvas: #f2f5f5;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-subtle: #edf1f1;
  --text: #172022;
  --text-muted: #606d70;
  --border: #d5dfe0;
  --border-strong: #b8c5c7;
  --accent: #087b7d;
  --accent-hover: #056668;
  --accent-soft: #dceeee;
  --success: #18794e;
  --warning: #9a6700;
  --danger: #b42318;
  --info: #176b87;
  --focus-ring: 0 0 0 3px rgb(8 123 125 / 22%);
  --elevation-overlay: 0 20px 52px rgb(24 55 58 / 18%);
  --elevation-sticky: 0 8px 24px rgb(24 55 58 / 12%);
  --radius-surface: 12px;
  --radius-control: 8px;
}

html[data-theme="dark"] {
  --canvas: #151b1d;
  --surface: #1c2426;
  --surface-raised: #242e30;
  --surface-subtle: #252e30;
  --text: #edf3f3;
  --text-muted: #aab9ba;
  --border: #39494b;
  --border-strong: #607477;
  --accent: #69c2bd;
  --accent-hover: #87d5d0;
  --accent-soft: #284746;
  --success: #62c995;
  --warning: #e4b95f;
  --danger: #f08a83;
  --info: #73bdd3;
  --focus-ring: 0 0 0 3px rgb(105 194 189 / 28%);
  --elevation-overlay: 0 24px 60px rgb(0 0 0 / 34%);
  --elevation-sticky: 0 10px 28px rgb(0 0 0 / 25%);
}

.admin-app {
  background: var(--canvas);
  color: var(--text);
  font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  font-optical-sizing: auto;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}

.admin-app button,
.admin-app input,
.admin-app select,
.admin-app textarea,
.login-app button,
.login-app input { font-family: inherit; }

.admin-app { --sidebar: 248px; }

.admin-app header,
.admin-app .panel,
.admin-app .table-shell,
.admin-app .stat,
.admin-app .env-card,
.admin-app .guide,
.admin-app .guide-card,
.admin-app form.surface-form,
.admin-app form[data-unsaved],
.admin-app form.advanced,
.admin-app form.upload-card {
  background: var(--surface);
  border-color: var(--border);
  border-radius: var(--radius-surface);
  box-shadow: none;
}

.admin-app .panel > :last-child,
.admin-app form.surface-form > :last-child,
.admin-app form[data-unsaved] > :last-child { margin-bottom: 0; }

.admin-app header { border-radius: 0; background: #fbfcfc; }
html[data-theme="dark"] .admin-app header { background: #12191b; }
.admin-app main { width: calc(100% - var(--sidebar)); max-width: 1520px; padding: 40px 48px 72px; }
.admin-app .topbar { padding: 22px 16px 18px; gap: 18px; }
.admin-app .brand { padding: 0 10px 18px; }
.admin-app .brand-header { gap: 12px; }
.admin-app .brand-logo-svg { width: 34px; height: 34px; }
.admin-app .brand-header svg { display: block; }
.admin-app .brand-title strong { text-transform: none; letter-spacing: -.01em; }
.admin-app .badge { text-transform: none; letter-spacing: 0; color: var(--text-muted); font-family: "Inter", "Segoe UI", system-ui, sans-serif; }
.admin-app .nav-group-label,
.admin-app .theme-label {
  text-transform: none;
  letter-spacing: 0;
font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  font-size: 11px;
}
.admin-app nav a {
  border: 0;
  border-radius: var(--radius-control);
  min-height: 42px;
  padding: 9px 12px;
  transition: background-color 150ms ease, color 150ms ease;
}
.admin-app nav a:hover,
.admin-app nav a:focus-visible { transform: none; }
.admin-app nav a.active {
  background: var(--accent-soft);
  color: var(--text);
  box-shadow: inset 3px 0 0 var(--accent);
}
.admin-app nav a .nav-icon {
  width: 17px;
  height: 17px;
  color: var(--text-muted);
  flex: 0 0 17px;
}
.admin-app nav a { display: flex; align-items: center; gap: 10px; line-height: 1.25; }
.admin-app nav a .nav-icon + * { min-width: 0; }
.admin-app .theme-options { align-items: stretch; }
.admin-app .theme-options button { min-width: 0; line-height: 1; }
.admin-app nav a.active .nav-icon { color: var(--accent); }
.admin-app .theme-panel,
.admin-app .logout-form { margin-inline: 8px; }
.admin-app .theme-options { background: var(--surface-subtle); }
.admin-app .logout-button { background: var(--surface); }
}

.admin-app .page-title,
.admin-app .simulator-page-head {
  border-bottom: 0;
  padding-bottom: 0;
  margin-bottom: 30px;
}
.admin-app .coordinate { display: none; }
.admin-app h1 { font-size: clamp(28px, 2.5vw, 34px); font-weight: 680; }
.admin-app h2 { font-size: 19px; }
.admin-app h3 { font-size: 15px; }
.admin-app .section-head { margin-bottom: 16px; }

.admin-app .panel,
.admin-app form.surface-form,
.admin-app form[data-unsaved],
.admin-app form.advanced,
.admin-app form.upload-card { padding: 24px; }

.admin-app .grid { gap: 12px; }
.admin-app .stat {
  min-height: 112px;
  padding: 18px;
  transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.admin-app .stat-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  border: 1px solid var(--border);
  background: var(--surface-subtle);
}
.admin-app .stat-icon .ui-icon { width: 19px; height: 19px; }
.admin-app .stat-copy { min-width: 0; }
.admin-app .stat-copy > span { line-height: 1.3; }
.admin-app .stat:hover,
.admin-app .stat:focus-visible {
  background: var(--surface-raised);
  border-color: var(--border-strong);
  box-shadow: none;
  transform: translateY(-1px);
}
.admin-app .stat.urgent {
  border-color: var(--border);
  border-left: 3px solid var(--danger);
  box-shadow: none;
}
.admin-app .stat span { text-transform: none; letter-spacing: 0; font-size: 12px; }
.admin-app .stat strong { margin-top: 7px; font-size: 29px; font-family: "Inter", "Segoe UI", system-ui, sans-serif; font-weight: 650; }

.admin-app .attention-panel,
.admin-app .setup-shell {
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.admin-app .guided-setup {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr);
  gap: 20px;
  margin-bottom: 28px;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.admin-app .guided-setup h2 { margin: 0 0 6px; }
.admin-app .guided-setup > div > p { margin: 0; max-width: 62ch; }
.admin-app .guided-next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-left: 20px;
  border-left: 1px solid var(--border);
}
.admin-app .guided-next-copy { display: grid; gap: 4px; min-width: 0; }
.admin-app .guided-next-copy span { color: var(--text-muted); font-size: 12px; }
.admin-app .guided-next .button-link { flex: 0 0 auto; white-space: nowrap; }
.admin-app .config-mode-bar,
.admin-app .config-preset-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.admin-app .config-mode-copy,
.admin-app .config-preset-copy { display: grid; gap: 3px; min-width: 0; }
.admin-app .config-mode-copy span,
.admin-app .config-preset-copy span { color: var(--text-muted); font-size: 12px; }
.admin-app .segmented-control { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-subtle); }
.admin-app .segmented-control button { min-height: 36px; padding: 7px 13px; background: transparent; color: var(--text-muted); }
.admin-app .segmented-control button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgb(20 44 47 / 10%); }
.admin-app .filter-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  margin: 0 0 16px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-subtle);
}
.admin-app .filter-tab {
  gap: 9px;
  min-height: 38px;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-muted);
  font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  box-shadow: none;
}
.admin-app .filter-tab:hover {
  border-color: var(--border);
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  color: var(--text);
  outline: none;
}
.admin-app .filter-tab:focus-visible { border-color: var(--accent); color: var(--text); outline: 2px solid var(--accent); outline-offset: 2px; }
.admin-app .filter-tab.active {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
  box-shadow: inset 3px 0 0 var(--accent), 0 1px 2px rgb(20 44 47 / 8%);
}
.admin-app .filter-tab .count {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-family: "IBM Plex Mono", monospace;
  font-size: 10px;
  line-height: 1;
  opacity: 1;
}
.admin-app .filter-tab.active .count { background: var(--accent-soft); color: var(--accent); }
html[data-theme="dark"] .admin-app .filter-tab { background: transparent; }
html[data-theme="dark"] .admin-app .filter-tab:hover { background: var(--surface-raised); }
html[data-theme="dark"] .admin-app .filter-tab.active { background: var(--surface); color: var(--text); }
.admin-app .preset-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.admin-app [data-config-mode="basic"] [data-config-advanced] { display: none !important; }
.admin-app[data-config-mode="basic"] [data-config-advanced] { display: none !important; }
.admin-app .config-section[data-config-advanced] { margin-top: 16px; }
.admin-app .basic-note { display: none; margin: 0 0 16px; padding: 12px 14px; border-radius: var(--radius-control); background: var(--accent-soft); color: var(--text); font-size: 13px; }
.admin-app [data-config-mode="basic"] .basic-note { display: block; }
.admin-app .attention-head { padding-top: 0; }
.admin-app .attention-item:last-child { padding-bottom: 0; }
.admin-app .setup-list { border: 0; border-top: 1px solid var(--border); border-radius: 0; }
.admin-app .status-grid {
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.admin-app .status-card {
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 18px 20px;
  transform: none;
}
.admin-app .status-card:last-child { border-right: 0; }
.admin-app .status-card:hover { background: var(--surface-subtle); box-shadow: none; transform: none; }
.admin-app .status-card .label { text-transform: none; letter-spacing: 0; font-size: 12px; }
.admin-app .status-dot { box-shadow: none; }

.admin-app input,
.admin-app textarea,
.admin-app select {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border-strong);
  border-radius: var(--radius-control);
}
.admin-app select:not([multiple]) {
  min-height: 44px;
  padding: 10px 40px 10px 13px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background-color: var(--surface);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='%23606d70'%3E%3Cpath d='M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 13px center;
  background-size: 15px 15px;
  color: var(--text);
  appearance: none;
  cursor: pointer;
  line-height: 1.25;
}
.admin-app select:not([multiple]):hover { border-color: var(--border-strong); background-color: var(--surface-raised); }
.admin-app select:not([multiple]):focus-visible { background-color: var(--surface); }
.admin-app select:disabled { cursor: not-allowed; opacity: .58; background-color: var(--surface-subtle); }
.admin-app select option { background: var(--surface); color: var(--text); }
.admin-app select.badge-pill {
  width: auto;
  min-height: 32px;
  padding: 5px 30px 5px 10px;
  border-radius: 999px;
  background-position: right 9px center;
  background-size: 13px 13px;
}
.admin-app .file-picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 5px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  overflow: hidden;
  transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
}
.admin-app .file-picker:hover { border-color: var(--accent); background: var(--surface-raised); }
.admin-app .file-picker:focus-within,
.admin-app .file-picker:has(input:focus-visible) { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: none; }
.admin-app .file-picker-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-control) - 2px);
  background: var(--surface-subtle);
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}
.admin-app .file-picker-name { min-width: 0; overflow: hidden; color: var(--text-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.admin-app .file-picker[data-has-file="true"] .file-picker-name { color: var(--text); }
.admin-app .file-picker input[type="file"] { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; border: 0; opacity: 0; cursor: pointer; }
.admin-app .backup-restore-form { display: grid; gap: 12px; align-items: start; }
.admin-app .backup-restore-form .secondary-button { justify-self: start; margin: 0; }
.admin-app input:focus-visible,
.admin-app textarea:focus-visible,
.admin-app select:focus-visible { border-color: var(--accent); box-shadow: var(--focus-ring); }
.admin-app input::placeholder,
.admin-app textarea::placeholder { color: var(--text-muted); opacity: .8; }
.admin-app textarea { min-height: 112px; }
.admin-app textarea[data-prompt-field],
.admin-app textarea.compact-area[data-prompt-field] { min-height: 180px; }
.admin-app .prompt-editor,
.admin-app textarea[name="rawPrompt"],
.admin-app textarea[name="prompt"] { min-height: 60vh; }

.admin-app button,
.admin-app .button-link,
.admin-app .ghost-btn,
.admin-app a.ghost-btn {
  border-radius: var(--radius-control);
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
}
.admin-app button:focus-visible,
.admin-app .button-link:focus-visible,
.admin-app .ghost-btn:focus-visible,
.admin-app a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: none; }
.admin-app button:active,
.admin-app .button-link:active,
.admin-app .ghost-btn:active { transform: scale(.98); }
.admin-app .secondary-button,
.admin-app .ghost-btn,
.admin-app a.ghost-btn {
  background: var(--surface-subtle);
  color: var(--text);
  border: 1px solid var(--border);
}
.admin-app .secondary-button:hover,
.admin-app .secondary-button:focus-visible,
.admin-app .ghost-btn:hover,
.admin-app a.ghost-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: none;
}

.admin-app .table-shell { overflow: clip; }
.admin-app .table-tools { background: var(--surface); padding: 16px; }
.admin-app th {
  position: static;
  background: var(--surface-subtle);
  color: var(--text-muted);
  text-transform: none;
  letter-spacing: 0;
  font-size: 12px;
}
.admin-app th,
.admin-app td { padding: 12px 16px; }
.admin-app tr:hover td { background: var(--accent-soft); }
.admin-app .mobile-card { border-color: var(--border); }

.admin-app .tone-neutral,
.admin-app .tone-ok,
.admin-app .tone-warn,
.admin-app .tone-danger,
.admin-app .tone-info,
.admin-app .mini-pill { border-radius: 999px; }
.admin-app .notice,
.admin-app .safe-note { border-radius: var(--radius-control); }
.admin-app .reply-style-intro { background: var(--surface-subtle); }
.admin-app .simple-style-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.admin-app .simple-style-grid.compact { align-items: end; }
.admin-app .simple-style-group { min-width: 0; margin: 0; padding: 0; border: 0; }
.admin-app .simple-style-group legend { margin-bottom: 8px; font-size: 13px; font-weight: 650; }
.admin-app .simple-style-group label { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; align-items: start; padding: 11px 12px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.admin-app .simple-style-group label:first-of-type { border-radius: var(--radius-control) var(--radius-control) 0 0; }
.admin-app .simple-style-group label:last-of-type { border-radius: 0 0 var(--radius-control) var(--radius-control); }
.admin-app .simple-style-group label + label { border-top: 0; }
.admin-app .simple-style-group label:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); }
.admin-app .simple-style-group label:has(input:checked) + label { border-top-color: var(--accent); }
.admin-app .simple-style-group input { width: 16px; height: 16px; margin-top: 2px; }
.admin-app .simple-style-group span { display: grid; gap: 2px; }
.admin-app .simple-style-group strong { font-size: 13px; }
.admin-app .simple-style-group small { color: var(--text-muted); font-size: 11px; }
.admin-app .reply-style-advanced-shell { border: 1px solid var(--border); border-radius: var(--radius-surface); background: var(--surface); overflow: hidden; }
.admin-app .reply-style-advanced-shell > summary { display: grid; grid-template-columns: minmax(0, 1fr) 28px; gap: 3px 12px; align-items: center; padding: 17px 18px; cursor: pointer; list-style: none; }
.admin-app .reply-style-advanced-shell > summary::-webkit-details-marker { display: none; }
.admin-app .reply-style-advanced-shell > summary span { font-size: 14px; font-weight: 650; }
.admin-app .reply-style-advanced-shell > summary small { color: var(--text-muted); font-size: 12px; }
.admin-app .reply-style-advanced-shell > summary > span,
.admin-app .reply-style-advanced-shell > summary > small { grid-column: 1; }
.admin-app .reply-style-advanced-shell > summary::after { content: "+"; grid-column: 2; grid-row: 1 / span 2; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-control); color: var(--text-muted); font-size: 20px; font-weight: 450; line-height: 1; }
.admin-app .reply-style-advanced-shell > summary:hover::after { background: var(--surface-subtle); color: var(--text); }
.admin-app .reply-style-advanced-shell[open] > summary::after { content: "−"; }
.admin-app .reply-style-advanced-shell[open] > summary { border-bottom: 1px solid var(--border); background: var(--surface-subtle); }
.admin-app .reply-style-advanced-body { display: grid; gap: 10px; padding: 14px; }
.admin-app .sticky-actions {
  background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
  border-radius: var(--radius-surface);
  box-shadow: var(--elevation-sticky);
}
.admin-app .toast,
.admin-app .modal,
.admin-app dialog { border-radius: var(--radius-surface) !important; box-shadow: var(--elevation-overlay) !important; }
.admin-app dialog#waQrModal { border-radius: var(--radius-surface) !important; box-shadow: var(--elevation-overlay) !important; }
.admin-app dialog::backdrop,
.admin-app dialog#waQrModal::backdrop { background: rgb(8 20 22 / 68%) !important; backdrop-filter: none !important; }

html[data-theme="dark"] .admin-app header,
html[data-theme="dark"] .admin-app .panel,
html[data-theme="dark"] .admin-app form,
html[data-theme="dark"] .admin-app .stat,
html[data-theme="dark"] .admin-app .table-shell,
html[data-theme="dark"] .admin-app .guide,
html[data-theme="dark"] .admin-app .guide-card,
html[data-theme="dark"] .admin-app .env-card,
html[data-theme="dark"] .admin-app input,
html[data-theme="dark"] .admin-app textarea,
html[data-theme="dark"] .admin-app select { background-color: var(--surface); border-color: var(--border); color: var(--text); }
html[data-theme="dark"] .admin-app select:not([multiple]) {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='%23aab9ba'%3E%3Cpath d='M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 13px center;
  background-size: 15px 15px;
}
html[data-theme="dark"] .admin-app select.badge-pill {
  background-position: right 9px center;
  background-size: 13px 13px;
}
html[data-theme="dark"] .admin-app th,
html[data-theme="dark"] .admin-app .table-tools { background: var(--surface-subtle); }
html[data-theme="dark"] .admin-app tr:hover td { background: var(--accent-soft); }
html[data-theme="dark"] .admin-app .status-grid,
html[data-theme="dark"] .admin-app .attention-panel,
html[data-theme="dark"] .admin-app .setup-shell { background: var(--surface); }

.login-app { background: var(--canvas); color: var(--text); font-family: "Inter", "Segoe UI", system-ui, sans-serif; font-optical-sizing: auto; font-feature-settings: "cv02", "cv03", "cv04", "cv11"; }
.login-app .topbar,
.login-app .login { background: var(--surface); border-color: var(--border); }
.login-app .login { border-radius: var(--radius-surface); box-shadow: var(--elevation-sticky); }
.login-app .login-head,
.login-app .login-foot { border-color: var(--border); }
.login-app .password-wrap input { background: var(--surface); border-color: var(--border-strong); color: var(--text); }
.login-app .password-wrap input:focus { border-color: var(--accent); box-shadow: var(--focus-ring); }
.login-app .login-foot { display: block; }
.login-app .login-foot span:last-child { display: none; }
.login-app .eyebrow { text-transform: none; letter-spacing: 0; font-family: "Inter", "Segoe UI", system-ui, sans-serif; }

@media (max-width: 920px) {
  .admin-app main { width: 100%; padding: 26px 18px 48px; }
  .admin-app nav { background: var(--surface); border-color: var(--border); box-shadow: var(--elevation-overlay); }
  .admin-app .table-tools { align-items: stretch; }
  .admin-app .simulator-page-head { grid-template-columns: 1fr; }
  .admin-app .status-card { border-right: 0; border-bottom: 1px solid var(--border); }
  .admin-app .status-card:last-child { border-bottom: 0; }
}
@media (max-width: 720px) {
  .admin-app .guided-setup { grid-template-columns: 1fr; padding: 18px; }
  .admin-app .guided-next { align-items: stretch; flex-direction: column; padding: 16px 0 0; border-left: 0; border-top: 1px solid var(--border); }
  .admin-app .guided-next .button-link { width: 100%; text-align: center; }
  .admin-app .config-mode-bar,
  .admin-app .config-preset-bar { align-items: stretch; flex-direction: column; }
  .admin-app .segmented-control { width: 100%; }
  .admin-app .segmented-control button { flex: 1; }
  .admin-app .preset-actions { justify-content: stretch; }
  .admin-app .preset-actions button { flex: 1 1 140px; }
  .admin-app .simple-style-grid { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .admin-app main { padding: 20px 14px 40px; }
  .admin-app .panel,
  .admin-app form.surface-form,
  .admin-app form[data-unsaved],
  .admin-app form.advanced,
  .admin-app form.upload-card { padding: 16px; }
  .admin-app .grid { grid-template-columns: 1fr; }
  .admin-app .table-tools { display: grid; gap: 10px; }
  .admin-app .table-tools input { max-width: none; }
  .admin-app .row-actions { align-items: stretch; }
  .admin-app .row-actions > *,
  .admin-app .row-actions form,
  .admin-app .row-actions button,
  .admin-app .row-actions a { width: 100%; }
  .admin-app .sticky-actions { bottom: 6px; margin-inline: 0; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .admin-app .filter-tabs { width: 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; }
  .admin-app .filter-tab { flex: 0 0 auto; }
  .admin-app .file-picker { align-items: stretch; flex-direction: column; gap: 6px; }
  .admin-app .file-picker-action { width: 100%; }
  .admin-app .file-picker-name { padding: 3px 8px 5px; text-align: center; }
}

@media (prefers-reduced-motion: reduce) {
  .admin-app *, .login-app * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;
