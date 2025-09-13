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
			const baseCls = 'px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';
			const common = l.primary
				? `${baseCls} text-white bg-fuchsia-600 hover:bg-fuchsia-500`
				: `${baseCls} text-slate-300 hover:text-white hover:bg-slate-800/50`;
			// Active: subtle tinted background + text color, no persistent ring
			const activeCls = (l.key === active) && !l.primary ? ' bg-slate-800/60 text-white' : '';
			const attrs = l.external ? ' target="_blank" rel="noopener noreferrer"' : '';
			return `<a href="${l.href}"${attrs} class="${common}${activeCls}" data-nav-key="${l.key}">${l.label}</a>`;
		}).join('\n');
		return `
			<header class="sticky top-0 z-50 backdrop-blur-sm bg-slate-950/90 border-b border-slate-800/30">
				<div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between relative">
					<a href="/" class="flex items-center gap-3 pr-4 -ml-2 pl-2 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-fuchsia-600 focus:ring-offset-2 focus:ring-offset-slate-900">
						<img src="https://github.com/Maruqes.png" alt="Maruqes" class="w-8 h-8 rounded-md object-cover">
						<span class="text-lg font-bold text-white tracking-tight">512lang</span>
					</a>
					<button id="navToggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="siteNav" class="sm:hidden p-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-fuchsia-600 focus:ring-offset-2 focus:ring-offset-slate-900 transition-colors relative z-[70]">
						<svg id="navToggleIcon" class="w-6 h-6" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 6h18M3 12h18M3 18h18" />
						</svg>
					</button>
					<nav id="siteNav" class="hidden sm:flex items-center gap-2 flex-wrap absolute sm:static top-full left-0 right-0 sm:top-auto bg-slate-950/95 sm:bg-transparent border-b border-slate-800/60 sm:border-none px-4 py-4 sm:p-0 shadow-xl sm:shadow-none rounded-b-lg sm:rounded-none animate-none z-[60]">
						${navLinks}
					</nav>
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

		// Mobile nav toggle (improved reliability)
		const toggleBtn = document.getElementById('navToggle');
		const nav = document.getElementById('siteNav');
		if (toggleBtn && nav) {
			let isOpen = false;
			let lastFocused = null;
			const icon = document.getElementById('navToggleIcon');

			function setIcon(open) {
				if (!icon) return;
				icon.innerHTML = open
					? '<path d="M6 18L18 6M6 6l12 12" />'
					: '<path d="M3 6h18M3 12h18M3 18h18" />';
			}

			function lockScroll() { document.documentElement.classList.add('nav-open'); }
			function unlockScroll() { document.documentElement.classList.remove('nav-open'); }

			function openNav() {
				if (isOpen) return;
				lastFocused = document.activeElement;
				isOpen = true;
				nav.classList.remove('hidden');
				nav.classList.add('is-open');
				toggleBtn.setAttribute('aria-expanded', 'true');
				setIcon(true);
				lockScroll();
				document.addEventListener('keydown', onKey);
				document.addEventListener('click', onDocClick, { capture: true });
				// Removed auto-focus of first link to avoid unwanted persistent outline on some mobile browsers.
			}

			function closeNav() {
				if (!isOpen) return;
				isOpen = false;
				nav.classList.add('hidden');
				nav.classList.remove('is-open');
				toggleBtn.setAttribute('aria-expanded', 'false');
				setIcon(false);
				unlockScroll();
				document.removeEventListener('keydown', onKey);
				document.removeEventListener('click', onDocClick, { capture: true });
				if (lastFocused && lastFocused.focus) setTimeout(() => lastFocused.focus(), 30);
			}

			function onKey(e) {
				if (e.key === 'Escape') {
					e.preventDefault();
					closeNav();
				} else if (e.key === 'Tab' && isOpen) {
					// simple focus trap
					const focusable = nav.querySelectorAll('a, button');
					if (!focusable.length) return;
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
					else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
				}
			}

			function onDocClick(e) {
				if (!nav.contains(e.target) && e.target !== toggleBtn) {
					closeNav();
				}
			}

			function toggleNav() { isOpen ? closeNav() : openNav(); }
			toggleBtn.addEventListener('click', toggleNav);
			// Some mobile browsers dispatch touch events differently; ensure touch works even if click is swallowed
			toggleBtn.addEventListener('touchend', (e) => { e.preventDefault(); toggleNav(); }, { passive: false });

			// Support touch swipe up to close (minimal)
			let touchStartY = null;
			nav.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
			nav.addEventListener('touchmove', e => {
				if (touchStartY !== null && e.touches[0].clientY - touchStartY > 60) {
					closeNav();
					touchStartY = null;
				}
			}, { passive: true });

			window.addEventListener('resize', () => { if (window.innerWidth >= 640) closeNav(); });
		}

		// (Custom cursor removed)
	};
})();
