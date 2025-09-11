document.getElementById('current-year').textContent = new Date().getFullYear();

// Default sample code
const defaultCode = `include("liblang/strings.lang")

func main() {
    print("Hello, World!\\n");
    return;
}
`;

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
});

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
