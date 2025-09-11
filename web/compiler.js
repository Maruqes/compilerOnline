document.getElementById('current-year').textContent = new Date().getFullYear();

// Default sample code (fallback)
const defaultCode = `include("liblang/strings.lang")\n\nfunc main() {\n    print("Hello, World!\\n");\n    return;\n}\n`;

let activeExampleKey = null; // track which example loaded

// Monaco setup
const amdRequire = window.require;
amdRequire.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.47.0/min/vs' } });
amdRequire(['vs/editor/editor.main'], function () {
	// Register a simple custom language for 512lang so we get syntax highlighting
	const LANG_ID = '512lang';

	monaco.languages.register({ id: LANG_ID });

	monaco.languages.setLanguageConfiguration(LANG_ID, {
		comments: {
			lineComment: '//',
			blockComment: ['/*', '*/']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '"', close: '"', notIn: ['string'] },
			{ open: '\'', close: '\'' },
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
		],
		surroundingPairs: [
			{ open: '"', close: '"' },
			{ open: '\'', close: '\'' },
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
		],
		indentationRules: {
			increaseIndentPattern: /\{[^}"']*$/,
			decreaseIndentPattern: /^\s*\}/
		}
	});

	monaco.languages.setMonarchTokensProvider(LANG_ID, {
		defaultToken: 'source',
		tokenPostfix: '.512',

		keywords: [
			'include', 'func', 'return', 'if', 'else', 'while', 'for', 'break', 'continue', 'struct', 'enum',
			'extern', 'import', 'switch', 'case', 'default'
		],

		typeKeywords: [
			'void', 'bool', 'int', 'i32', 'i64', 'u32', 'u64', 'float', 'double', 'char', 'string'
		],

		constants: ['true', 'false', 'null', 'nil'],

		operators: [
			'=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '++', '--', '+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '+=', '-=', '*=', '/=', '%='
		],

		// C-like symbols
		symbols: /[=><!~?:&|+\-*\/\^%]+/,

		// escape sequences
		escapes: /\\(?:[abfnrtv\\"'n]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4})/,

		// The main tokenizer for our languages
		tokenizer: {
			root: [
				// identifiers and keywords
				[/[a-zA-Z_][\w]*/, {
					cases: {
						'@keywords': 'keyword',
						'@typeKeywords': 'type',
						'@constants': 'constant',
						'@default': 'identifier'
					}
				}],

				// whitespace
				{ include: '@whitespace' },

				// delimiters and operators
				[/@symbols/, {
					cases: {
						'@operators': 'operator',
						'@default': 'delimiter'
					}
				}],

				// numbers
				[/0[xX][0-9a-fA-F]+\b/, 'number.hex'],
				[/\d+\.\d*([eE][\-+]?\d+)?\b/, 'number.float'],
				[/\d+([eE][\-+]?\d+)?\b/, 'number'],

				// strings
				[/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
				[/'/, { token: 'string.quote', bracket: '@open', next: '@sstring' }],

				// delimiters
				[/[{}\[\]()]/, '@brackets'],
				[/[,;]/, 'delimiter']
			],

			// Deal with whitespace, including comments
			whitespace: [
				[/\s+/, 'white'],
				[/\/\*/, 'comment', '@comment'],
				[/\/\/+.*$/, 'comment'],
			],

			comment: [
				[/[^/*]+/, 'comment'],
				[/\*\//, 'comment', '@pop'],
				[/[/\*]/, 'comment']
			],

			string: [
				[/@escapes/, 'string.escape'],
				[/\\./, 'string.escape.invalid'],
				[/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
				[/[^\\"]+/, 'string']
			],

			sstring: [
				[/@escapes/, 'string.escape'],
				[/\\./, 'string.escape.invalid'],
				[/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
				[/[^\\']+/, 'string']
			]
		}
	});

	window.editor = monaco.editor.create(document.getElementById('editor'), {
		value: defaultCode,
		language: LANG_ID,
		theme: 'vs-dark',
		fontFamily: 'JetBrains Mono, monospace',
		fontSize: 14,
		minimap: { enabled: false },
		automaticLayout: true,
		wordWrap: 'on',
	});

	// After editor ready populate examples sidebar
	initializeExampleSidebar();
});

function initializeExampleSidebar() {
	const list = document.getElementById('examplesList');
	if (!list || !window.codeExamples) return;

	// Flatten examples object -> array
	const examples = Object.entries(window.codeExamples).map(([key, obj]) => ({ key, title: obj.title, code: obj.code }));

	// Sort alphabetically by title
	examples.sort((a, b) => a.title.localeCompare(b.title));

	list.innerHTML = '';
	for (const ex of examples) {
		const li = document.createElement('li');
		li.className = 'group px-3 py-2 cursor-pointer hover:bg-slate-800/60 transition-colors flex flex-col gap-0.5';
		li.setAttribute('data-title', ex.title.toLowerCase());
		li.innerHTML = `<div class="flex items-center justify-between"><span class="font-medium text-slate-200">${ex.title}</span><button class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-400 group-hover:border-fuchsia-600/40 group-hover:text-fuchsia-300 group-hover:bg-fuchsia-600/10">Load</button></div><div class="text-[10px] text-slate-500 truncate font-mono">${escapeSnippet(ex.code)}</div>`;
		li.addEventListener('click', () => loadExample(ex.key));
		list.appendChild(li);
	}
}

function escapeSnippet(code) {
	return code.replace(/\n/g, ' ').replace(/</g, '&lt;').slice(0, 70) + (code.length > 70 ? '…' : '');
}

function loadExample(key) {
	if (!window.codeExamples || !window.codeExamples[key]) return;
	const { code, title } = window.codeExamples[key];
	if (window.editor) {
		window.editor.setValue(code.trim() + '\n');
		activeExampleKey = key;
		const tag = document.getElementById('activeExampleTag');
		if (tag) {
			tag.textContent = title;
			tag.classList.remove('hidden');
		}
		highlightActiveExample(key);
		statusEl.textContent = 'idle';
		outputEl.textContent = '';
	}
}

function highlightActiveExample(key) {
	const list = document.getElementById('examplesList');
	if (!list) return;
	const targetTitle = window.codeExamples[key]?.title;
	Array.from(list.children).forEach(li => {
		const match = targetTitle && (li.querySelector('span')?.textContent === targetTitle);
		li.classList.toggle('bg-slate-800/70', match);
		li.classList.toggle('ring-1', match);
		li.classList.toggle('ring-fuchsia-600/40', match);
	});
}

async function compile(code) {
	const res = await fetch('/compile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ code }),
	});
	if (!res.ok) {
		const t = await res.text();
		throw new Error(t || 'compile failed');
	}
	return res.text();
}

const outputEl = document.getElementById('output');
const statusEl = document.getElementById('status');

document.getElementById('runBtn').addEventListener('click', async () => {
	try {
		statusEl.textContent = 'compiling…';
		outputEl.textContent = '';
		const code = window.editor ? window.editor.getValue() : '';
		const out = await compile(code);
		outputEl.textContent = out;
		statusEl.textContent = 'done';
	} catch (e) {
		outputEl.textContent = (e && e.message) || String(e);
		statusEl.textContent = 'error';
	}
});

document.getElementById('resetBtn').addEventListener('click', () => {
	if (window.editor) window.editor.setValue(defaultCode);
	outputEl.textContent = '';
	statusEl.textContent = 'idle';
	activeExampleKey = null;
	const tag = document.getElementById('activeExampleTag');
	if (tag) { tag.classList.add('hidden'); tag.textContent = ''; }
	highlightActiveExample('__none__');
});

// minimal custom cursor support to match site
const cursor = document.getElementById('cursor');
let mouseX = 0, mouseY = 0, cursorX = 0, cursorY = 0;
function updateCursor() {
	const diffX = mouseX - cursorX;
	const diffY = mouseY - cursorY;
	cursorX += diffX * 0.1;
	cursorY += diffY * 0.1;
	cursor.style.transform = `translate(${cursorX - 10}px, ${cursorY - 10}px)`;
	requestAnimationFrame(updateCursor);
}
document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
document.addEventListener('mouseleave', () => { cursor.style.opacity = '0'; });
document.addEventListener('mouseenter', () => { cursor.style.opacity = '0.8'; });
updateCursor();

// Expose loadExample globally for potential future deep-linking
window.loadExample = loadExample;

// Focus mode toggle to maximize editor width
document.addEventListener('DOMContentLoaded', () => {
	const focusBtn = document.getElementById('focusToggle');
	if(!focusBtn) return;
	let focused = false;
	focusBtn.addEventListener('click', () => {
		focused = !focused;
		const examples = document.getElementById('examplesSidebar');
		const output = document.getElementById('outputPanel');
		const grid = document.getElementById('layoutGrid');
		if(focused){
			examples?.classList.add('hidden');
			output?.classList.add('hidden');
			grid?.classList.remove('lg:grid-cols-[12rem_minmax(0,1fr)_16rem]');
			grid?.classList.add('lg:grid-cols-[1fr]');
			focusBtn.textContent = 'Unfocus';
		} else {
			examples?.classList.remove('hidden');
			output?.classList.remove('hidden');
			grid?.classList.remove('lg:grid-cols-[1fr]');
			grid?.classList.add('lg:grid-cols-[12rem_minmax(0,1fr)_16rem]');
			focusBtn.textContent = 'Focus';
		}
		// Trigger layout for monaco
		if(window.editor){
			setTimeout(()=>window.editor.layout(), 60);
		}
	});
});
