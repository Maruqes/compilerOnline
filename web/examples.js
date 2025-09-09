// 512lang Code Examples
// Hero carousel code samples
const heroCodeSamples = [
	{
		title: "addThreadVariable",
		code: `func threadJoin(ptr ctid_addr){
    if ctid_addr == 0 { return; }
    dq FUTEX_WAIT = 0;
    while 1 == 1 {
		dd cur = *<dd>ctid_addr;
		if cur == 0 { 
			break; 
		}
		sys_futex(ctid_addr, FUTEX_WAIT, cur, 0, 0, 0);
    }
}
`
	},
	{
		title: "getStringLen",
		code: `func getStringLen(ptr s1){
	dd res = 0;
	while s1[res] != 0 {
		res++;
	}
	return res;
}`
	},
	{
		title: "reverseString",
		code: `func memset(ptr s1, dq len, db value){
	for dq i = 0; i < len; i++; {
		s1[i] = value;
	}
	return;
}

func memcpy(ptr dest, ptr src, dq len){
	for dq i = 0; i < len; i++; {
		dest[i] = src[i];
	}
	return;
}`
	},
	{
		title: "Assembly",
		code: `func print(ptr s1){
	dd len = getStringLen(s1);

	asm(mov64_r_i, rax, 1);
	asm(mov64_r_i, rdi, 1);
	loadReg(rsi, s1);
	loadReg(rdx, len);
	asm(syscall);
	return;
}`
	}
];

const codeExamples = {
	variables: {
		title: "Variables",
		code: `func vars(){
	dq a = 10; // 8 bytes
	dd b = 5;  // 4 bytes
	dw c = 2;  // 2 bytes
	db d = 1;  // 1 byte
	ptr p = 0; // 8 byte (wrapper over dq)

	a++;
	a--;
	a+=2;
	a-=2;
	// ...

	printHex(a);
	// ...

	//negative symbol and type affirmation
	printHex(-dq(a));
	// ...

	//dq(), dd(), dw(), db() affirm type
	//db(0xffffffffffffffab) = 0xab
	return;
}
`,
		description: [
			"Scalar declarations across dq/dd/dw/db/ptr and basic arithmetic.",
			"Unary negation with explicit type affirmation for each width."
		],
		features: {
			title: "Type Sizes:",
			items: [
				"db - 1 byte",
				"dw - 2 bytes",
				"dd - 4 bytes",
				"dq - 8 bytes",
				"ptr - 8 bytes"
			]
		}
	},

	arithmetics: {
		title: "Arithmetics",
		code: `    printHex(a + b); // +-*/
	printHex(a % b); 

	
	printHex(x & y);
	printHex(x | y);
	printHex(x ^ y);

	// logical ops
	printHex(f && t);
	printHex(f || t); 

	// comparisons
	printHex(a == b); 
	printHex(a != b); 
	printHex(a <  b); 
	printHex(a <= b); 
	printHex(a >  b); 
	printHex(a >= b); 

	// shifts (amount in register)
	printHex(x << sh);
	printHex(x >> sh);
`,
		description: [
			"Arithmetic, bitwise, logical, comparisons, and shifts in one routine."
		],
		features: {
			title: "Ops:",
			items: [
				" (+  -  *  /  %)",
				" (&  |  ^)",
				" (&&  ||)",
				" (== != < <= > >=)",
				" (<< >>)"
			]
		}
	},
	structs: {
		title: "Structs & Types",
		code: `struct Struct1{
    dq a;
    dq arr dq<2>;
    dq b;
}

func structsT(){
	// Show both ways to access the "dq arr dq<2>"
	ptr s<Struct1> = Struct1{};
	s.a = 1;
	s.b = 4;

	// Method1: raw deref on field address
	*<dq>(&s.arr) = 2;
	*<dq>(&s.arr + sizeof(dq)) = 3;

	// Method2: take dq* to an array index it
	ptr s_arr<dq> = &s.arr;

	printHex(s.a);
	printHex(*<dq>(&s.arr));                 // 2
	printHex(*<dq>(&s.arr + sizeof(dq)));    // 3
	printHex(s_arr[0]);                      // 2
	printHex(s_arr[1]);                      // 3
	printHex(s.b);

	// Writes via indexing read back via raw deref
	// They are equivalent
	s_arr[0] = 20;
	s_arr[1] = 30;
	printHex(*<dq>(&s.arr));                 // 20
	printHex(*<dq>(&s.arr + sizeof(dq)));    // 30
	
	return;
}`,
		description: [
			"Struct definitions with mixed field sizes and nested/generic style references.",
			"Direct field access and instance initialization syntax."
		],
		features: {
			title: "Type Sizes:",
			items: [
				"db - 1 byte",
				"dw - 2 bytes",
				"dd - 4 bytes",
				"dq - 8 bytes",
				"ptr - 8 bytes"
			]
		}
	},

	pointers: {
		title: "Pointers & Memory",
		code: `func pointers(){
	dq a = 5;
	dd b = 6;
	dw c = 7;
	db d = 8;

	ptr aP<dq> = &a;
	ptr bP<dd> = &b;
	ptr cP<dw> = &c;
	ptr dP<db> = &d;

	// *<type>...
	*<dq>aP = 10;

	ptr aPP<dq> = &aP;
	ptr bPP<dd> = &bP;
	ptr cPP<dw> = &cP;
	ptr dPP<db> = &dP;

	printHex(*<dq>aP);
	printHex(*<dd>bP);
	printHex(*<dw>cP);
	printHex(*<db>dP);

	printHex(*<dq>*<dq>aPP);
	printHex(*<dd>*<dq>bPP);
	printHex(*<dw>*<dq>cPP);
	printHex(*<db>*<dq>dPP);

	return;
}`,
		description: [
			"Multi-level pointer declarations and dereferencing.",
			"Explicit typed pointer syntax with generic-like annotations."
		],
		features: {
			title: "Memory Operations:",
			items: [
				"Address-of & and dereference *",
				"Multiple indirection access",
				"In-place mutation via pointers"
			]
		}
	},

	assembly: {
		title: "Embedded Assembly",
		code: `struct timespec {
	dq tv_nsec;
	dq tv_sec;
}

func nanosleep(dq sec, dq nansec){
	ptr ts<timespec> = timespec{sec, nansec};

	asm(mov64_r_i, rax, 35);
	loadReg(rdi, ts); // rdi = ts
	// loadVar(varname, reg) also exists, varname = reg
	asm(mov64_r_i, rsi, 0);
	asm(syscall);
	return;
}`,
		description: [
			"Inline assembly with syscall number load and register setup.",
			"Direct system interaction via raw syscall invocation.",
			"Not all instructions are supported, check asmFunc.go for details."
		],
		features: {
			title: "Assembly Features:",
			items: [
				"Register load helpers",
				"Structured data passed to syscalls",
				"Direct syscall primitive",
				"Mixed high-level + asm code"
			]
		}
	},

	control: {
		title: "Control Flow",
		code: `func flow(){

	// ifs
	if a == 5 {
		printHex(a);
	}

	//...

	if a != 5 {
		printHex(0xff);
	} elif a == 5 {
		printHex(0xff00);
	}

	if a != 5 {
		printHex(0xff);
	} elif a == 6 {
		printHex(0xff00);
	} else {
		printHex(0xff0000);
	}

	//while
	while a > 0 {
		printHex(a);
		break;
	}

	//for
	for dq i = 0; i < 5; i++; {
		if i >= 1 {
			continue;
		}
		printHex(i);
	}

	return;
}`,
		description: [
			"Loops, conditionals, and branching constructs in one routine.",
			"Demonstrates while, for, if/elif/else, break, continue."
		],
		features: {
			title: "Control Structures:",
			items: [
				"while loops",
				"for loops",
				"if / elif / else",
				"break & continue"
			]
		}
	},

	globals: {
		title: "Globals",
		code: `global{
	dq aGlob2 = 10;
}

func globalVars(){
	printHex(aGlob);
	printHex(aGlob2);
	return;
}`,
		description: [
			"Global storage block with initialized data.",
			"Access globals directly inside functions."
		],
		features: {
			title: "Global Features:",
			items: [
				"Initialized data segment",
				"Can use multiple global{} blocks",
			]
		}
	},

	arrays: {
		title: "Arrays",
		code: `func arraysT(){
	dq arr<dq> = dq{1,2,3,4,5};
	printHex(arr);

	for dq i = 0; i < 5; i++; {
		printHex(arr[i]);
	}

	dq matrix<dq> = dq{dq{1, 2}, dq{3, 4}};
	for dq i = 0; i < 2; i++; {
		for dq j = 0; j < 2; j++; {
			printHex(matrix[i][j]);
		}
	}

	return;
}`,
		description: [
			"Linear and nested array initialization.",
			"Indexed element access within nested loops."
		],
		features: {
			title: "Array Features:",
			items: [
				"Typed array literals",
				"Nested array (matrix)",
				"Indexing operations",
				"Type-affirmed arrays",
				"Nested arrays should be same type",
			]
		}
	}
};

// Escape HTML so raw code shows correctly inside <code>
function escapeHtml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

// Function to check if code is long and needs compact display
function isLongCode(code) {
	const lines = code.split('\n').length;
	const chars = code.length;
	return lines > 25 || chars > 800;
}

// Function to create compact code display for long examples
function createCompactCodeDisplay(code, exampleKey, exampleTitle) {
	const isLong = isLongCode(code);

	if (!isLong) {
		const highlightedCode = escapeHtml(code);
		return `<pre class="p-5 rounded-lg bg-slate-900/70 ring-1 ring-slate-800 overflow-auto text-sm leading-relaxed"><code class="language-c">${highlightedCode}</code></pre>`;
	}

	// For long code, show truncated version with modal button
	const truncatedCode = code.split('\n').slice(0, 15).join('\n') + '\n\n// ... (code continues)';
	const highlightedTruncated = escapeHtml(truncatedCode);

	return `
		<div class="code-container-wrapper">
			<div class="flex items-center justify-between mb-3">
				<span class="text-xs text-slate-400 font-mono">Code Example (Truncated)</span>
				<button class="modal-expand-btn text-xs px-3 py-1 rounded-md bg-fuchsia-600/20 text-fuchsia-300 hover:bg-fuchsia-600/30 transition-colors" 
					onclick="openCodeModal('${exampleKey}', '${exampleTitle}')"
					data-full-code="${escapeHtml(code).replace(/"/g, '&quot;')}">
					Expand
				</button>
			</div>
			<div class="code-container truncated">
				<pre class="p-5 rounded-lg bg-slate-900/70 ring-1 ring-slate-800 text-sm leading-tight"><code class="language-c">${highlightedTruncated}</code></pre>
			</div>
		</div>
	`;
}

// Function to render an example
function renderExample(exampleKey) {
	const example = codeExamples[exampleKey];
	if (!example) return '';

	const codeDisplay = createCompactCodeDisplay(example.code, exampleKey, example.title);
	const descriptions = example.description.map(desc => `<p>${desc}</p>`).join('');
	const featureItems = example.features.items.map(item => `<li>• ${item}</li>`).join('');

	return `
        <div class="grid lg:grid-cols-2 gap-10 items-start">
            ${codeDisplay}
            <div class="space-y-4 text-slate-300 text-sm leading-relaxed">
                ${descriptions}
                <div class="mt-6 p-4 bg-slate-800/40 rounded-lg">
                    <h4 class="font-semibold text-fuchsia-300 mb-2">${example.features.title}</h4>
                    <ul class="space-y-1 text-xs${example.features.title.includes('Type') ? ' font-mono' : ''}">
                        ${featureItems}
                    </ul>
                </div>
            </div>
        </div>
    `;
}

// Initialize examples when DOM is loaded
function initializeExamples() {
	console.log('Initializing examples...');
	const tabContents = document.querySelectorAll('.tab-content');
	console.log('Found tab contents:', tabContents.length);

	tabContents.forEach(content => {
		const exampleKey = content.id;
		console.log('Processing tab:', exampleKey);
		if (codeExamples[exampleKey]) {
			const renderedContent = renderExample(exampleKey);
			content.innerHTML = renderedContent;
			console.log('Rendered example for:', exampleKey, 'Content length:', renderedContent.length);
		} else {
			console.log('No example found for:', exampleKey);
			content.innerHTML = '<p style="color: red;">Error: No example data found for ' + exampleKey + '</p>';
		}
	});

	// Add expand/collapse functionality for long code examples
	setTimeout(() => {
		initializeCodeExpansion();
		if (window.Prism) {
			console.log('Running Prism.highlightAll()');
			Prism.highlightAll();
		} else {
			console.log('Prism not available yet');
		}
	}, 100);
}

// Modal functionality for code examples
function openCodeModal(exampleKey, title) {
	const example = codeExamples[exampleKey];
	if (!example) return;

	// Remove existing modal if any
	const existingModal = document.getElementById('code-modal');
	if (existingModal) {
		existingModal.remove();
	}

	// Create modal
	const modal = document.createElement('div');
	modal.id = 'code-modal';
	modal.className = 'code-modal';
	modal.innerHTML = `
		<div class="code-modal-backdrop" onclick="closeCodeModal()"></div>
		<div class="code-modal-content">
			<div class="code-modal-header">
				<h3 class="code-modal-title">${title}</h3>
				<button class="code-modal-close" onclick="closeCodeModal()" aria-label="Close modal">
					<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
			<div class="code-modal-body">
				<pre class="code-modal-pre"><code class="language-c" id="modal-code-${exampleKey}">${escapeHtml(example.code)}</code></pre>
			</div>
		</div>
	`;

	document.body.appendChild(modal);

	// Trigger syntax highlighting for the modal content
	setTimeout(() => {
		if (window.Prism) {
			Prism.highlightElement(document.getElementById(`modal-code-${exampleKey}`));
		}
	}, 50);

	// Prevent body scroll
	document.body.style.overflow = 'hidden';

	// Focus trap and escape key
	modal.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			closeCodeModal();
		}
	});

	// Focus the modal
	modal.focus();
}

function closeCodeModal() {
	const modal = document.getElementById('code-modal');
	if (modal) {
		modal.remove();
		document.body.style.overflow = '';
	}
}

// Initialize code expansion functionality (now just for cleanup)
function initializeCodeExpansion() {
	// No longer needed - using onclick handlers in HTML
	console.log('Modal functionality ready');
}

// Make functions globally available
window.initializeExamples = initializeExamples;
window.codeExamples = codeExamples;
window.heroCodeSamples = heroCodeSamples;
window.openCodeModal = openCodeModal;
window.closeCodeModal = closeCodeModal;

// Auto-initialize when script loads
console.log('examples.js loaded, attempting auto-initialization...');
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		console.log('DOMContentLoaded from examples.js');
		initializeExamples();
		initializeHeroCarousel();
	});
} else {
	// DOM already loaded
	console.log('DOM already ready, initializing immediately');
	initializeExamples();
	initializeHeroCarousel();
}

// Hero code carousel functionality
let currentSlide = 0;
let carouselTimer = null;
const CAROUSEL_INTERVAL = 4000; // 4 seconds

function updateHeroCode(index) {
	const heroCodeElement = document.getElementById('hero-code');
	const heroDots = document.querySelectorAll('.hero-dot');

	console.log('Updating hero code, index:', index);
	console.log('Hero code samples available:', heroCodeSamples.length);

	if (!heroCodeElement || !heroDots.length) return;

	// Update code display
	heroCodeElement.textContent = heroCodeSamples[index].code;

	// Add syntax highlighting class
	heroCodeElement.className = 'text-sm text-slate-300 font-mono leading-relaxed language-c';

	// Trigger syntax highlighting if Prism is available
	setTimeout(() => {
		if (window.Prism) {
			Prism.highlightElement(heroCodeElement);
		}
	}, 50);

	// Update dots
	heroDots.forEach((dot, i) => {
		if (i === index) {
			dot.classList.add('active');
			dot.classList.remove('bg-slate-600');
			dot.classList.add('bg-fuchsia-500');
		} else {
			dot.classList.remove('active');
			dot.classList.remove('bg-fuchsia-500');
			dot.classList.add('bg-slate-600');
		}
	});
}

function startCarouselTimer() {
	// Clear existing timer
	if (carouselTimer) {
		clearInterval(carouselTimer);
	}

	// Start new timer
	carouselTimer = setInterval(() => {
		currentSlide = (currentSlide + 1) % heroCodeSamples.length;
		updateHeroCode(currentSlide);
	}, CAROUSEL_INTERVAL);
}

function initializeHeroCarousel() {
	console.log('Initializing hero carousel...');
	const heroCodeElement = document.getElementById('hero-code');
	const heroDots = document.querySelectorAll('.hero-dot');

	console.log('Hero code element:', heroCodeElement);
	console.log('Hero dots:', heroDots.length);

	if (!heroCodeElement) {
		console.log('Hero code element not found');
		return;
	}

	if (!heroDots.length) {
		console.log('Hero dots not found');
		return;
	}

	if (!heroCodeSamples || heroCodeSamples.length === 0) {
		console.log('No hero code samples available');
		heroCodeElement.textContent = 'Error: No code samples loaded';
		return;
	}

	// Initialize first slide
	updateHeroCode(0);

	// Add click handlers to dots
	heroDots.forEach((dot, index) => {
		dot.addEventListener('click', () => {
			currentSlide = index;
			updateHeroCode(index);
			// Restart timer when user manually changes slide
			startCarouselTimer();
		});
	});

	// Start auto-advance timer
	startCarouselTimer();
}

// Make functions globally available
window.initializeHeroCarousel = initializeHeroCarousel;
