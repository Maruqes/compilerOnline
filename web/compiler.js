document.getElementById('current-year').textContent = new Date().getFullYear();

// Default sample code (fallback)
const defaultCode = `include("liblang/strings.lang")\n\nfunc main() {\n    print("Hello, World!\\\\n");\n    return;\n}\n`;

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
		key: 'demo1', title: 'Demo 1', code: `include("liblang/min.lang")
include("liblang/mem.lang")
include("liblang/strings.lang")
include("liblang/threads.lang")
include("liblang/net.lang")

// A simple struct with an inline fixed-size array (2 dq elements)
struct Pair {
	dq a;
	dq data dq<2>;
	dq b;
}

// Sum an array of dq values
func sum(ptr arr<dq>, dq n){
	dq total = 0;
	for dq i = 0; i < n; i++; {
		total = total + arr[i];
	}
	return total;
}


// Demonstrate pointer indirection
func increment(ptr p<dq>){
	*<dq>p = *<dq>p + 1;
	return;
}

func main(){
	print("=== Simple Feature Demo ===\\n");

	// 1. Variables and arithmetic
	dq x = 10;
	dq y = 32;
	dq z = x * y + 5; // 10*32+5 = 325
       
	print("z = ");
	dq bufNum = db<32>; // buffer for number -> string
	int_to_string(z, bufNum, 32);
	print(bufNum); print("\\n");

	// 2. Array + loop + function call (sum)
	dq numbers<dq> = dq{1,2,3,4,5};
	dq total = sum(numbers, 5);
	print("sum(numbers) = ");
	int_to_string(total, bufNum, 32);
	print(bufNum); print("\\n");

	// 3. Struct usage + inline array field writes
	ptr p<Pair> = Pair{};
	p.a = 11; p.b = 99;

    
	// write inline 2-element dq array two different ways
	*<dq>(&p.data) = 22;                         // element 0
	*<dq>(&p.data + sizeof(dq)) = 33;            // element 1
	print("Pair: a data[0] data[1] b -> \\n");
	dq tmpBuf = db<32>;
	int_to_string(p.a, tmpBuf, 32); 
	print(tmpBuf); 
	print(" ");

	int_to_string(*<dq>(&p.data), tmpBuf, 32); 
	print(tmpBuf); 
	print(" ");

	int_to_string(*<dq>(&p.data + sizeof(dq)), tmpBuf, 32); 
	print(tmpBuf); 
	print(" ");
    
	int_to_string(p.b, tmpBuf, 32); 
	print(tmpBuf); 
	print("\\n");

	// 4. Pointer indirection
	dq counter = 0;
	increment(&counter);
	increment(&counter);
	print("counter after increments = "); int_to_string(counter, bufNum, 32); print(bufNum); print("\\n");


	print("=== End Demo ===\\n");
	return;
}` },
	{
		key: 'demo2', title: 'Demo 2', code: `
include("liblang/strings.lang")

// --- Global scope -------------------------------------------------------
global{
	dq gCounter = 0;        // mutable global counter
	dq gLimit   = 10;       // loop upper bound
	dq gSum     = 0;        // accumulate values
	dq gFlag    = 1;        // used in conditionals
}

// Increment the global counter and add to sum
func tick(){
	gCounter++;
	gSum = gSum + gCounter;
	return;
}

// Show simple branching with globals
func checkState(){
	if gFlag == 0 {
		print("gFlag == 0\\n");
	}elif gFlag == 1 {
		print("gFlag == 1\\n");
	}else {
		print("gFlag other\\n");
	}
	return;
}

// Format and print a dq number with label
func printNum(ptr label, dq value){
	dq buf = db<32>;
	print(label);
	int_to_string(value, buf, 32);
	print(buf);
	print("\\n");
	return;
}

func main(){
	print("=== Globals & Loops Demo ===\\n");

	// 1. while loop using global limit
	while gCounter < gLimit {
		tick();         
		if gCounter % 2 { 
           
			continue;
		}
		printNum("even step: ", gCounter);
		if gCounter >= 6 {
			break;
		}
	}

	printNum("gCounter after while: ", gCounter);
	printNum("gSum after while: ", gSum);

	// 2. for loop to add remaining numbers up to gLimit
	for dq i = gCounter; i < gLimit; i++; {
		gSum = gSum + i;
	}
	printNum("gSum after for: ", gSum);

	// 3. Conditional state display
	checkState();
	gFlag = 0;
	checkState();
	gFlag = 7;
	checkState();

	// 4. Simple countdown with while
	dq n = 5;
	print("countdown: \\n");
	while n > 0 {
		printNum("n = ", n);
		n--;
	}

	print("Done.\\n");
	return;
}` },
	{
		key: 'demo3', title: 'Demo 3', code: `include("liblang/min.lang")
include("liblang/mem.lang")
include("liblang/strings.lang")

// --- Section 1: Arrays --------------------------------------------------
func arrayBasics(){
	dq nums<dq> = dq{10,20,30,40};
	dq total = 0;
	for dq i = 0; i < 4; i++; { 
		total = total + nums[i];
	}
	dq buf = db<32>;
	int_to_string(total, buf, 32);
	print("array sum = ");
	print(buf);
	print("\\n");

	// Modify via pointer view
	ptr p<dq> = nums; // base pointer
	p[2] = 333; // change third element
	int_to_string(p[2], buf, 32);
	print("nums[2] now = ");
	print(buf);
	print("\\n");
	return;
}

// --- Section 2: Multi-level pointers ------------------------------------
func pointerLevels(){
	dq value = 5;
	ptr p1<dq> = &value;
	ptr p2<dq> = &p1;
	ptr p3<dq> = &p2;

	*<dq>p1 = *<dq>p1 + 10;      // value = 15
	*<dq>*<dq>p2 = *<dq>*<dq>p2 + 5; // value = 20
	*<dq>*<dq>*<dq>p3 = 42;         // value = 42

	dq buf = db<32>;
	int_to_string(value, buf, 32);
	print("value(final) = ");
	print(buf);
	print("\\n");
	return;
}

// --- Section 3: Pointer arithmetic & raw deref --------------------------
func pointerArithmetic(){
	dq arr<dq> = dq{1,2,3,4};
	ptr base<dq> = arr;

	// Show raw deref using *<dq>(address + offset)
	dq first = *<dq>base;                      // arr[0]
	dq second = *<dq>(base + sizeof(dq));      // arr[1]
	dq third = base[2];                        // arr[2]

	dq buf = db<32>;
	int_to_string(first + second + third, buf, 32);
	print("first+second+third = ");
	print(buf);
	print("\\n");

	// Overwrite arr[1] via raw deref and show via indexing
	*<dq>(base + sizeof(dq)) = 999;
	int_to_string(arr[1], buf, 32);
	print("arr[1] now = ");
	print(buf);
	print("\\n");
	return;
}

// --- Section 4: Embedded assembly (syscall write) -----------------------
// Demonstrates manual syscall invocation: write(1, msg, len)
// Using: rax=1 (SYS_write) rdi=1 (fd=stdout) rsi=buf rdx=len then syscall
func asmWriteDemo(){
	ptr msg = "[asm] hello via raw syscall\\n";
	dq len = getStringLen(msg);

	// Equivalent to print(), but done manually.
	asm(mov64_r_i, rax, 1);      // SYS_write
	asm(mov64_r_i, rdi, 1);      // fd = stdout
	loadReg(rsi, msg);           // buf
	loadReg(rdx, len);           // len
	asm(syscall);
	return;
}

// --- Section 5: Inline buffer + ascii pattern via pointer walk ----------
func fillPattern(){
	dq N = 16;
	dq buf = db<32>; // bigger than N for terminator
	memset(buf, 32, 0);
	ptr b<db> = buf;

	for dq i = 0; i < N; i++; {
		b[i] = 'A' + i;
	}
	b[N] = '\\n';
	b[N+1] = 0;
	print("pattern: ");
	print(b);
	return;
}

func main(){
	print("=== Demo 3: pointers, arrays, asm ===\\n");
	arrayBasics();
	pointerLevels();
	pointerArithmetic();
	asmWriteDemo();
	fillPattern();
	print("=== End Demo 3 ===\\n");
	return;
}` },
	{
		key: 'demo4', title: 'Demo 4', code: `include("liblang/min.lang")
include("liblang/mem.lang")
include("liblang/strings.lang")
include("liblang/threads.lang")
include("liblang/net.lang")

// ---------------- Globals ----------------
global{
	dq gTicks = 0;
	dq gTotal = 0;
	dq gThreadDone = 0;
}

// ---------------- Structs ----------------
struct Inner { dq a; dq b; }
struct Complex {
	dq id;
	dq values dq<4>;   // inline array
	dq count;
	dq inners Inner<2>; // array of 2 Inner structs
}

// Init Complex instance
func initComplex(ptr cPtr, dq ident){
	ptr c<Complex> = cPtr;
	c.id = ident;
	c.count = 4;
	// write inline array via raw deref
	*<dq>(&c.values) = 10;
	*<dq>(&c.values + sizeof(dq)) = 20;
	*<dq>(&c.values + (2 * sizeof(dq))) = 30;
	*<dq>(&c.values + (3 * sizeof(dq))) = 40;
	// inners
	ptr i0<Inner> = &c.inners;
	ptr i1<Inner> = &c.inners + sizeof(Inner);
	i0.a = 1; i0.b = 2;
	i1.a = 3; i1.b = 4;
	return;
}

// Sum of all numeric fields for demonstration
func complexSum(ptr cPtr){
	ptr c<Complex> = cPtr;
	dq s = c.id + c.count;
	ptr vals<dq> = &c.values;
	for dq i = 0; i < 4; i++; { s = s + vals[i]; }
	ptr i0<Inner> = &c.inners;
	ptr i1<Inner> = &c.inners + sizeof(Inner);
	s = s + i0.a + i0.b + i1.a + i1.b;
	return s;
}

// ---------------- Inline asm example (getpid) ----------------
// Demonstrates invoking getpid (syscall 39) manually and returning pid.
func getPidAsm(){
	dq pid; 
	asm(mov64_r_i, rax, 39); // SYS_getpid
	asm(syscall);
	loadVar(pid, rax); // syscall result in rax
	return pid;
}

// ---------------- Threads ----------------
func workerAdd(dq base){
	// simple workload
	for dq i = 0; i < 5; i++; {
		gTotal = gTotal + base + i;
		gTicks++;
		nanosleep(0, 2000000); // 2ms
	}
	gThreadDone = 1;
	return;
}

// ---------------- Heap / brk demo ----------------
func heapDemo(){
	dq N = 64;
	ptr mem = brk(N);
	if mem == -1 { print("brk failed\\n"); return; }
	memset(mem, N, 0);
	// Lay out mixed types at offsets
	*<db>(mem + 0) = 'Z';
	*<dw>(mem + 2) = 0xBEEF;
	*<dd>(mem + 8) = 0x11223344;
	*<dq>(mem + 16) = 0xAABBCCDDEEFF0011;
	print("*<db>(mem + 0) -> ");printHex(*<db>(mem+0));
	print("*<dw>(mem + 2) -> ");printHex(*<dw>(mem+2));
	print("*<dd>(mem + 8) -> ");printHex(*<dd>(mem+8));
	print("*<dq>(mem + 16) -> ");printHex(*<dq>(mem+16));
	freeBrk(mem);
	return;
}

// ---------------- Network (optional) ----------------
func tryConnect(){
	dq sock = sys_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if sock < 0 { print("socket fail (ok)\\n"); return; }
	dq addr<sockaddr_in> = sockaddr_in{};
	addr.family = AF_INET; addr.port = htons(65000); addr.addr = htonl(0x7F000001); // 127.0.0.1
	dq r = sys_connect(sock, addr, 16);
	if r < 0 { print("connect fail (ok)\\n"); sys_close(sock); return; }
	print("connected (unexpected)\\n");
	sys_close(sock);
	return;
}

// ---------------- Raw syscall write demo ----------------
func rawWrite(ptr msg){
	dq len = getStringLen(msg);
	asm(mov64_r_i, rax, 1);
	asm(mov64_r_i, rdi, 1);
	loadReg(rsi, msg);
	loadReg(rdx, len);
	asm(syscall);
	return;
}

// ---------------- Arg echo ----------------
func echoArgs(dq argc, dq rbpSave){
	ptr args<dq> = getArgsPtr(rbpSave);
	for dq i = 0; i < argc; i++; {
		print("arg[");
		dq numBuf = db<16>; int_to_string(i, numBuf, 16); print(numBuf); print("] = ");
		print(args[i]);
		print("\\n");
	}
	return;
}

func main(dq argc){
	print("=== Advanced Showcase ===\\n");

	// Save rbp for args
	dq rbpVal;
	loadVar(rbpVal, rbp);
	echoArgs(argc, rbpVal);

	// Struct + nested usage
	ptr c<Complex> = Complex{};
	initComplex(c, 99);
	dq sum = complexSum(c);
	dq buf = db<32>;
	int_to_string(sum, buf, 32);
	print("complexSum = ");
	print(buf);
	print("\\n");

	// getpid via inline asm
	dq pid = getPidAsm();
	int_to_string(pid, buf, 32);
	print("pid = ");
	print(buf);
	print("\\n");

	heapDemo();

	// Thread demo (create one worker)
	dq stack_size = 6 * 4096; //each mmap page is 4096 bytes
	dq stack1 = mmap(6);
	dq t1_id = 0;
	if stack1 != -1 {
		// base param 100
		addThreadVariable(stack1, stack_size, 100, 0);
		createThreadIds(&workerAdd, stack1, stack_size, &t1_id, 0, 1);
		//thread with workerAdd(100)
	} else {
		print("mmap stack fail (skip thread)\\n");
	}

	// Poll until thread done (rudimentary join substitute)
	dq spins = 0;
	while gThreadDone == 0{
		spins++;
	}
	print("thread finished with spins = ");
	printHex(spins);

	int_to_string(gTotal, buf, 32);
	print("gTotal = ");
	print(buf);
	print("\\n");

	// Network attempt (non-fatal)
	tryConnect();

	// Raw write + string ops
	ptr demo = "Reversible line!\\n";
	rawWrite(demo);
	reverseString(demo);
	print("reversed: ");
	print(demo);
	print("\\n");

	// Pointer arithmetic quick sample
	dq small<dq> = dq{5,6,7};
	ptr ps<dq> = small;
	*<dq>(ps + sizeof(dq)) = 66;
	int_to_string(small[1], buf, 32);
	print("small[1] = ");
	print(buf);
	print("\\n");

	print("=== End Showcase ===\\n");
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
