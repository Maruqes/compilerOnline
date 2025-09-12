// Shared header & footer injection for 512lang site
// Usage: include this script and call injectLayout('home'|'compiler'|'privacy'|'terms')

(function () {
	function headerTemplate(active) {
		const linkBase = [
			{ href: '/', label: 'Home', key: 'home' },
			{ href: '/compiler', label: 'Try Online', key: 'compiler' },
			{ href: 'https://github.com/Maruqes/compiler', label: 'GitHub', key: 'github', external: true },
			{ href: 'https://github.com/Maruqes/compiler/releases', label: 'Download', key: 'download', external: true, primary: true }
		];
		const navLinks = linkBase.map(l => {
			const baseCls = 'px-4 py-2 text-sm font-medium rounded-md transition-colors';
			const common = l.primary
				? `${baseCls} text-white bg-fuchsia-600 hover:bg-fuchsia-500`
				: `${baseCls} text-slate-300 hover:text-white hover:bg-slate-800/50`;
			const activeCls = (l.key === active) && !l.primary ? ' ring-1 ring-fuchsia-600/40 text-white' : '';
			const attrs = l.external ? ' target="_blank" rel="noopener noreferrer"' : '';
			return `<a href="${l.href}"${attrs} class="${common}${activeCls}">${l.label}</a>`;
		}).join('\n');
		return `
		<header class="sticky top-0 z-50 backdrop-blur-sm bg-slate-950/90 border-b border-slate-800/30">
			<div class="max-w-6xl mx-auto px-6 h-16">
				<div class="flex items-center justify-between h-full">
					<div class="flex items-center gap-3">
						<img src="https://github.com/Maruqes.png" alt="Maruqes" class="w-8 h-8 rounded-md object-cover">
						<div>
							<span class="text-lg font-bold text-white">512lang</span>
							<span class="ml-2 text-sm text-slate-400">by Maruqes</span>
						</div>
					</div>
					<nav class="flex items-center gap-2 flex-wrap">${navLinks}</nav>
				</div>
			</div>
		</header>`;
	}

	function footerTemplate() {
		return `
		<footer class="border-t border-slate-800/30 bg-slate-950/90 backdrop-blur-sm mt-16">
			<div class="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
				<div class="flex items-center gap-3">
					<img src="https://github.com/Maruqes.png" alt="Maruqes" class="w-8 h-8 rounded-md object-cover">
					<div>
						<span class="text-lg font-bold text-white">512lang</span>
						<span class="ml-2 text-sm text-slate-400">by Maruqes</span>
					</div>
				</div>
				<div class="flex items-center gap-6 text-sm text-slate-400 flex-wrap">
					<span>Zero dependencies • Direct binary emission</span>
					<span>© <span id="current-year">2025</span> 512lang • GPL-3.0</span>
					<a href="privacy.html" class="hover:text-slate-200">Privacy</a>
					<a href="terms.html" class="hover:text-slate-200">Terms</a>
					<a href="https://github.com/Maruqes/compiler/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" class="hover:text-slate-200">License</a>
				</div>
			</div>
		</footer>`;
	}

	window.injectLayout = function (active) {
		const h = document.getElementById('site-header');
		const f = document.getElementById('site-footer');
		if (h) h.innerHTML = headerTemplate(active);
		if (f) f.innerHTML = footerTemplate();
		const yearEl = document.getElementById('current-year');
		if (yearEl) yearEl.textContent = new Date().getFullYear();
	};
})();
