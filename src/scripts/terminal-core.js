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
export function mountTerminal({ root, output, scrollEl = null, maxBlocks = Infinity, compactHelp = false, initialDir = '~', posts = [], boot = null }) {
	const USER = 'mkaaad';
	const HOST = 'kali';
	const PROMPT2 = '└─$';
	const HOME_DIR = '~';
	const BLOG_DIR = 'blog';
	const BLOG_PATH = `${HOME_DIR}/${BLOG_DIR}`;
	// Tab 补全候选只列实际可进入的目录：~ 下可进 blog，~/blog 下没有子目录
	function tabDirs() {
		return cwd === BLOG_PATH ? [] : ['blog/'];
	}
	// 博客文章数据：{ id, title }，供 less 解析文件名与 ls/listPosts 列表
	const POSTS = Array.isArray(posts) ? posts : [];

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

	const DBEAVER_SPLASH = [
		'┌──────────────────────────────┐',
		'│   DBeaver Community Edition  │',
		'│   Universal Database Tool    │',
		'└──────────────────────────────┘',
	];

	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const start = Date.now();
	let cwd = initialDir;
	const history = [];
	let historyIndex = 0;
	let current = null;
	let tabMatches = null;
	let tabIndex = -1;
	let tabPrefix = '';
	let tabLead = '';
	let tabMenuEl = null;

	function escapeHtml(s) {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// 提示符第一行随当前目录变化，例如 [~] 或 [~/blog]
	function prompt1Text() {
		return `┌──(${USER}㉿${HOST})-[${cwd}]`;
	}

	// 虚拟目录解析：~ 是根目录，blog 是唯一可进入的目录（对应 /blog 页面）。
	// 相对名 blog 只在 ~ 下有效；在 ~/blog 里 cd blog 应报错（没有 blog 子目录）。
	// 绝对形式（~/blog、/blog）从任何目录都可用（已在 blog 内时等价于原地，不报错）。
	function resolveDir(raw) {
		const target = raw.replace(/\/+$/, '');
		if (!target || target === HOME_DIR || target === '/' || target === '..') return HOME_DIR;
		if (target === BLOG_PATH || target === `/${BLOG_DIR}`) return BLOG_PATH;
		if (cwd !== BLOG_PATH && (target === BLOG_DIR || target === `./${BLOG_DIR}`)) {
			return BLOG_PATH;
		}
		return null;
	}

	// 把 less 参数解析成博客文章：可带目录前缀（blog/、./blog/、~/blog/、/blog/），
	// 剥掉 .md/.mdx/.markdown 扩展名（也接受裸 slug），按 post.id 匹配
	function resolvePostFile(raw) {
		const arg = (raw || '').trim();
		if (!arg) return null;
		let name = arg;
		for (const prefix of ['blog/', './blog/', '~/blog/', '/blog/', '/']) {
			if (name.startsWith(prefix)) {
				name = name.slice(prefix.length);
				break;
			}
		}
		const base = name.split('/').pop() || '';
		const slug = base.replace(/\.(md|mdx|markdown)$/i, '').toLowerCase();
		return POSTS.find((p) => String(p.id).toLowerCase() === slug) || null;
	}

	// 文章文件列表（boot / ls 用）：绿字文件名 + 标题
	function listPosts() {
		if (POSTS.length === 0) return '<span class="c-dim"># no posts</span>';
		const width = Math.max(...POSTS.map((p) => String(p.id).length));
		return POSTS.map((p) => {
			const file = `<span class="c-green">${escapeHtml(String(p.id))}</span>`;
			return `${file}${' '.repeat(width - String(p.id).length + 2)}${escapeHtml(p.title || '')}`;
		}).join('\n');
	}

	// 判断该命令是否会触发内部页面跳转（cd 进入有效目录 / home 返回首页）。
	// 跳转命令要在提交命令行、创建新提示符之前执行，让 View Transition 的快照
	// 停留在“按下回车前”的状态，而不是“命令已执行完”的状态。
	function isNavigationCommand(raw) {
		const parts = raw.trim().split(/\s+/);
		const cmd = (parts[0] || '').toLowerCase();
		if (cmd === 'home') return location.pathname !== '/';
		if (cmd === 'less') return resolvePostFile(parts.slice(1).join(' ')) !== null;
		if (cmd !== 'cd') return false;
		const target = parts.slice(1).join(' ') || HOME_DIR;
		if (target === '.') return false;
		const resolved = resolveDir(target);
		return resolved !== null && resolved !== cwd;
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
					['cd &lt;dir&gt;', 'Change directory (blog)'],
					['ls &lt;dir&gt;', 'List directory contents'],
					['less &lt;file&gt;', 'Read a post'],
					['pwd', 'Print working directory'],
					['home', 'Back to terminal home (/)'],
					['social', 'Social links'],
					['whoami', 'Show current user'],
					['date', 'Show date &amp; time'],
					['echo &lt;text&gt;', 'Echo text'],
					['neofetch', 'System-style info'],
					['dbeaver', 'Launch DBeaver'],
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
			const rows = [
				['cd <dir>', 'Change directory (blog → /blog)'],
				['ls [dir]', 'List directory contents'],
				['less <file>', 'Read a blog post'],
				['pwd', 'Print working directory'],
				['home', 'Back to terminal home (/)'],
				['help', 'Show this help'],
				['about', 'About this blog'],
				['social', 'Social links'],
				['whoami', 'Show current user'],
				['date', 'Show date & time'],
				['echo <text>', 'Echo text'],
				['neofetch', 'System-style info'],
				['dbeaver', 'Launch DBeaver'],
				['banner', 'Reprint the banner'],
				['clear', 'Clear the screen'],
			];
			const cmdWidth = Math.max(...rows.map(([cmd]) => cmd.length));
			printBlock(
				`<span class="c-dim">Available commands:</span>\n` +
					rows
						.map(
							([cmd, desc]) =>
								`  <span class="c-green">${escapeHtml(cmd)}</span>${' '.repeat(cmdWidth - cmd.length + 2)}${escapeHtml(desc)}`,
						)
						.join('\n'),
				'block',
			);
		},
		about() {
			printBlock(`Hi, I'm <span class="c-green">mkaaad</span> — developer &amp; blogger.
This is my personal blog, powered by Astro.
Type <span class="c-green">cd blog</span> to browse posts, or <span class="c-green">social</span> to find me.`, 'block');
		},
		cd(args) {
			const target = (args || HOME_DIR).trim();
			if (target === '.') return;
			const resolved = resolveDir(target);
			if (resolved === null) {
				printBlock(`<span class="c-red">cd: no such file or directory: ${escapeHtml(target)}</span>`, 'block');
				return;
			}
			if (resolved === cwd) return;
			cwd = resolved;
			navigateTo(resolved === BLOG_PATH ? '/blog' : '/');
		},
		ls(args) {
			const target = (args || '').trim();
			const resolved = !target || target === '.' ? cwd : resolveDir(target);
			if (resolved === null) {
				printBlock(`<span class="c-red">ls: cannot access '${escapeHtml(target)}': No such file or directory</span>`, 'block');
				return;
			}
			if (resolved === BLOG_PATH) {
				printBlock(listPosts(), 'block');
				return;
			}
			printBlock('blog', 'block');
		},
		less(args) {
			const file = (args || '').trim();
			if (!file) {
				printBlock(`<span class="c-red">less: usage: less &lt;file&gt;</span>`, 'block');
				return;
			}
			const post = resolvePostFile(file);
			if (!post) {
				printBlock(`<span class="c-red">less: cannot open '${escapeHtml(file)}': No such file or directory</span>`, 'block');
				return;
			}
			// 内部页面跳转：走 View Transitions（与 cd blog / home 一致）
			navigateTo(`/blog/${post.id}/`);
		},
		pwd() {
			printBlock(cwd, 'block');
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
		async dbeaver() {
			printPre(DBEAVER_SPLASH, 'logo');
			const lines = [
				`<span class="c-dim">Starting <span class="c-green">DBeaver Community Edition</span>...</span>`,
				`<span class="c-dim">[<span class="c-green">■■■■</span>□□□□□□□□] Loading workspace</span>`,
				`<span class="c-dim">[<span class="c-green">■■■■■■■■</span>□□□□] Loading JDBC drivers</span>`,
				`<span class="c-dim">[<span class="c-green">■■■■■■■■■■■■</span>] Initializing UI</span>`,
				`<span class="c-green">DBeaver is running.</span> <span class="c-dim">Workspace: ~/dbeaver-workspace</span>`,
			];
			for (const line of lines) {
				// 间隔加随机浮动（280–580ms），模拟真实启动节奏
				if (!reduceMotion) await sleep(280 + Math.random() * 300);
				printBlock(line, 'block');
			}
		},
		banner() {
			printPre(BANNER, 'banner');
			printBlock(`Welcome to <span class="c-green">mkaaad's blog</span> — type <span class="c-green">help</span> to get started.`, 'block');
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
			return fn(args);
		} else {
			printBlock(`<span class="c-red">zsh: command not found: ${escapeHtml(cmd)}</span>`, 'block');
		}
	}

	// 执行命令：异步命令（如 dbeaver 逐行输出）期间不创建新提示符，
	// 输出按顺序追加在已提交的命令行下方，等命令结束后提示符才重新出现
	async function runCommand(value) {
		commitLine(value);
		try {
			const result = execute(value);
			if (result && typeof result.then === 'function') {
				await result;
			}
		} finally {
			current = createPrompt();
			current.querySelector('input').focus({ preventScroll: true });
		}
	}

	// 活动提示符：输出流里的最后一个元素
	function createPrompt() {
		const wrap = document.createElement('div');
		wrap.className = 'prompt-live';
		wrap.innerHTML = `<div class="prompt-1">${prompt1Text()}</div><div class="prompt-2"><span class="prompt-symbol">${PROMPT2}</span><input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Terminal input" /></div>`;
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
		tabLead = '';
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
			if (isNavigationCommand(value)) {
				// 内部跳转：先触发 View Transition（快照停留在回车前），
				// 不提交命令行、不创建新提示符
				execute(value);
				return;
			}
			runCommand(value);
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
				e.target.value = tabLead + tabMatches[tabIndex];
				renderTabMenu();
				return;
			}
			const raw = e.target.value;
			const trimmed = raw.trim();
			if (!trimmed) return;
			const parts = trimmed.split(/\s+/);
			const first = parts[0].toLowerCase();
			tabLead = '';
			tabPrefix = trimmed;
			let matches = [];
			if (first === 'less') {
				// less 按文章文件名补全；保留用户已输入的前导路径（blog/ 等）
				const wantFile = parts.length === 2 || (parts.length === 1 && /\s$/.test(raw));
				if (wantFile) {
					tabLead = `${first} `;
					tabPrefix = parts[1] ?? '';
					const typed = tabPrefix.toLowerCase();
					const leadMatch = typed.match(/^(?:blog\/|\.\/blog\/|~\/blog\/|\/blog\/|\/)/);
					const lead = leadMatch ? leadMatch[0] : '';
					const base = typed.slice(lead.length);
					matches = POSTS.map((p) => String(p.id))
						.filter((id) => id.startsWith(base))
						.map((id) => lead + id);
				} else {
					matches = Object.keys(COMMANDS).filter((c) => c.startsWith(trimmed.toLowerCase()));
				}
			} else if (first === 'cd' || first === 'ls') {
				// cd / ls 按目录名补全；命令后带空格时补全空参数
				const wantDir = parts.length === 2 || (parts.length === 1 && /\s$/.test(raw));
				if (wantDir) {
					tabLead = `${first} `;
					tabPrefix = parts[1] ?? '';
					matches = tabDirs().filter((d) => d.startsWith(tabPrefix.toLowerCase()));
				} else {
					matches = Object.keys(COMMANDS).filter((c) => c.startsWith(trimmed.toLowerCase()));
				}
			} else if (parts.length === 1) {
				matches = Object.keys(COMMANDS).filter((c) => c.startsWith(trimmed.toLowerCase()));
			}
			if (matches.length === 0) return;
			if (matches.length === 1) {
				e.target.value = tabLead + matches[0];
				return;
			}
			// 第一次 Tab：只展示候选，不选中
			tabMatches = matches;
			tabIndex = -1;
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

	const api = { printBlock, printPre, createPrompt, scrollToBottom, sleep, reduceMotion, BANNER, KALI_LOGO, listPosts };
	if (boot) {
		boot(api);
	} else {
		createPrompt();
	}
}
