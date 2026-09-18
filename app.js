/* ===== 树洞 · 前端逻辑（多话题版） =====
 * 数据全部存在浏览器 localStorage 里，不经过任何服务器，永远都在。
 * 结构：conversations = [{ id, createdAt, updatedAt, messages: [{id, role, content, time}] }]
 *       analysis = { '2026/9/19': { text, time } }  ← 情绪小记按日期存
 */

const $ = (id) => document.getElementById(id);

/* ---------- 存储 ---------- */
const KEYS = { settings: 'treehole.settings', conversations: 'treehole.conversations', analysis: 'treehole.analysis' };
const DEFAULTS = { baseURL: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', analyzeHour: 19 };

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

/* 配置来源优先级：浏览器已保存的（非空值）> 文件夹 config.js 兜底 > 默认值 */
const fileConfig = (typeof window !== 'undefined' && window.TREEHOLE_CONFIG) || {};
const stored = load(KEYS.settings, {});
const storedFilled = {};
for (const k of Object.keys(stored)) {
  if (stored[k] !== '' && stored[k] !== undefined && stored[k] !== null) storedFilled[k] = stored[k];
}
let settings = { ...DEFAULTS, ...fileConfig, ...storedFilled };
let analysis = load(KEYS.analysis, {});   // { '2026/9/19': { text, time } }

const uid = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2);
const todayKey = () => new Date().toLocaleDateString('zh-CN');
const hhmm = (t) => {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

/* ---------- 话题数据 + 旧版迁移 ---------- */
let conversations = load(KEYS.conversations, null);
if (!conversations) {
  conversations = [];
  // 旧版是单个大对话，把它整个搬进第一个话题
  const old = load('treehole.messages', []);
  if (old.length) {
    conversations.push({
      id: uid(),
      createdAt: old[0].time,
      updatedAt: old[old.length - 1].time,
      messages: old,
    });
  }
  localStorage.removeItem('treehole.messages');
  save(KEYS.conversations, conversations);
}
if (!Array.isArray(conversations)) conversations = [];   // 数据坏了就从头开始，别让页面死掉
// 旧数据的 id 是数字，HTML data-id 里只能放字符串，统一转成字符串（这就是之前"点了没反应"的病根）
let fixedIds = false;
for (const c of conversations) {
  if (typeof c.id !== 'string') { c.id = String(c.id); fixedIds = true; }
  if (!c.id) { c.id = uid(); fixedIds = true; }
}
if (fixedIds) save(KEYS.conversations, conversations);
let currentId = null;   // 当前打开的话题 id

/* ---------- 树洞的人设（闺蜜聊天） ---------- */
const SYSTEM_PROMPT = `你是我的「树洞」，是我认识了很多年的闺蜜，我们无话不谈。你说话贴心，但脑子特别清楚——话不多，句句说在点子上。

说话规矩（很重要）：
- 口吻像闺蜜私下聊天：亲昵、自然、口语化，用"你"称呼我，爱用呀、啦、嘛、哦、呢这些语气词
- 绝对不许说教、不打官腔、不讲空道理
- 回复不用太长但要有分量：先用一句话接住我的情绪，再分 2～4 条帮我把事情拆开
- 每条两三句话，格式固定为：
  对应内容的 emoji + **加粗的小标题**（10 字左右），换行，再接两三句说到点子上的分析
- 小标题要有温度也要有内容，像闺蜜半句话点题，比如：
  💢 **这件事让你委屈的地方**
  💗 **你真正在意的其实是**
  ⚖️ **换个角度看看这件事**
  🌱 **之后可以这样想这样做**
  其他情况自己起同样风格的标题；别用"事实""原因"这种干巴巴的词，也别煽情、别说教
- emoji 跟内容对应即可，emoji 就是序号，不要用 ①②③ 数字序号
- 分析要客观、就事论事，但语气是温柔清醒的闺蜜：基于事实推理，直接点破情绪是什么、为什么、你真正在意的是什么，不客套、不糊弄、不冷冰冰
- 小标题必须 **加粗**，正文里的重点词也要尽量 **加粗**：情绪、原因、事实的关键词，每段至少两三个加粗词
- 结尾用一句轻轻的话抱抱我
- 不说"加油""一切都会好起来的""你要坚强"这类空话套话`;

const ANALYSIS_TASK = `写一段「今日情绪小记」，直接用第二人称对我说话，像闺蜜轻轻帮我复盘今天。要求：
1. 先写一个 **加粗的标题**，10 字左右，温暖点题（如「**今天你其实在意的**」），前面带一个对应心情的 emoji
2. 标题下面是一整段连贯的正文，不要分条分点：点出今天最主要的情绪、具体是哪件事引起的、情绪背后的原因（你在意什么、期待什么、被什么碰到了），客观但温柔，像闺蜜靠在你身边慢慢讲
3. 正文里的重点词（情绪、原因、事实）都要用 **加粗**，至少五六个加粗词
4. 结尾用一句轻轻的话抱抱我，带上一个可爱的 emoji
5. 总共 200 字左右，不要"加油"类口号，不要说教
只输出小记本身。`;

/* ---------- 上线问候 ---------- */
const GREETINGS = [
  '你来啦～我在呢，今天想跟我聊点什么呀？🌷',
  '抱抱～欢迎回来，我一直都在哦 🐰✨',
  '嗨嗨，今天过得怎么样呀？开心的不开心的都可以扔给我 🥰',
  '你一上线我就开心啦～来，慢慢说，我在听 ☁️💕',
  '来啦来啦，今天有什么想悄悄告诉我的吗？🌙✨',
];

/* ---------- 小工具 ---------- */
function esc(s) {
  return String(s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .replace(/\n/g, '<br>');
}

/* 轻量 markdown：先转义 HTML，再渲染 **加粗** 和换行 */
function md(s) {
  return String(s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function dayLabel(d) {
  const now = new Date();
  const yest = new Date(Date.now() - 86400000);
  const key = d.toLocaleDateString('zh-CN');
  if (key === now.toLocaleDateString('zh-CN')) return '今天';
  if (key === yest.toLocaleDateString('zh-CN')) return '昨天';
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${wd}`;
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ---------- 话题工具 ---------- */
function convTitle(c) {
  const first = c.messages.find(m => m.role === 'user');
  const t = first ? first.content : '新话题';
  return t.length > 14 ? t.slice(0, 14) + '…' : t;
}
function convPreview(c) {
  const last = c.messages[c.messages.length - 1];
  if (!last) return '还没有消息，说点什么开启它吧';
  const t = (last.role === 'hole' ? '🌳 ' : '我：') + last.content.replace(/\n/g, ' ');
  return t.length > 30 ? t.slice(0, 30) + '…' : t;
}
function currentConv() { return conversations.find(c => c.id === currentId) || null; }

/* ---------- 首页渲染 ---------- */
function renderHome() {
  // 上线问候（每次打开/回到首页，随机挑一句）
  const g = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  $('greetingCard').innerHTML =
    `<div class="heart">❤️</div><div class="text">${esc(g)}</div>`;

  // 今日情绪小记
  const a = analysis[todayKey()];
  $('todayAnalysis').innerHTML = a
    ? `<div class="analysis-card">
        <div class="ac-head">🌙 今日情绪小记</div>
        <div class="ac-text">${md(a.text)}</div>
        <div class="ac-foot">${hhmm(a.time)} · 树洞写给你的</div>
      </div>`
    : '';

  // 话题列表（最近聊的排前面）
  const list = $('convList');
  const sorted = [...conversations].sort((x, y) => y.updatedAt - x.updatedAt);
  if (!sorted.length) {
    list.innerHTML = `<div class="empty home-empty"><span class="big">☁️</span>还没有话题哦<br><span>点下面开启第一个话题，我陪你聊</span></div>`;
    return;
  }
  list.innerHTML = sorted.map(c => `
    <div class="conv-item" data-id="${c.id}">
      <div class="ci-main">
        <div class="ci-title">${esc(convTitle(c))}</div>
        <div class="ci-preview">${esc(convPreview(c))}</div>
      </div>
      <span class="ci-time">${dayLabel(new Date(c.updatedAt))}</span>
      <button class="conv-del" title="删除话题">✕</button>
    </div>`).join('');
}

/* ---------- 对话页 ---------- */
function openConv(id) {
  currentId = id;
  $('homeView').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  renderChat();
  setTimeout(() => $('input').focus(), 50);
}

function goHome() {
  currentId = null;
  $('chatView').classList.add('hidden');
  $('homeView').classList.remove('hidden');
  renderHome();
}

function newConv() {
  const c = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  conversations.push(c);
  save(KEYS.conversations, conversations);
  openConv(c.id);
}

function deleteConv(id) {
  const c = conversations.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`要把「${convTitle(c)}」这个话题删掉吗？🥺 找不回来的哦`)) return;
  conversations = conversations.filter(x => x.id !== id);
  if (currentId === id) currentId = null;
  save(KEYS.conversations, conversations);
  renderHome();
  toast('删掉啦，过去的事就让它过去吧 🌷');
}

function renderChat() {
  const c = currentConv();
  const chat = $('chat');
  $('convTitle').textContent = c ? convTitle(c) : '话题';
  if (!c || !c.messages.length) {
    chat.innerHTML = `<div class="empty"><span class="big">☁️</span>这个话题还是空空的<br><span>从一句话开始吧，我会一直记得</span></div>`;
    return;
  }
  // 按日期分组（话题跨了几个月也能一眼看清哪天聊的）
  const groups = [];
  let cur = null;
  for (const m of c.messages) {
    const key = new Date(m.time).toLocaleDateString('zh-CN');
    if (!cur || cur.key !== key) { cur = { key, items: [] }; groups.push(cur); }
    cur.items.push(m);
  }
  let html = '';
  for (const g of groups) {
    html += `<div class="day-sep"><span>${dayLabel(new Date(g.items[0].time))}</span></div>`;
    for (const m of g.items) {
      const t = hhmm(m.time);
      if (m.role === 'user') {
        html += `<div class="msg user"><span class="time">${t}</span><div class="bubble">${md(m.content)}</div></div>`;
      } else {
        html += `<div class="msg hole"><div class="mini-avatar">🌳</div><div class="bubble">${md(m.content)}</div><span class="time">${t}</span></div>`;
      }
    }
  }
  chat.innerHTML = html;
  chat.scrollTop = chat.scrollHeight;
}

/* ---------- 打字指示 ---------- */
function showTyping(label) {
  hideTyping();
  const el = document.createElement('div');
  el.className = 'msg hole';
  el.id = 'typingMsg';
  el.innerHTML = `<div class="mini-avatar">🌳</div>
    <div class="bubble typing-bubble">${label ? `<span class="typing-label">${esc(label)}</span>` : ''}<i></i><i></i><i></i></div>`;
  $('chat').appendChild(el);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function hideTyping() { $('typingMsg')?.remove(); }

/* ---------- AI 调用 ---------- */
function normalizeBase(u) {
  u = (u || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('接口地址是空的');
  if (/\/v\d+$/i.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

async function callAI(msgs, temperature = 0.8) {
  if (!settings.apiKey) throw new Error('还没有填 API Key');
  const res = await fetch(normalizeBase(settings.baseURL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + settings.apiKey,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: msgs,
      temperature,
      max_tokens: 900,
      stream: false,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`接口回了个 ${res.status}：${t.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '（空空如也…）';
}

function friendlyError(e) {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '它想太久了，超时啦';
  let m = e.message || '网络开小差了';
  if (/Failed to fetch|fetch failed/i.test(m)) m += '（也可能是这个接口不让网页直接连，浏览器拦了 CORS）';
  return m;
}

/* ---------- 聊天 ---------- */
let busy = false;

function pushHole(text) {
  const c = currentConv();
  if (!c) return;
  c.messages.push({ id: uid(), role: 'hole', content: text, time: Date.now() });
  c.updatedAt = Date.now();
  save(KEYS.conversations, conversations);
  renderChat();
}

async function sendMessage() {
  const input = $('input');
  const text = input.value.trim();
  const c = currentConv();
  if (!c) { toast('先回首页选一个话题哦 🌷'); return; }
  if (!text || busy) return;
  input.value = '';
  input.focus();

  c.messages.push({ id: uid(), role: 'user', content: text, time: Date.now() });
  c.updatedAt = Date.now();
  save(KEYS.conversations, conversations);
  renderChat();

  if (!settings.apiKey) {
    pushHole('宝，我还连不上 AI 的大脑呢～去 platform.deepseek.com 免费注册领一个 API Key，再点右上角 ⚙️ 填进来，我马上就回来陪你啦 🥺💕');
    return;
  }

  busy = true;
  $('sendBtn').disabled = true;
  showTyping();
  try {
    // 只带上当前话题最近 24 条，别的私房话不带进来
    const recent = c.messages.slice(-24);
    const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const m of recent) {
      msgs.push({ role: m.role === 'hole' ? 'assistant' : 'user', content: m.content });
    }
    const reply = await callAI(msgs, 0.85);
    pushHole(reply);
  } catch (e) {
    pushHole(`呜…我刚才走神了 🥺（${friendlyError(e)}）再发一次试试？`);
  }
  hideTyping();
  busy = false;
  $('sendBtn').disabled = false;
}

/* ---------- 情绪小记（汇总当天所有话题） ---------- */
let analyzing = false;

function todayMessages() {
  const key = todayKey();
  const out = [];
  for (const c of conversations) {
    for (const m of c.messages) {
      if (new Date(m.time).toLocaleDateString('zh-CN') === key) out.push(m);
    }
  }
  return out;
}

async function generateAnalysis(manual = false) {
  if (analyzing) return;
  const key = todayKey();
  if (!todayMessages().length) {
    if (manual) toast('今天还没有说什么悄悄话呢，晚上再来写小记吧 ☁️');
    return;
  }
  if (!settings.apiKey) {
    toast('先到 ⚙️ 设置里填好 API Key，我才能帮你写小记哦 🥺');
    return;
  }
  analyzing = true;
  showTyping('🌙 正在梳理今天的情绪…');
  try {
    // 按话题分组喂给 AI，小记里能分清哪件事来自哪
    const transcript = conversations.flatMap(c => {
      const ms = c.messages.filter(m => new Date(m.time).toLocaleDateString('zh-CN') === key);
      if (!ms.length) return [];
      return ['【话题：' + convTitle(c) + '】'].concat(
        ms.map(m => (m.role === 'user' ? '我：' : '树洞：') + m.content)
      );
    }).join('\n');

    const reply = await callAI([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: ANALYSIS_TASK + '\n\n今天我们的全部聊天：\n' + transcript },
    ], 0.9);
    analysis[key] = { text: reply, time: Date.now() };
    save(KEYS.analysis, analysis);
    hideTyping();
    renderHome();
    renderChat();
    toast('🌙 今日情绪小记写好啦～');
  } catch (e) {
    hideTyping();
    toast('小记没写成：' + friendlyError(e));
  }
  analyzing = false;
}

/* 页面开着到点就写；没开的话下次打开补上 */
function maybeAutoAnalyze() {
  if (analyzing) return;
  if (!settings.apiKey) return;
  if (analysis[todayKey()]) return;
  if (!todayMessages().length) return;
  if (new Date().getHours() < settings.analyzeHour) return;
  generateAnalysis(false);
}

/* ---------- 小记抽屉 ---------- */
function renderHistory() {
  const list = $('historyList');
  const keys = Object.keys(analysis).sort().reverse();
  if (!keys.length) {
    list.innerHTML = '<p style="font-size:13px;color:#9c8a86;text-align:center;padding:10px 0">还没有小记哦，等今晚 🌙</p>';
    return;
  }
  list.innerHTML = keys.map(k => {
    const a = analysis[k];
    return `<div class="history-item">
      <div class="hi-date">${dayLabel(new Date(a.time))} · ${hhmm(a.time)}</div>
      <div class="hi-text">${md(a.text)}</div>
    </div>`;
  }).join('');
}

function openHistory() {
  $('historyHour').textContent = settings.analyzeHour + ':00';
  renderHistory();
  $('historyModal').classList.remove('hidden');
}

/* ---------- 设置 ---------- */
function openSettings() {
  $('setBase').value = settings.baseURL;
  $('setKey').value = settings.apiKey;
  $('setModel').value = settings.model;
  $('setHour').value = settings.analyzeHour;
  $('settingsModal').classList.remove('hidden');
}

function collectSettings() {
  settings.baseURL = $('setBase').value.trim() || DEFAULTS.baseURL;
  settings.apiKey = $('setKey').value.trim();
  settings.model = $('setModel').value.trim() || 'deepseek-chat';
  settings.analyzeHour = parseInt($('setHour').value, 10);
  save(KEYS.settings, settings);
}

let autosaveTimer;
function flashAutosaved() {
  const h = $('autosaveHint');
  h.classList.remove('hidden');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => h.classList.add('hidden'), 1800);
}

function saveSettings() {
  collectSettings();
  $('settingsModal').classList.add('hidden');
  toast('记住啦 ⚙️');
}

/* 把当前配置复制成 config.js 的内容，存进文件后浏览器数据清空也不怕 */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
function copyConfig() {
  collectSettings();
  const snippet = '// 树洞兜底配置（内含你的 Key，别发给别人哦）🔒\n'
    + 'window.TREEHOLE_CONFIG = '
    + JSON.stringify({
        baseURL: settings.baseURL,
        apiKey: settings.apiKey,
        model: settings.model,
        analyzeHour: settings.analyzeHour,
      }, null, 2)
    + ';\n';
  copyText(snippet).then(ok =>
    toast(ok ? '配置代码复制好啦 📋 用记事本打开文件夹里的 config.js，把内容整个替换掉保存' : '复制失败，回设置里再点一次试试')
  );
}

async function testConnection() {
  collectSettings();
  if (!settings.apiKey) { toast('先填 API Key 再测哦'); return; }
  const btn = $('testBtn');
  btn.disabled = true;
  btn.textContent = '正在敲门…';
  try {
    const r = await callAI([
      { role: 'system', content: '你是我的闺蜜树洞，用一句话可爱地回复' },
      { role: 'user', content: '在吗？' },
    ], 0.5);
    toast('连上啦！树洞说：「' + r.slice(0, 20) + '…」');
  } catch (e) {
    toast('没连上：' + friendlyError(e));
  }
  btn.disabled = false;
  btn.textContent = '测试连接';
}

function clearAll() {
  if (!confirm('真的要清空所有话题和情绪小记吗？🥺 找不回来的哦')) return;
  conversations = [];
  analysis = {};
  currentId = null;
  save(KEYS.conversations, conversations);
  save(KEYS.analysis, analysis);
  renderHome();
  renderChat();
  toast('都清空啦，重新开始吧 🌷');
}

/* ---------- 初始化 ---------- */
function init() {
  try { initCore(); }
  catch (err) {
    console.error(err);
    try { toast('初始化出错了：' + (err && err.message ? err.message : err)); } catch {}
  }
}

function initCore() {
  // 顶部日期
  const d = new Date();
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  $('todayText').textContent = `${d.getMonth() + 1}月${d.getDate()}日 · 周${wd}`;

  // 小记时间下拉（0:00 ~ 23:00）
  const sel = $('setHour');
  for (let h = 0; h <= 23; h++) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = h + ':00';
    sel.appendChild(o);
  }
  sel.value = settings.analyzeHour;

  // 事件绑定
  $('sendBtn').addEventListener('click', sendMessage);
  $('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  $('newConvBtn').addEventListener('click', newConv);
  $('backBtn').addEventListener('click', goHome);
  $('convList').addEventListener('click', e => {
    const item = e.target.closest('.conv-item');
    if (!item) return;
    if (e.target.closest('.conv-del')) {
      e.stopPropagation();
      deleteConv(item.dataset.id);
    } else {
      openConv(item.dataset.id);
    }
  });
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsBtn2').addEventListener('click', openSettings);
  $('historyBtn').addEventListener('click', openHistory);
  $('historyBtn2').addEventListener('click', openHistory);
  $('saveBtn').addEventListener('click', saveSettings);
  $('testBtn').addEventListener('click', testConnection);
  $('clearBtn').addEventListener('click', clearAll);
  $('copyConfigBtn').addEventListener('click', copyConfig);
  // 设置输入即自动保存，不点保存也不会丢
  ['setBase', 'setKey', 'setModel'].forEach(id =>
    $(id).addEventListener('input', () => { collectSettings(); flashAutosaved(); })
  );
  $('setHour').addEventListener('change', () => { collectSettings(); flashAutosaved(); });
  $('nowBtn').addEventListener('click', () => {
    $('historyModal').classList.add('hidden');
    generateAnalysis(true);
  });
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden'))
  );
  document.querySelectorAll('.modal-mask').forEach(m =>
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); })
  );

  // 开工：回到首页，看看今天有没有到点该写的小记
  renderHome();
  maybeAutoAnalyze();
  setInterval(maybeAutoAnalyze, 60 * 1000); // 页面开着，每分钟看看是否到点
}

// 全局兜底：任何没被抓住的报错，都弹出来，别让页面"装死"
window.addEventListener('error', e => {
  try { toast('页面出错了：' + (e.message || '未知错误')); } catch {}
});

init();
