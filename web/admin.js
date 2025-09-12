// Admin Dashboard Logic
// Unified refresh for stats, history and logs.

const REFRESH_INTERVAL_MS = 5000;
let refreshTimer = null;
let currentView = 'status';

function authHeaders() {
	const t = sessionStorage.getItem('admintoken');
	return t ? { 'Authorization': 'Bearer ' + t } : {};
}

// DOM references (resolved on DOMContentLoaded)
let btnStatus, btnLogs, viewStatus, viewLogs, refreshStatus;
function activate(btn) {
	[btnStatus, btnLogs].forEach(b => {
		if (!b) return;
		b.classList.remove('bg-fuchsia-600', 'text-white', 'shadow-fuchsia-600/30');
		b.classList.add('bg-slate-800', 'text-slate-200', 'border', 'border-slate-700');
	});
	if (btn) {
		btn.classList.add('bg-fuchsia-600', 'text-white');
		btn.classList.remove('bg-slate-800', 'text-slate-200', 'border', 'border-slate-700');
	}
}

function esc(s) { return (s || '').toString().replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

let firstStatsLoad = true;
async function loadStats() {
	const body = document.getElementById('containersBody');
	const prevScrollParent = body.parentElement; // tbody scroll container (via overflow-x on table wrapper)
	const parentScrollTop = prevScrollParent ? prevScrollParent.scrollTop : 0;
	if (firstStatsLoad) {
		body.innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-slate-500">Loading...</td></tr>';
	}
	try {
		const r = await fetch('/stats', { headers: { 'Accept': 'application/json', ...authHeaders() } });
		if (r.status === 401) { window.location = '/adminLogin'; return; }
		if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
		const data = await r.json();
		document.getElementById('statTimestamp').textContent = data.timestamp || '-';
		document.getElementById('statContainerCount').textContent = data.container_count ?? 0;
		let newHtml;
		if (Array.isArray(data.containers) && data.containers.length) {
			newHtml = data.containers.map(c => `<tr class="hover:bg-slate-800/40">\n<td class="px-4 py-2 max-w-[160px] truncate" title="${esc(c.container_id)}">${esc(c.container_id)}</td>\n<td class="px-4 py-2">${esc(c.timestamp)}</td>\n<td class="px-4 py-2">${esc(c.status || '-')}</td>\n<td class="px-4 py-2">${esc(c.runtime || '-')}</td>\n</tr>`).join('');
		} else {
			newHtml = '<tr><td colspan="4" class="px-4 py-3 text-slate-500">No containers</td></tr>';
		}
		if (body.innerHTML !== newHtml) body.innerHTML = newHtml;
		if (prevScrollParent) prevScrollParent.scrollTop = parentScrollTop;
		firstStatsLoad = false;
	} catch (e) {
		if (firstStatsLoad) body.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-red-400">Erro: ${esc(e.message)}</td></tr>`;
	}
}

let firstHistoryLoad = true;
async function loadHistory() {
	const limit = document.getElementById('limit').value || 25;
	const body = document.getElementById('historyBody');
	const scrollParent = body.parentElement;
	const saved = scrollParent ? scrollParent.scrollTop : 0;
	if (firstHistoryLoad) body.innerHTML = '<tr><td colspan="5" class="px-4 py-3 text-slate-500">Loading...</td></tr>';
	try {
		const r = await fetch(`/history?limit=${encodeURIComponent(limit)}`, { headers: { 'Accept': 'application/json', ...authHeaders() } });
		if (r.status === 401) { window.location = '/adminLogin'; return; }
		if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
		const data = await r.json();
		document.getElementById('historyCount').textContent = data.count ?? 0;
		let newHtml;
		if (Array.isArray(data.containers) && data.containers.length) {
			newHtml = data.containers.map((c, idx) => { const durMs = c.execution_time ? Math.round(c.execution_time / 1e6) : '-'; return `<tr class=\"align-top hover:bg-slate-800/40 cursor-pointer\" onclick=\"showContainerDetails(${idx})\">\n<td class=\"px-4 py-2 max-w-[160px] truncate\" title=\"${esc(c.container_id)}\">${esc(c.container_id)}</td>\n<td class=\"px-4 py-2 whitespace-nowrap\">${esc(c.created_at)}</td>\n<td class=\"px-4 py-2 whitespace-nowrap\">${esc(c.finished_at)}</td>\n<td class=\"px-4 py-2\">${durMs}</td>\n<td class=\"px-4 py-2 text-red-400 max-w-[200px] truncate\" title=\"${esc(c.error_message)}\">${esc(c.error_message)}</td>\n</tr>`; }).join('');
			window.currentContainers = data.containers;
		} else {
			newHtml = '<tr><td colspan="5" class="px-4 py-3 text-slate-500">No history</td></tr>';
			window.currentContainers = [];
		}
		if (body.innerHTML !== newHtml) body.innerHTML = newHtml;
		if (scrollParent) scrollParent.scrollTop = saved;
		firstHistoryLoad = false;
	} catch (e) {
		if (firstHistoryLoad) body.innerHTML = `<tr><td colspan=\"5\" class=\"px-4 py-3 text-red-400\">Erro: ${esc(e.message)}</td></tr>`;
		window.currentContainers = [];
	}
}

let firstLogsLoad = true;
async function loadLogs() {
	const limit = document.getElementById('logsLimit').value || 100;
	const levelFilter = document.getElementById('logLevel').value;
	const body = document.getElementById('logsBody');
	const meta = document.getElementById('logsMeta');
	const parent = body.parentElement;
	const savedTop = parent ? parent.scrollTop : 0;
	if (firstLogsLoad) body.innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-slate-500">Loading...</td></tr>';
	try {
		let url = `/logs?limit=${encodeURIComponent(limit)}`;
		if (levelFilter) url += `&level=${encodeURIComponent(levelFilter)}`;
		const r = await fetch(url, { headers: { 'Accept': 'application/json', ...authHeaders() } });
		if (r.status === 401) { window.location = '/adminLogin'; return; }
		if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
		const data = await r.json();
		const filterText = levelFilter ? ` (filtered by ${levelFilter})` : '';
		meta.textContent = `Showing ${data.count} logs (limit=${data.limit})${filterText}`;
		let newHtml;
		if (Array.isArray(data.logs) && data.logs.length) {
			newHtml = data.logs.map((l, idx) => { const levelColor = l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-green-300'; return `<tr class=\"hover:bg-slate-800/40 cursor-pointer\" onclick=\"showLogDetails(${idx})\">\n<td class=\"px-4 py-2 whitespace-nowrap\">${esc(l.ts)}</td>\n<td class=\"px-4 py-2 ${levelColor}\">${esc(l.level)}</td>\n<td class=\"px-4 py-2 max-w-[420px] truncate\" title=\"${esc(l.message)}\">${esc(l.message)}</td>\n<td class=\"px-4 py-2 max-w-[200px] truncate\" title=\"${esc(l.caller)}\">${esc(l.caller || '')}</td>\n</tr>`; }).join('');
			window.currentLogs = data.logs;
		} else {
			newHtml = '<tr><td colspan="4" class="px-4 py-3 text-slate-500">No logs</td></tr>';
			window.currentLogs = [];
		}
		if (body.innerHTML !== newHtml) body.innerHTML = newHtml;
		if (parent) parent.scrollTop = savedTop;
		firstLogsLoad = false;
	} catch (e) {
		if (firstLogsLoad) body.innerHTML = `<tr><td colspan=\"4\" class=\"px-4 py-3 text-red-400\">Erro: ${esc(e.message)}</td></tr>`;
		meta.textContent = '';
		window.currentLogs = [];
	}
}

function modalOpen() {
	return !document.getElementById('logModal').classList.contains('hidden') || !document.getElementById('containerModal').classList.contains('hidden');
}
function unifiedRefresh() {
	if (modalOpen()) return; // don't refresh while a modal is open to prevent context jump
	if (currentView === 'status') {
		loadStats();
		loadHistory();
	} else if (currentView === 'logs') {
		loadLogs();
	}
}

function startUnifiedAutoRefresh() {
	stopUnifiedAutoRefresh();
	unifiedRefresh(); // immediate
	refreshTimer = setInterval(unifiedRefresh, REFRESH_INTERVAL_MS);
	if (refreshStatus) {
		refreshStatus.textContent = `Auto-refresh every ${REFRESH_INTERVAL_MS / 1000}s (${currentView} view)`;
	}
}
function stopUnifiedAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

// Modal formatting reused from previous inline script
function formatLogForDisplay(log) {
	const formatValue = (key, value) => {
		if (value === null) return '<span class="text-slate-500">null</span>';
		if (value === undefined) return '<span class="text-slate-500">undefined</span>';
		if (value === '') return '<span class="text-slate-500">""</span>';
		if (typeof value === 'string') {
			if (key === 'ts') {
				try { const d = new Date(value); return `<span class=\"text-cyan-300\">"${esc(value)}"</span> <span class=\"text-slate-400 text-xs\">(${d.toLocaleString()})</span>`; } catch { return `<span class=\"text-cyan-300\">"${esc(value)}"</span>`; }
			} else if (key === 'level') {
				const levelColor = value === 'error' ? 'text-red-400' : value === 'warn' ? 'text-amber-300' : 'text-green-300';
				return `<span class=\"${levelColor}\">"${esc(value)}"</span>`;
			} else if (key === 'stack' && value.includes('\n')) {
				const lines = value.split('\n').map(line => `    ${esc(line.trim())}`).join('\n');
				return `<span class=\"text-orange-300\">"</span><br><span class=\"text-slate-400 text-xs leading-relaxed\">${lines}</span><br><span class=\"text-orange-300\">"</span>`;
			}
			return `<span class=\"text-cyan-300\">"${esc(value)}"</span>`;
		}
		if (typeof value === 'number') return `<span class=\"text-yellow-400\">${value}</span>`;
		if (typeof value === 'boolean') return `<span class=\"text-purple-400\">${value}</span>`;
		return `<span class=\"text-slate-300\">${JSON.stringify(value)}</span>`;
	};
	let html = '<div class="space-y-2">';
	const levelColor = log.level === 'error' ? 'bg-red-500/20 text-red-300 border-red-500/30' : log.level === 'warn' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-green-500/20 text-green-300 border-green-500/30';
	html += `<div class=\"flex items-center gap-3 pb-3 border-b border-slate-700\">`;
	html += `<span class=\"px-2 py-1 rounded text-xs font-semibold border ${levelColor}\">${log.level?.toUpperCase() || 'LOG'}</span>`;
	html += `<span class=\"text-slate-400 text-sm font-mono\">${log.ts || ''}</span>`;
	html += '</div>';
	Object.entries(log).forEach(([k, v]) => { html += `<div class=\"flex flex-col gap-1\"><span class=\"text-fuchsia-400 font-medium\">${k}:</span><div class=\"pl-4 ${k === 'stack' ? 'bg-slate-900/50 rounded p-2' : ''}\">${formatValue(k, v)}</div></div>`; });
	html += '</div>'; return html;
}

function formatContainerForDisplay(container) {
	const formatValue = (key, value) => {
		if (value === null) return '<span class="text-slate-500">null</span>';
		if (value === undefined) return '<span class="text-slate-500">undefined</span>';
		if (value === '') return '<span class="text-slate-500">""</span>';
		if (typeof value === 'string') {
			if (key === 'created_at' || key === 'finished_at') {
				try { const d = new Date(value); return `<span class=\"text-cyan-300\">"${esc(value)}"</span> <span class=\"text-slate-400 text-xs\">(${d.toLocaleString()})</span>`; } catch { return `<span class=\"text-cyan-300\">"${esc(value)}"</span>`; }
			} else if (key === 'error_message' && value) {
				return `<span class=\"text-red-300\">"${esc(value)}"</span>`;
			} else if (key === 'code_executed') {
				const lines = value.split('\n').map(line => `<span class=\"text-slate-300\">${esc(line)}</span>`).join('<br>');
				return `<div class=\"bg-slate-900/50 rounded p-3 max-h-64 overflow-y-auto\"><span class=\"text-orange-300\">"</span><br>${lines}<br><span class=\"text-orange-300\">"</span></div>`;
			} else if (key === 'output') {
				const lines = value.split('\n').map(line => `<span class=\"text-green-300\">${esc(line)}</span>`).join('<br>');
				return `<div class=\"bg-slate-900/50 rounded p-3 max-h-48 overflow-y-auto\"><span class=\"text-orange-300\">"</span><br>${lines}<br><span class=\"text-orange-300\">"</span></div>`;
			}
			return `<span class=\"text-cyan-300\">"${esc(value)}"</span>`;
		}
		if (typeof value === 'number') {
			if (key === 'execution_time') {
				const ms = Math.round(value / 1e6); const sec = (value / 1e9).toFixed(3);
				return `<span class=\"text-yellow-400\">${value}</span> <span class=\"text-slate-400 text-xs\">(${ms}ms / ${sec}s)</span>`;
			}
			return `<span class=\"text-yellow-400\">${value}</span>`;
		}
		if (typeof value === 'boolean') return `<span class=\"text-purple-400\">${value}</span>`;
		return `<span class=\"text-slate-300\">${JSON.stringify(value)}</span>`;
	};
	let html = '<div class="space-y-4">';
	const statusColor = container.error_message ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-green-500/20 text-green-300 border-green-500/30';
	const statusText = container.error_message ? 'FAILED' : 'SUCCESS';
	html += `<div class=\"flex items-center gap-3 pb-3 border-b border-slate-700\"><span class=\"px-2 py-1 rounded text-xs font-semibold border ${statusColor}\">${statusText}</span><span class=\"text-slate-400 text-sm font-mono\">${container.container_id || ''}</span></div>`;
	const fieldOrder = ['container_id', 'created_at', 'finished_at', 'execution_time', 'error_message', 'code_executed', 'output'];
	fieldOrder.forEach(k => { if (container.hasOwnProperty(k)) { const v = container[k]; html += `<div class=\"flex flex-col gap-1\"><span class=\"text-fuchsia-400 font-medium\">${k}:</span><div class=\"pl-4\">${formatValue(k, v)}</div></div>`; } });
	Object.entries(container).forEach(([k, v]) => { if (!fieldOrder.includes(k)) { html += `<div class=\"flex flex-col gap-1\"><span class=\"text-fuchsia-400 font-medium\">${k}:</span><div class=\"pl-4\">${formatValue(k, v)}</div></div>`; } });
	html += '</div>'; return html;
}

function showLogDetails(i) { if (!window.currentLogs || !window.currentLogs[i]) return; document.getElementById('logDetails').innerHTML = formatLogForDisplay(window.currentLogs[i]); document.getElementById('logModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeLogModal() { document.getElementById('logModal').classList.add('hidden'); document.body.style.overflow = ''; }
function showContainerDetails(i) { if (!window.currentContainers || !window.currentContainers[i]) return; document.getElementById('containerDetails').innerHTML = formatContainerForDisplay(window.currentContainers[i]); document.getElementById('containerModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeContainerModal() { document.getElementById('containerModal').classList.add('hidden'); document.body.style.overflow = ''; }

// Expose for inline handlers in generated HTML rows
window.showLogDetails = showLogDetails;
window.showContainerDetails = showContainerDetails;

function switchTo(view) {
	currentView = view;
	if (view === 'status') {
		viewStatus.classList.remove('hidden');
		viewLogs.classList.add('hidden');
	} else {
		viewLogs.classList.remove('hidden');
		viewStatus.classList.add('hidden');
	}
	startUnifiedAutoRefresh();
}

function initAdmin() {
	btnStatus = document.getElementById('btnStatus');
	btnLogs = document.getElementById('btnLogs');
	viewStatus = document.getElementById('view-status');
	viewLogs = document.getElementById('view-logs');
	refreshStatus = document.getElementById('refreshStatus');

	btnStatus.addEventListener('click', () => { activate(btnStatus); switchTo('status'); });
	btnLogs.addEventListener('click', () => { activate(btnLogs); switchTo('logs'); });

	document.getElementById('limit').addEventListener('change', loadHistory);
	document.getElementById('logsLimit').addEventListener('change', loadLogs);
	document.getElementById('logLevel').addEventListener('change', loadLogs);

	document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLogModal(); closeContainerModal(); } });
	document.getElementById('logModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeLogModal(); });
	document.getElementById('containerModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeContainerModal(); });

	// Activate default
	activate(btnStatus);
	startUnifiedAutoRefresh();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopUnifiedAutoRefresh(); else startUnifiedAutoRefresh(); });

document.addEventListener('DOMContentLoaded', initAdmin);

// --- URL PARAM SYNC ---
function setQueryParam(key, value) {
	const url = new URL(window.location.href);
	if (value === undefined || value === null || value === '') url.searchParams.delete(key); else url.searchParams.set(key, value);
	window.history.replaceState({}, '', url.toString());
}
function getQueryParam(key) {
	const url = new URL(window.location.href); return url.searchParams.get(key);
}

// Extend init to read params AFTER DOMContentLoaded executed primary init
document.addEventListener('DOMContentLoaded', () => {
	// read params
	const qView = getQueryParam('view');
	const qLevel = getQueryParam('level');
	const qLogsLimit = getQueryParam('logsLimit');
	if (qLogsLimit && !isNaN(parseInt(qLogsLimit))) {
		const el = document.getElementById('logsLimit'); if (el) { el.value = parseInt(qLogsLimit); }
	}
	if (qLevel) {
		const el = document.getElementById('logLevel'); if (el) { el.value = qLevel; }
	}
	if (qView === 'logs') {
		// switch to logs view respecting existing start logic
		activate(btnLogs); currentView = 'logs'; viewLogs.classList.remove('hidden'); viewStatus.classList.add('hidden'); unifiedRefresh();
	}
	// attach change listeners to update URL
	const levelEl = document.getElementById('logLevel');
	if (levelEl) { levelEl.addEventListener('change', () => { setQueryParam('level', levelEl.value); }); }
	const limitEl = document.getElementById('logsLimit');
	if (limitEl) { limitEl.addEventListener('change', () => { setQueryParam('logsLimit', limitEl.value); }); }
	const historyLimitEl = document.getElementById('limit');
	if (historyLimitEl) { historyLimitEl.addEventListener('change', () => { setQueryParam('historyLimit', historyLimitEl.value); }); }
	// view buttons already defined; hook to update param
	if (btnStatus) { btnStatus.addEventListener('click', () => setQueryParam('view', 'status')); }
	if (btnLogs) { btnLogs.addEventListener('click', () => setQueryParam('view', 'logs')); }
	// initial param reflect
	setQueryParam('view', currentView);
	setQueryParam('level', document.getElementById('logLevel')?.value || '');
	setQueryParam('logsLimit', document.getElementById('logsLimit')?.value || '');
});
