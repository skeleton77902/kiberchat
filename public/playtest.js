// ============================================
// ПЛЕЙТЕСТЫ И ФИДБЕК
// ============================================

// ============================================
// СТАТИСТИКА
// ============================================
function refreshStats() {
    const builds = DB.get('builds', []);
    const runs = DB.get('playtestRuns', []);
    const feedback = DB.get('feedback', []);

    const statBuilds = document.getElementById('statBuilds');
    const statRuns = document.getElementById('statRuns');
    const statBugs = document.getElementById('statBugs');
    const statAvgTime = document.getElementById('statAvgTime');

    if (statBuilds) statBuilds.textContent = builds.length;
    if (statRuns) statRuns.textContent = runs.length;
    if (statBugs) statBugs.textContent = feedback.filter(f => f.type === 'BUG').length;

    const avgTime = runs.length > 0
        ? Math.round(runs.reduce((s, r) => s + (r.duration || 0), 0) / runs.length)
        : 0;

    if (statAvgTime) statAvgTime.textContent = avgTime + 'м';
}

// ============================================
// БИЛДЫ — ОТОБРАЖЕНИЕ
// ============================================
function renderBuilds() {
    const builds = DB.get('builds', []);
    const container = document.getElementById('buildsList');
    if (!container) return;

    if (builds.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--text2);font-style:italic;">
                Нет экспериментов
            </div>`;
        return;
    }

    const icons = {
        Windows: 'fa-windows',
        macOS: 'fa-apple',
        Linux: 'fa-linux',
        WebGL: 'fa-globe',
        Android: 'fa-android',
        iOS: 'fa-mobile'
    };

    container.innerHTML = builds.map((b, i) => {
        const date = new Date(b.time).toLocaleDateString('ru-RU');
        const isFound = isFounder(b.author);

        return `
            <div class="build-item">
                <div class="build-platform">
                    <i class="fab ${icons[b.platform] || 'fa-windows'}"></i>
                </div>
                <div class="build-info">
                    <div class="build-version">v${escapeHtml(b.version)}</div>
                    <div class="build-meta">
                        <span><i class="fas fa-desktop"></i> ${b.platform}</span>
                        <span><i class="fas fa-hdd"></i> ${b.size} MB</span>
                        <span><i class="fas fa-calendar"></i> ${date}</span>
                        ${isFound ? '<span style="color:var(--yellow);">👑</span>' : ''}
                    </div>
                    ${b.changelog ? `<div style="font-size:12px;color:var(--text2);margin-top:6px;">${escapeHtml(b.changelog)}</div>` : ''}
                </div>
                <button class="btn-small danger" onclick="deleteBuild(${i})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

// ============================================
// БИЛДЫ — СОЗДАНИЕ
// ============================================
function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.classList.add('show');
}

function uploadBuild() {
    const version = document.getElementById('buildVersion').value.trim();
    if (!version) return toast('Укажи версию', 'error');

    const builds = DB.get('builds', []);
    builds.unshift({
        version: version,
        platform: document.getElementById('buildPlatform').value,
        size: parseInt(document.getElementById('buildSize').value) || 100,
        changelog: document.getElementById('buildChangelog').value.trim(),
        time: Date.now(),
        author: currentUser.username
    });
    DB.set('builds', builds);

    closeModal('uploadModal');
    document.getElementById('buildVersion').value = '';
    document.getElementById('buildSize').value = '';
    document.getElementById('buildChangelog').value = '';

    toast(`✅ Билд v${version} загружен`, 'success');
    renderBuilds();
    refreshStats();
}

// ============================================
// БИЛДЫ — УДАЛЕНИЕ
// ============================================
function deleteBuild(i) {
    if (!confirm('Удалить билд?')) return;

    const builds = DB.get('builds', []);
    builds.splice(i, 1);
    DB.set('builds', builds);

    renderBuilds();
    refreshStats();
    toast('Билд удалён', 'success');
}

// ============================================
// ФИДБЕК — ОТОБРАЖЕНИЕ
// ============================================
function renderFeedback() {
    const feedback = DB.get('feedback', []);
    const container = document.getElementById('feedbackList');
    if (!container) return;

    if (feedback.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--text2);font-style:italic;">
                Нет багов — отличная работа!
            </div>`;
        return;
    }

    const typeLabels = {
        BUG: '🐛 BUG',
        FEATURE: '💡 ИДЕЯ',
        BALANCE: '⚖️ БАЛАНС',
        UX: '🎨 UX',
        PERFORMANCE: '⚡ PERF'
    };

    const priorityColors = {
        LOW: 'rgba(151,206,76,0.15)',
        MEDIUM: 'rgba(0,201,255,0.15)',
        HIGH: 'rgba(255,176,0,0.15)',
        CRITICAL: 'rgba(231,76,60,0.15)'
    };

    const priorityTextColors = {
        LOW: 'var(--green)',
        MEDIUM: 'var(--portal-cyan)',
        HIGH: 'var(--signal-amber)',
        CRITICAL: 'var(--red)'
    };

    container.innerHTML = feedback.map((f, i) => {
        const isFound = isFounder(f.author);
        const date = new Date(f.time).toLocaleDateString('ru-RU');
        const priorityColor = priorityColors[f.priority] || 'rgba(151,206,76,0.15)';
        const priorityText = priorityTextColors[f.priority] || 'var(--green)';

        return `
            <div class="feedback-item">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                    <span style="font-size:10px;padding:3px 8px;border-radius:6px;font-weight:700;
                        background:rgba(231,76,60,0.15);color:var(--red);
                        font-family:'JetBrains Mono',monospace;">
                        ${typeLabels[f.type] || f.type}
                    </span>
                    <span style="font-size:10px;padding:3px 8px;border-radius:6px;font-weight:700;
                        background:${priorityColor};color:${priorityText};
                        font-family:'JetBrains Mono',monospace;">
                        ${f.priority}
                    </span>
                    <span style="font-size:10px;padding:3px 8px;border-radius:6px;font-weight:700;
                        background:rgba(255,176,0,0.15);color:var(--signal-amber);
                        font-family:'JetBrains Mono',monospace;">
                        ${f.status}
                    </span>
                    ${isFound ? '<span class="msg-badge badge-founder">👑</span>' : ''}
                    <span style="margin-left:auto;font-size:11px;color:var(--text2);">${date}</span>
                </div>
                <div style="font-size:15px;font-weight:700;margin-bottom:6px;">
                    ${escapeHtml(f.title)}
                </div>
                <div style="font-size:13px;color:var(--text2);line-height:1.5;">
                    ${escapeHtml(f.content || '')}
                </div>
                <div style="display:flex;align-items:center;gap:16px;margin-top:10px;font-size:12px;color:var(--text2);">
                    <span><i class="fas fa-user"></i> ${escapeHtml(f.author)}</span>
                    ${f.author === currentUser.username ? `
                        <button class="btn-small danger" 
                            style="margin-left:auto;padding:4px 10px;font-size:11px;" 
                            onclick="deleteFeedback(${i})">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// ФИДБЕК — СОЗДАНИЕ
// ============================================
function openFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (modal) modal.classList.add('show');
}

function submitFeedback() {
    const title = document.getElementById('fbTitle').value.trim();
    if (title.length < 5) {
        return toast('Заголовок от 5 символов', 'error');
    }

    const feedback = DB.get('feedback', []);
    feedback.unshift({
        type: document.getElementById('fbType').value,
        priority: document.getElementById('fbPriority').value,
        title: title,
        content: document.getElementById('fbContent').value.trim(),
        author: currentUser.username,
        status: 'OPEN',
        time: Date.now()
    });
    DB.set('feedback', feedback);

    closeModal('feedbackModal');
    document.getElementById('fbTitle').value = '';
    document.getElementById('fbContent').value = '';

    toast('✅ Фидбек отправлен', 'success');
    renderFeedback();
    refreshStats();
}

// ============================================
// ФИДБЕК — УДАЛЕНИЕ
// ============================================
function deleteFeedback(i) {
    if (!confirm('Удалить фидбек?')) return;

    const feedback = DB.get('feedback', []);
    feedback.splice(i, 1);
    DB.set('feedback', feedback);

    renderFeedback();
    refreshStats();
    toast('Фидбек удалён', 'success');
}

console.log('✅ playtest.js загружен');