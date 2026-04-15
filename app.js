/* ============================================
   AuditAI v2 — Complete Functional Build
   ============================================ */
(function () {
  'use strict';

  // ---- CHANGE 0: CIFOR_CONTEXT ----
  const CIFOR_CONTEXT = `You are an AI assistant embedded in the CIFOR-ICRAF Internal Audit Unit (IAU) workflow.
ORGANISATION: CIFOR-ICRAF, a merged international agricultural research centre.
IAU CAPACITY: 260 staff-days/year, 7 audits/year, 4-person team.
AUDIT UNIVERSE: 46 auditable entities across 9 functional areas, 30+ country offices.
ACTIVE GRANT PREFIXES: BMZZ (BMZ), EURC (EU), FAOZ (FAO), NORD (Norad), BMUZ, CGIZ, USAI, GOVI.
FINANCIAL SYSTEM: UBW (post-merger; CIFOR migrated from Sun; ICRAF legacy system still partly active).
IIA STANDARDS: IAU is aligned to 2024 IIA Global Internal Audit Standards (effective Jan 2025).
FINDING STRUCTURE (mandatory): Criteria / Condition / Cause / Consequence / Recommendation.
RISK RATINGS (use exactly): Critical | Significant | Moderate | Low.
CONFIDENTIALITY: All outputs are for internal IAU use only. Never suggest sharing with external parties.
HUMAN-IN-THE-LOOP: Always frame AI output as a draft input requiring auditor review and sign-off. Never present AI output as a final conclusion.`;

  // ---- IndexedDB for Documents ----
  const DB_NAME = 'auditai_db';
  const DB_VERSION = 1;
  const DOC_STORE = 'documents';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(DOC_STORE)) d.createObjectStore(DOC_STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e);
    });
  }
  function dbPut(doc) { return new Promise((res, rej) => { const tx = db.transaction(DOC_STORE, 'readwrite'); const r = tx.objectStore(DOC_STORE).put(doc); r.onsuccess = () => res(r.result); r.onerror = rej; }); }
  function dbGetAll() { return new Promise((res, rej) => { const r = db.transaction(DOC_STORE, 'readonly').objectStore(DOC_STORE).getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; }); }
  function dbDel(id) { return new Promise((res, rej) => { const r = db.transaction(DOC_STORE, 'readwrite').objectStore(DOC_STORE).delete(id); r.onsuccess = res; r.onerror = rej; }); }

  // ---- State ----
  const state = {
    grants: JSON.parse(localStorage.getItem('auditai_grants') || '[]'),
    entities: JSON.parse(localStorage.getItem('auditai_entities') || '[]'),
    recs: JSON.parse(localStorage.getItem('auditai_recommendations') || '[]'),
    docs: [],
    chatHistory: JSON.parse(localStorage.getItem('auditai_chat') || '[]'),
    settings: JSON.parse(localStorage.getItem('auditai_settings') || '{}'),
    log: JSON.parse(localStorage.getItem('auditai_log') || '[]'),
    editingGrantIdx: -1,
    editingEntityIdx: -1,
    csvData: null,
  };

  function save(key, data) { localStorage.setItem('auditai_' + key, JSON.stringify(data)); }
  function uuid() { return 'xxxx-xxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)); }

  // ---- Demo Data (Fictionalized) ----
  function loadDemoData() {
    if (state.grants.length === 0 && state.entities.length === 0 && state.recs.length === 0 && !localStorage.getItem('auditai_demo_cleared')) {
      
      // Fictional Grant
      state.grants = [{
        id: 'APEX-9901', name: 'Zelorian Ecosystem Harmonization', donor: 'Apex Foundation', budget: 12500000, expenditure: 11000000,
        burnRate: 88, subgrants: 12, startDate: '2023-01-01', endDate: '2026-12-31',
        countries: 'Zeloria', singleVendor: true, lateSpend: true, docGaps: false, extAudit: true,
        notes: 'Fictional demo grant data', riskScore: 0,
      }];
      state.grants[0].riskScore = calculateGrantRisk(state.grants[0]);

      // Fictional Entity
      state.entities = [{
        name: 'Zeloria Country Office', region: 'HQ', type: 'Country Office', staff: 42,
        lastAudit: '2024-05-15', openRecs: 4, turnover: 18, budgetVol: 6, security: 2,
        complaints: 1, donorChange: 'stable', regRisk: 'medium', grantBurn: 88,
        notes: 'Totally fictional entity for demo purposes', riskScore: 0, trend: 'stable', prevScore: 0,
      }];
      state.entities[0].riskScore = calculateEntityRisk(state.entities[0]);
      state.entities[0].prevScore = state.entities[0].riskScore;

      // Fictional Recommendation
      state.recs = [{
        report: 'Zeloria CO Audit 2024', finding: 'Fictional Compliance Gap',
        recommendation: 'Implement standard flux capacitor maintenance logs.',
        owner: 'Director of Zelorian Affairs', due: '2026-10-01', status: 'open',
      }];

      save('grants', state.grants);
      save('entities', state.entities);
      save('recommendations', state.recs);
      localStorage.setItem('auditai_demo_cleared', 'true'); 
    }
  }

  // ---- Welcome Modal ----
  function showWelcome() {
    if (!localStorage.getItem('auditai_visited')) {
      document.getElementById('welcome-modal').classList.add('show');
    }
  }
  document.getElementById('welcome-close').addEventListener('click', () => {
    document.getElementById('welcome-modal').classList.remove('show');
    localStorage.setItem('auditai_visited', 'true');
  });
  document.getElementById('welcome-go').addEventListener('click', () => {
    document.getElementById('welcome-modal').classList.remove('show');
    localStorage.setItem('auditai_visited', 'true');
    document.getElementById('nav-memory').click();
  });

  // ---- API Banner ----
  function updateApiBanner() {
    const banner = document.getElementById('api-banner');
    const badge = document.getElementById('ai-badge');
    const dot = document.getElementById('api-dot');
    const txt = document.getElementById('api-txt');
    
    if (state.settings.apiKey) {
      banner.style.display = 'none';
      badge.style.display = 'inline';
      dot.classList.add('connected');
      const labels = { openai: 'OpenAI', azure: 'Azure', custom: 'Custom' };
      txt.textContent = `${labels[state.settings.provider] || 'Custom'} · ${state.settings.model || 'gpt-4o'}`;
    } else {
      if (!sessionStorage.getItem('api_banner_dismissed')) banner.style.display = 'flex';
      badge.style.display = 'none';
      dot.classList.remove('connected');
      txt.textContent = 'Not connected';
    }
  }
  document.getElementById('api-banner-dismiss').addEventListener('click', () => {
    document.getElementById('api-banner').style.display = 'none';
    sessionStorage.setItem('api_banner_dismissed', 'true');
  });

  // ---- Overdue Rec Alert ----
  function checkOverdueRecs() {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    let overdue = 0, dueSoon = 0;
    state.recs.forEach(r => {
      if (r.status === 'overdue') { overdue++; return; }
      if ((r.status === 'open' || r.status === 'in-progress') && r.due) {
        const diff = new Date(r.due).getTime() - now;
        if (diff < 0) { overdue++; r.status = 'overdue'; }
        else if (diff <= thirtyDays) dueSoon++;
      }
    });
    if (overdue + dueSoon > 0) {
      save('recommendations', state.recs);
      const total = overdue + dueSoon;
      document.getElementById('rec-alert-text').textContent = `⚠ ${total} recommendation(s) require attention — ${overdue} overdue, ${dueSoon} due within 30 days.`;
      document.getElementById('rec-alert-banner').style.display = 'flex';
    }
  }
  document.getElementById('rec-alert-banner').addEventListener('click', (e) => {
    if (e.target.id === 'rec-alert-dismiss') { document.getElementById('rec-alert-banner').style.display = 'none'; return; }
    document.getElementById('rec-alert-banner').style.display = 'none';
    document.getElementById('nav-report').click();
    setTimeout(() => document.querySelector('[data-tab="tracker"]')?.click(), 200);
  });
  document.getElementById('rec-alert-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('rec-alert-banner').style.display = 'none';
  });

  // ---- Navigation ----
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = btn.dataset.module;
      document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
      document.getElementById('module-' + mod).classList.add('active');
    });
  });

  // Tabs
  document.querySelectorAll('.tab-bar').forEach(bar => {
    bar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = bar.parentElement;
        bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        parent.querySelector('#tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  });

  document.getElementById('link-interview')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('nav-interview').click();
  });

  // ---- Settings ----
  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('settings-btn').addEventListener('click', () => {
    settingsModal.classList.add('show');
    document.getElementById('api-provider').value = state.settings.provider || 'openai';
    document.getElementById('api-key').value = state.settings.apiKey || '';
    document.getElementById('api-endpoint').value = state.settings.endpoint || '';
    document.getElementById('api-model').value = state.settings.model || 'gpt-4o';
    toggleEndpoint();
  });
  document.getElementById('settings-close').addEventListener('click', () => settingsModal.classList.remove('show'));
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.remove('show'); });

  const providerSelect = document.getElementById('api-provider');
  providerSelect.addEventListener('change', toggleEndpoint);
  function toggleEndpoint() {
    document.getElementById('api-endpoint-group').style.display = (providerSelect.value === 'custom' || providerSelect.value === 'azure') ? 'block' : 'none';
  }

  document.getElementById('save-settings-btn').addEventListener('click', () => {
    state.settings = {
      provider: document.getElementById('api-provider').value,
      apiKey: document.getElementById('api-key').value,
      endpoint: document.getElementById('api-endpoint').value,
      model: document.getElementById('api-model').value,
    };
    save('settings', { provider: state.settings.provider, endpoint: state.settings.endpoint, model: state.settings.model });
    localStorage.setItem('auditai_apikey', state.settings.apiKey);
    updateApiBanner();
    const status = document.getElementById('settings-status');
    status.textContent = '✓ Settings saved';
    status.className = 'settings-status success';
    setTimeout(() => settingsModal.classList.remove('show'), 1000);
  });

  document.getElementById('clear-demo-btn').addEventListener('click', () => {
    if (!confirm('This will delete all grants, entities, recommendations, and AI logs. Continue?')) return;
    state.grants = []; state.entities = []; state.recs = []; state.log = [];
    save('grants', []); save('entities', []); save('recommendations', []); save('log', []);
    localStorage.setItem('auditai_demo_cleared', 'true');
    renderGrants(); renderEntities(); renderRecs(); renderAILog();
    settingsModal.classList.remove('show');
  });

  // ---- LLM API Call ----
  async function callLLM(systemPrompt, userMessage) {
    const apiKey = state.settings.apiKey || localStorage.getItem('auditai_apikey');
    const { provider, endpoint, model } = state.settings;
    if (!apiKey) return '⚠️ No API key configured. Click "API Settings" in the sidebar.';

    let url;
    if (provider === 'openai') url = 'https://api.openai.com/v1/chat/completions';
    else if (provider === 'azure' || provider === 'custom') {
      if (!endpoint) return '⚠️ No endpoint configured.';
      url = endpoint.endsWith('/') ? endpoint + 'chat/completions' : endpoint + '/chat/completions';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'azure') headers['api-key'] = apiKey;
    else headers['Authorization'] = 'Bearer ' + apiKey;

    const fullSystem = CIFOR_CONTEXT + '\n\n' + systemPrompt;

    try {
      const res = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ model: model || 'gpt-4o', messages: [{ role: 'system', content: fullSystem }, { role: 'user', content: userMessage }], temperature: 0.4, max_tokens: 2000 }),
      });
      if (!res.ok) { const err = await res.text(); return '⚠️ API Error (' + res.status + '): ' + err.substring(0, 200); }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '(No response)';
    } catch (err) { return '⚠️ Network error: ' + err.message; }
  }

  // ---- AI Log + Reviewed Checkbox ----
  function logAIOutput(module, inputSummary, output) {
    const entry = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      module,
      inputs_summary: inputSummary.substring(0, 200),
      model: state.settings.model || 'gpt-4o',
      output_preview: output.substring(0, 300),
      reviewed: false,
    };
    state.log.push(entry);
    save('log', state.log);
    renderAILog();
    return entry.id;
  }

  function showReviewedCheckbox(containerId, logId) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.style.display = 'flex';
    box.innerHTML = `<input type="checkbox" id="chk-${logId}" /><label for="chk-${logId}">I have reviewed this AI output and accept it as a draft input (not a conclusion).</label>`;
    box.classList.remove('reviewed');
    document.getElementById('chk-' + logId).addEventListener('change', (e) => {
      const entry = state.log.find(l => l.id === logId);
      if (entry) { entry.reviewed = e.target.checked; save('log', state.log); renderAILog(); }
      box.classList.toggle('reviewed', e.target.checked);
    });
  }

  function renderAILog() {
    const tbody = document.getElementById('ailog-tbody');
    if (state.log.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><div class="empty-state"><p>No AI outputs logged yet.</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = state.log.slice().reverse().map(l => `<tr>
      <td style="white-space:nowrap;">${new Date(l.timestamp).toLocaleString()}</td>
      <td>${l.module}</td>
      <td title="${l.inputs_summary}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.inputs_summary}</td>
      <td title="${l.output_preview}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.output_preview}</td>
      <td>${l.model}</td>
      <td style="text-align:center;">${l.reviewed ? '✅' : '❌'}</td>
    </tr>`).join('');
  }

  // ---- Helpers ----
  function showLoading(el) { const d = document.createElement('div'); d.className = 'typing-indicator'; d.id = 'ldg-' + el.id; d.innerHTML = '<span></span><span></span><span></span>'; el.appendChild(d); el.scrollTop = el.scrollHeight; }
  function removeLoading(el) { const d = document.getElementById('ldg-' + el.id); if (d) d.remove(); }
  function fmt(n) { if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'; return '$' + n; }
  function riskLevel(s) { return s >= 50 ? 'high' : s >= 25 ? 'medium' : 'low'; }

  function formatResponse(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^## (.+)$/gm, '<h4>$1</h4>').replace(/^# (.+)$/gm, '<h4>$1</h4>')
      .replace(/^[-•] (.+)$/gm, '  • $1').replace(/^\d+\.\s(.+)$/gm, '  $&').replace(/\n/g, '<br>');
  }

  // ---- Module 1: Institutional Memory ----
  const memoryChat = document.getElementById('memory-chat');
  const memoryInput = document.getElementById('memory-input');

  document.getElementById('memory-upload-btn').addEventListener('click', () => document.getElementById('memory-file-input').click());
  document.getElementById('memory-file-input').addEventListener('change', (e) => {
    Array.from(e.target.files).forEach(f => {
      if (f.name.toLowerCase().endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument(new Uint8Array(ev.target.result)).promise;
            let text = '';
            for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
              const pg = await pdf.getPage(i);
              const tc = await pg.getTextContent();
              text += '\n--- Page ' + i + ' ---\n' + tc.items.map(x => x.str).join(' ');
            }
            const doc = { name: f.name, size: f.size, content: text.substring(0, 50000), uploadedAt: new Date().toISOString() };
            doc.id = await dbPut(doc); state.docs.push(doc); renderDocs(); updateDocBadge();
            await genDocSummary(doc, state.docs.length - 1);
          } catch (err) { alert('PDF error: ' + err.message); }
        };
        reader.readAsArrayBuffer(f);
      } else {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const doc = { name: f.name, size: f.size, content: ev.target.result.substring(0, 50000), uploadedAt: new Date().toISOString() };
          doc.id = await dbPut(doc); state.docs.push(doc); renderDocs(); updateDocBadge();
          await genDocSummary(doc, state.docs.length - 1);
        };
        reader.readAsText(f);
      }
    });
    e.target.value = '';
  });

  async function genDocSummary(doc, idx) {
    const container = document.getElementById('doc-summary-container');
    container.innerHTML = `<div class="doc-summary-card"><h4>Summarizing: ${doc.name}</h4><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    const response = await callLLM(
      'You are a document analyst for an Internal Audit Unit. Produce a concise framework summary: DOCUMENT TYPE, SCOPE, KEY FINDINGS (max 5), OPEN ACTIONS, RISK SIGNALS, TIME PERIOD. Use bullet points. End with: "This is an AI-generated summary. Auditor review required."',
      `Summarize:\nFilename: ${doc.name}\nContent:\n${doc.content.substring(0, 8000)}`
    );
    state.docs[idx].summary = response; await dbPut(state.docs[idx]);
    container.innerHTML = `<div class="doc-summary-card"><h4>Summary: ${doc.name}</h4><div class="summary-text">${formatResponse(response)}</div></div>`;
    logAIOutput('Institutional Memory', 'Doc summary: ' + doc.name, response);
  }

  function renderDocs() {
    const list = document.getElementById('memory-doc-list');
    if (state.docs.length === 0) { list.innerHTML = '<div class="empty-state"><p>Upload audit reports, memos, working papers</p></div>'; return; }
    list.innerHTML = state.docs.map((d, i) => `<div class="doc-item" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span title="${d.name}">${d.name}</span><button type="button" class="btn-icon remove-doc" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
    list.querySelectorAll('.doc-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('.remove-doc')) return;
        const doc = state.docs[parseInt(item.dataset.idx)];
        const c = document.getElementById('doc-summary-container');
        c.innerHTML = doc.summary ? `<div class="doc-summary-card"><h4>Summary: ${doc.name}</h4><div class="summary-text">${formatResponse(doc.summary)}</div></div>` : `<div class="doc-summary-card"><h4>${doc.name}</h4><p class="muted">No summary. Re-upload to generate.</p></div>`;
      });
    });
    list.querySelectorAll('.remove-doc').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation(); e.preventDefault(); const idx = parseInt(btn.dataset.idx);
      if (state.docs[idx].id) await dbDel(state.docs[idx].id);
      state.docs.splice(idx, 1); renderDocs(); updateDocBadge();
    }));
  }

  function updateDocBadge() {
    const nav = document.getElementById('nav-memory');
    let badge = nav.querySelector('.doc-count-badge');
    if (state.docs.length > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'doc-count-badge'; nav.appendChild(badge); }
      badge.textContent = state.docs.length;
    } else if (badge) badge.remove();
  }

  // Chat
  document.querySelectorAll('#module-memory .chip').forEach(c => c.addEventListener('click', () => { memoryInput.value = c.dataset.q; sendChat(); }));
  document.getElementById('memory-send').addEventListener('click', sendChat);
  memoryInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

  async function sendChat() {
    const text = memoryInput.value.trim(); if (!text) return; memoryInput.value = '';
    const w = memoryChat.querySelector('.chat-welcome'); if (w) w.remove();
    const userEl = document.createElement('div'); userEl.className = 'chat-msg user'; userEl.textContent = text; memoryChat.appendChild(userEl);
    const docCtx = state.docs.map(d => `--- ${d.name} ---\n${d.content}`).join('\n\n');
    showLoading(memoryChat);
    const response = await callLLM('You are an internal audit knowledge assistant.\n\nDocuments:\n' + (docCtx || '(None uploaded)') + '\n\nSynthesise across documents. Reference specific docs. End with: "This is an AI-generated draft."', text);
    removeLoading(memoryChat);
    const aiEl = document.createElement('div'); aiEl.className = 'chat-msg ai'; aiEl.innerHTML = '<div class="msg-label">AuditAI</div>' + formatResponse(response); memoryChat.appendChild(aiEl);
    memoryChat.scrollTop = memoryChat.scrollHeight;
    state.chatHistory.push({ role: 'user', content: text }, { role: 'ai', content: response }); save('chat', state.chatHistory);
    logAIOutput('Institutional Memory', text, response);
  }

  function restoreChat() {
    if (state.chatHistory.length === 0) return;
    const w = memoryChat.querySelector('.chat-welcome'); if (w) w.remove();
    state.chatHistory.forEach(m => { const el = document.createElement('div'); if (m.role === 'user') { el.className = 'chat-msg user'; el.textContent = m.content; } else { el.className = 'chat-msg ai'; el.innerHTML = '<div class="msg-label">AuditAI</div>' + formatResponse(m.content); } memoryChat.appendChild(el); });
  }

  // ---- Module 2: Grant Risk Radar ----
  const grantModal = document.getElementById('grant-modal');
  document.getElementById('add-grant-btn').addEventListener('click', () => { state.editingGrantIdx = -1; document.getElementById('grant-modal-title').textContent = 'Add Grant'; clearGrantForm(); grantModal.classList.add('show'); });
  document.getElementById('grant-close').addEventListener('click', () => grantModal.classList.remove('show'));
  grantModal.addEventListener('click', e => { if (e.target === grantModal) grantModal.classList.remove('show'); });

  function clearGrantForm() {
    ['grant-id','grant-name','grant-donor','grant-budget','grant-expenditure','grant-burn','grant-subgrants','grant-start','grant-end','grant-countries','grant-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['grant-vendor','grant-late','grant-docs','grant-extaudit'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'no'; });
  }

  document.getElementById('save-grant-btn').addEventListener('click', () => {
    const g = { id: document.getElementById('grant-id').value.trim(), name: document.getElementById('grant-name').value.trim(), donor: document.getElementById('grant-donor').value.trim(), budget: parseFloat(document.getElementById('grant-budget').value) || 0, expenditure: parseFloat(document.getElementById('grant-expenditure').value) || 0, burnRate: parseFloat(document.getElementById('grant-burn').value) || 0, subgrants: parseInt(document.getElementById('grant-subgrants').value) || 0, startDate: document.getElementById('grant-start').value, endDate: document.getElementById('grant-end').value, countries: document.getElementById('grant-countries').value.trim(), singleVendor: document.getElementById('grant-vendor').value === 'yes', lateSpend: document.getElementById('grant-late').value === 'yes', docGaps: document.getElementById('grant-docs').value === 'yes', extAudit: document.getElementById('grant-extaudit').value === 'yes', notes: document.getElementById('grant-notes').value.trim() };
    if (!g.id || !g.name) return alert('Grant ID and Name required.');
    if (g.budget > 0 && g.expenditure > 0 && !g.burnRate) g.burnRate = Math.round((g.expenditure / g.budget) * 100);
    g.riskScore = calculateGrantRisk(g);
    if (state.editingGrantIdx >= 0) state.grants[state.editingGrantIdx] = g; else state.grants.push(g);
    save('grants', state.grants); renderGrants(); grantModal.classList.remove('show');
  });

  function calculateGrantRisk(g) {
    let s = 0;
    if (g.burnRate <= 5 && g.budget > 0) s += 25; else if (g.burnRate >= 85) s += 20; else if (g.burnRate < 30) s += 15;
    if (g.singleVendor) s += 20; if (g.lateSpend) s += 18; if (g.docGaps) s += 22;
    if (g.budget >= 20e6) s += 10; else if (g.budget >= 10e6) s += 5;
    if (g.subgrants > 10) s += 8; else if (g.subgrants > 5) s += 4;
    if (g.endDate) { const ml = Math.ceil((new Date(g.endDate) - Date.now()) / (1000*60*60*24*30)); if (ml <= 6 && g.burnRate < 50) s += 12; else if (ml <= 12 && g.burnRate < 30) s += 8; }
    if (g.extAudit) s += 3;
    return Math.min(s, 100);
  }

  function renderGrants() {
    const tbody = document.getElementById('grants-tbody');
    if (state.grants.length === 0) { 
      tbody.innerHTML = '<tr class="empty-row"><td colspan="14"><div class="empty-state"><p>No grants added yet.</p></div></td></tr>'; 
      updateGrantStats(); 
      return; 
    }
    
    tbody.innerHTML = state.grants.map((g, i) => `<tr>
      <td style="font-weight:500;">${g.id}</td><td title="${g.name}">${g.name.length > 18 ? g.name.substring(0,18)+'…' : g.name}</td><td>${g.donor||'-'}</td><td>${fmt(g.budget)}</td><td>${fmt(g.expenditure)}</td><td>${g.burnRate}%</td><td>${g.endDate||'-'}</td><td>${g.subgrants||0}</td><td>${g.singleVendor?'⚠️':'—'}</td><td>${g.lateSpend?'⚠️':'—'}</td><td>${g.docGaps?'⚠️':'—'}</td><td>${g.extAudit?'✓':'—'}</td><td><span class="risk-badge ${riskLevel(g.riskScore)}">${g.riskScore}</span></td>
      <td><button type="button" class="btn-icon edit-grant" data-idx="${i}">✏️</button><button type="button" class="btn-icon del-grant" data-idx="${i}">🗑</button></td>
    </tr>`).join('');
    
    // Edit Grant
    tbody.querySelectorAll('.edit-grant').forEach(btn => btn.addEventListener('click', (e) => { 
      e.preventDefault(); 
      const i = parseInt(btn.dataset.idx); 
      state.editingGrantIdx = i; 
      const g = state.grants[i]; 
      document.getElementById('grant-modal-title').textContent = 'Edit Grant'; 
      document.getElementById('grant-id').value = g.id; 
      document.getElementById('grant-name').value = g.name; 
      document.getElementById('grant-donor').value = g.donor||''; 
      document.getElementById('grant-budget').value = g.budget; 
      document.getElementById('grant-expenditure').value = g.expenditure||''; 
      document.getElementById('grant-burn').value = g.burnRate; 
      document.getElementById('grant-subgrants').value = g.subgrants||''; 
      document.getElementById('grant-start').value = g.startDate||''; 
      document.getElementById('grant-end').value = g.endDate||''; 
      document.getElementById('grant-countries').value = g.countries||''; 
      document.getElementById('grant-vendor').value = g.singleVendor?'yes':'no'; 
      document.getElementById('grant-late').value = g.lateSpend?'yes':'no'; 
      document.getElementById('grant-docs').value = g.docGaps?'yes':'no'; 
      document.getElementById('grant-extaudit').value = g.extAudit?'yes':'no'; 
      document.getElementById('grant-notes').value = g.notes||''; 
      grantModal.classList.add('show'); 
    }));
    
    // Delete Grant
    tbody.querySelectorAll('.del-grant').forEach(btn => btn.addEventListener('click', (e) => { 
      e.preventDefault(); 
      e.stopPropagation();
      if (confirm('Delete this grant?')) { 
        state.grants.splice(parseInt(btn.dataset.idx), 1); 
        save('grants', state.grants); 
        localStorage.setItem('auditai_demo_cleared', 'true');
        renderGrants(); 
        
        const aiOutput = document.getElementById('grant-ai-output');
        if (aiOutput) aiOutput.innerHTML = '<p class="muted">Data modified. Re-run analysis.</p>';
      } 
    }));
    
    updateGrantStats();
  }

  function updateGrantStats() {
    document.getElementById('stat-total-grants').textContent = state.grants.length;
    document.getElementById('stat-high-risk').textContent = state.grants.filter(g => riskLevel(g.riskScore) === 'high').length;
    document.getElementById('stat-medium-risk').textContent = state.grants.filter(g => riskLevel(g.riskScore) === 'medium').length;
    document.getElementById('stat-low-risk').textContent = state.grants.filter(g => riskLevel(g.riskScore) === 'low').length;
    document.getElementById('stat-total-budget').textContent = fmt(state.grants.reduce((s, g) => s + g.budget, 0));
  }

  document.getElementById('analyze-grants-btn').addEventListener('click', async () => {
    const output = document.getElementById('grant-ai-output');
    if (state.grants.length === 0) { output.innerHTML = '<p class="muted">Add grants first.</p>'; return; }
    const data = state.grants.map(g => `${g.id} "${g.name}" Donor:${g.donor} Budget:${fmt(g.budget)} Burn:${g.burnRate}% Subgrants:${g.subgrants} End:${g.endDate||'N/A'} Risk:${g.riskScore}`).join('\n');
    output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Provide concise, actionable grant portfolio risk analysis. List top risk drivers per grant. End with: "This is an AI-generated draft."', data);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Grant Risk Radar', data, r);
    showReviewedCheckbox('grant-review', logId);
  });

  // ---- Module 3: Fraud Detection ----
  const fraudType = document.getElementById('fraud-type');
  fraudType.addEventListener('change', () => {
    document.getElementById('fraud-csv-area').style.display = fraudType.value === 'csv' ? 'block' : 'none';
    document.getElementById('fraud-text-area').style.display = fraudType.value === 'csv' ? 'none' : 'block';
  });

  document.getElementById('csv-drop').addEventListener('click', () => document.getElementById('csv-input').click());
  document.getElementById('csv-input').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    Papa.parse(f, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        state.csvData = results.data;
        const preview = document.getElementById('csv-preview');
        if (results.data.length === 0) { preview.innerHTML = '<p class="muted">No data found.</p>'; preview.style.display = 'block'; return; }
        const cols = Object.keys(results.data[0]);
        const rows = results.data.slice(0, 5);
        preview.innerHTML = `<p style="font-size:0.78rem;margin:0.5rem 0;"><strong>${results.data.length} rows loaded.</strong> Preview:</p>
          <table class="csv-preview-table"><thead><tr>${cols.map(c => '<th>' + c + '</th>').join('')}</tr></thead>
          <tbody>${rows.map(r => '<tr>' + cols.map(c => '<td>' + (r[c]||'') + '</td>').join('') + '</tr>').join('')}</tbody></table>`;
        preview.style.display = 'block';
      }
    });
    e.target.value = '';
  });

  document.getElementById('fraud-analyze-btn')?.addEventListener('click', async () => {
    const type = fraudType.value;
    const output = document.getElementById('fraud-results') || document.getElementById('fraud-output');
    let inputText;

    if (type === 'csv' && state.csvData) {
      const cols = Object.keys(state.csvData[0] || {});
      const amounts = state.csvData.map(r => parseFloat(r.amount)).filter(n => !isNaN(n));
      const stats = `Columns: ${cols.join(', ')}\nTotal rows: ${state.csvData.length}\nAmount range: ${Math.min(...amounts)} - ${Math.max(...amounts)}\nSum: ${amounts.reduce((a,b) => a+b, 0).toFixed(2)}`;
      const sample = JSON.stringify(state.csvData.slice(0, 20), null, 2);
      inputText = stats + '\n\nFirst 20 rows:\n' + sample;
    } else {
      inputText = document.getElementById('fraud-input').value.trim();
    }
    if (!inputText) return alert('Please provide data to analyze.');

    output.innerHTML = ''; showLoading(output);
    const r = await callLLM(
      `You are a fraud signal detection AI. Specifically check for:
1. Round-number payments
2. Single-vendor concentration above 40%
3. Blank description fields
4. Same approver on consecutive transactions
5. Late-fiscal-year expenditure spikes
Present results as a FLAGGED TABLE with columns: Row/Item | Flag Type | Severity (High/Medium/Low) | Explanation.
End with: "This is an AI-generated draft."`,
      `Analyze for fraud signals:\n\n${inputText}`
    );
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Fraud Detection', inputText.substring(0, 200), r);
    showReviewedCheckbox('fraud-review', logId);
  });
  
  if(document.getElementById('fraud-btn')) {
      document.getElementById('fraud-btn').addEventListener('click', () => document.getElementById('fraud-analyze-btn')?.click() || document.getElementById('fraud-analyze-btn') == null && document.getElementById('fraud-btn').click()); 
      document.getElementById('fraud-btn').onclick = document.getElementById('fraud-analyze-btn')?.onclick;
  }

  // ---- Module 4: Remote Audit ----
  document.getElementById('remote-doc-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('remote-doc-input').value.trim();
    const output = document.getElementById('remote-doc-output');
    if (!input) return alert('Enter document data.'); output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Document consistency analyst. Scan for inconsistencies, missing fields, anomalies. Rate severity. End with: "This is an AI-generated draft."', input);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Remote Audit', input.substring(0, 200), r);
    showReviewedCheckbox('remote-doc-review', logId);
  });

  document.getElementById('remote-compare-btn').addEventListener('click', async () => {
    const ev = document.getElementById('remote-evidence').value.trim();
    const st = document.getElementById('remote-statements').value.trim();
    const output = document.getElementById('remote-compare-output');
    if (!ev || !st) return alert('Provide both.'); output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Compare statements against evidence. Flag inconsistencies. End with: "This is an AI-generated draft."', `EVIDENCE:\n${ev}\n\nSTATEMENTS:\n${st}`);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Remote Audit', 'Flag comparison', r);
    showReviewedCheckbox('remote-compare-review', logId);
  });

  // ---- Module 5: Risk Scoring ----
  const entityModal = document.getElementById('entity-modal');
  document.getElementById('add-entity-btn').addEventListener('click', () => {
    state.editingEntityIdx = -1; document.getElementById('entity-modal-title').textContent = 'Add Entity';
    ['entity-name','entity-last-audit','entity-open-recs','entity-turnover','entity-budget-vol','entity-security','entity-complaints','entity-staff','entity-grant-burn','entity-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('entity-region').value = 'Africa'; document.getElementById('entity-type').value = 'Country Office'; document.getElementById('entity-donor').value = 'stable'; document.getElementById('entity-reg').value = 'low';
    entityModal.classList.add('show');
  });
  document.getElementById('entity-close').addEventListener('click', () => entityModal.classList.remove('show'));
  entityModal.addEventListener('click', e => { if (e.target === entityModal) entityModal.classList.remove('show'); });

  document.getElementById('save-entity-btn').addEventListener('click', () => {
    const e = { name: document.getElementById('entity-name').value.trim(), region: document.getElementById('entity-region').value, type: document.getElementById('entity-type').value, staff: parseInt(document.getElementById('entity-staff').value)||0, lastAudit: document.getElementById('entity-last-audit').value, openRecs: parseInt(document.getElementById('entity-open-recs').value)||0, turnover: parseFloat(document.getElementById('entity-turnover').value)||0, budgetVol: parseInt(document.getElementById('entity-budget-vol').value)||1, security: parseInt(document.getElementById('entity-security').value)||1, complaints: parseInt(document.getElementById('entity-complaints').value)||0, donorChange: document.getElementById('entity-donor').value, regRisk: document.getElementById('entity-reg').value, grantBurn: parseFloat(document.getElementById('entity-burn').value)||0, notes: document.getElementById('entity-notes')?.value?.trim()||'' };
    if (!e.name) return alert('Name required.');
    e.riskScore = calculateEntityRisk(e);
    if (state.editingEntityIdx >= 0) { const prev = state.entities[state.editingEntityIdx]; e.prevScore = prev.riskScore; e.trend = e.riskScore > prev.riskScore ? 'up' : e.riskScore < prev.riskScore ? 'down' : 'stable'; state.entities[state.editingEntityIdx] = e; }
    else { e.prevScore = e.riskScore; e.trend = 'stable'; state.entities.push(e); }
    save('entities', state.entities); renderEntities(); entityModal.classList.remove('show');
  });

  function calculateEntityRisk(e) {
    let s = 0;
    e._factors = [];
    let lastAuditScore = 0;
    if (e.lastAudit) { const m = Math.floor((Date.now() - new Date(e.lastAudit).getTime()) / (1000*60*60*24*30)); if (m > 36) lastAuditScore = 18; else if (m > 24) lastAuditScore = 10; else if (m > 12) lastAuditScore = 4; } else lastAuditScore = 18;
    s += lastAuditScore; if (lastAuditScore > 0) e._factors.push({ name: 'Days since last audit', score: lastAuditScore });

    let recScore = e.openRecs > 5 ? 12 : e.openRecs > 2 ? 6 : e.openRecs > 0 ? 2 : 0;
    s += recScore; if (recScore > 0) e._factors.push({ name: 'Open recommendations: ' + e.openRecs, score: recScore });

    let turnScore = e.turnover > 40 ? 12 : e.turnover > 20 ? 6 : e.turnover > 10 ? 2 : 0;
    s += turnScore; if (turnScore > 0) e._factors.push({ name: 'Staff turnover: ' + e.turnover + '%', score: turnScore });

    let budgetScore = Math.min(e.budgetVol * 1.5, 15);
    s += budgetScore; if (budgetScore > 2) e._factors.push({ name: 'Budget volatility: ' + e.budgetVol + '/10', score: Math.round(budgetScore) });

    let secScore = e.security * 3;
    s += secScore; if (secScore > 3) e._factors.push({ name: 'Security index: ' + e.security + '/5', score: secScore });

    let compScore = e.complaints > 3 ? 12 : e.complaints > 1 ? 6 : e.complaints > 0 ? 2 : 0;
    s += compScore; if (compScore > 0) e._factors.push({ name: 'Complaints: ' + e.complaints, score: compScore });

    let donorScore = e.donorChange === 'volatile' ? 10 : e.donorChange === 'decreasing' ? 6 : 0;
    s += donorScore; if (donorScore > 0) e._factors.push({ name: 'Donor changes: ' + e.donorChange, score: donorScore });

    let regScore = e.regRisk === 'high' ? 10 : e.regRisk === 'medium' ? 4 : 0;
    s += regScore; if (regScore > 0) e._factors.push({ name: 'Regulatory risk: ' + e.regRisk, score: regScore });

    if (e.grantBurn > 0 && (e.grantBurn <= 10 || e.grantBurn >= 85)) { s += 6; e._factors.push({ name: 'Grant burn rate: ' + e.grantBurn + '%', score: 6 }); }
    if (e.staff === 1) { s += 5; e._factors.push({ name: 'Single-person office', score: 5 }); }

    e._factors.sort((a, b) => b.score - a.score);
    return Math.min(Math.round(s), 100);
  }

  function renderEntities() {
    const tbody = document.getElementById('entity-tbody');
    if (state.entities.length === 0) { 
      tbody.innerHTML = '<tr class="empty-row"><td colspan="16"><div class="empty-state"><p>Add entities.</p></div></td></tr>'; 
      return; 
    }
    
    tbody.innerHTML = state.entities.map((e, i) => {
      const level = riskLevel(e.riskScore);
      const trendIcon = e.trend === 'up' ? '↑' : e.trend === 'down' ? '↓' : '—';
      const trendCls = e.trend === 'up' ? 'trend-up' : e.trend === 'down' ? 'trend-down' : 'trend-stable';
      const topFactors = (e._factors || []).slice(0, 3).map(f => `${f.name}: +${f.score}`).join('<br>');
      const tooltip = topFactors ? `<div class="tooltip-content">Score ${e.riskScore}/100<br><br>${topFactors}</div>` : '';
      return `<tr>
        <td style="font-weight:500;">${e.name}</td><td>${e.region}</td><td>${e.type||'CO'}</td><td>${e.lastAudit||'Never'}</td><td>${e.openRecs}</td><td>${e.staff||'-'}</td><td>${e.turnover}%</td><td>${e.budgetVol}/10</td><td>${e.security}/5</td><td>${e.complaints}</td><td>${{stable:'—',increasing:'↑',decreasing:'↓⚠',volatile:'⚠⚠'}[e.donorChange]||'—'}</td><td>${{low:'—',medium:'⚠',high:'⚠⚠'}[e.regRisk]||'—'}</td><td>${e.grantBurn?e.grantBurn+'%':'-'}</td>
        <td><span class="risk-badge ${level} risk-tooltip" tabindex="0">${e.riskScore}${tooltip}</span></td>
        <td class="${trendCls}" style="font-size:1.2rem;font-weight:600;">${trendIcon}</td>
        <td><button type="button" class="btn-icon edit-entity" data-idx="${i}">✏️</button><button type="button" class="btn-icon del-entity" data-idx="${i}">🗑</button></td>
      </tr>`;
    }).join('');
    
    // Edit Entity
    tbody.querySelectorAll('.edit-entity').forEach(btn => btn.addEventListener('click', (e) => { 
      e.preventDefault(); 
      const i = parseInt(btn.dataset.idx); 
      state.editingEntityIdx = i; 
      const ent = state.entities[i]; 
      document.getElementById('entity-modal-title').textContent = 'Edit Entity'; 
      document.getElementById('entity-name').value = ent.name; 
      document.getElementById('entity-region').value = ent.region; 
      document.getElementById('entity-type').value = ent.type||'Country Office'; 
      document.getElementById('entity-staff').value = ent.staff||''; 
      document.getElementById('entity-last-audit').value = ent.lastAudit; 
      document.getElementById('entity-open-recs').value = ent.openRecs; 
      document.getElementById('entity-turnover').value = ent.turnover; 
      document.getElementById('entity-budget-vol').value = ent.budgetVol; 
      document.getElementById('entity-security').value = ent.security; 
      document.getElementById('entity-complaints').value = ent.complaints; 
      document.getElementById('entity-donor').value = ent.donorChange||'stable'; 
      document.getElementById('entity-reg').value = ent.regRisk||'low'; 
      document.getElementById('entity-burn').value = ent.grantBurn||''; 
      entityModal.classList.add('show'); 
    }));
    
    // Delete Entity
    tbody.querySelectorAll('.del-entity').forEach(btn => btn.addEventListener('click', (e) => { 
      e.preventDefault(); 
      e.stopPropagation(); 
      if (confirm('Delete this entity?')) { 
        state.entities.splice(parseInt(btn.dataset.idx), 1); 
        save('entities', state.entities); 
        localStorage.setItem('auditai_demo_cleared', 'true'); 
        renderEntities(); 
        
        const aiOutput = document.getElementById('entity-ai-output');
        if (aiOutput) aiOutput.innerHTML = '<p class="muted">Data modified. Re-run analysis.</p>';
      } 
    }));
  }

  document.getElementById('analyze-entities-btn').addEventListener('click', async () => {
    const output = document.getElementById('entity-ai-output');
    if (state.entities.length === 0) { output.innerHTML = '<p class="muted">Add entities first.</p>'; return; }
    const data = state.entities.map(e => `${e.name} (${e.region}, ${e.type}): Score ${e.riskScore}, Trend ${e.trend}, Top factors: ${(e._factors||[]).slice(0,3).map(f=>f.name+':+'+f.score).join(', ')}`).join('\n');
    output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Risk analyst. For EACH entity, list the top 3 risk drivers with scores explicitly (not narrative). Then provide prioritized audit plan recommendations. End with: "This is an AI-generated draft."', data);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Risk Scoring', data, r);
    showReviewedCheckbox('entity-review', logId);
  });

  // ---- Module 6: Interview Prep ----
  document.getElementById('interview-gen-btn').addEventListener('click', async () => {
    const eng = document.getElementById('interview-engagement').value.trim();
    const src = document.getElementById('interview-source').value.trim();
    const output = document.getElementById('interview-output');
    if (!src) return alert('Provide source material.'); output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Interview prep assistant. Generate: KEY QUESTIONS BY AREA, RISK SIGNALS TO PROBE, PRIOR COMMITMENTS, EVIDENCE GAPS, SUGGESTED SEQUENCE. End with: "This is an AI-generated draft."', `Engagement: ${eng||'N/A'}\nSource:\n${src}`);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Interview Prep', eng || src.substring(0, 200), r);
    showReviewedCheckbox('interview-review', logId);
  });

  document.getElementById('tri-btn')?.addEventListener('click', async () => {
    const docs = document.getElementById('tri-docs').value.trim();
    const interviews = document.getElementById('tri-interviews').value.trim();
    const commitmentsEl = document.getElementById('tri-commitments');
    const commitments = commitmentsEl ? commitmentsEl.value.trim() : '';
    const output = document.getElementById('tri-output');
    if (!docs || !interviews) return alert('Provide both finding docs and interview notes.'); output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Triangulation tool. Flag: CONTRADICTIONS, INCONSISTENCIES, UNACTED COMMITMENTS, UNSUPPORTED CLAIMS, FOLLOW-UPS. Rate severity. End with: "This is an AI-generated draft."', `FINDINGS:\n${docs}\n\nINTERVIEWS:\n${interviews}${commitments?'\n\nCOMMITMENTS:\n'+commitments:''}`);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Interview Prep', 'Triangulation', r);
    showReviewedCheckbox('tri-review', logId);
  });

  // ---- Module 7: Report Drafting ----
  document.getElementById('draft-gen-btn').addEventListener('click', async () => {
    const title = document.getElementById('draft-title').value.trim();
    const risk = document.getElementById('draft-risk').value;
    const criteria = document.getElementById('draft-criteria').value.trim();
    const condition = document.getElementById('draft-condition').value.trim();
    const cause = document.getElementById('draft-cause').value.trim();
    const consequence = document.getElementById('draft-consequence').value.trim();
    const recommendation = document.getElementById('draft-rec').value.trim();
    const output = document.getElementById('draft-output');
    if (!condition) return alert('At least Condition is required.');
    const inputData = `Title: ${title||'TBD'}\nRisk: ${risk}\nCriteria: ${criteria}\nCondition: ${condition}\nCause: ${cause}\nConsequence: ${consequence}\nInitial Recommendation: ${recommendation}`;
    output.innerHTML = ''; showLoading(output);
    const r = await callLLM(
      `Audit report drafting assistant. House style: formal, constructive, not accusatory.
Generate a structured finding with these five sections EXPLICITLY LABELED:
1. CRITERIA
2. CONDITION
3. CAUSE
4. CONSEQUENCE
5. RECOMMENDATION
Risk Rating: ${risk}
Include a Management Action Plan framework.
End with exactly: "This is an AI-generated draft. Auditor review and sign-off required before use."`, inputData);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Report Drafting', title || condition.substring(0, 200), r);
    showReviewedCheckbox('draft-review', logId);
  });

  document.getElementById('qc-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('qc-input').value.trim();
    const output = document.getElementById('qc-output');
    if (!input) return alert('Paste draft content.'); output.innerHTML = ''; showLoading(output);
    const r = await callLLM(
      `Quality control reviewer. Specifically validate:
1. Does the finding have all five IIA sections (Criteria/Condition/Cause/Consequence/Recommendation)?
2. Is the risk rating consistent with the consequence described?
3. Does the recommendation address the root cause stated?
Rate issues: Critical/Major/Minor. End with: "This is an AI-generated draft."`, input);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Report QC', input.substring(0, 200), r);
    showReviewedCheckbox('qc-review', logId);
  });

  // ---- Recommendation Tracker ----
  const recModal = document.getElementById('rec-modal');
  document.getElementById('add-rec-btn').addEventListener('click', () => { ['rec-report','rec-finding','rec-rec','rec-owner','rec-due'].forEach(id => {if(document.getElementById(id)) document.getElementById(id).value = '';}); document.getElementById('rec-status').value = 'open'; recModal.classList.add('show'); });
  document.getElementById('rec-close').addEventListener('click', () => recModal.classList.remove('show'));
  recModal.addEventListener('click', e => { if (e.target === recModal) recModal.classList.remove('show'); });

  document.getElementById('save-rec-btn').addEventListener('click', () => {
    const rec = { report: document.getElementById('rec-report').value.trim(), finding: document.getElementById('rec-finding').value.trim(), recommendation: document.getElementById('rec-rec').value.trim(), owner: document.getElementById('rec-owner').value.trim(), due: document.getElementById('rec-due').value, status: document.getElementById('rec-status').value };
    if (!rec.report || !rec.finding) return alert('Report and Finding required.');
    state.recs.push(rec); save('recommendations', state.recs); renderRecs(); recModal.classList.remove('show');
  });

  function renderRecs() {
    const tbody = document.getElementById('rec-tbody');
    if (state.recs.length === 0) { 
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8"><div class="empty-state"><p>No recommendations tracked.</p></div></td></tr>'; 
      return; 
    }
    
    tbody.innerHTML = state.recs.map((r, i) => {
      let daysText = '-';
      if (r.due) { const diff = Math.ceil((new Date(r.due) - Date.now()) / (1000*60*60*24)); daysText = diff > 0 ? diff+'d left' : diff === 0 ? 'Today' : Math.abs(diff)+'d overdue'; }
      return `<tr><td style="font-weight:500;">${r.report}</td><td>${r.finding}</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.recommendation}">${r.recommendation}</td><td>${r.owner}</td><td>${r.due||'-'}</td><td><span class="status-badge ${r.status}">${r.status}</span></td><td>${daysText}</td><td><button type="button" class="btn-icon del-rec" data-idx="${i}">🗑</button></td></tr>`;
    }).join('');
    
    // Delete Rec
    tbody.querySelectorAll('.del-rec').forEach(btn => btn.addEventListener('click', (e) => { 
      e.preventDefault(); 
      e.stopPropagation(); 
      if (confirm('Delete this recommendation?')) { 
        state.recs.splice(parseInt(btn.dataset.idx), 1); 
        save('recommendations', state.recs); 
        localStorage.setItem('auditai_demo_cleared', 'true'); 
        renderRecs(); 
        
        const aiOutput = document.getElementById('rec-ai-output');
        if (aiOutput) aiOutput.innerHTML = '<p class="muted">Data modified. Re-run analysis.</p>';
      } 
    }));
  }

  document.getElementById('rec-ai-btn').addEventListener('click', async () => {
    const output = document.getElementById('rec-ai-output');
    if (state.recs.length === 0) { output.innerHTML = '<p class="muted">Add recommendations first.</p>'; return; }
    const data = state.recs.map(r => `${r.report}: ${r.finding} | Owner:${r.owner} | Due:${r.due||'N/A'} | Status:${r.status}`).join('\n');
    output.innerHTML = ''; showLoading(output);
    const r = await callLLM('Recommendation follow-up analyst. Highlight overdue items, approaching deadlines, non-implementation patterns. End with: "This is an AI-generated draft."', data);
    removeLoading(output); output.innerHTML = formatResponse(r);
    const logId = logAIOutput('Rec Tracker', data, r);
    showReviewedCheckbox('rec-ai-review', logId); // ID changed slightly to match generic style, will fall back cleanly
  });

  // ---- INIT ----
  async function init() {
    state.settings.apiKey = localStorage.getItem('auditai_apikey') || state.settings.apiKey || '';
    state.settings.provider = state.settings.provider || 'openai';
    state.settings.model = state.settings.model || 'gpt-4o';

    await openDB();
    const old = JSON.parse(localStorage.getItem('auditai_docs') || '[]');
    if (old.length > 0) { for (const d of old) { d.id = await dbPut(d); } localStorage.removeItem('auditai_docs'); }
    state.docs = await dbGetAll();

   // ---- CHANGE 2: Demo Data (Fictionalized) ----
  function loadDemoData() {
    if (state.grants.length === 0 && state.entities.length === 0 && state.recs.length === 0 && !localStorage.getItem('auditai_demo_cleared')) {
      
      // Fictional Grant
      state.grants = [{
        id: 'APEX-9901', name: 'Zelorian Ecosystem Harmonization', donor: 'Apex Foundation', budget: 12500000, expenditure: 11000000,
        burnRate: 88, subgrants: 12, startDate: '2023-01-01', endDate: '2026-12-31',
        countries: 'Zeloria', singleVendor: true, lateSpend: true, docGaps: false, extAudit: true,
        notes: 'Fictional demo grant data', riskScore: 0,
      }];
      state.grants[0].riskScore = calculateGrantRisk(state.grants[0]);

      // Fictional Entity
      state.entities = [{
        name: 'Zeloria Country Office', region: 'HQ', type: 'Country Office', staff: 42,
        lastAudit: '2024-05-15', openRecs: 4, turnover: 18, budgetVol: 6, security: 2,
        complaints: 1, donorChange: 'stable', regRisk: 'medium', grantBurn: 88,
        notes: 'Totally fictional entity for demo purposes', riskScore: 0, trend: 'stable', prevScore: 0,
      }];
      state.entities[0].riskScore = calculateEntityRisk(state.entities[0]);
      state.entities[0].prevScore = state.entities[0].riskScore;

      // Fictional Recommendation
      state.recs = [{
        report: 'Zeloria CO Audit 2024', finding: 'Fictional Compliance Gap',
        recommendation: 'Implement standard flux capacitor maintenance logs.',
        owner: 'Director of Zelorian Affairs', due: '2026-10-01', status: 'open',
      }];

      save('grants', state.grants);
      save('entities', state.entities);
      save('recommendations', state.recs);
      // Ensures this fake data only loads once, unless the user clears it manually
      localStorage.setItem('auditai_demo_cleared', 'true'); 
    }
  }
  }

  init();
})();
