let socket = null;
let history = [];
let activeIndex = 0;
let filterPinnedOnly = false;
const inboxNotifications = [];
let lastLoggedWindowName = '';
let lastLoggedInjectStatus = null;
let currentBranch = '';
let searchQuery = '';
let filteredHistory = null;

// ─────────────────────────────────────────────
// CURSOR TRACKING
// ─────────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
  document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
});

// ─────────────────────────────────────────────
// TEXT DECRYPT ANIMATION
// ─────────────────────────────────────────────
function decryptText(element, finalValue, duration = 400) {
  if (!element) return;
  const chars = '01%&#?_@XZ[]{}<>';
  const start = Date.now();
  const intervalTime = 30;
  const timer = setInterval(() => {
    const elapsed = Date.now() - start;
    const progress = Math.min(1, elapsed / duration);
    const decodedLength = Math.floor(progress * finalValue.length);
    let displayStr = finalValue.slice(0, decodedLength);
    for (let i = decodedLength; i < finalValue.length; i++) {
      if (' /\\'.includes(finalValue[i])) {
        displayStr += finalValue[i];
      } else {
        displayStr += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    element.innerText = displayStr;
    if (progress >= 1) {
      clearInterval(timer);
      element.innerText = finalValue;
    }
  }, intervalTime);
}

// ─────────────────────────────────────────────
// TOAST NOTIFICATION SYSTEM
// ─────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const toastIcons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    action: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
  };
  toast.innerHTML = `
    <span class="toast-icon">${toastIcons[type] || toastIcons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  const timeout = type === 'error' ? 6000 : 4000;
  setTimeout(() => removeToast(toast), timeout);
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove('toast-visible');
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// ─────────────────────────────────────────────
// CONFIRM MODAL
// ─────────────────────────────────────────────
let confirmResolve = null;

function showConfirm(title, message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmModal').classList.add('open');
  });
}

function closeConfirm(result) {
  document.getElementById('confirmModal').classList.remove('open');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

// ─────────────────────────────────────────────
// DOM ELEMENTS
// ─────────────────────────────────────────────
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const projectTitleEl = document.getElementById('projectTitle');
const filterToggleBtn = document.getElementById('filterToggleBtn');
const timeLabelEl = document.getElementById('timeLabel');
const timeDisplayEl = document.getElementById('timeDisplay');
const pinBadgeEl = document.getElementById('pinBadge');
const noteContainer = document.getElementById('noteContainer');
const noteInput = document.getElementById('noteInput');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const timelineNodesWrapper = document.getElementById('timelineNodesWrapper');
const timelineSliderEl = document.getElementById('timelineSlider');
const timelineCountTextEl = document.getElementById('timelineCountText');
const fileCountBadgeEl = document.getElementById('fileCountBadge');
const fileListEl = document.getElementById('fileList');
const pinBtnEl = document.getElementById('pinBtn');
const restoreBtnEl = document.getElementById('restoreBtn');
const deleteBtnEl = document.getElementById('deleteBtn');
const searchInput = document.getElementById('searchInput');
const rightGitBranch = document.getElementById('rightGitBranch');

const navItems = {
  navInbox: { nav: document.getElementById('navInbox'), tab: document.getElementById('tabContentInbox') },
  navVersions: { nav: document.getElementById('navVersions'), tab: document.getElementById('tabContentVersions') },
  navPulse: { nav: document.getElementById('navPulse'), tab: document.getElementById('tabContentPulse') },
  navAnalytics: { nav: document.getElementById('navAnalytics'), tab: document.getElementById('tabContentAnalytics') }
};

const previewModal = document.getElementById('previewModal');
const previewModalTitle = document.getElementById('previewModalTitle');
const previewModalSubtitle = document.getElementById('previewModalSubtitle');
const codeContent = document.getElementById('codeContent');
const closeModalBtn = document.getElementById('closeModalBtn');

const diffModal = document.getElementById('diffModal');
const diffModalTitle = document.getElementById('diffModalTitle');
const diffModalSubtitle = document.getElementById('diffModalSubtitle');
const diffContainer = document.getElementById('diffContainer');
const closeDiffModalBtn = document.getElementById('closeDiffModalBtn');

const sidebarBookmarksList = document.getElementById('sidebarBookmarksList');
const breadcrumbActiveState = document.getElementById('breadcrumbActiveState');
const metaStateId = document.getElementById('metaStateId');
const rightPanelStatus = document.getElementById('rightPanelStatus');
const rightPanelPriority = document.getElementById('rightPanelPriority');

// ─────────────────────────────────────────────
// NOTIFICATION HELPER
// ─────────────────────────────────────────────
function addNotification(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const date = new Date().toLocaleDateString();
  inboxNotifications.unshift({ message, type, time, date });

  const inboxTab = document.getElementById('tabContentInbox');
  if (inboxTab && inboxTab.style.display !== 'none') {
    renderInboxTab();
  }
}

// ─────────────────────────────────────────────
// HISTORY FILTERING
// ─────────────────────────────────────────────
function getVisibleHistory() {
  let list = filterPinnedOnly ? history.filter(e => e.pinned) : history;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(entry => {
      const noteMatch = (entry.note || '').toLowerCase().includes(q);
      const timeMatch = (entry.formattedTime || '').toLowerCase().includes(q);
      const branchMatch = (entry.branch || '').toLowerCase().includes(q);
      const fileMatch = (entry.files || []).some(f => {
        const basename = f.split('/').pop().toLowerCase();
        return basename.includes(q) || f.toLowerCase().includes(q);
      });
      const idMatch = `cc-${entry.timestamp}`.includes(q);
      return noteMatch || timeMatch || branchMatch || fileMatch || idMatch;
    });
  }

  return list;
}

// ─────────────────────────────────────────────
// ACTIVE WINDOW UI
// ─────────────────────────────────────────────
function updateActiveWindowUI(activeWindow) {
  const panel = document.getElementById('activeInjectionPanel');
  const label = document.getElementById('injectionStatusLabel');
  const dot = document.getElementById('injectionDot');
  const iconWrapper = document.getElementById('injectionIconWrapper');
  const iconImg = document.getElementById('injectionIcon');
  const nameEl = document.getElementById('injectionName');
  const fileEl = document.getElementById('injectionFile');
  const rightActiveIde = document.getElementById('rightActiveIde');
  const rightAttachStatus = document.getElementById('rightAttachStatus');

  if (!activeWindow || !activeWindow.processName) {
    if (panel) {
      panel.className = 'active-injection-panel failed';
    }
    if (label) label.innerText = 'FAILED';
    if (nameEl) nameEl.innerText = 'Telemetry Stopped';
    if (fileEl) { fileEl.innerText = 'Active window tracker failed / inactive'; fileEl.title = 'Inactive'; }
    if (iconWrapper) iconWrapper.style.display = 'none';
    if (rightActiveIde) rightActiveIde.innerText = 'None';
    if (rightAttachStatus) rightAttachStatus.innerHTML = '<span class="attach-status-badge badge-failed">FAILED</span>';
    return;
  }

  const nameLower = activeWindow.processName.toLowerCase();
  const isInjected = activeWindow.status === 'injected';
  const isNotInjected = activeWindow.status === 'not_injected';

  if (isInjected) {
    if (panel) {
      panel.className = 'active-injection-panel injected';
    }
    if (label) label.innerText = 'INJECTED';
    if (rightAttachStatus) rightAttachStatus.innerHTML = '<span class="attach-status-badge badge-injected">INJECTED</span>';
  } else if (isNotInjected) {
    if (panel) {
      panel.className = 'active-injection-panel not_injected';
    }
    if (label) label.innerText = 'NOT INJECTED';
    if (rightAttachStatus) rightAttachStatus.innerHTML = '<span class="attach-status-badge badge-not-injected">NOT INJECTED</span>';
  } else {
    if (panel) {
      panel.className = 'active-injection-panel failed';
    }
    if (label) label.innerText = 'FAILED';
    if (rightAttachStatus) rightAttachStatus.innerHTML = '<span class="attach-status-badge badge-failed">FAILED</span>';
  }

  if (activeWindow.icon && activeWindow.icon !== 'None' && nameLower !== 'none') {
    if (iconImg) iconImg.src = `data:image/png;base64,${activeWindow.icon}`;
    if (iconWrapper) iconWrapper.style.display = 'flex';
  } else {
    if (iconWrapper) iconWrapper.style.display = 'none';
  }

  if (nameEl) nameEl.innerText = nameLower === 'none' ? 'No active IDE / Code Editor' : activeWindow.processName;
  if (fileEl) { fileEl.innerText = activeWindow.title || 'Untitled Window'; fileEl.title = activeWindow.title || 'Untitled Window'; }
  if (rightActiveIde) rightActiveIde.innerText = nameLower === 'none' ? 'None' : activeWindow.processName;

  const logMsg = isInjected
    ? `Injected target updated: ${activeWindow.processName} - "${activeWindow.title || 'No Title'}"`
    : `Active process monitoring: ${activeWindow.processName} [${activeWindow.status || 'not_injected'}]`;

  if (activeWindow.processName !== lastLoggedWindowName || isInjected !== lastLoggedInjectStatus) {
    addNotification(logMsg, isInjected ? 'success' : 'system');
    lastLoggedWindowName = activeWindow.processName;
    lastLoggedInjectStatus = isInjected;
  }
}

// ─────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const emailParam = currentUser ? encodeURIComponent(currentUser.email) : 'anonymous';
  const platformParam = window.navigator.userAgent.includes('Windows') ? 'Windows' : (window.navigator.userAgent.includes('Mac') ? 'macOS' : 'Linux');
  socket = new WebSocket(`${protocol}//${window.location.host}?email=${emailParam}&platform=${platformParam}`);

  socket.onopen = () => {
    statusBadge.classList.add('online');
    statusText.innerText = 'PIPELINE ONLINE';
    if (rightPanelStatus) { rightPanelStatus.innerText = 'ONLINE'; rightPanelStatus.className = 'badge-status-online'; }
    showToast('WebSocket connected. Synchronizing...', 'success');
    addNotification('WebSocket connection established. Synchronizing telemetry...', 'success');
  };

  socket.onclose = () => {
    statusBadge.classList.remove('online');
    statusText.innerText = 'DISCONNECTED';
    if (rightPanelStatus) { rightPanelStatus.innerText = 'OFFLINE'; rightPanelStatus.className = 'badge-status-offline'; }
    showToast('Connection lost. Retrying...', 'error');
    addNotification('Connection to WebSocket server lost. Retrying...', 'system');
    timelineSliderEl.disabled = true;
    pinBtnEl.disabled = true;
    restoreBtnEl.disabled = true;
    deleteBtnEl.disabled = true;
    saveNoteBtn.disabled = true;
    setTimeout(connectWS, 3000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        decryptText(projectTitleEl, `MONITORING: ${data.projectTitle.toUpperCase()}`, 800);
        history = data.history || [];
        currentBranch = data.branch || '';
        updateBranchDisplay();

        const visible = getVisibleHistory();
        activeIndex = visible.length > 0 ? visible.length - 1 : 0;
        renderActiveState();
        updateActiveWindowUI(data.activeWindow);
        addNotification(`Linked to workspace: ${data.projectTitle}. Synchronized ${history.length} versions.`, 'success');
      }
      else if (data.type === 'historyUpdate') {
        const visibleBefore = getVisibleHistory();
        const wasAtLatest = activeIndex === visibleBefore.length - 1 || visibleBefore.length === 0;
        const oldHistoryLength = history.length;
        history = data.history || [];
        const visibleAfter = getVisibleHistory();

        if (wasAtLatest) {
          activeIndex = visibleAfter.length > 0 ? visibleAfter.length - 1 : 0;
        } else {
          activeIndex = Math.max(0, Math.min(activeIndex, visibleAfter.length - 1));
        }

        renderActiveState();
        if (navItems.navPulse.tab.style.display !== 'none') renderPulseTab();
        if (navItems.navAnalytics.tab.style.display !== 'none') renderAnalyticsTab();

        if (history.length > oldHistoryLength) {
          const newSnapshot = history[history.length - 1];
          const filesString = newSnapshot.files.map(f => f.split('/').pop()).join(', ');
          const msg = `Snapshot captured: CC-${newSnapshot.timestamp.toString().slice(-6)} [${filesString}]`;
          showToast(msg, 'success');
          addNotification(msg, 'action');
        } else if (history.length < oldHistoryLength) {
          addNotification('Snapshot directory permanently deleted from local disk.', 'system');
        } else {
          addNotification('State database metadata updated.', 'system');
        }
      }
      else if (data.type === 'activeWindowUpdate') {
        updateActiveWindowUI(data.activeWindow);
      }
      else if (data.type === 'restoreComplete') {
        restoreBtnEl.innerText = 'Project Restored!';
        restoreBtnEl.style.backgroundColor = '#27a644';
        restoreBtnEl.style.borderColor = '#27a644';
        restoreBtnEl.style.color = '#fff';
        showToast(`Restored to CC-${data.timestamp.toString().slice(-6)}`, 'success');
        addNotification(`Restoration succeeded for CC-${data.timestamp.toString().slice(-6)}. Workspace restored.`, 'success');
        setTimeout(() => {
          restoreBtnEl.innerText = 'Restore to this point';
          restoreBtnEl.style.backgroundColor = '';
          restoreBtnEl.style.borderColor = '';
          restoreBtnEl.style.color = '';
          restoreBtnEl.disabled = false;
          deleteBtnEl.disabled = false;
        }, 1800);
      }
      else if (data.type === 'error') {
        showToast(`Error: ${data.message}`, 'error');
        addNotification(`Engine Error: ${data.message}`, 'system');
        restoreBtnEl.disabled = false;
        restoreBtnEl.innerText = 'Restore to this point';
        deleteBtnEl.disabled = false;
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  };
}

function updateBranchDisplay() {
  if (rightGitBranch) {
    rightGitBranch.innerText = currentBranch ? currentBranch : '--';
  }
}

// ─────────────────────────────────────────────
// RENDER ACTIVE STATE
// ─────────────────────────────────────────────
function renderActiveState() {
  const visible = getVisibleHistory();
  renderSidebarBookmarks();
  const onboardingEl = document.getElementById('onboardingGuide');
  const detailsTitleEl = document.querySelector('.issue-title-block');
  const changeLogSectionEl = document.querySelector('.change-log-section');

  if (visible.length === 0) {
    if (onboardingEl) onboardingEl.style.display = 'block';
    if (detailsTitleEl) detailsTitleEl.style.display = 'none';
    if (changeLogSectionEl) changeLogSectionEl.style.display = 'none';
    timeLabelEl.innerText = 'No Saved State';
    timeDisplayEl.innerText = '--:--:--';
    pinBadgeEl.style.display = 'none';
    noteContainer.style.display = 'none';
    timelineSliderEl.disabled = true;
    timelineSliderEl.max = 0;
    timelineSliderEl.value = 0;
    timelineCountTextEl.innerText = searchQuery ? 'No matching states' : '0 states recorded';
    fileCountBadgeEl.innerText = '0';
    fileListEl.innerHTML = '<div class="empty-state">No files modified at this timestamp</div>';
    timelineNodesWrapper.innerHTML = '<div class="no-nodes-message">No states recorded yet</div>';
    if (breadcrumbActiveState) breadcrumbActiveState.innerText = 'State Detail';
    if (metaStateId) metaStateId.innerText = 'STATE-0000';
    pinBtnEl.disabled = true;
    pinBtnEl.classList.remove('pinned');
    pinBtnEl.innerText = 'Bookmark State';
    restoreBtnEl.disabled = true;
    deleteBtnEl.disabled = true;
    return;
  }

  if (onboardingEl) onboardingEl.style.display = 'none';
  if (detailsTitleEl) detailsTitleEl.style.display = 'block';
  if (changeLogSectionEl) changeLogSectionEl.style.display = 'block';

  timelineSliderEl.disabled = false;
  timelineSliderEl.max = visible.length - 1;
  timelineSliderEl.value = activeIndex;

  const currentEvent = visible[activeIndex];
  if (!currentEvent) return;

  const timeStr = currentEvent.formattedTime.split(' ')[0];
  const dateStr = currentEvent.formattedTime.split(' ').slice(1).join(' ');
  const shortId = `CC-${currentEvent.timestamp.toString().slice(-6)}`;

  if (metaStateId) decryptText(metaStateId, shortId, 300);
  if (breadcrumbActiveState) {
    breadcrumbActiveState.innerText = currentEvent.note ? `${shortId}: ${currentEvent.note}` : `${shortId}`;
  }

  const textStr = currentEvent.note ? `"${currentEvent.note}" (${dateStr})` : `Version State (${dateStr})`;
  decryptText(timeLabelEl, textStr, 500);
  timeDisplayEl.innerText = timeStr;

  if (currentEvent.pinned) {
    pinBadgeEl.style.display = 'inline-block';
    pinBtnEl.classList.add('pinned');
    pinBtnEl.innerText = 'Bookmarked';
    if (rightPanelPriority) rightPanelPriority.innerHTML = '<span class="badge-priority-pinned">Pinned Milestone</span>';
  } else {
    pinBadgeEl.style.display = 'none';
    pinBtnEl.classList.remove('pinned');
    pinBtnEl.innerText = 'Bookmark State';
    if (rightPanelPriority) rightPanelPriority.innerHTML = '<span class="badge-priority-micro">Micro-Commit</span>';
  }

  // Update branch if snapshot has one
  if (currentEvent.branch) {
    currentBranch = currentEvent.branch;
    updateBranchDisplay();
  }

  noteContainer.style.display = 'block';
  noteInput.value = currentEvent.note || '';

  // Timeline nodes
  timelineNodesWrapper.innerHTML = '';
  visible.forEach((event, idx) => {
    const node = document.createElement('div');
    node.className = 'timeline-node';
    if (idx === activeIndex) node.classList.add('active');
    if (event.pinned) node.classList.add('pinned');

    const t = event.formattedTime.split(' ')[0];
    const label = event.note ? `"${event.note}" [${t}]` : t;
    node.setAttribute('data-time', label);
    node.setAttribute('data-index', idx);
    node.addEventListener('click', () => { activeIndex = idx; renderActiveState(); });
    timelineNodesWrapper.appendChild(node);
  });

  const activeNode = timelineNodesWrapper.querySelector('.timeline-node.active');
  if (activeNode) activeNode.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  const isLatest = activeIndex === visible.length - 1;
  timelineCountTextEl.innerText = `State ${activeIndex + 1} of ${visible.length} ${isLatest ? '(Latest)' : ''}`;

  pinBtnEl.disabled = false;
  restoreBtnEl.disabled = false;
  deleteBtnEl.disabled = false;
  saveNoteBtn.disabled = false;

  // File list
  fileCountBadgeEl.innerText = currentEvent.files.length;
  if (currentEvent.files.length > 0) {
    fileListEl.innerHTML = '';
    currentEvent.files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item animate-file-entry';
      item.setAttribute('data-path', file);

      const fileBtns = document.createElement('div');
      fileBtns.className = 'file-item-actions';

      const previewBtn = document.createElement('button');
      previewBtn.className = 'file-action-btn';
      previewBtn.title = 'Preview file contents';
      previewBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
      previewBtn.addEventListener('click', (e) => { e.stopPropagation(); openFilePreview(currentEvent.timestamp, file); });

      const diffBtn = document.createElement('button');
      diffBtn.className = 'file-action-btn';
      diffBtn.title = 'Diff with previous snapshot';
      diffBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/></svg>';
      diffBtn.addEventListener('click', (e) => { e.stopPropagation(); openDiffForFile(file); });

      fileBtns.appendChild(previewBtn);
      fileBtns.appendChild(diffBtn);

      const pathSpan = document.createElement('span');
      pathSpan.className = 'file-path';
      pathSpan.title = file;

      item.appendChild(pathSpan);
      item.appendChild(fileBtns);
      fileListEl.appendChild(item);
      decryptText(pathSpan, file, 600);
    });
  } else {
    fileListEl.innerHTML = '<div class="empty-state">No files modified at this timestamp</div>';
  }
}

// ─────────────────────────────────────────────
// RENDER SIDEBAR BOOKMARKS
// ─────────────────────────────────────────────
function renderSidebarBookmarks() {
  if (!sidebarBookmarksList) return;
  const bookmarked = history.filter(e => e.pinned);

  if (bookmarked.length === 0) {
    sidebarBookmarksList.innerHTML = '<li class="nav-item italic-empty">No bookmarked states</li>';
  } else {
    sidebarBookmarksList.innerHTML = bookmarked.map(event => {
      const timePart = event.formattedTime.split(' ')[0];
      const namePart = event.note || `Snapshot CC-${event.timestamp.toString().slice(-6)}`;
      return `
        <li class="nav-item sidebar-bookmark-item" data-timestamp="${event.timestamp}">
          <span class="nav-item-icon"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" class="nav-lucide-icon"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>
          <span class="bookmark-note-text" title="${namePart}">${namePart}</span>
          <span class="bookmark-time-text">${timePart}</span>
        </li>
      `;
    }).join('');

    sidebarBookmarksList.querySelectorAll('.sidebar-bookmark-item').forEach(item => {
      item.addEventListener('click', () => {
        const ts = Number(item.getAttribute('data-timestamp'));
        const visible = getVisibleHistory();
        const idx = visible.findIndex(e => e.timestamp === ts);
        if (idx !== -1) {
          activeIndex = idx;
          renderActiveState();
        } else {
          const allIdx = history.findIndex(e => e.timestamp === ts);
          if (allIdx !== -1) {
            filterPinnedOnly = false;
            filterToggleBtn.classList.remove('active');
            activeIndex = allIdx;
            renderActiveState();
          }
        }
      });
    });
  }
}

// ─────────────────────────────────────────────
// INBOX TAB
// ─────────────────────────────────────────────
function renderInboxTab() {
  const inboxFeed = document.getElementById('inboxFeed');
  if (!inboxFeed) return;
  if (inboxNotifications.length === 0) {
    inboxFeed.innerHTML = '<div class="empty-state">No notifications recorded in this session</div>';
    return;
  }
  const inboxIcons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    action: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  inboxFeed.innerHTML = inboxNotifications.map(notif => {
    return `
      <div class="inbox-item">
        <span class="inbox-item-text">${inboxIcons[notif.type] || inboxIcons.info} ${notif.message}</span>
        <span class="inbox-item-time">${notif.time}</span>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────
// PULSE TAB
// ─────────────────────────────────────────────
function renderPulseTab() {
  const pulseGrid = document.getElementById('pulseGrid');
  if (!pulseGrid) return;

  const totalBoxes = 112;
  const now = Date.now();
  const intervalMs = 60 * 60 * 1000;
  const startTime = now - (totalBoxes - 1) * intervalMs;
  const bins = Array(totalBoxes).fill(0);

  history.forEach(entry => {
    const ageMs = now - entry.timestamp;
    const binIndex = totalBoxes - 1 - Math.floor(ageMs / intervalMs);
    if (binIndex >= 0 && binIndex < totalBoxes) bins[binIndex]++;
  });

  let html = '';
  for (let i = 0; i < totalBoxes; i++) {
    const count = bins[i];
    let level = 0;
    if (count === 1) level = 1;
    else if (count === 2) level = 2;
    else if (count === 3) level = 3;
    else if (count >= 4) level = 4;

    const binTime = new Date(startTime + i * intervalMs);
    const timeLabel = binTime.toLocaleDateString() + ' ' + binTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    html += `<div class="heatmap-box level-${level}" title="${count} versions at ${timeLabel}"></div>`;
  }
  pulseGrid.innerHTML = html;

  const sessionTimeLabel = document.getElementById('sessionTimeLabel');
  if (sessionTimeLabel && history.length > 0) {
    const oldestTimestamp = Math.min(...history.map(e => e.timestamp));
    const elapsedMinutes = Math.floor((Date.now() - oldestTimestamp) / 60000);
    if (elapsedMinutes < 1) {
      sessionTimeLabel.innerText = 'Started just now';
    } else if (elapsedMinutes < 60) {
      sessionTimeLabel.innerText = `Started ${elapsedMinutes}m ago \u2022 ${history.length} snapshots`;
    } else {
      const hours = Math.floor(elapsedMinutes / 60);
      const mins = elapsedMinutes % 60;
      sessionTimeLabel.innerText = `Started ${hours}h ${mins}m ago \u2022 ${history.length} snapshots`;
    }
  }
}

// ─────────────────────────────────────────────
// ANALYTICS TAB
// ─────────────────────────────────────────────
function renderAnalyticsTab() {
  const statsTotalStates = document.getElementById('statsTotalStates');
  const statsBookmarked = document.getElementById('statsBookmarked');
  const statsEfficiency = document.getElementById('statsEfficiency');
  const analyticsFileRows = document.getElementById('analyticsFileRows');

  if (statsTotalStates) statsTotalStates.innerText = history.length;
  if (statsBookmarked) statsBookmarked.innerText = history.filter(e => e.pinned).length;

  const efficiencyVal = Math.min(99, 90 + Math.min(9, Math.floor(history.length / 2)));
  if (statsEfficiency) statsEfficiency.innerText = `${efficiencyVal}%`;

  if (!analyticsFileRows) return;

  const fileCounts = {};
  history.forEach(entry => {
    (entry.files || []).forEach(file => {
      fileCounts[file] = (fileCounts[file] || 0) + 1;
    });
  });

  const sortedFiles = Object.keys(fileCounts).map(f => ({ name: f, count: fileCounts[f] })).sort((a, b) => b.count - a.count);

  if (sortedFiles.length === 0) {
    analyticsFileRows.innerHTML = '<div class="empty-state">No files tracked yet</div>';
    return;
  }

  const maxCount = sortedFiles[0].count;
  analyticsFileRows.innerHTML = sortedFiles.slice(0, 8).map(fileInfo => {
    const percentage = Math.round((fileInfo.count / maxCount) * 100);
    const basename = fileInfo.name.split('/').pop();
    return `
      <div class="analytics-file-row">
        <div class="analytics-file-info" title="${fileInfo.name}">${basename} <span style="color: var(--color-slate); font-size: 10px;">(${fileInfo.name})</span></div>
        <div class="analytics-file-bar-wrapper">
          <span class="analytics-count-label">${fileInfo.count} edits</span>
          <div class="analytics-file-bar-bg">
            <div class="analytics-file-bar-fill" style="width: ${percentage}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
function setupNavigation() {
  Object.keys(navItems).forEach(key => {
    const item = navItems[key];
    if (item.nav && item.tab) {
      item.nav.addEventListener('click', () => {
        Object.keys(navItems).forEach(k => {
          if (navItems[k].nav) navItems[k].nav.classList.remove('active');
          if (navItems[k].tab) { navItems[k].tab.style.display = 'none'; navItems[k].tab.classList.remove('active'); }
        });
        item.nav.classList.add('active');
        item.tab.style.display = 'block';
        item.tab.classList.add('active');
        if (key === 'navPulse') renderPulseTab();
        if (key === 'navAnalytics') renderAnalyticsTab();
        if (key === 'navInbox') renderInboxTab();
      });
    }
  });
}

// ─────────────────────────────────────────────
// FILE PREVIEW
// ─────────────────────────────────────────────
async function openFilePreview(timestamp, filePath) {
  previewModalTitle.innerText = filePath.split('/').pop();
  previewModalSubtitle.innerText = `Version at Snapshot ${new Date(Number(timestamp)).toLocaleTimeString()}`;
  codeContent.innerText = 'Loading file contents...';
  previewModal.classList.add('open');
  addNotification(`Fetching file snapshot preview: ${filePath}`, 'action');

  try {
    const token = localStorage.getItem('cc_token');
    const res = await fetch(`/api/file-content?timestamp=${timestamp}&path=${encodeURIComponent(filePath)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Failed to load file content (${res.status})`);
    const text = await res.text();
    codeContent.innerText = text;
    addNotification(`File preview loaded: ${filePath}`, 'success');
  } catch (err) {
    codeContent.innerText = `Error: ${err.message}`;
    showToast(`Preview error: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────
// DIFF VIEWER
// ─────────────────────────────────────────────
async function openDiffForFile(filePath) {
  if (!checkProPermission('Diffing versions')) return;
  const visible = getVisibleHistory();
  if (visible.length < 2) {
    showToast('Need at least 2 snapshots to diff', 'info');
    return;
  }

  const current = visible[activeIndex];
  const prevIndex = activeIndex > 0 ? activeIndex - 1 : null;
  if (prevIndex === null) {
    showToast('No previous snapshot to diff against', 'info');
    return;
  }
  const previous = visible[prevIndex];

  // Check if file exists in both
  const inCurrent = current.files.includes(filePath);
  const inPrevious = previous.files.includes(filePath);
  if (!inCurrent && !inPrevious) {
    showToast('File not found in either snapshot', 'info');
    return;
  }

  diffModalTitle.innerText = filePath.split('/').pop();
  diffModalSubtitle.innerText = `CC-${previous.timestamp.toString().slice(-6)} → CC-${current.timestamp.toString().slice(-6)}`;
  diffContainer.innerHTML = '<div class="empty-state">Computing diff...</div>';
  diffModal.classList.add('open');

  try {
    const token = localStorage.getItem('cc_token');
    const res = await fetch(`/api/diff?from=${previous.timestamp}&to=${current.timestamp}&path=${encodeURIComponent(filePath)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Diff request failed (${res.status})`);
    const data = await res.json();

    if (!data.diff || data.diff.length === 0) {
      diffContainer.innerHTML = '<div class="empty-state">No differences found</div>';
      return;
    }

    let html = '<table class="diff-table">';
    let lineNum = 0;
    data.diff.forEach(entry => {
      lineNum++;
      const typeClass = entry.type === 'add' ? 'diff-add' : entry.type === 'remove' ? 'diff-remove' : 'diff-context';
      const prefix = entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' ';
      const oldNum = entry.oldNum || '';
      const newNum = entry.newNum || '';
      const escaped = entry.line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<tr class="${typeClass}"><td class="diff-ln">${oldNum}</td><td class="diff-ln">${newNum}</td><td class="diff-prefix">${prefix}</td><td class="diff-code">${escaped}</td></tr>`;
    });
    html += '</table>';
    diffContainer.innerHTML = html;
  } catch (err) {
    diffContainer.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    showToast(`Diff error: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────
// EXPORT / IMPORT
// ─────────────────────────────────────────────
async function exportTimeline() {
  if (!checkProPermission('Exporting timeline data')) return;
  showToast('Preparing export...', 'action');
  try {
    const token = localStorage.getItem('cc_token');
    const res = await fetch('/api/export', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronocode-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export downloaded successfully', 'success');
    addNotification('Timeline data exported', 'action');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
}

async function importTimeline(file) {
  if (!checkProPermission('Importing timeline data')) return;
  showToast('Importing timeline data...', 'action');
  try {
    const text = await file.text();
    const bundle = JSON.parse(text);
    const token = localStorage.getItem('cc_token');
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(bundle),
    });
    if (!res.ok) throw new Error('Import request failed');
    const data = await res.json();
    showToast(`Imported ${data.imported} snapshots (${data.total} total)`, 'success');
    addNotification(`Timeline imported: ${data.imported} new snapshots`, 'action');
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────
async function runCleanup() {
  if (!checkProPermission('Running database cleanup')) return;
  const maxAge = document.getElementById('cleanupMaxAge').value;
  const maxCount = document.getElementById('cleanupMaxCount').value;

  const body = {};
  if (maxAge) body.maxAge = parseInt(maxAge, 10);
  if (maxCount) body.maxCount = parseInt(maxCount, 10);

  if (!body.maxAge && !body.maxCount) {
    showToast('Set at least one cleanup parameter', 'info');
    return;
  }

  const ok = await showConfirm('Run Cleanup', 'This will permanently delete old snapshots. Continue?');
  if (!ok) return;

  try {
    const token = localStorage.getItem('cc_token');
    const res = await fetch('/api/cleanup', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Cleanup failed');
    const data = await res.json();
    showToast(`Cleanup complete: ${data.deleted} deleted, ${data.remaining} remaining`, 'success');
    addNotification(`Cleanup: ${data.deleted} snapshots removed`, 'system');
  } catch (err) {
    showToast(`Cleanup error: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────

// Modal close
closeModalBtn.addEventListener('click', () => previewModal.classList.remove('open'));
previewModal.addEventListener('click', (e) => { if (e.target === previewModal) previewModal.classList.remove('open'); });
closeDiffModalBtn.addEventListener('click', () => diffModal.classList.remove('open'));
diffModal.addEventListener('click', (e) => { if (e.target === diffModal) diffModal.classList.remove('open'); });

// Confirm modal
document.getElementById('closeConfirmModalBtn').addEventListener('click', () => closeConfirm(false));
document.getElementById('confirmCancelBtn').addEventListener('click', () => closeConfirm(false));
document.getElementById('confirmOkBtn').addEventListener('click', () => closeConfirm(true));
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });

// Bookmark filter
filterToggleBtn.addEventListener('click', () => {
  filterPinnedOnly = !filterPinnedOnly;
  filterToggleBtn.classList.toggle('active', filterPinnedOnly);
  const visible = getVisibleHistory();
  activeIndex = visible.length > 0 ? visible.length - 1 : 0;
  renderActiveState();
  showToast(`Bookmark filter: ${filterPinnedOnly ? 'ON' : 'OFF'}`, 'info');
});

// Slider
timelineSliderEl.addEventListener('input', (e) => {
  activeIndex = parseInt(e.target.value, 10);
  renderActiveState();
});

// Pin
pinBtnEl.addEventListener('click', () => {
  const visible = getVisibleHistory();
  const currentEvent = visible[activeIndex];
  if (currentEvent) {
    pinBtnEl.disabled = true;
    pinBtnEl.innerHTML = '<span class="button-spinner"></span> Bookmarking...';
    socket.send(JSON.stringify({ type: 'togglePin', timestamp: currentEvent.timestamp }));
    showToast(`Bookmark ${currentEvent.pinned ? 'removed' : 'added'}`, 'action');
  }
});

// Save note
saveNoteBtn.addEventListener('click', () => {
  const visible = getVisibleHistory();
  const currentEvent = visible[activeIndex];
  if (currentEvent) {
    saveNoteBtn.disabled = true;
    saveNoteBtn.innerHTML = '<span class="button-spinner"></span> Saving...';
    const noteText = noteInput.value.trim();
    socket.send(JSON.stringify({ type: 'updateNote', timestamp: currentEvent.timestamp, note: noteText }));
    showToast('Note saved', 'success');
  }
});

// Delete
deleteBtnEl.addEventListener('click', async () => {
  if (!checkProPermission('Deleting snapshots')) return;
  const visible = getVisibleHistory();
  const currentEvent = visible[activeIndex];
  if (!currentEvent) return;
  const ok = await showConfirm('Delete Snapshot', `Permanently delete CC-${currentEvent.timestamp.toString().slice(-6)} and all its cached files?`);
  if (!ok) return;
  restoreBtnEl.disabled = true;
  deleteBtnEl.disabled = true;
  deleteBtnEl.innerHTML = '<span class="button-spinner"></span> Deleting...';
  socket.send(JSON.stringify({ type: 'deleteSnapshot', timestamp: currentEvent.timestamp }));
  showToast(`Deleting CC-${currentEvent.timestamp.toString().slice(-6)}...`, 'info');
});

// Restore
restoreBtnEl.addEventListener('click', async () => {
  if (!checkProPermission('Restoring snapshots')) return;
  const visible = getVisibleHistory();
  const currentEvent = visible[activeIndex];
  if (!currentEvent) return;
  const ok = await showConfirm('Restore Snapshot', `Overwrite current project files with CC-${currentEvent.timestamp.toString().slice(-6)}? This cannot be undone.`);
  if (!ok) return;
  restoreBtnEl.disabled = true;
  deleteBtnEl.disabled = true;
  restoreBtnEl.innerHTML = '<span class="button-spinner"></span> Restoring...';
  socket.send(JSON.stringify({ type: 'restore', timestamp: currentEvent.timestamp }));
  showToast(`Restoring to CC-${currentEvent.timestamp.toString().slice(-6)}...`, 'action');
});

// Search
searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  const visible = getVisibleHistory();
  activeIndex = visible.length > 0 ? visible.length - 1 : 0;
  renderActiveState();
});

// Export / Import / Cleanup
document.getElementById('exportBtn').addEventListener('click', exportTimeline);
document.getElementById('importFileInput').addEventListener('change', (e) => {
  if (e.target.files.length > 0) importTimeline(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('runCleanupBtn').addEventListener('click', runCleanup);

// Compare button
document.getElementById('compareBtn').addEventListener('click', async () => {
  if (!checkProPermission('Comparing snapshots')) return;
  const visible = getVisibleHistory();
  if (visible.length < 2) {
    showToast('Need at least 2 snapshots to compare', 'info');
    return;
  }
  const current = visible[activeIndex];
  const prevIndex = activeIndex > 0 ? activeIndex - 1 : null;
  if (prevIndex === null) {
    showToast('No previous snapshot to compare against', 'info');
    return;
  }
  const previous = visible[prevIndex];

  // Diff all shared files
  const shared = current.files.filter(f => previous.files.includes(f));
  if (shared.length === 0) {
    showToast('No shared files between these snapshots', 'info');
    return;
  }

  diffModalTitle.innerText = `Snapshot Comparison`;
  diffModalSubtitle.innerText = `CC-${previous.timestamp.toString().slice(-6)} → CC-${current.timestamp.toString().slice(-6)}`;
  diffContainer.innerHTML = '<div class="empty-state">Loading diffs...</div>';
  diffModal.classList.add('open');

  let allHtml = '';
  const token = localStorage.getItem('cc_token');
  for (const filePath of shared) {
    try {
      const res = await fetch(`/api/diff?from=${previous.timestamp}&to=${current.timestamp}&path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.diff || data.diff.length === 0) continue;

      const hasChanges = data.diff.some(d => d.type !== 'context');
      if (!hasChanges) continue;

      allHtml += `<div class="diff-file-header">${filePath}</div>`;
      allHtml += '<table class="diff-table">';
      data.diff.forEach(entry => {
        const typeClass = entry.type === 'add' ? 'diff-add' : entry.type === 'remove' ? 'diff-remove' : 'diff-context';
        const prefix = entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' ';
        const oldNum = entry.oldNum || '';
        const newNum = entry.newNum || '';
        const escaped = (entry.line || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        allHtml += `<tr class="${typeClass}"><td class="diff-ln">${oldNum}</td><td class="diff-ln">${newNum}</td><td class="diff-prefix">${prefix}</td><td class="diff-code">${escaped}</td></tr>`;
      });
      allHtml += '</table>';
    } catch (_) {}
  }

  diffContainer.innerHTML = allHtml || '<div class="empty-state">No differences found between these snapshots</div>';
});

// Copy state hash
document.getElementById('copyStateHashBtn').addEventListener('click', () => {
  const text = document.getElementById('metaStateId').innerText;
  navigator.clipboard.writeText(text).then(() => showToast('State hash copied', 'success'));
});

// Sidebar toggle
const sidebarLeft = document.querySelector('.sidebar-left');
const sidebarToggleBtnUi = document.getElementById('sidebarToggleBtnUi');
if (sidebarToggleBtnUi && sidebarLeft) {
  sidebarToggleBtnUi.addEventListener('click', () => {
    sidebarLeft.classList.toggle('collapsed');
  });
}

// ─────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Don't handle shortcuts when typing in inputs
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  // Don't handle when modal is open (except Escape)
  const anyModalOpen = previewModal.classList.contains('open') ||
                       diffModal.classList.contains('open') ||
                       confirmModal.classList.contains('open');

  if (e.key === 'Escape') {
    previewModal.classList.remove('open');
    diffModal.classList.remove('open');
    closeConfirm(false);
    return;
  }

  if (anyModalOpen) return;

  const visible = getVisibleHistory();

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      if (visible.length > 0) {
        activeIndex = Math.max(0, activeIndex - 1);
        renderActiveState();
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (visible.length > 0) {
        activeIndex = Math.min(visible.length - 1, activeIndex + 1);
        renderActiveState();
      }
      break;
    case 'b':
    case 'B':
      if (pinBtnEl && !pinBtnEl.disabled) pinBtnEl.click();
      break;
    case 'r':
    case 'R':
      if (restoreBtnEl && !restoreBtnEl.disabled) restoreBtnEl.click();
      break;
    case 'd':
    case 'D':
      if (deleteBtnEl && !deleteBtnEl.disabled) deleteBtnEl.click();
      break;
    case '/':
      e.preventDefault();
      if (searchInput) searchInput.focus();
      break;
  }
});

// Show/hide shortcut hint
let shortcutHintTimeout;
document.addEventListener('keydown', () => {
  const hint = document.getElementById('shortcutHint');
  if (hint) {
    hint.classList.add('visible');
    clearTimeout(shortcutHintTimeout);
    shortcutHintTimeout = setTimeout(() => hint.classList.remove('visible'), 3000);
  }
});

// ─────────────────────────────────────────────
// SAAS SESSION MANAGEMENT & USER PROFILE
// ─────────────────────────────────────────────
let currentUser = null;

async function checkAuthSession() {
  const token = localStorage.getItem('cc_token');
  if (!token) {
    window.location.href = '../login.html';
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('cc_token');
      window.location.href = '../login.html';
      return;
    }

    if (res.ok) {
      currentUser = await res.json();
      updateProfileUI();
      // Track analytics page view
      trackAnalytics('pageview', window.location.pathname);
      // Delayed connectWS after profile is fetched
      connectWS();
    }
  } catch (err) {
    console.error('Session validation failed:', err);
  }
}

function updateProfileUI() {
  if (!currentUser) return;
  
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const upgradeBtn = document.getElementById('upgradeBtn');
  
  if (userAvatar && currentUser.picture) {
    userAvatar.src = currentUser.picture;
  }
  if (userName) {
    userName.textContent = currentUser.name || currentUser.email;
    userName.title = currentUser.email;
  }
  if (userRoleBadge) {
    userRoleBadge.textContent = currentUser.role.toUpperCase();
    if (currentUser.role === 'pro' || currentUser.role === 'admin') {
      userRoleBadge.style.color = '#3b82f6';
      if (upgradeBtn) upgradeBtn.style.display = 'none'; // Hide upgrade button for pro/admin
    } else {
      userRoleBadge.style.color = '#8e909d';
      if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
    }
  }
}

function checkProPermission(actionName = 'This feature') {
  if (!currentUser) return false;
  if (currentUser.role === 'pro' || currentUser.role === 'admin') {
    return true;
  }
  
  showConfirm('Upgrade to Pro Required', `${actionName} is a premium feature. Upgrade to Pro to unlock advanced time-travel capabilities.`)
    .then(ok => {
      if (ok) {
        window.location.href = '../pro.html';
      }
    });
  return false;
}

// Client-side analytics logger helper
async function trackAnalytics(type, path, featureName = '') {
  const token = localStorage.getItem('cc_token');
  try {
    const osName = window.navigator.userAgent.includes('Windows') ? 'Windows' : (window.navigator.userAgent.includes('Mac') ? 'macOS' : 'Linux');
    const browserName = window.navigator.userAgent.includes('Firefox') ? 'Firefox' : (window.navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Safari');
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        type,
        path,
        platform: osName,
        browser: browserName,
        device: 'desktop',
        featureName
      })
    });
  } catch (_) {}
}

// Hook up logout button
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/local-logout', { method: 'POST' });
    } catch (_) {}
    localStorage.removeItem('cc_token');
    window.location.href = '../login.html';
  });
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
setupNavigation();
checkAuthSession();

// Electron Window Controls binding
const winCloseBtn = document.getElementById('winCloseBtn');
const winMinBtn = document.getElementById('winMinBtn');
const winMaxBtn = document.getElementById('winMaxBtn');

if (window.electronAPI) {
  if (winCloseBtn) winCloseBtn.addEventListener('click', () => window.electronAPI.close());
  if (winMinBtn) winMinBtn.addEventListener('click', () => window.electronAPI.minimize());
  if (winMaxBtn) winMaxBtn.addEventListener('click', () => window.electronAPI.maximize());
} else {
  // If not running in Electron, hide the window buttons
  const winControls = document.querySelector('.window-controls');
  if (winControls) winControls.style.display = 'none';
}
