const members = [
  { name: '周若岚', initial: '周', color: 'coral', school: '清华大学 · 公共管理', role: 'AI 产品经理 · 早期创业者', tags: ['AI 产品', '教育创新'], time: '周末可投入', match: 96 },
  { name: '顾以安', initial: '顾', color: 'blue', school: '复旦大学 · 计算机', role: '全栈工程师 · 开源贡献者', tags: ['技术', 'AI 工程'], time: '工作日晚间', match: 92 },
  { name: '许承安', initial: '许', color: 'yellow', school: '香港大学 · 教育学', role: '乡村教育项目发起人', tags: ['教育', '项目运营'], time: '周末可投入', match: 88 },
  { name: '沈知行', initial: '沈', color: 'teal', school: '上海交大 · 设计', role: '服务设计师 · 社会议题研究', tags: ['设计', '社会创新'], time: '周末可投入', match: 84 },
  { name: '陈默然', initial: '陈', color: 'blue', school: '伦敦政经 · 国际关系', role: '研究员 · 青年公益', tags: ['研究', '教育'], time: '工作日晚间', match: 81 },
  { name: '唐可为', initial: '唐', color: 'coral', school: '浙江大学 · 工业设计', role: '独立开发者 · 产品设计', tags: ['产品', '技术'], time: '周末可投入', match: 79 }
];
const intents = [
  { title: '用 AI 陪伴乡村儿童阅读', owner: '许承安', initial: '许', color: 'yellow', tag: '寻找产品与技术伙伴', text: '正在验证一个面向乡村学校的阅读陪伴工具，希望找到对教育和 AI 有热情的合作者。' },
  { title: '青年行动者的城市议题地图', owner: '沈知行', initial: '沈', color: 'teal', tag: '招募调研与设计伙伴', text: '把城市中值得被看见的公共议题和行动者连接起来，准备从北京开始试点。' },
  { title: '为非技术人做一门 AI 产品课', owner: '周若岚', initial: '周', color: 'coral', tag: '寻找课程设计伙伴', text: '一套从真实问题出发的 AI 产品实战工作坊，正在招募内容与社群伙伴。' }
];
const invites = [{ code: 'YOUTH-7K9P', used: '18 / 30 已使用', status: '有效至 10 月 30 日' }, { code: 'FRONTIER-A2M', used: '6 / 10 已使用', status: '有效至 11 月 12 日' }, { code: 'JOIN-2026', used: '23 / 50 已使用', status: '长期有效' }];
const $ = (s) => document.querySelector(s);
const showToast = (text) => { const el = $('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400); };
function renderMembers(list = members) { $('#member-grid').innerHTML = list.map(m => `<article class="member-card"><div class="member-head"><div class="avatar ${m.color === 'teal' ? 'avatar-teal' : m.color}">${m.initial}</div><div><h3>${m.name}</h3><p class="school">${m.school}</p></div></div><p class="role">${m.role}</p><div class="tags">${m.tags.map(t => `<span>${t}</span>`).join('')}</div><div class="card-footer"><span><i data-lucide="clock-3"></i> ${m.time}</span><span><i data-lucide="sparkles"></i> AI 推荐</span></div></article>`).join(''); lucide.createIcons(); }
function renderIntents() { $('#intent-grid').innerHTML = intents.map(i => `<article class="intent-card"><span class="status">${i.tag}</span><h2>${i.title}</h2><p>${i.text}</p><div class="intent-owner"><div class="avatar ${i.color}">${i.initial}</div><span>发起人 · ${i.owner}</span></div></article>`).join(''); }
function renderInvites() { $('#invite-list').innerHTML = invites.map(i => `<div class="invite-row"><span class="invite-code">${i.code}</span><p>${i.used}<br/><small>${i.status}</small></p><button class="outline" onclick="navigator.clipboard?.writeText('${i.code}'); showToast('邀请码已复制')">复制</button></div>`).join(''); }
function navigate(view) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === view)); document.querySelectorAll('[data-view]').forEach(v => v.classList.toggle('active', v.dataset.view === view)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
document.querySelectorAll('[data-view-link]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.viewLink)));
$('#member-search').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); renderMembers(members.filter(m => Object.values(m).join(' ').toLowerCase().includes(q))); });
document.querySelectorAll('.filter-chip').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); const f = btn.dataset.filter; renderMembers(f === 'all' ? members : members.filter(m => m.tags.join(' ').includes(f) || m.time.includes(f))); }));
function addChat(text) { const conversation = $('#conversation'); conversation.insertAdjacentHTML('beforeend', `<div class="message user"><div class="message-avatar">林</div><div class="bubble">${text}</div></div>`); const matches = /教育|周末/.test(text) ? members.slice(0, 3) : /海外/.test(text) ? [members[4], members[0], members[3]] : [members[1], members[0], members[5]]; setTimeout(() => { conversation.insertAdjacentHTML('beforeend', `<div class="message ai"><div class="message-avatar">知</div><div class="bubble">我找到了几位和你的描述高度契合的成员。他们的公开资料中都提到了相关经历，并且时间安排可以配合。</div></div><section class="match-result"><h3>为你推荐 ${matches.length} 位伙伴</h3>${matches.map(m => `<div class="match-person"><div class="avatar ${m.color === 'teal' ? 'avatar-teal' : m.color}">${m.initial}</div><div class="meta"><b>${m.name}</b><p>${m.role}</p><div class="tags">${m.tags.map(t => `<span>${t}</span>`).join('')}</div></div><span class="score">${m.match}%</span></div>`).join('')}</section>`); conversation.scrollTop = conversation.scrollHeight; lucide.createIcons(); }, 550); conversation.scrollTop = conversation.scrollHeight; }
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const input = $('#chat-text'); if (!input.value.trim()) return; addChat(input.value.trim()); input.value = ''; });
document.querySelectorAll('[data-prompt]').forEach(b => b.addEventListener('click', () => { $('#chat-text').value = b.dataset.prompt; $('#chat-form').requestSubmit(); }));
$('#save-profile').addEventListener('click', () => showToast('资料已保存，更新将在成员目录中生效'));
function createInvite(){ const code = `YOUTH-${Math.random().toString(36).slice(2,6).toUpperCase()}`; invites.unshift({ code, used: '0 / 10 已使用', status: '有效至 11 月 20 日' }); renderInvites(); showToast(`已创建邀请码 ${code}`); }
$('#create-invite').addEventListener('click', createInvite); $('#create-invite-small').addEventListener('click', createInvite);
$('#publish-intent').addEventListener('click', () => showToast('协作意向发布功能已准备就绪'));
renderMembers(); renderIntents(); renderInvites(); lucide.createIcons();
