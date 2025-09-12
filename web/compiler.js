document.getElementById('current-year').textContent = new Date().getFullYear();

// Default sample code (fallback)
const defaultCode = `include("liblang/strings.lang")\n\nfunc main() {\n    print("Hello, World!\\n");\n    return;\n}\n`;

let activeExampleKey = null; // track which example loaded

// Unique examples for compiler page
const compilerPageExamples = [
	{ key: 'hello', title: 'Hello World', code: defaultCode },
	{
		key: 'print-hex', title: 'Print Hex', code: `include("liblang/strings.lang")
func main(){
	dq a = 0x1234abcd;
	printHex(a);
	return;
}` },
	{
		key: 'threads-demo', title: 'Threads Demo', code: `include("liblang/min.lang")
include("liblang/mem.lang")
include("liblang/strings.lang")
include("liblang/threads.lang")
include("liblang/net.lang")

func worker1(dq p1, dd p2, dw p3, db p4){
	print("worker1(): p1 p2 p3 p4\\n");
	printHex(p1);
	printHex(p2);
	printHex(p3);
	printHex(p4);
	ptr printStr<db> = "/";  // '0' - '1' = '/'
	for dq i = 0; i < 2; i++; {
		print("worker1: i=");
		printStr[0] = printStr[0] + 1;
		print(printStr);
		print("\\n");
		nanosleep(1, 0);
	}
	return;
}

func worker2(){
	print("worker2(): no params\\n");
	ptr printStr<db> = "/";  // '0' - '1' = '/'
	for dq i = 0; i < 4; i++; {
		print("worker2: i=");
		printStr[0] = printStr[0] + 1;
		print(printStr);
		print("\\n");
		nanosleep(1, 0);
	}
	return;
}

func main(){
	dq p1 = 0x1111111122222222;
	dq p2 = 0x3333333344444444;
	dd p3 = 0x5555555566666666;
	dw p4 = 0x6666666677777777;

	dq stack_size = 8 * 4096;
	dq t1_id; dq stack_t1 = mmap(8);
	dq t2_id; dq stack_t2 = mmap(8);

	//creating thread 1 with 4 params
	addThreadVariable(stack_t1, stack_size, p1, 0);
	addThreadVariable(stack_t1, stack_size, p2, 1);
	addThreadVariable(stack_t1, stack_size, p3, 2);
	addThreadVariable(stack_t1, stack_size, p4, 3);

	createThreadIds(&worker1, stack_t1, stack_size, &t1_id, 0, 4);

	//creating thread 2 with no params
	createThreadIds(&worker2, stack_t2, stack_size, &t2_id, 0, 0);

	print("Threads created, joining...\\n");
	threadJoin(&t1_id);
	print("Joined thread 1\\n");
	threadJoin(&t2_id);
	print("Joined thread 2\\n");

	freeMmap(stack_t1, 8);
	freeMmap(stack_t2, 8);
	print("Finished all threads\\n");
	return;
}` },

	{
		key: 'loop', title: 'Loop', code: `include("liblang/strings.lang")
func main(){
	for dq i = 0; i < 5; i++; {
		print("i=");
		printHex(i);
	}
	return;
}` },
	{
		key: 'struct', title: 'Struct', code: `include("liblang/strings.lang")
struct Point { dq x; dq y; }
func main(){
	ptr p<Point> = Point{10,20};
	printHex(p.x);
	printHex(p.y);
	return;
}` }
	,
	{
		key: 'kernel-info', title: 'Kernel Info', code: `include("liblang/strings.lang")
struct utsname {
	db domainname db<65>;
	db machine db<65>;  
	db version db<65>; 
	db release db<65>;
	db nodename db<65>; 
	db sysname db<65>;   
}

func main(){
	//pointer to memory for struct utsname
	ptr structName<utsname> = utsname{};

	asm(mov64_r_i, rax, 63);   //syscall: uname
	loadReg(rdi, structName);  //loads rdi with structName value
	asm(syscall);

	print(&structName.sysname);
	print("\\n");
	print(&structName.nodename);
	print("\\n");
	print(&structName.release);
	print("\\n");
	print(&structName.version);
	print("\\n");
	print(&structName.machine);
	print("\\n");
	print(&structName.domainname);
	return;
}` }
	,
	{
		key: 'tcp-connect', title: 'TCP Connect', code: `include("liblang/min.lang")
include("liblang/mem.lang")
include("liblang/strings.lang")
include("liblang/threads.lang")
include("liblang/net.lang")

//only works running locally, this is currently not possible in an online compiler
func main(){
	dq sock = sys_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if sock < 0 { print("socket() failed\\n"); return; }

    dq addr<sockaddr_in> = sockaddr_in{};
    addr.family = AF_INET;
    addr.port = htons(53);
    addr.addr = htonl(0x08080808); // 8.8.8.8

    print("Attempt connect...\\n");
    dq r = sys_connect(sock, addr, 16);
    if r < 0 { print("connect() failed, this compiles in a total isolation environment, does not work in an online compiler\\n"); return; }
    print("connected\\n");

    sys_send(sock, "Write your message:\\n", 20, MSG_NOSIGNAL);
	//loop reading from socket and printing to stdout
    dq buf = db<512>;
    while 1 {
        memset(buf, 512, 0);
        dq rr = sys_read(sock, buf, 512);
        if rr == 0 { print("peer closed\\n"); break; }
        if rr < 0 { print("read failed\\n"); break; }
        if rr > 0 { print(buf); }

        if strcmp(buf, "exit\\n") {
            print("Exiting on 'exit' command\\n");
            break;
        }
    }

    sys_close(sock);
	return;
}` }
];

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
	if (!list) return;
	list.innerHTML = '';
	compilerPageExamples.forEach(ex => {
		const li = document.createElement('li');
		li.className = 'group px-3 py-2 cursor-pointer hover:bg-slate-800/60 transition-colors flex flex-col gap-0.5';
		li.setAttribute('data-title', ex.title.toLowerCase());
		li.innerHTML = `<div class="flex items-center justify-between"><span class="font-medium text-slate-200">${ex.title}</span><button class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-400 group-hover:border-fuchsia-600/40 group-hover:text-fuchsia-300 group-hover:bg-fuchsia-600/10">Load</button></div><div class="text-[10px] text-slate-500 truncate font-mono">${escapeSnippet(ex.code)}</div>`;
		li.addEventListener('click', () => loadExample(ex.key));
		list.appendChild(li);
	});
}

function escapeSnippet(code) {
	return code.replace(/\n/g, ' ').replace(/</g, '&lt;').slice(0, 70) + (code.length > 70 ? '…' : '');
}

function loadExample(key) {
	const ex = compilerPageExamples.find(e => e.key === key);
	if (!ex) return;
	if (window.editor) {
		window.editor.setValue(ex.code.trim() + '\n');
		activeExampleKey = key;
		const tag = document.getElementById('activeExampleTag');
		if (tag) {
			tag.textContent = ex.title;
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
	// Always first clear all
	Array.from(list.children).forEach(li => {
		li.classList.remove('bg-slate-800/70', 'ring-1', 'ring-fuchsia-600/40', 'example-active');
	});
	if (!key) return; // no selection desired
	const target = compilerPageExamples.find(e => e.key === key)?.title;
	if (!target) return;
	const li = Array.from(list.children).find(li => li.querySelector('span')?.textContent === target);
	if (li) {
		li.classList.add('bg-slate-800/70', 'ring-1', 'ring-fuchsia-600/40', 'example-active');
	}
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
	highlightActiveExample(null);
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

// Focus mode toggle with floating output panel
document.addEventListener('DOMContentLoaded', () => {
	const focusBtn = document.getElementById('focusToggle');
	if (!focusBtn) return;
	let focused = false;
	focusBtn.addEventListener('click', () => {
		focused = !focused;
		const examples = document.getElementById('examplesSidebar');
		const output = document.getElementById('outputPanel');
		const grid = document.getElementById('layoutGrid');
		if (focused) {
			examples?.classList.add('hidden');
			createFloatingOutput();
			output?.classList.add('hidden');
			grid?.classList.remove('lg:grid-cols-[12rem_minmax(0,1fr)_16rem]');
			grid?.classList.add('lg:grid-cols-[1fr]');
			focusBtn.textContent = 'Unfocus';
		} else {
			examples?.classList.remove('hidden');
			removeFloatingOutput();
			output?.classList.remove('hidden');
			grid?.classList.remove('lg:grid-cols-[1fr]');
			grid?.classList.add('lg:grid-cols-[12rem_minmax(0,1fr)_16rem]');
			focusBtn.textContent = 'Focus';
		}
		if (window.editor) { setTimeout(() => window.editor.layout(), 60); }
	});

	// Inline output collapse logic
	const toggleBtn = document.getElementById('toggleOutputBody');
	const body = document.getElementById('outputBody');
	if (toggleBtn && body) {
		toggleBtn.addEventListener('click', () => {
			const hidden = body.classList.toggle('hidden');
			toggleBtn.textContent = hidden ? 'Show' : 'Hide';
		});
	}
});

function createFloatingOutput() {
	if (document.getElementById('floatingOutput')) return;
	const panel = document.createElement('div');
	panel.id = 'floatingOutput';
	panel.className = 'fixed bottom-4 right-4 w-[380px] max-h-[45vh] bg-slate-900/95 border border-slate-700/70 rounded-lg shadow-xl flex flex-col backdrop-blur-md z-50';
	panel.innerHTML = `<div class="flex items-center justify-between px-3 py-2 border-b border-slate-700/70 text-xs font-mono"><span class="text-slate-300">output</span><div class="flex items-center gap-2"><button id="floatResize" class="px-1.5 py-0.5 rounded bg-slate-800/70 hover:bg-slate-700 text-slate-400" title="Toggle size">Size</button><button id="floatClose" class="px-1.5 py-0.5 rounded bg-slate-800/70 hover:bg-fuchsia-600/30 text-slate-400" title="Close">×</button></div></div><div class="p-3 overflow-auto flex-1"><pre id="floatingOutputContent" class="text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-slate-300"></pre></div>`;
	document.body.appendChild(panel);
	syncFloatingOutput();
	document.getElementById('floatClose').onclick = () => { panel.remove(); const focusBtn = document.getElementById('focusToggle'); if (focusBtn) focusBtn.click(); };
	document.getElementById('floatResize').onclick = () => {
		if (panel.classList.contains('w-[380px]')) {
			panel.classList.remove('w-[380px]', 'max-h-[45vh]');
			panel.classList.add('w-[60vw]', 'max-h-[70vh]');
		} else {
			panel.classList.remove('w-[60vw]', 'max-h-[70vh]');
			panel.classList.add('w-[380px]', 'max-h-[45vh]');
		}
	};
}

function removeFloatingOutput() {
	const panel = document.getElementById('floatingOutput');
	if (panel) panel.remove();
}

function syncFloatingOutput() {
	const floating = document.getElementById('floatingOutputContent');
	if (!floating) return;
	floating.textContent = document.getElementById('output')?.textContent || '';
}

const outputObserver = new MutationObserver(syncFloatingOutput);
if (document.getElementById('output')) {
	outputObserver.observe(document.getElementById('output'), { childList: true, characterData: true, subtree: true });
}
