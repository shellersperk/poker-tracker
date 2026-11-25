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
  function sumInvested(sessions, predicate) {
    return sessions.filter(s => s.status === 'completed' && predicate(s))
      .reduce((sum, s) => sum + totalInvested(s), 0);
  }
  function sessionType(s) { return s.type === 'tournament' ? 'tournament' : 'cash'; }
  function ordinal(n) {
    const v = Number(n);
    if (!v) return '';
    const mod100 = v % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
    switch (v % 10) {
      case 1: return `${v}st`;
      case 2: return `${v}nd`;
      case 3: return `${v}rd`;
      default: return `${v}th`;
    }
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
  function topFrequent(sessions, keyFn, n) {
    const counts = new Map();
    for (const s of sessions) {
      const k = keyFn(s);
      if (k === '' || k == null) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  }

  // ---------- quick-pick chips ----------
  const REBUY_PRESETS = [100, 200, 300, 500];
  function buildChips(container, values, onPick, formatFn) {
    if (!container) return;
    container.innerHTML = '';
    values.forEach(v => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = formatFn ? formatFn(v) : v;
      chip.addEventListener('click', () => onPick(v));
      container.appendChild(chip);
    });
  }

  // ---------- cash / tournament type toggle ----------
  function wireTypeToggle(containerId, onChange) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.type);
      });
    });
  }
  function getToggleType(containerId) {
    const active = document.querySelector(`#${containerId} .type-btn.active`);
    return active ? active.dataset.type : 'cash';
  }
  function setToggleType(containerId, type) {
    document.querySelectorAll(`#${containerId} .type-btn`).forEach(b =>
      b.classList.toggle('active', b.dataset.type === type));
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
      type: sessionType(s),
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
      finishPlace: s.place != null ? s.place : '',
      fieldSize: s.fieldSize != null ? s.fieldSize : '',
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
    const headers = ['Date', 'Day of Week', 'Time of Day', 'Type', 'Check-In', 'Check-Out', 'Location', 'Game', 'Buy-In', 'Add-Ons',
      'Total Invested', 'Cash-Out', 'Profit', 'Duration (hrs)', 'Profit/Hr', 'Finish Place', 'Field Size', 'Good', 'Bad', 'Needs Action'];
    const rows = sessions.filter(s => s.status === 'completed')
      .sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn))
      .map(sessionToRow);
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.date, r.dayOfWeek, r.timeOfDay, r.type, r.checkIn, r.checkOut, r.location, r.game, r.buyIn, r.addOns,
        r.totalInvested, r.cashOut, r.profit, r.durationHours, r.profitPerHour, r.finishPlace, r.fieldSize,
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
    refreshSyncBadges();
  }
  function refreshSyncBadges() {
    if (!document.getElementById('screen-home').classList.contains('hidden')) renderHome();
    if (!document.getElementById('screen-history').classList.contains('hidden')) renderHistory();
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

    const monthInvested = sumInvested(sessions, s => {
      const d = new Date(s.checkIn);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const ytdInvested = sumInvested(sessions, s => new Date(s.checkIn).getFullYear() === now.getFullYear());
    document.getElementById('stat-month-invested').textContent = `Buy-ins ${formatMoney(monthInvested)}`;
    document.getElementById('stat-ytd-invested').textContent = `Buy-ins ${formatMoney(ytdInvested)}`;

    const recent = sessions.filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn))
      .slice(0, 3);
    const list = document.getElementById('recent-list');
    list.innerHTML = '';
    if (!recent.length) {
      list.innerHTML = '<div class="empty-state">No sessions yet. Check in to start tracking.</div>';
    } else {
      recent.forEach(s => list.appendChild(buildSessionRow(s)));
    }

    renderTrendChart(sessions);
  }

  // ---------- render: 3-month trend chart ----------
  function renderTrendChart(sessions) {
    const container = document.getElementById('trend-chart');
    if (!container) return;
    const now = new Date();
    const months = [0, 1, 2].map(i => new Date(now.getFullYear(), now.getMonth() - (2 - i), 1));
    const data = months.map(d => ({
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      value: sumProfit(sessions, s => {
        const sd = new Date(s.checkIn);
        return sd.getFullYear() === d.getFullYear() && sd.getMonth() === d.getMonth();
      })
    }));

    const totalEl = document.getElementById('trend-total');
    const total = data.reduce((sum, d) => sum + d.value, 0);
    totalEl.textContent = formatMoney(total);
    totalEl.className = 'trend-total ' + (total > 0 ? 'positive' : total < 0 ? 'negative' : '');

    const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.value)));
    const TRACK_H = 52;
    container.innerHTML = '';
    data.forEach(d => {
      const col = document.createElement('div');
      col.className = 'trend-col';

      const value = document.createElement('div');
      value.className = 'trend-value ' + (d.value > 0 ? 'positive' : d.value < 0 ? 'negative' : '');
      value.textContent = formatMoney(d.value);

      const track = document.createElement('div');
      track.className = 'trend-track';
      const top = document.createElement('div');
      top.className = 'trend-top';
      const bottom = document.createElement('div');
      bottom.className = 'trend-bottom';
      const bar = document.createElement('div');
      const barHeight = Math.round((Math.abs(d.value) / maxAbs) * (TRACK_H - 4));
      bar.style.height = Math.max(d.value === 0 ? 0 : 3, barHeight) + 'px';
      if (d.value >= 0) {
        bar.className = 'trend-bar positive';
        top.appendChild(bar);
      } else {
        bar.className = 'trend-bar negative';
        bottom.appendChild(bar);
      }
      const baseline = document.createElement('div');
      baseline.className = 'trend-baseline';
      track.append(top, baseline, bottom);

      const month = document.createElement('div');
      month.className = 'trend-month';
      month.textContent = d.label;

      col.append(value, track, month);
      container.appendChild(col);
    });
  }
  function setStat(id, value) {
    const el = document.getElementById(id);
    el.textContent = formatMoney(value);
    el.className = 'stat-value ' + (value > 0 ? 'positive' : value < 0 ? 'negative' : '');
  }

  function syncBadgeHtml(s) {
    if (!getSheetsUrl()) return '';
    const pending = loadQueue().includes(s.id);
    return pending
      ? '<div class="sync-badge pending">Pending sync</div>'
      : '<div class="sync-badge synced">Synced</div>';
  }

  function buildSessionRow(s) {
    const invested = totalInvested(s);
    const profit = profitOf(s);
    const hours = durationHours(s);
    const isTourney = sessionType(s) === 'tournament';
    const row = document.createElement('div');
    row.className = 'session-row';

    const top = document.createElement('div');
    top.className = 'session-row-top';

    const subParts = [formatDateShort(s.checkIn), escapeHtml(s.game || ''), formatDuration(hours)];
    if (isTourney && s.place) {
      subParts.push(`Finished ${ordinal(s.place)}${s.fieldSize ? ` of ${s.fieldSize}` : ''}`);
    }
    const main = document.createElement('div');
    main.className = 'session-row-main';
    main.innerHTML = `
      <div class="session-row-title">${escapeHtml(s.location || 'Session')}</div>
      <div class="session-row-sub">${subParts.filter(Boolean).join(' · ')}</div>
      ${isTourney ? '<div><span class="session-row-tag">Tournament</span></div>' : ''}
      ${syncBadgeHtml(s)}
    `;

    const right = document.createElement('div');
    right.className = 'session-row-right';
    const profitEl = document.createElement('div');
    profitEl.className = `session-row-profit ${profit >= 0 ? 'positive' : 'negative'}`;
    profitEl.textContent = formatMoney(profit);
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'session-edit-btn';
    editBtn.setAttribute('aria-label', 'Edit notes');
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openEditNotes(s.id); });
    right.append(profitEl, editBtn);

    top.append(main, right);
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

  // ---------- edit notes after the fact ----------
  let editingSessionId = null;
  function openEditNotes(id) {
    const sessions = loadSessions();
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    editingSessionId = id;
    document.getElementById('edit-good-text').value = s.notes ? (s.notes.good || '') : '';
    document.getElementById('edit-bad-text').value = s.notes ? (s.notes.bad || '') : '';
    document.getElementById('edit-action-text').value = s.notes ? (s.notes.action || '') : '';
    document.getElementById('dlg-edit-notes').showModal();
  }
  function saveEditedNotes() {
    if (!editingSessionId) return;
    const sessions = loadSessions();
    const idx = sessions.findIndex(x => x.id === editingSessionId);
    if (idx === -1) { editingSessionId = null; return; }
    const good = document.getElementById('edit-good-text').value.trim();
    const bad = document.getElementById('edit-bad-text').value.trim();
    const action = document.getElementById('edit-action-text').value.trim();
    sessions[idx].notes = (good || bad || action) ? { good, bad, action } : null;
    saveSessions(sessions);
    const id = editingSessionId;
    editingSessionId = null;
    refreshSyncBadges();
    queueSync(id);
    toast('Notes saved');
  }

  // ---------- render: check-in ----------
  function renderCheckin() {
    setToggleType('checkin-type-toggle', 'cash');
    document.getElementById('input-fieldsize').value = '';
    renderCheckinPickers('cash');
  }

  function renderCheckinPickers(type) {
    const all = loadSessions();
    const scoped = all.filter(s => sessionType(s) === type);
    const pool = scoped.length ? scoped : all;
    const defaults = computeDefaults(pool);
    document.getElementById('input-location').value = defaults.location;
    document.getElementById('input-game').value = defaults.game;
    document.getElementById('input-buyin').value = defaults.buyIn;

    const locList = document.getElementById('location-options');
    locList.innerHTML = distinctRecent(pool, s => s.location).map(v => `<option value="${escapeHtml(v)}">`).join('');
    const gameList = document.getElementById('game-options');
    gameList.innerHTML = distinctRecent(pool, s => s.game).map(v => `<option value="${escapeHtml(v)}">`).join('');

    buildChips(document.getElementById('checkin-location-chips'), topFrequent(pool, s => s.location, 4),
      v => { document.getElementById('input-location').value = v; });
    buildChips(document.getElementById('checkin-game-chips'), topFrequent(pool, s => s.game, 4),
      v => { document.getElementById('input-game').value = v; });
    buildChips(document.getElementById('checkin-buyin-chips'), topFrequent(pool, s => s.buyIn, 4),
      v => { document.getElementById('input-buyin').value = v; }, formatMoney);

    document.getElementById('checkin-fieldsize-field').classList.toggle('hidden', type !== 'tournament');
  }

  function doCheckin() {
    const type = getToggleType('checkin-type-toggle');
    const location = document.getElementById('input-location').value.trim();
    const game = document.getElementById('input-game').value.trim();
    const buyIn = Number(document.getElementById('input-buyin').value) || 0;
    const fieldSize = type === 'tournament' ? (Number(document.getElementById('input-fieldsize').value) || null) : null;
    if (!location) { toast('Enter where you’re playing'); return; }

    const session = {
      id: uid(),
      type,
      checkIn: new Date().toISOString(),
      checkOut: null,
      location, game, buyIn,
      addOns: [],
      cashOut: null,
      fieldSize, place: null,
      notes: null,
      status: 'active'
    };
    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);
    showScreen('active');
  }

  // ---------- render: log past session ----------
  function applyPastDefaults(type) {
    type = type || getToggleType('past-type-toggle');
    const all = loadSessions();
    const scoped = all.filter(s => sessionType(s) === type);
    const pool = scoped.length ? scoped : all;
    const dateStr = document.getElementById('past-date').value;
    const timeStr = document.getElementById('past-start').value || '19:00';
    const ref = dateStr ? new Date(`${dateStr}T${timeStr}`) : new Date();
    const defaults = computeDefaults(pool, ref);
    document.getElementById('past-location').value = defaults.location;
    document.getElementById('past-game').value = defaults.game;
    document.getElementById('past-buyin').value = defaults.buyIn;

    const locList = document.getElementById('location-options');
    locList.innerHTML = distinctRecent(pool, s => s.location).map(v => `<option value="${escapeHtml(v)}">`).join('');
    const gameList = document.getElementById('game-options');
    gameList.innerHTML = distinctRecent(pool, s => s.game).map(v => `<option value="${escapeHtml(v)}">`).join('');

    buildChips(document.getElementById('past-location-chips'), topFrequent(pool, s => s.location, 4),
      v => { document.getElementById('past-location').value = v; });
    buildChips(document.getElementById('past-game-chips'), topFrequent(pool, s => s.game, 4),
      v => { document.getElementById('past-game').value = v; });
    buildChips(document.getElementById('past-buyin-chips'), topFrequent(pool, s => s.buyIn, 4),
      v => { document.getElementById('past-buyin').value = v; }, formatMoney);
    buildChips(document.getElementById('past-addons-chips'), REBUY_PRESETS,
      v => { document.getElementById('past-addons').value = v; }, formatMoney);

    document.getElementById('past-fieldsize-field').classList.toggle('hidden', type !== 'tournament');
    document.getElementById('past-place-field').classList.toggle('hidden', type !== 'tournament');
  }

  function renderPast() {
    const yesterday = new Date(Date.now() - 86400000);

    document.getElementById('past-date').value = localDateStr(yesterday);
    document.getElementById('past-start').value = '19:00';
    document.getElementById('past-duration').value = '';
    document.getElementById('past-fieldsize').value = '';
    document.getElementById('past-addons').value = '';
    document.getElementById('past-cashout').value = '';
    document.getElementById('past-place').value = '';
    document.getElementById('past-good').value = '';
    document.getElementById('past-bad').value = '';
    document.getElementById('past-action').value = '';
    setToggleType('past-type-toggle', 'cash');
    applyPastDefaults('cash');
  }

  function savePastSession() {
    const type = getToggleType('past-type-toggle');
    const dateStr = document.getElementById('past-date').value;
    const timeStr = document.getElementById('past-start').value;
    const duration = Number(document.getElementById('past-duration').value);
    const location = document.getElementById('past-location').value.trim();
    const game = document.getElementById('past-game').value.trim();
    const buyIn = Number(document.getElementById('past-buyin').value) || 0;
    const addOnsTotal = Number(document.getElementById('past-addons').value) || 0;
    const cashOut = Number(document.getElementById('past-cashout').value) || 0;
    const fieldSize = type === 'tournament' ? (Number(document.getElementById('past-fieldsize').value) || null) : null;
    const place = type === 'tournament' ? (Number(document.getElementById('past-place').value) || null) : null;
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
      type,
      checkIn, checkOut, location, game, buyIn,
      addOns: addOnsTotal > 0 ? [{ amount: addOnsTotal, time: checkIn }] : [],
      cashOut,
      fieldSize, place,
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
    const isTourney = sessionType(session) === 'tournament';

    document.getElementById('active-location').textContent = session.location || '—';
    document.getElementById('active-game').textContent = session.game || '—';
    document.getElementById('active-invested').textContent = formatMoney(totalInvested(session));
    document.getElementById('active-invested-sub').textContent =
      lastAddonAmount != null ? `+${formatMoney(lastAddonAmount)} last ${isTourney ? 're-entry' : 'add-on'}` : `Buy-in ${formatMoney(session.buyIn)}`;
    document.getElementById('btn-addon').textContent = isTourney ? '+ Re-Entry' : '+ Add-On';

    const list = document.getElementById('addon-list');
    list.innerHTML = (session.addOns || []).map(a =>
      `<div class="addon-row"><span>${isTourney ? 'Re-Entry' : 'Add-on'}</span><span>${formatMoney(a.amount)} · ${formatTime(a.time)}</span></div>`
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
  let pendingPlace = null;
  let draftNotes = null;

  function finalizeSession(notes) {
    const sessions = loadSessions();
    const idx = sessions.findIndex(s => s.status === 'active');
    if (idx === -1) return;
    const s = sessions[idx];
    s.checkOut = new Date().toISOString();
    s.cashOut = pendingCashout;
    if (sessionType(s) === 'tournament' && pendingPlace != null) s.place = pendingPlace;
    s.notes = notes;
    s.status = 'completed';
    sessions[idx] = s;
    saveSessions(sessions);
    queueSync(s.id);

    pendingCashout = null;
    pendingPlace = null;
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
    const finishSuffix = sessionType(session) === 'tournament' && session.place
      ? ` · Finished ${ordinal(session.place)}${session.fieldSize ? ` of ${session.fieldSize}` : ''}`
      : '';
    document.getElementById('report-location').textContent = `${session.location || ''} · ${session.game || ''}${finishSuffix}`;
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
    document.getElementById('past-date').addEventListener('change', () => applyPastDefaults());
    document.getElementById('past-start').addEventListener('change', () => applyPastDefaults());
    wireTypeToggle('checkin-type-toggle', type => renderCheckinPickers(type));
    wireTypeToggle('past-type-toggle', type => applyPastDefaults(type));

    ['input-location', 'input-game', 'past-location', 'past-game'].forEach(id =>
      setupDatalistDefault(document.getElementById(id))
    );
    document.getElementById('btn-resume').addEventListener('click', () => showScreen('active'));
    document.getElementById('link-history').addEventListener('click', e => { e.preventDefault(); showScreen('history'); });

    document.getElementById('checkin-back').addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-do-checkin').addEventListener('click', doCheckin);

    document.getElementById('active-home').addEventListener('click', () => showScreen('home'));
    buildChips(document.getElementById('addon-chips'), REBUY_PRESETS,
      v => { document.getElementById('dlg-addon-amount').value = v; }, formatMoney);
    document.getElementById('btn-addon').addEventListener('click', () => {
      document.getElementById('dlg-addon-amount').value = '';
      document.getElementById('dlg-addon').showModal();
      document.getElementById('dlg-addon-amount').focus();
    });
    document.getElementById('btn-cashout').addEventListener('click', () => {
      document.getElementById('dlg-cashout-amount').value = 0;
      document.getElementById('dlg-cashout-place').value = '';
      const activeSession = getActiveSession();
      const isTourney = activeSession && sessionType(activeSession) === 'tournament';
      document.getElementById('dlg-cashout-place-field').classList.toggle('hidden', !isTourney);
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
        pendingPlace = Number(document.getElementById('dlg-cashout-place').value) || null;
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

    document.getElementById('dlg-edit-notes').addEventListener('close', e => {
      if (e.target.returnValue === 'save') saveEditedNotes();
      else editingSessionId = null;
    });

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
      navigator.serviceWorker.register('service-worker.js').then(reg => {
        reg.update().catch(() => {});
      }).catch(() => {});

      // A new service worker activates (skipWaiting + clients.claim, set in
      // service-worker.js) as soon as it finishes installing. Reload once
      // that handoff happens so the new app.js/index.html/styles.css take
      // effect immediately instead of waiting on the user to reopen the app
      // the right number of times.
      let refreshedOnce = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshedOnce) return;
        refreshedOnce = true;
        location.reload();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
