import { navigate as astroNavigate } from 'astro:transitions/client';

/**
 * 挂载一个交互式 Kali 风格终端。
 * 首页全屏终端与博客页底部终端条共用同一套逻辑。
 *
 * @param {HTMLElement} root    终端容器（.terminal / .terminal-dock）
 * @param {HTMLElement} output  输出区元素
 * @param {HTMLElement|null} scrollEl 需要内部滚动时传入（如底部终端条），否则滚动 window
 * @param {number} maxBlocks    输出区最多保留的块数（不含活动提示符），Infinity 不裁剪
 * @param {boolean} compactHelp 小终端（底部终端条）用多列网格显示 help，大终端保持单行列表
 * @param {Function|null} boot  挂载完成后的初始化回调，接收 { printBlock, printPre, createPrompt, scrollToBottom, sleep, reduceMotion, BANNER, KALI_LOGO }
 */
export function mountTerminal({ root, output, scrollEl = null, maxBlocks = Infinity, compactHelp = false, boot = null }) {
	const USER = 'mkaaad';
	const HOST = 'kali';
	const PROMPT1 = `┌──(${USER}㉿${HOST})-[~]`;
	const PROMPT2 = '└─$';

	const BANNER = [
		' ____  _     ___   ____ ',
		'| __ )| |   / _ \\ / ___|',
		'|  _ \\| |  | | | | |  _ ',
		'| |_) | |__| |_| | |_| |',
		'|____/|_____\\___/ \\____|',
	];

	const KALI_LOGO = [
		' _  __    _    _     ___ ',
		'| |/ /   / \\  | |   |_ _|',
		"| ' /   / _ \\ | |    | | ",
		'| . \\  / ___ \\| |___ | | ',
		'|_|\\_\\/_/   \\_\\_____|___|',
	];

	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const start = Date.now();
	const history = [];
	let historyIndex = 0;
	let current = null;
	let tabMatches = null;
	let tabIndex = -1;
	let tabPrefix = '';
	let tabMenuEl = null;

	function escapeHtml(s) {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function scrollToBottom() {
		if (scrollEl) {
			scrollEl.scrollTop = scrollEl.scrollHeight;
			return;
		}
		const max = document.documentElement.scrollHeight - window.innerHeight;
		if (max > 0) window.scrollTo({ top: max });
	}

	// 内部页面跳转：走 Astro 的 View Transitions 路由（终端快照逐行擦除）
	// 不要用 window.navigate / location.assign，那会绕过 ClientRouter 变成整页刷新
	function navigateTo(path) {
		try {
			astroNavigate(path);
		} catch {
			window.location.assign(path);
		}
	}

	// 输出区只保留最近 maxBlocks 个块，活动提示符永远保留
	function trimOutput() {
		if (!Number.isFinite(maxBlocks)) return;
		const hasLivePrompt = output.lastElementChild?.classList.contains('prompt-live');
		while (output.children.length > maxBlocks + (hasLivePrompt ? 1 : 0)) {
			output.firstElementChild.remove();
		}
	}

	function printBlock(html, className = '') {
		const div = document.createElement('div');
		if (className) div.className = className;
		div.innerHTML = html;
		output.appendChild(div);
		trimOutput();
		scrollToBottom();
	}

	function printPre(lines, className = '') {
		const pre = document.createElement('pre');
		if (className) pre.className = className;
		pre.textContent = lines.join('\n');
		output.appendChild(pre);
		trimOutput();
		scrollToBottom();
	}

	function uptime() {
		const s = Math.floor((Date.now() - start) / 1000);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		if (h) return `${h}h ${m % 60}m`;
		if (m) return `${m}m ${s % 60}s`;
		return `${s}s`;
	}

	// 清空屏幕：跳转前调用，保证快照底部条带是干净的黑底，不会把旧内容带进新终端
	function clearScreen() {
		output.innerHTML = '';
		tabMenuEl = null;
	}

	const COMMANDS = {
		help() {
			if (compactHelp) {
				const entries = [
					['help', 'Show this help'],
					['about', 'About this blog'],
					['blog', 'Go to blog posts (/blog)'],
					['home', 'Back to terminal home (/)'],
					['social', 'Social links'],
					['whoami', 'Show current user'],
					['date', 'Show date &amp; time'],
					['echo &lt;text&gt;', 'Echo text'],
					['neofetch', 'System-style info'],
					['banner', 'Reprint the banner'],
					['clear', 'Clear the screen'],
				];
				printBlock(
					`<span class="help-head c-dim">Available commands:</span>` +
						entries
							.map(
								([cmd, desc]) =>
									`<span class="help-item"><span class="c-green">${cmd}</span><span class="help-desc">${desc}</span></span>`,
							)
							.join(''),
					'help-grid',
				);
				return;
			}
			printBlock(`<span class="c-dim">Available commands:</span>
  <span class="c-green">help</span>       Show this help
  <span class="c-green">about</span>      About this blog
  <span class="c-green">blog</span>       Go to blog posts (/blog)
  <span class="c-green">home</span>       Back to terminal home (/)
  <span class="c-green">social</span>     Social links
  <span class="c-green">whoami</span>     Show current user
  <span class="c-green">date</span>       Show date &amp; time
  <span class="c-green">echo</span> &lt;text&gt;   Echo text
  <span class="c-green">neofetch</span>   System-style info
  <span class="c-green">banner</span>     Reprint the banner
  <span class="c-green">clear</span>      Clear the screen`, 'block');
		},
		about() {
			printBlock(`Hi, I'm <span class="c-green">mkaaad</span> — developer &amp; blogger.
This is my personal blog, powered by Astro.
Type <span class="c-green">blog</span> to browse posts, or <span class="c-green">social</span> to find me.`, 'block');
		},
		blog() {
			navigateTo('/blog');
		},
		home() {
			if (location.pathname === '/') return;
			navigateTo('/');
		},
		social() {
			printBlock(`GitHub: <a class="link" href="https://github.com/mkaaad" target="_blank" rel="noopener">https://github.com/mkaaad</a>
Email:  <a class="link" href="mailto:kadmanmk@outlook.com">kadmanmk@outlook.com</a>`, 'block');
		},
		whoami() {
			printBlock(`<span class="c-green">mkaaad</span>`, 'block');
		},
		date() {
			printBlock(new Date().toLocaleString(), 'block');
		},
		echo(args) {
			printBlock(escapeHtml(args), 'block');
		},
		neofetch() {
			printPre(KALI_LOGO, 'logo');
			printBlock(`<span class="c-green">${USER}</span>@<span class="c-green">${HOST}</span>
<span class="c-dim">--------------------</span>
<span class="c-cyan">OS</span>:       Kali GNU/Linux (blog flavor)
<span class="c-cyan">Host</span>:     Astro Blog
<span class="c-cyan">Shell</span>:    zsh
<span class="c-cyan">Uptime</span>:    ${uptime()}
<span class="c-cyan">Blog</span>:     /blog
<span class="c-cyan">Theme</span>:     Kali-dark`, 'block');
		},
		banner() {
			printPre(BANNER, 'banner');
			printBlock(`Welcome to <span class="c-green">Astro Blog</span> — type <span class="c-green">help</span> to get started.`, 'block');
		},
		clear() {
			clearScreen();
		},
		cls() {
			clearScreen();
		},
		sudo() {
			printBlock(`<span class="c-red">mkaaad is not in the sudoers file. This incident will be reported.</span>`, 'block');
		},
	};

	function execute(raw) {
		const line = raw.trim();
		if (!line) return;
		const parts = line.split(/\s+/);
		const cmd = parts[0].toLowerCase();
		const args = parts.slice(1).join(' ');
		const fn = COMMANDS[cmd];
		if (fn) {
			fn(args);
		} else {
			printBlock(`<span class="c-red">zsh: command not found: ${escapeHtml(cmd)}</span>`, 'block');
		}
	}

	// 活动提示符：输出流里的最后一个元素
	function createPrompt() {
		const wrap = document.createElement('div');
		wrap.className = 'prompt-live';
		wrap.innerHTML = `<div class="prompt-1">${PROMPT1}</div><div class="prompt-2"><span class="prompt-symbol">${PROMPT2}</span><input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Terminal input" /></div>`;
		output.appendChild(wrap);
		trimOutput();
		scrollToBottom();
		current = wrap;
		return wrap;
	}

	// 回车：原地把当前提示符转成历史行，位置不变
	// 只把 <input> 换成文本 span，保留 prompt-1/prompt-2/prompt-symbol 结构与行高
	function commitLine(raw) {
		const wrap = current;
		wrap.classList.remove('prompt-live');
		wrap.classList.add('cmd-line');
		const inputEl = wrap.querySelector('input');
		const text = document.createElement('span');
		text.textContent = raw;
		inputEl.replaceWith(text);
		scrollToBottom();
	}

	function resetTab() {
		tabMatches = null;
		tabIndex = -1;
		tabPrefix = '';
		if (tabMenuEl) {
			tabMenuEl.remove();
			tabMenuEl = null;
		}
	}

	function renderTabMenu() {
		if (!tabMenuEl) {
			tabMenuEl = document.createElement('div');
			tabMenuEl.className = 'tab-menu';
			output.appendChild(tabMenuEl);
		}
		tabMenuEl.innerHTML = tabMatches
			.map((c, i) => {
				const inner =
					i === tabIndex
						? escapeHtml(c)
						: `<span class="c-green">${escapeHtml(tabPrefix)}</span>${escapeHtml(c.slice(tabPrefix.length))}`;
				return `<span class="tab-item${i === tabIndex ? ' tab-selected' : ''}" data-idx="${i}">${inner}</span>`;
			})
			.join('  ');
		scrollToBottom();
	}

	output.addEventListener('keydown', (e) => {
		if (e.target.tagName !== 'INPUT') return;
		if (e.key === 'Enter') {
			resetTab();
			const value = e.target.value;
			if (value.trim()) history.push(value);
			historyIndex = history.length;
			commitLine(value);
			execute(value);
			current = createPrompt();
			current.querySelector('input').focus({ preventScroll: true });
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			resetTab();
			if (historyIndex > 0) {
				historyIndex--;
				e.target.value = history[historyIndex];
			}
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			resetTab();
			if (historyIndex < history.length - 1) {
				historyIndex++;
				e.target.value = history[historyIndex];
			} else {
				historyIndex = history.length;
				e.target.value = '';
			}
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (tabMatches) {
				// 已有候选菜单：循环选中下一个
				tabIndex = (tabIndex + 1) % tabMatches.length;
				e.target.value = tabMatches[tabIndex];
				renderTabMenu();
				return;
			}
			const val = e.target.value.trim().toLowerCase();
			if (!val) return;
			const matches = Object.keys(COMMANDS).filter((c) => c.startsWith(val));
			if (matches.length === 0) return;
			if (matches.length === 1) {
				e.target.value = matches[0];
				return;
			}
			// 第一次 Tab：只展示候选，不选中
			tabMatches = matches;
			tabIndex = -1;
			tabPrefix = val;
			renderTabMenu();
		}
	});

	// 输入变化时重置候选菜单
	output.addEventListener('input', (e) => {
		if (e.target.tagName === 'INPUT') resetTab();
	});

	// 点击任意处聚焦输入框（链接除外，保留点击聚焦）
	// 监听绑在整个终端容器上，覆盖标题栏和空白区域
	root.addEventListener('click', (e) => {
		if (e.target.closest('a')) return;
		const inp = output.querySelector('.prompt-live input');
		if (inp) inp.focus({ preventScroll: true });
	});

	const api = { printBlock, printPre, createPrompt, scrollToBottom, sleep, reduceMotion, BANNER, KALI_LOGO };
	if (boot) {
		boot(api);
	} else {
		createPrompt();
	}
}
