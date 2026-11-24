(() => {
  'use strict';

  const KEYS = {
    sessions: 'pt_sessions',
    sheetsUrl: 'pt_sheets_url',
    queue: 'pt_sync_queue',
    lastSynced: 'pt_last_synced'
  };

  // ---------- storage ----------
  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(KEYS.sessions)) || []; }
    catch { return []; }
  }
  function saveSessions(list) { localStorage.setItem(KEYS.sessions, JSON.stringify(list)); }
  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(KEYS.queue)) || []; }
    catch { return []; }
  }
  function saveQueue(q) { localStorage.setItem(KEYS.queue, JSON.stringify(q)); }
  function getSheetsUrl() { return localStorage.getItem(KEYS.sheetsUrl) || ''; }
  function setSheetsUrl(v) { localStorage.setItem(KEYS.sheetsUrl, v); }
  function getLastSynced() { return localStorage.getItem(KEYS.lastSynced) || ''; }
  function setLastSynced(iso) { localStorage.setItem(KEYS.lastSynced, iso); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function getActiveSession() {
    return loadSessions().find(s => s.status === 'active') || null;
  }

  // ---------- math helpers ----------
  function totalInvested(s) {
    const addOns = (s.addOns || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    return (Number(s.buyIn) || 0) + addOns;
  }
  function profitOf(s) {
    if (s.cashOut == null) return 0;
    return (Number(s.cashOut) || 0) - totalInvested(s);
  }
  function durationHours(s) {
    if (!s.checkOut) return 0;
    return Math.max(0, (new Date(s.checkOut) - new Date(s.checkIn)) / 3600000);
  }
  function sumProfit(sessions, predicate) {
    return sessions.filter(s => s.status === 'completed' && predicate(s))
      .reduce((sum, s) => sum + profitOf(s), 0);
  }

  function formatMoney(n) {
    const v = Math.round((n || 0) * 100) / 100;
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    const str = abs.toLocaleString('en-US', {
      minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
    return `${sign}$${str}`;
  }
  function formatDuration(hours) {
    const totalMin = Math.round(hours * 60);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return `${h}h ${m}m`;
  }
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function localDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function formatDateShort(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- smart defaults ----------
  function dayBucket(date) {
    const h = date.getHours();
    if (h < 11) return 'morning';
    if (h < 17) return 'afternoon';
    if (h < 21) return 'evening';
    return 'night';
  }
  function pickMostFrequent(listAsc, keyFn) {
    const counts = new Map();
    for (const item of listAsc) {
      const k = keyFn(item);
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null, bestCount = 0;
    for (const item of listAsc) {
      const k = keyFn(item);
      if (!k) continue;
      const c = counts.get(k);
      if (c >= bestCount) { bestCount = c; best = k; }
    }
    return best;
  }
  function computeDefaults(sessions, refDate) {
    const all = sessions.slice().sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));
    if (!all.length) return { location: '', game: '', buyIn: '' };

    const ref = refDate || new Date();
    const bucket = dayBucket(ref);
    const weekday = ref.getDay();
    const weekdayBucketMatches = all.filter(s => {
      const d = new Date(s.checkIn);
      return d.getDay() === weekday && dayBucket(d) === bucket;
    });
    const weekdayMatches = all.filter(s => new Date(s.checkIn).getDay() === weekday);
    const pool = weekdayBucketMatches.length ? weekdayBucketMatches : (weekdayMatches.length ? weekdayMatches : all);

    const location = pickMostFrequent(pool, s => s.location) || pickMostFrequent(all, s => s.location) || '';
    const gamePool = pool.filter(s => s.location === location);
    const game = pickMostFrequent(gamePool.length ? gamePool : pool, s => s.game) || pickMostFrequent(all, s => s.game) || '';

    const buyInPool = all.filter(s => s.location === location && s.game === game);
    const source = buyInPool.length ? buyInPool : all;
    const buyIn = source[source.length - 1].buyIn || '';

    return { location, game, buyIn };
  }
  function timeBucketLabel(date) {
    const b = dayBucket(date);
    return b.charAt(0).toUpperCase() + b.slice(1);
  }
  function distinctRecent(sessions, keyFn) {
    const seen = new Set();
    const out = [];
    const sorted = sessions.slice().sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
    for (const s of sorted) {
      const v = keyFn(s);
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    return out;
  }

  // ---------- CSV ----------
  function sessionToRow(s) {
    const invested = totalInvested(s);
    const hours = durationHours(s);
    const profit = s.status === 'completed' ? profitOf(s) : '';
    const pph = (s.status === 'completed' && hours > (1 / 60)) ? profit / hours : '';
    const checkInDate = s.checkIn ? new Date(s.checkIn) : null;
    return {
      id: s.id,
      date: checkInDate ? localDateStr(checkInDate) : '',
      dayOfWeek: checkInDate ? checkInDate.toLocaleDateString('en-US', { weekday: 'long' }) : '',
      timeOfDay: checkInDate ? timeBucketLabel(checkInDate) : '',
      checkIn: s.checkIn || '',
      checkOut: s.checkOut || '',
      location: s.location || '',
      game: s.game || '',
      buyIn: s.buyIn || 0,
      addOns: (s.addOns || []).reduce((a, b) => a + (Number(b.amount) || 0), 0),
      totalInvested: invested,
      cashOut: s.cashOut != null ? s.cashOut : '',
      profit: profit,
      durationHours: hours ? Math.round(hours * 100) / 100 : '',
      profitPerHour: pph !== '' ? Math.round(pph * 100) / 100 : '',
      notesGood: s.notes ? (s.notes.good || '') : '',
      notesBad: s.notes ? (s.notes.bad || '') : '',
      notesAction: s.notes ? (s.notes.action || '') : ''
    };
  }
  function csvEscape(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(sessions) {
    const headers = ['Date', 'Day of Week', 'Time of Day', 'Check-In', 'Check-Out', 'Location', 'Game', 'Buy-In', 'Add-Ons',
      'Total Invested', 'Cash-Out', 'Profit', 'Duration (hrs)', 'Profit/Hr', 'Good', 'Bad', 'Needs Action'];
    const rows = sessions.filter(s => s.status === 'completed')
      .sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn))
      .map(sessionToRow);
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.date, r.dayOfWeek, r.timeOfDay, r.checkIn, r.checkOut, r.location, r.game, r.buyIn, r.addOns,
        r.totalInvested, r.cashOut, r.profit, r.durationHours, r.profitPerHour,
        r.notesGood, r.notesBad, r.notesAction].map(csvEscape).join(','));
    }
    return lines.join('\n');
  }
  function downloadCSV() {
    const csv = toCSV(loadSessions());
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poker-sessions-${localDateStr(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Google Sheets sync ----------
  function queueSync(id) {
    const q = loadQueue();
    if (!q.includes(id)) { q.push(id); saveQueue(q); }
    attemptSync();
  }
  async function attemptSync() {
    const url = getSheetsUrl();
    const q = loadQueue();
    if (!url || !q.length) { renderSyncStatus(); return; }
    const sessions = loadSessions();
    const remaining = [];
    for (const id of q) {
      const s = sessions.find(x => x.id === id);
      if (!s) continue;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(sessionToRow(s))
        });
        const data = await res.json();
        if (!res.ok || data.ok !== true) throw new Error('sync failed');
      } catch {
        remaining.push(id);
      }
    }
    saveQueue(remaining);
    if (remaining.length < q.length) setLastSynced(new Date().toISOString());
    renderSyncStatus();
  }
  function renderSyncStatus() {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const url = getSheetsUrl();
    const q = loadQueue();
    if (!url) { el.textContent = 'Not configured'; return; }
    const last = getLastSynced();
    const lastStr = last ? new Date(last).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
    el.textContent = `Last synced: ${lastStr}${q.length ? ` · ${q.length} pending` : ''}`;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- navigation ----------
  let activeTimerInterval = null;
  function stopActiveTimer() {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }
  function showScreen(name) {
    if (name !== 'active') stopActiveTimer();
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(`screen-${name}`).classList.remove('hidden');
    window.scrollTo(0, 0);
    if (name === 'home') renderHome();
    if (name === 'checkin') renderCheckin();
    if (name === 'past') renderPast();
    if (name === 'active') renderActive();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
  }

  // ---------- render: home ----------
  function renderHome() {
    const sessions = loadSessions();
    const active = sessions.find(s => s.status === 'active');
    const banner = document.getElementById('active-banner');
    if (active) {
      banner.classList.remove('hidden');
      document.getElementById('active-banner-detail').textContent =
        `${active.location || 'Session'} · ${active.game || ''} · since ${formatTime(active.checkIn)}`;
    } else {
      banner.classList.add('hidden');
    }

    const now = new Date();
    const month = sumProfit(sessions, s => {
      const d = new Date(s.checkIn);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const ytd = sumProfit(sessions, s => new Date(s.checkIn).getFullYear() === now.getFullYear());
    setStat('stat-month', month);
    setStat('stat-ytd', ytd);

    const recent = sessions.filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn))
      .slice(0, 5);
    const list = document.getElementById('recent-list');
    list.innerHTML = '';
    if (!recent.length) {
      list.innerHTML = '<div class="empty-state">No sessions yet. Check in to start tracking.</div>';
    } else {
      recent.forEach(s => list.appendChild(buildSessionRow(s)));
    }
  }
  function setStat(id, value) {
    const el = document.getElementById(id);
    el.textContent = formatMoney(value);
    el.className = 'stat-value ' + (value > 0 ? 'positive' : value < 0 ? 'negative' : '');
  }

  function buildSessionRow(s) {
    const invested = totalInvested(s);
    const profit = profitOf(s);
    const hours = durationHours(s);
    const row = document.createElement('div');
    row.className = 'session-row';

    const top = document.createElement('div');
    top.className = 'session-row-top';
    top.innerHTML = `
      <div class="session-row-main">
        <div class="session-row-title">${escapeHtml(s.location || 'Session')}</div>
        <div class="session-row-sub">${formatDateShort(s.checkIn)} · ${escapeHtml(s.game || '')} · ${formatDuration(hours)}</div>
      </div>
      <div class="session-row-profit ${profit >= 0 ? 'positive' : 'negative'}">${formatMoney(profit)}</div>
    `;
    row.appendChild(top);

    const hasNotes = s.notes && (s.notes.good || s.notes.bad || s.notes.action);
    if (hasNotes) {
      const notesEl = document.createElement('div');
      notesEl.className = 'session-row-notes hidden';
      notesEl.innerHTML = [
        s.notes.good ? `<div><b>Good:</b> ${escapeHtml(s.notes.good)}</div>` : '',
        s.notes.bad ? `<div><b>Bad:</b> ${escapeHtml(s.notes.bad)}</div>` : '',
        s.notes.action ? `<div><b>Needs action:</b> ${escapeHtml(s.notes.action)}</div>` : ''
      ].join('');
      top.style.cursor = 'pointer';
      top.addEventListener('click', () => notesEl.classList.toggle('hidden'));
      row.appendChild(notesEl);
    }
    void invested;
    return row;
  }

  // ---------- render: check-in ----------
  function renderCheckin() {
    const sessions = loadSessions();
    const defaults = computeDefaults(sessions);
    document.getElementById('input-location').value = defaults.location;
    document.getElementById('input-game').value = defaults.game;
    document.getElementById('input-buyin').value = defaults.buyIn;

    const locList = document.getElementById('location-options');
    locList.innerHTML = distinctRecent(sessions, s => s.location).map(v => `<option value="${escapeHtml(v)}">`).join('');
    const gameList = document.getElementById('game-options');
    gameList.innerHTML = distinctRecent(sessions, s => s.game).map(v => `<option value="${escapeHtml(v)}">`).join('');
  }

  function doCheckin() {
    const location = document.getElementById('input-location').value.trim();
    const game = document.getElementById('input-game').value.trim();
    const buyIn = Number(document.getElementById('input-buyin').value) || 0;
    if (!location) { toast('Enter where you’re playing'); return; }

    const session = {
      id: uid(),
      checkIn: new Date().toISOString(),
      checkOut: null,
      location, game, buyIn,
      addOns: [],
      cashOut: null,
      notes: null,
      status: 'active'
    };
    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);
    showScreen('active');
  }

  // ---------- render: log past session ----------
  function applyPastDefaults() {
    const sessions = loadSessions();
    const dateStr = document.getElementById('past-date').value;
    const timeStr = document.getElementById('past-start').value || '19:00';
    const ref = dateStr ? new Date(`${dateStr}T${timeStr}`) : new Date();
    const defaults = computeDefaults(sessions, ref);
    document.getElementById('past-location').value = defaults.location;
    document.getElementById('past-game').value = defaults.game;
    document.getElementById('past-buyin').value = defaults.buyIn;
  }

  function renderPast() {
    const sessions = loadSessions();
    const yesterday = new Date(Date.now() - 86400000);

    document.getElementById('past-date').value = localDateStr(yesterday);
    document.getElementById('past-start').value = '19:00';
    document.getElementById('past-duration').value = '';
    document.getElementById('past-addons').value = '';
    document.getElementById('past-cashout').value = '';
    document.getElementById('past-good').value = '';
    document.getElementById('past-bad').value = '';
    document.getElementById('past-action').value = '';
    applyPastDefaults();

    const locList = document.getElementById('location-options');
    locList.innerHTML = distinctRecent(sessions, s => s.location).map(v => `<option value="${escapeHtml(v)}">`).join('');
    const gameList = document.getElementById('game-options');
    gameList.innerHTML = distinctRecent(sessions, s => s.game).map(v => `<option value="${escapeHtml(v)}">`).join('');
  }

  function savePastSession() {
    const dateStr = document.getElementById('past-date').value;
    const timeStr = document.getElementById('past-start').value;
    const duration = Number(document.getElementById('past-duration').value);
    const location = document.getElementById('past-location').value.trim();
    const game = document.getElementById('past-game').value.trim();
    const buyIn = Number(document.getElementById('past-buyin').value) || 0;
    const addOnsTotal = Number(document.getElementById('past-addons').value) || 0;
    const cashOut = Number(document.getElementById('past-cashout').value) || 0;
    const good = document.getElementById('past-good').value.trim();
    const bad = document.getElementById('past-bad').value.trim();
    const action = document.getElementById('past-action').value.trim();

    if (!dateStr || !timeStr) { toast('Enter a date and start time'); return; }
    if (!(duration > 0)) { toast('Enter a duration greater than 0'); return; }
    if (!location) { toast('Enter where you played'); return; }

    const checkIn = new Date(`${dateStr}T${timeStr}`).toISOString();
    const checkOut = new Date(new Date(checkIn).getTime() + duration * 3600000).toISOString();

    const session = {
      id: uid(),
      checkIn, checkOut, location, game, buyIn,
      addOns: addOnsTotal > 0 ? [{ amount: addOnsTotal, time: checkIn }] : [],
      cashOut,
      notes: (good || bad || action) ? { good, bad, action } : null,
      status: 'completed'
    };

    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);
    queueSync(session.id);
    renderReport(session, sessions);
    showScreen('report');
  }

  // ---------- render: active session ----------
  function formatElapsed(checkInIso) {
    const diff = Math.max(0, Date.now() - new Date(checkInIso).getTime());
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }

  let lastAddonAmount = null;

  function renderActive() {
    const session = getActiveSession();
    if (!session) { showScreen('home'); return; }

    document.getElementById('active-location').textContent = session.location || '—';
    document.getElementById('active-game').textContent = session.game || '—';
    document.getElementById('active-invested').textContent = formatMoney(totalInvested(session));
    document.getElementById('active-invested-sub').textContent =
      lastAddonAmount != null ? `+${formatMoney(lastAddonAmount)} last add-on` : `Buy-in ${formatMoney(session.buyIn)}`;

    const list = document.getElementById('addon-list');
    list.innerHTML = (session.addOns || []).map(a =>
      `<div class="addon-row"><span>Add-on</span><span>${formatMoney(a.amount)} · ${formatTime(a.time)}</span></div>`
    ).join('');

    stopActiveTimer();
    const tick = () => { document.getElementById('active-timer').textContent = formatElapsed(session.checkIn); };
    tick();
    activeTimerInterval = setInterval(tick, 1000);
  }

  function addAddon(amount) {
    if (!(amount > 0)) { toast('Enter an amount greater than 0'); return; }
    const sessions = loadSessions();
    const idx = sessions.findIndex(s => s.status === 'active');
    if (idx === -1) return;
    sessions[idx].addOns = sessions[idx].addOns || [];
    sessions[idx].addOns.push({ amount, time: new Date().toISOString() });
    saveSessions(sessions);
    lastAddonAmount = amount;
    toast(`+${formatMoney(amount)} added — total invested ${formatMoney(totalInvested(sessions[idx]))}`);
    renderActive();
  }

  // ---------- cash-out / notes flow ----------
  let pendingCashout = null;
  let draftNotes = null;

  function finalizeSession(notes) {
    const sessions = loadSessions();
    const idx = sessions.findIndex(s => s.status === 'active');
    if (idx === -1) return;
    const s = sessions[idx];
    s.checkOut = new Date().toISOString();
    s.cashOut = pendingCashout;
    s.notes = notes;
    s.status = 'completed';
    sessions[idx] = s;
    saveSessions(sessions);
    queueSync(s.id);

    pendingCashout = null;
    draftNotes = null;
    lastAddonAmount = null;
    renderReport(s, sessions);
    showScreen('report');
  }

  function renderReport(session, allSessions) {
    const invested = totalInvested(session);
    const profit = profitOf(session);
    const hours = durationHours(session);
    const safeHours = Math.max(hours, 1 / 60);
    const pph = profit / safeHours;

    const heroVal = document.getElementById('report-profit');
    heroVal.textContent = formatMoney(profit);
    heroVal.className = 'report-hero-value ' + (profit >= 0 ? 'positive' : 'negative');
    document.getElementById('report-location').textContent = `${session.location || ''} · ${session.game || ''}`;
    document.getElementById('report-duration').textContent = formatDuration(hours);

    const pphEl = document.getElementById('report-pph');
    pphEl.textContent = formatMoney(pph);
    pphEl.className = 'report-tile-value ' + (pph >= 0 ? 'positive' : 'negative');

    const now = new Date(session.checkOut);
    const month = sumProfit(allSessions, s => {
      const d = new Date(s.checkIn);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const ytd = sumProfit(allSessions, s => new Date(s.checkIn).getFullYear() === now.getFullYear());
    const monthEl = document.getElementById('report-month');
    monthEl.textContent = formatMoney(month);
    monthEl.className = 'report-tile-value ' + (month >= 0 ? 'positive' : 'negative');
    const ytdEl = document.getElementById('report-ytd');
    ytdEl.textContent = formatMoney(ytd);
    ytdEl.className = 'report-tile-value ' + (ytd >= 0 ? 'positive' : 'negative');

    void invested;

    const notesWrap = document.getElementById('report-notes-wrap');
    const actionWrap = document.getElementById('report-action-wrap');
    if (session.notes && (session.notes.good || session.notes.bad || session.notes.action)) {
      notesWrap.hidden = false;
      document.getElementById('report-good').textContent = session.notes.good || '—';
      document.getElementById('report-bad').textContent = session.notes.bad || '—';
      if (session.notes.action) {
        actionWrap.hidden = false;
        document.getElementById('report-action').textContent = session.notes.action;
      } else {
        actionWrap.hidden = true;
      }
    } else {
      notesWrap.hidden = true;
      actionWrap.hidden = true;
    }
  }

  // ---------- render: history ----------
  function renderHistory() {
    const sessions = loadSessions().filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    if (!sessions.length) {
      list.innerHTML = '<div class="empty-state">No completed sessions yet.</div>';
      return;
    }
    sessions.forEach(s => list.appendChild(buildSessionRow(s)));
  }

  // ---------- render: settings ----------
  function renderSettings() {
    document.getElementById('input-sheets-url').value = getSheetsUrl();
    renderSyncStatus();
  }

  // ---------- datalist UX fix ----------
  // Browsers filter datalist suggestions by the field's current text, so a
  // pre-filled default (e.g. "$2/5 NLHE") hides every other option (e.g.
  // "$5/10 PLO") until the field is cleared. Clear on focus so the full
  // list shows, and restore the default if the field is left empty.
  function setupDatalistDefault(input) {
    input.addEventListener('focus', () => {
      input.dataset.prevValue = input.value;
      input.value = '';
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim() && input.dataset.prevValue) {
        input.value = input.dataset.prevValue;
      }
    });
  }

  // ---------- wiring ----------
  function init() {
    document.getElementById('btn-settings').addEventListener('click', () => showScreen('settings'));
    document.getElementById('btn-checkin').addEventListener('click', () => showScreen('checkin'));
    document.getElementById('btn-past-session').addEventListener('click', () => showScreen('past'));
    document.getElementById('past-back').addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-save-past').addEventListener('click', savePastSession);
    document.getElementById('past-date').addEventListener('change', applyPastDefaults);
    document.getElementById('past-start').addEventListener('change', applyPastDefaults);

    ['input-location', 'input-game', 'past-location', 'past-game'].forEach(id =>
      setupDatalistDefault(document.getElementById(id))
    );
    document.getElementById('btn-resume').addEventListener('click', () => showScreen('active'));
    document.getElementById('link-history').addEventListener('click', e => { e.preventDefault(); showScreen('history'); });

    document.getElementById('checkin-back').addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-do-checkin').addEventListener('click', doCheckin);

    document.getElementById('active-home').addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-addon').addEventListener('click', () => {
      document.getElementById('dlg-addon-amount').value = '';
      document.getElementById('dlg-addon').showModal();
      document.getElementById('dlg-addon-amount').focus();
    });
    document.getElementById('btn-cashout').addEventListener('click', () => {
      document.getElementById('dlg-cashout-amount').value = 0;
      document.getElementById('dlg-cashout').showModal();
    });

    document.getElementById('dlg-addon').addEventListener('close', e => {
      if (e.target.returnValue === 'confirm') {
        addAddon(Number(document.getElementById('dlg-addon-amount').value));
      }
    });

    document.getElementById('dlg-cashout').addEventListener('close', e => {
      if (e.target.returnValue === 'confirm') {
        pendingCashout = Number(document.getElementById('dlg-cashout-amount').value) || 0;
        document.getElementById('dlg-notes-prompt').showModal();
      }
    });

    document.getElementById('dlg-notes-prompt').addEventListener('close', e => {
      if (e.target.returnValue === 'add') {
        document.getElementById('dlg-good-text').value = '';
        document.getElementById('dlg-notes-good').showModal();
      } else {
        finalizeSession(null);
      }
    });
    document.getElementById('dlg-notes-good').addEventListener('close', () => {
      draftNotes = { good: document.getElementById('dlg-good-text').value.trim(), bad: '', action: '' };
      document.getElementById('dlg-bad-text').value = '';
      document.getElementById('dlg-notes-bad').showModal();
    });
    document.getElementById('dlg-notes-bad').addEventListener('close', () => {
      draftNotes.bad = document.getElementById('dlg-bad-text').value.trim();
      document.getElementById('dlg-action-text').value = '';
      document.getElementById('dlg-notes-action').showModal();
    });
    document.getElementById('dlg-notes-action').addEventListener('close', () => {
      draftNotes.action = document.getElementById('dlg-action-text').value.trim();
      finalizeSession(draftNotes);
    });

    document.getElementById('btn-report-done').addEventListener('click', () => showScreen('home'));

    document.getElementById('history-back').addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-export-csv-history').addEventListener('click', downloadCSV);

    document.getElementById('settings-back').addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-save-sheets').addEventListener('click', () => {
      setSheetsUrl(document.getElementById('input-sheets-url').value.trim());
      toast('Saved');
      renderSyncStatus();
    });
    document.getElementById('btn-sync-now').addEventListener('click', async () => {
      const before = loadQueue().length;
      if (!before) { toast('Nothing to sync'); return; }
      toast('Syncing…');
      await attemptSync();
      const after = loadQueue().length;
      if (after === 0) toast('Synced successfully');
      else toast(`${after} session(s) failed to sync — check the URL in Settings`);
    });
    document.getElementById('btn-export-csv').addEventListener('click', downloadCSV);

    document.getElementById('btn-clear-data').addEventListener('click', () => {
      document.getElementById('dlg-confirm-title').textContent = 'Clear all data?';
      document.getElementById('dlg-confirm-body').textContent = 'This permanently deletes every session on this device. This cannot be undone.';
      const dlg = document.getElementById('dlg-confirm');
      dlg.showModal();
      const handler = e => {
        if (e.target.returnValue === 'confirm') {
          localStorage.removeItem(KEYS.sessions);
          localStorage.removeItem(KEYS.queue);
          localStorage.removeItem(KEYS.lastSynced);
          toast('All data cleared');
          showScreen('home');
        }
        dlg.removeEventListener('close', handler);
      };
      dlg.addEventListener('close', handler);
    });

    const active = getActiveSession();
    showScreen(active ? 'active' : 'home');
    attemptSync();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
