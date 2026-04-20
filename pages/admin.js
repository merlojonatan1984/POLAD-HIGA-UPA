*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #222637;
  --border: rgba(255,255,255,0.08);
  --border2: rgba(255,255,255,0.14);
  --text: #e8eaf0;
  --text-muted: #8b90a0;
  --text-hint: #555b6e;
  --blue: #378ADD;
  --blue-dark: #185FA5;
  --green: #1D9E75;
  --amber: #BA7517;
  --red: #A32D2D;
  --radius: 8px;
  --radius-lg: 12px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  min-height: 100vh;
}

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: var(--radius);
  border: 0.5px solid var(--border2);
  background: var(--surface2); cursor: pointer;
  font-size: 13px; color: var(--text);
  transition: background .15s;
}
.btn:hover { background: #2a2f45; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn-primary { background: var(--blue); color: #fff; border-color: var(--blue); }
.btn-primary:hover { background: var(--blue-dark); border-color: var(--blue-dark); }
.btn-success { background: var(--green); color: #fff; border-color: var(--green); padding: 10px 24px; font-size: 14px; }
.btn-success:hover { background: #0F6E56; }
.btn-sm { padding: 5px 10px; font-size: 12px; }

/* Cards */
.card {
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
}
.panel {
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 16px;
}
.panel-header {
  padding: 10px 14px;
  border-bottom: 0.5px solid var(--border);
  background: var(--surface2);
  display: flex; align-items: center; justify-content: space-between;
}
.panel-header h3 { font-size: 13px; font-weight: 500; color: var(--text); }

/* Inputs */
input[type="text"], input[type="password"], select {
  width: 100%; padding: 9px 11px;
  border: 0.5px solid var(--border2);
  border-radius: var(--radius);
  font-size: 14px; background: var(--surface2); color: var(--text);
  outline: none;
}
input:focus, select:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(55,138,221,0.2); }
label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 5px; }

/* Metrics */
.metric { background: var(--surface2); border-radius: var(--radius); padding: 12px 14px; border: 0.5px solid var(--border); }
.metric-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.metric-val { font-size: 22px; font-weight: 500; color: var(--text); }
.metric-sub { font-size: 11px; color: var(--text-hint); margin-top: 2px; }

/* Tags */
.tag { font-size: 10px; padding: 2px 7px; border-radius: 3px; font-weight: 500; }
.tag-u { background: #2a2560; color: #AFA9EC; }
.tag-g { background: #0d3328; color: #5DCAA5; }

/* Alerts */
.alert { padding: 10px 14px; border-radius: var(--radius); font-size: 13px; margin-bottom: 12px; }
.alert-ok { background: #0d2b1a; color: #5DCAA5; border: 0.5px solid #1D9E75; }
.alert-warn { background: #2b1e08; color: #EF9F27; border: 0.5px solid #BA7517; }
.alert-err { background: #2b0d0d; color: #F09595; border: 0.5px solid #E24B4A; }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { font-size: 11px; font-weight: 500; color: var(--text-muted); text-align: left; padding: 8px 12px; border-bottom: 0.5px solid var(--border); background: var(--surface2); }
td { padding: 8px 12px; border-bottom: 0.5px solid var(--border); color: var(--text); }
tr:last-child td { border-bottom: none; }
tr:hover td { background: rgba(255,255,255,0.02); }

/* Horas bar */
.hbar { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); margin-top: 3px; width: 80px; overflow: hidden; }
.hfill { height: 100%; border-radius: 3px; }

/* Chips */
.chip { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; margin: 1px; }
.chip-d { background: #3a2a0a; color: #EF9F27; }
.chip-n { background: #0d2040; color: #85B7EB; }
.chip-dn { background: #0d2b1a; color: #5DCAA5; }

/* Topbar */
.topbar {
  background: var(--surface); border-bottom: 0.5px solid var(--border);
  padding: 11px 20px; display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 10;
}

/* Layout */
.app-layout { display: flex; min-height: calc(100vh - 49px); }
.sidebar { width: 200px; background: var(--surface); border-right: 0.5px solid var(--border); padding: 12px 0; flex-shrink: 0; }
.main-area { flex: 1; overflow: auto; }
.content { padding: 18px 20px; }
.nav-item { padding: 8px 14px; font-size: 12px; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; gap: 7px; border-left: 2px solid transparent; text-decoration: none; }
.nav-item.active { color: var(--text); border-left: 2px solid var(--blue); background: rgba(55,138,221,0.1); font-weight: 500; }
.nav-item:hover:not(.active) { background: rgba(255,255,255,0.03); }
.nav-sec { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-hint); padding: 10px 14px 3px; }

/* Group headers */
.group-header { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .06em; padding: 10px 14px 6px; margin-top: 4px; border-bottom: 0.5px solid var(--border); }
.group-header-u { color: #AFA9EC; background: rgba(42,37,96,0.4); }
.group-header-g { color: #5DCAA5; background: rgba(13,51,40,0.4); }

/* Calendar grid */
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.day-cell { border: 0.5px solid var(--border); padding: 6px; min-height: 52px; cursor: pointer; border-radius: 6px; transition: background .1s; background: var(--surface2); }
.day-cell:hover { background: #2a2f45; }
.day-cell.sel-d { background: #3a2a0a; border-color: #BA7517; }
.day-cell.sel-n { background: #0d2040; border-color: #378ADD; }
.day-cell.sel-dn { background: #0d2b1a; border-color: #1D9E75; }
.day-cell.empty { border: none; background: transparent; cursor: default; }
.day-num { font-size: 11px; font-weight: 500; color: var(--text-muted); }
.day-label { font-size: 10px; font-weight: 500; margin-top: 2px; }

/* Loading */
.loading { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-muted); font-size: 13px; }

/* Dot */
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

@media (max-width: 600px) {
  .sidebar { display: none; }
  .content { padding: 12px; }
  .cal-grid { gap: 2px; }
  .day-cell { min-height: 40px; padding: 4px; }
}
