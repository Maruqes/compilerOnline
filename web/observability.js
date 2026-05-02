const REFRESH_MS = 30000;
let activeRange = '1d';
let latestData = null;
let refreshTimer = null;

function authHeaders() {
	const t = sessionStorage.getItem('admintoken');
	return t ? { 'Authorization': 'Bearer ' + t } : {};
}

function esc(s) {
	return (s || '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtNumber(n) {
	return new Intl.NumberFormat().format(n || 0);
}

function fmtTime(s) {
	if (!s) return '-';
	const d = new Date(s);
	if (Number.isNaN(d.getTime())) return esc(s);
	return d.toLocaleString();
}

function fmtDuration(ms) {
	if (!ms) return '0ms';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function setRangeButtons() {
	document.querySelectorAll('.range-btn').forEach(btn => {
		const active = btn.dataset.range === activeRange;
		btn.className = 'range-btn px-4 py-2 rounded-lg text-sm font-semibold transition-all ' + (
			active
				? 'bg-fuchsia-600 text-white shadow shadow-fuchsia-600/30'
				: 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700/70'
		);
	});
}

function defaultCustomValues() {
	const to = new Date();
	const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
	document.getElementById('customFrom').value = toLocalInputValue(from);
	document.getElementById('customTo').value = toLocalInputValue(to);
}

function toLocalInputValue(date) {
	const pad = n => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildURL() {
	const params = new URLSearchParams();
	params.set('range', activeRange);
	if (activeRange === 'custom') {
		const from = document.getElementById('customFrom').value;
		const to = document.getElementById('customTo').value;
		if (from) params.set('from', new Date(from).toISOString());
		if (to) params.set('to', new Date(to).toISOString());
	}
	return `/observability?${params.toString()}`;
}

async function loadObservability() {
	document.getElementById('refreshStatus').textContent = 'Refreshing...';
	try {
		const r = await fetch(buildURL(), { headers: { 'Accept': 'application/json', ...authHeaders() } });
		if (r.status === 401) {
			window.location = '/adminLogin';
			return;
		}
		if (!r.ok) throw new Error(await r.text());
		latestData = await r.json();
		render(latestData);
		document.getElementById('refreshStatus').textContent = `Auto-refresh every ${REFRESH_MS / 1000}s`;
	} catch (e) {
		document.getElementById('refreshStatus').textContent = `Error: ${e.message}`;
	}
}

function render(data) {
	document.getElementById('uniqueIPCount').textContent = fmtNumber(data.unique_ip_count);
	document.getElementById('totalCompilations').textContent = fmtNumber(data.total_compilations);
	document.getElementById('successError').textContent = `${fmtNumber(data.success_count)} / ${fmtNumber(data.error_count)}`;
	document.getElementById('avgCompileTime').textContent = fmtDuration(data.average_compile_time_ms);
	document.getElementById('failedLogins').textContent = fmtNumber(data.failed_admin_logins?.total);
	document.getElementById('rangeMeta').textContent = `${fmtTime(data.from)} - ${fmtTime(data.to)}`;

	const total = (data.success_count || 0) + (data.error_count || 0);
	const successPct = total ? Math.round((data.success_count || 0) * 100 / total) : 0;
	const errorPct = total ? Math.round((data.error_count || 0) * 100 / total) : 0;
	document.getElementById('successRate').textContent = `${successPct}%`;
	document.getElementById('errorRate').textContent = `${errorPct}%`;
	document.getElementById('successBar').style.width = `${successPct}%`;
	document.getElementById('errorBar').style.width = `${errorPct}%`;

	renderIPTable('uniqueIPsBody', data.unique_ips || [], 'Compilations');
	renderIPTable('failedIPsBody', data.failed_admin_logins?.ips || [], 'Failures');
	renderRecentFailures(data.failed_admin_logins?.recent || []);
	drawHourlyChart(data.hourly_compilations || []);
}

function renderIPTable(id, rows) {
	const body = document.getElementById(id);
	if (!rows.length) {
		body.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-slate-500">No data</td></tr>';
		return;
	}
	body.innerHTML = rows.map(row => `<tr class="hover:bg-slate-800/40">
		<td class="px-4 py-2 text-cyan-300">${esc(row.ip)}</td>
		<td class="px-4 py-2">${fmtNumber(row.count)}</td>
		<td class="px-4 py-2 whitespace-nowrap">${fmtTime(row.first_seen)}</td>
		<td class="px-4 py-2 whitespace-nowrap">${fmtTime(row.last_seen)}</td>
	</tr>`).join('');
}

function renderRecentFailures(rows) {
	const body = document.getElementById('failedRecentBody');
	if (!rows.length) {
		body.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-slate-500">No failed login requests</td></tr>';
		return;
	}
	body.innerHTML = rows.map(row => `<tr class="hover:bg-slate-800/40 align-top">
		<td class="px-4 py-2 whitespace-nowrap">${fmtTime(row.occurred_at)}</td>
		<td class="px-4 py-2 text-cyan-300">${esc(row.ip)}</td>
		<td class="px-4 py-2">${esc(row.username || '-')}</td>
		<td class="px-4 py-2 text-red-300">${esc(row.reason || '-')}</td>
		<td class="px-4 py-2 max-w-[360px] truncate" title="${esc(row.user_agent || '')}">${esc(row.user_agent || '-')}</td>
	</tr>`).join('');
}

function drawHourlyChart(points) {
	const canvas = document.getElementById('hourlyChart');
	const rect = canvas.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.max(1, Math.floor(rect.width * dpr));
	canvas.height = Math.max(1, Math.floor(rect.height * dpr));
	const ctx = canvas.getContext('2d');
	ctx.scale(dpr, dpr);
	const w = rect.width;
	const h = rect.height;
	ctx.clearRect(0, 0, w, h);

	const pad = { left: 52, right: 18, top: 20, bottom: 42 };
	const plotW = Math.max(1, w - pad.left - pad.right);
	const plotH = Math.max(1, h - pad.top - pad.bottom);
	const maxY = Math.max(1, ...points.map(p => p.count || 0));

	ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
	ctx.lineWidth = 1;
	ctx.font = '12px JetBrains Mono, monospace';
	ctx.fillStyle = '#94a3b8';
	for (let i = 0; i <= 4; i++) {
		const y = pad.top + plotH - (plotH * i / 4);
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(w - pad.right, y);
		ctx.stroke();
		const label = Math.round(maxY * i / 4);
		ctx.fillText(String(label), 12, y + 4);
	}

	if (!points.length) {
		ctx.fillStyle = '#64748b';
		ctx.fillText('No data', pad.left + 12, pad.top + 28);
		return;
	}

	const xFor = i => pad.left + (points.length === 1 ? 0 : (plotW * i / (points.length - 1)));
	const yFor = count => pad.top + plotH - ((count || 0) / maxY) * plotH;

	ctx.strokeStyle = '#22d3ee';
	ctx.lineWidth = 2;
	ctx.beginPath();
	points.forEach((p, i) => {
		const x = xFor(i);
		const y = yFor(p.count);
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	});
	ctx.stroke();

	ctx.fillStyle = '#d946ef';
	points.forEach((p, i) => {
		if (!p.count) return;
		ctx.beginPath();
		ctx.arc(xFor(i), yFor(p.count), 3, 0, Math.PI * 2);
		ctx.fill();
	});

	const labelIndexes = [0, Math.floor(points.length / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
	ctx.fillStyle = '#94a3b8';
	labelIndexes.forEach(i => {
		const d = new Date(points[i].time);
		const label = d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit' });
		const x = Math.min(w - 80, Math.max(pad.left, xFor(i) - 28));
		ctx.fillText(label, x, h - 14);
	});
}

function startAutoRefresh() {
	if (refreshTimer) clearInterval(refreshTimer);
	refreshTimer = setInterval(loadObservability, REFRESH_MS);
}

function init() {
	defaultCustomValues();
	setRangeButtons();
	document.querySelectorAll('.range-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			activeRange = btn.dataset.range;
			setRangeButtons();
			loadObservability();
		});
	});
	document.getElementById('applyCustom').addEventListener('click', () => {
		activeRange = 'custom';
		setRangeButtons();
		loadObservability();
	});
	document.getElementById('refreshNow').addEventListener('click', loadObservability);
	window.addEventListener('resize', () => {
		if (latestData) drawHourlyChart(latestData.hourly_compilations || []);
	});
	loadObservability();
	startAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);
