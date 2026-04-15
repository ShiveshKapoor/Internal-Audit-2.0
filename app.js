/* ============================================
   AuditAI — Application Logic (Persistent Storage)
   ============================================ */

(function () {
  'use strict';

  // ---- IndexedDB for Document Storage ----
  const DB_NAME = 'auditai_db';
  const DB_VERSION = 1;
  const DOC_STORE = 'documents';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(DOC_STORE)) {
          database.createObjectStore(DOC_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => { console.error('IndexedDB error', e); reject(e); };
    });
  }

  function dbPutDoc(doc) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, 'readwrite');
      const store = tx.objectStore(DOC_STORE);
      const req = store.put(doc);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e);
    });
  }

  function dbGetAllDocs() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, 'readonly');
      const store = tx.objectStore(DOC_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e);
    });
  }

  function dbDeleteDoc(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, 'readwrite');
      const store = tx.objectStore(DOC_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  }

  // ---- State (localStorage for small data, IndexedDB for docs) ----
  const state = {
    grants: JSON.parse(localStorage.getItem('auditai_grants') || '[]'),
    entities: JSON.parse(localStorage.getItem('auditai_entities') || '[]'),
    recs: JSON.parse(localStorage.getItem('auditai_recs') || '[]'),
    docs: [], // Loaded from IndexedDB
    chatHistory: JSON.parse(localStorage.getItem('auditai_chat') || '[]'),
    settings: JSON.parse(localStorage.getItem('auditai_settings') || '{}'),
    editingGrantIdx: -1,
    editingEntityIdx: -1,
  };

  function save(key, data) {
    localStorage.setItem('auditai_' + key, JSON.stringify(data));
  }

  // ---- API Status Indicator ----
  function updateApiStatus() {
    const dot = document.getElementById('api-status-dot');
    const text = document.getElementById('api-status-text');
    if (state.settings.apiKey) {
      dot.classList.add('connected');
      const provider = state.settings.provider || 'openai';
      const model = state.settings.model || 'gpt-4o';
      const labels = { openai: 'OpenAI', azure: 'Azure', custom: 'Custom' };
      text.textContent = `${labels[provider] || provider} · ${model}`;
    } else {
      dot.classList.remove('connected');
      text.textContent = 'Not connected';
    }
  }

  // ---- Document Count Badge ----
  function updateDocBadge() {
    const navMemory = document.getElementById('nav-memory');
    let badge = navMemory.querySelector('.doc-count-badge');
    if (state.docs.length > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'doc-count-badge';
        navMemory.appendChild(badge);
      }
      badge.textContent = state.docs.length;
    } else if (badge) {
      badge.remove();
    }
  }

  // ---- Navigation ----
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = btn.dataset.module;
      navItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
      document.getElementById('module-' + mod).classList.add('active');
    });
  });

  // ---- Tab Navigation ----
  document.querySelectorAll('.tab-bar').forEach(bar => {
    bar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        const parent = bar.parentElement;
        bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        parent.querySelector('#tab-' + tabId).classList.add('active');
      });
    });
  });

  // ---- Settings Modal ----
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
    const ep = document.getElementById('api-endpoint-group');
    ep.style.display = (providerSelect.value === 'custom' || providerSelect.value === 'azure') ? 'block' : 'none';
  }

  document.getElementById('save-settings-btn').addEventListener('click', () => {
    state.settings = {
      provider: document.getElementById('api-provider').value,
      apiKey: document.getElementById('api-key').value,
      endpoint: document.getElementById('api-endpoint').value,
      model: document.getElementById('api-model').value,
    };
    save('settings', state.settings);
    updateApiStatus();
    const status = document.getElementById('settings-status');
    status.textContent = '✓ Settings saved — API key will persist across sessions';
    status.className = 'settings-status success';
    setTimeout(() => settingsModal.classList.remove('show'), 1500);
  });

  // ---- LLM API Call ----
  async function callLLM(systemPrompt, userMessage) {
    const { provider, apiKey, endpoint, model } = state.settings;

    if (!apiKey) {
      return '⚠️ No API key configured. Click "API Settings" in the sidebar to connect your LLM provider.';
    }

    let url;
    if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
    } else if (provider === 'azure' || provider === 'custom') {
      if (!endpoint) return '⚠️ No API endpoint configured. Please set your endpoint in API Settings.';
      url = endpoint.endsWith('/') ? endpoint + 'chat/completions' : endpoint + '/chat/completions';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'azure') {
      headers['api-key'] = apiKey;
    } else {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }

    const body = {
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 2000,
    };

    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.text();
        return '⚠️ API Error (' + res.status + '): ' + err.substring(0, 200);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '(No response from model)';
    } catch (err) {
      return '⚠️ Network error: ' + err.message;
    }
  }

  function showLoading(container) {
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.id = 'loading-' + container.id;
    el.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  function removeLoading(container) {
    const el = document.getElementById('loading-' + container.id);
    if (el) el.remove();
  }

  // ---- Module 1: Institutional Memory (IndexedDB-backed) ----
  const memoryChat = document.getElementById('memory-chat');
  const memoryInput = document.getElementById('memory-input');

  // Document upload
  document.getElementById('memory-upload-btn').addEventListener('click', () => {
    document.getElementById('memory-file-input').click();
  });

  document.getElementById('memory-file-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(f => {
      // Detect file type and extract text accordingly
      const isPDF = f.name.toLowerCase().endsWith('.pdf');

      if (isPDF) {
        // Read PDF using pdf.js
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const typedArray = new Uint8Array(ev.target.result);
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument(typedArray).promise;
            let fullText = '';
            const maxPages = Math.min(pdf.numPages, 50); // Cap at 50 pages
            for (let i = 1; i <= maxPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map(item => item.str).join(' ');
              fullText += `\n--- Page ${i} ---\n${pageText}`;
            }
            const content = fullText.substring(0, 50000);
            const doc = { name: f.name, size: f.size, content: content, uploadedAt: new Date().toISOString() };
            const id = await dbPutDoc(doc);
            doc.id = id;
            state.docs.push(doc);
            renderDocs();
            updateDocBadge();
            await generateDocSummary(doc, state.docs.length - 1);
          } catch (err) {
            console.error('PDF parse error:', err);
            alert('Could not read PDF: ' + err.message);
          }
        };
        reader.readAsArrayBuffer(f);
      } else {
        // Read as plain text (.txt, .doc, .docx)
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const content = ev.target.result.substring(0, 50000);
          const doc = { name: f.name, size: f.size, content: content, uploadedAt: new Date().toISOString() };
          const id = await dbPutDoc(doc);
          doc.id = id;
          state.docs.push(doc);
          renderDocs();
          updateDocBadge();
          await generateDocSummary(doc, state.docs.length - 1);
        };
        reader.readAsText(f);
      }
    });
    e.target.value = '';
  });

  async function generateDocSummary(doc, idx) {
    const container = document.getElementById('doc-summary-container');
    container.innerHTML = `
      <div class="doc-summary-card">
        <h4>Summarizing: ${doc.name}</h4>
        <div class="typing-indicator"><span></span><span></span><span></span></div>
      </div>`;

    const systemPrompt = `You are a document analyst for an Internal Audit Unit. When given a document, produce a concise framework summary with these sections:
1. **DOCUMENT TYPE**: (audit report, planning memo, management response, working paper, etc.)
2. **SCOPE**: What entity/office/programme does this cover?
3. **KEY FINDINGS**: List the main findings (max 5), each in one sentence
4. **OPEN ACTIONS**: Any management actions or recommendations still pending
5. **RISK SIGNALS**: Notable risk indicators mentioned
6. **TIME PERIOD**: What period does this document cover?

Keep it concise — this is a quick reference card, not a full analysis. Use bullet points.`;

    const response = await callLLM(systemPrompt, `Summarize this audit document:\n\nFilename: ${doc.name}\n\nContent:\n${doc.content.substring(0, 8000)}`);

    // Update doc with summary in IndexedDB
    state.docs[idx].summary = response;
    await dbPutDoc(state.docs[idx]);

    container.innerHTML = `
      <div class="doc-summary-card">
        <h4>Summary: ${doc.name}</h4>
        <div class="summary-text">${formatResponse(response)}</div>
      </div>`;
  }

  function renderDocs() {
    const list = document.getElementById('memory-doc-list');
    if (state.docs.length === 0) {
      list.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>Upload audit reports, planning memos, working papers, and management responses</p></div>';
      document.getElementById('doc-summary-container').innerHTML = '';
      return;
    }
    list.innerHTML = state.docs.map((d, i) => {
      const dateStr = d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : '';
      const sizeStr = d.size ? (d.size < 1024 ? d.size + ' B' : (d.size / 1024).toFixed(1) + ' KB') : '';
      return `
      <div class="doc-item" data-idx="${i}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span title="${d.name}${dateStr ? ' — ' + dateStr : ''}${sizeStr ? ' (' + sizeStr + ')' : ''}">${d.name}</span>
        <button class="btn-icon remove-doc" data-idx="${i}" data-id="${d.id || ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join('');

    // Click doc to show summary
    list.querySelectorAll('.doc-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.remove-doc')) return;
        const idx = parseInt(item.dataset.idx);
        const doc = state.docs[idx];
        const container = document.getElementById('doc-summary-container');
        if (doc.summary) {
          container.innerHTML = `
            <div class="doc-summary-card">
              <h4>Summary: ${doc.name}</h4>
              <div class="summary-text">${formatResponse(doc.summary)}</div>
            </div>`;
        } else {
          container.innerHTML = `<div class="doc-summary-card"><h4>${doc.name}</h4><p class="muted">No summary available. Re-upload to generate.</p></div>`;
        }
      });
    });

    list.querySelectorAll('.remove-doc').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const docId = state.docs[idx].id;
        if (docId) await dbDeleteDoc(docId);
        state.docs.splice(idx, 1);
        renderDocs();
        updateDocBadge();
      });
    });
  }

  // Chat
  document.querySelectorAll('#module-memory .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      memoryInput.value = chip.dataset.q;
      sendMemoryChat();
    });
  });

  document.getElementById('memory-send').addEventListener('click', sendMemoryChat);
  memoryInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMemoryChat(); }
  });

  async function sendMemoryChat() {
    const text = memoryInput.value.trim();
    if (!text) return;
    memoryInput.value = '';

    const welcome = memoryChat.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user';
    userMsg.textContent = text;
    memoryChat.appendChild(userMsg);
    memoryChat.scrollTop = memoryChat.scrollHeight;

    const docContext = state.docs.map(d => `--- Document: ${d.name} ---\n${d.content}`).join('\n\n');

    const systemPrompt = `You are an internal audit knowledge assistant for CIFOR-ICRAF's Internal Audit Unit (IAU). You have access to the following audit documents:

${docContext || '(No documents uploaded yet)'}

When answering questions:
- Synthesise information across documents, don't just list links
- Reference specific documents and findings when relevant
- Identify patterns across offices and time periods
- Note any open recommendations or unresolved issues
- Be precise about dates, amounts, and responsible parties
- If the question cannot be answered from the available documents, say so clearly

If no documents are uploaded, explain that the user needs to upload audit documents first, and give an example of the kind of answer you could provide.`;

    showLoading(memoryChat);
    const response = await callLLM(systemPrompt, text);
    removeLoading(memoryChat);

    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-msg ai';
    aiMsg.innerHTML = '<div class="msg-label">AuditAI</div>' + formatResponse(response);
    memoryChat.appendChild(aiMsg);
    memoryChat.scrollTop = memoryChat.scrollHeight;

    state.chatHistory.push({ role: 'user', content: text }, { role: 'ai', content: response });
    save('chat', state.chatHistory);
  }

  // Restore chat history
  function restoreChatHistory() {
    if (state.chatHistory.length > 0) {
      const welcome = memoryChat.querySelector('.chat-welcome');
      if (welcome) welcome.remove();
      state.chatHistory.forEach(msg => {
        const el = document.createElement('div');
        if (msg.role === 'user') {
          el.className = 'chat-msg user';
          el.textContent = msg.content;
        } else {
          el.className = 'chat-msg ai';
          el.innerHTML = '<div class="msg-label">AuditAI</div>' + formatResponse(msg.content);
        }
        memoryChat.appendChild(el);
      });
    }
  }

  // ---- Module 2: Grant Risk Radar ----
  const grantModal = document.getElementById('grant-modal');
  document.getElementById('add-grant-btn').addEventListener('click', () => {
    state.editingGrantIdx = -1;
    document.getElementById('grant-modal-title').textContent = 'Add Grant';
    clearGrantForm();
    grantModal.classList.add('show');
  });
  document.getElementById('grant-close').addEventListener('click', () => grantModal.classList.remove('show'));
  grantModal.addEventListener('click', e => { if (e.target === grantModal) grantModal.classList.remove('show'); });

  function clearGrantForm() {
    ['grant-id', 'grant-name', 'grant-donor', 'grant-budget', 'grant-expenditure',
     'grant-burn', 'grant-subgrants', 'grant-start', 'grant-end', 'grant-countries', 'grant-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['grant-vendor', 'grant-late', 'grant-docs', 'grant-extaudit'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = 'no';
    });
  }

  document.getElementById('save-grant-btn').addEventListener('click', () => {
    const grant = {
      id: document.getElementById('grant-id').value.trim(),
      name: document.getElementById('grant-name').value.trim(),
      donor: document.getElementById('grant-donor').value.trim(),
      budget: parseFloat(document.getElementById('grant-budget').value) || 0,
      expenditure: parseFloat(document.getElementById('grant-expenditure').value) || 0,
      burnRate: parseFloat(document.getElementById('grant-burn').value) || 0,
      subgrants: parseInt(document.getElementById('grant-subgrants').value) || 0,
      startDate: document.getElementById('grant-start').value,
      endDate: document.getElementById('grant-end').value,
      countries: document.getElementById('grant-countries').value.trim(),
      singleVendor: document.getElementById('grant-vendor').value === 'yes',
      lateSpend: document.getElementById('grant-late').value === 'yes',
      docGaps: document.getElementById('grant-docs').value === 'yes',
      extAudit: document.getElementById('grant-extaudit').value === 'yes',
      notes: document.getElementById('grant-notes').value.trim(),
    };
    if (!grant.id || !grant.name) return alert('Grant ID and Programme Name are required.');

    if (grant.budget > 0 && grant.expenditure > 0 && !grant.burnRate) {
      grant.burnRate = Math.round((grant.expenditure / grant.budget) * 100);
    }

    grant.riskScore = calculateGrantRisk(grant);

    if (state.editingGrantIdx >= 0) {
      state.grants[state.editingGrantIdx] = grant;
    } else {
      state.grants.push(grant);
    }
    save('grants', state.grants);
    renderGrants();
    grantModal.classList.remove('show');
  });

  function calculateGrantRisk(g) {
    let score = 0;
    if (g.burnRate <= 5 && g.budget > 0) score += 25;
    else if (g.burnRate >= 85) score += 20;
    else if (g.burnRate > 5 && g.burnRate < 30) score += 15;
    else if (g.burnRate >= 60 && g.burnRate < 85) score += 5;

    if (g.singleVendor) score += 20;
    if (g.lateSpend) score += 18;
    if (g.docGaps) score += 22;

    if (g.budget >= 20000000) score += 10;
    else if (g.budget >= 10000000) score += 5;

    if (g.subgrants > 10) score += 8;
    else if (g.subgrants > 5) score += 4;

    if (g.endDate) {
      const monthsLeft = Math.ceil((new Date(g.endDate) - Date.now()) / (1000 * 60 * 60 * 24 * 30));
      if (monthsLeft <= 6 && g.burnRate < 50) score += 12;
      else if (monthsLeft <= 12 && g.burnRate < 30) score += 8;
    }

    if (g.extAudit) score += 3;
    return Math.min(score, 100);
  }

  function riskLevel(score) {
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  function fmtUSD(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
    return '$' + n.toLocaleString();
  }

  function renderGrants() {
    const tbody = document.getElementById('grants-tbody');
    if (state.grants.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="14"><div class="empty-state"><p>No grants added yet. Click "Add Grant" to begin monitoring.</p></div></td></tr>';
      updateGrantStats();
      return;
    }
    tbody.innerHTML = state.grants.map((g, i) => {
      const level = riskLevel(g.riskScore);
      return `<tr>
        <td style="color: var(--text-primary); font-weight: 500;">${g.id}</td>
        <td title="${g.name}">${g.name.length > 20 ? g.name.substring(0, 20) + '…' : g.name}</td>
        <td>${g.donor || '-'}</td>
        <td>${fmtUSD(g.budget)}</td>
        <td>${fmtUSD(g.expenditure)}</td>
        <td>${g.burnRate}%</td>
        <td>${g.endDate || '-'}</td>
        <td>${g.subgrants || 0}</td>
        <td>${g.singleVendor ? '⚠️' : '—'}</td>
        <td>${g.lateSpend ? '⚠️' : '—'}</td>
        <td>${g.docGaps ? '⚠️' : '—'}</td>
        <td>${g.extAudit ? '✓' : '—'}</td>
        <td><span class="risk-badge ${level}">${g.riskScore}</span></td>
        <td>
          <button class="btn-icon edit-grant" data-idx="${i}" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-icon del-grant" data-idx="${i}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.edit-grant').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        state.editingGrantIdx = idx;
        const g = state.grants[idx];
        document.getElementById('grant-modal-title').textContent = 'Edit Grant';
        document.getElementById('grant-id').value = g.id;
        document.getElementById('grant-name').value = g.name;
        document.getElementById('grant-donor').value = g.donor || '';
        document.getElementById('grant-budget').value = g.budget;
        document.getElementById('grant-expenditure').value = g.expenditure || '';
        document.getElementById('grant-burn').value = g.burnRate;
        document.getElementById('grant-subgrants').value = g.subgrants || '';
        document.getElementById('grant-start').value = g.startDate || '';
        document.getElementById('grant-end').value = g.endDate || '';
        document.getElementById('grant-countries').value = g.countries || '';
        document.getElementById('grant-vendor').value = g.singleVendor ? 'yes' : 'no';
        document.getElementById('grant-late').value = g.lateSpend ? 'yes' : 'no';
        document.getElementById('grant-docs').value = g.docGaps ? 'yes' : 'no';
        document.getElementById('grant-extaudit').value = g.extAudit ? 'yes' : 'no';
        document.getElementById('grant-notes').value = g.notes || '';
        grantModal.classList.add('show');
      });
    });

    tbody.querySelectorAll('.del-grant').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this grant?')) {
          state.grants.splice(parseInt(btn.dataset.idx), 1);
          save('grants', state.grants);
          renderGrants();
        }
      });
    });

    updateGrantStats();
  }

  function updateGrantStats() {
    document.getElementById('stat-total-grants').textContent = state.grants.length;
    document.getElementById('stat-high-risk').textContent = state.grants.filter(g => riskLevel(g.riskScore) === 'high').length;
    document.getElementById('stat-medium-risk').textContent = state.grants.filter(g => riskLevel(g.riskScore) === 'medium').length;
    document.getElementById('stat-low-risk').textContent = state.grants.filter(g => riskLevel(g.riskScore) === 'low').length;
    const totalBudget = state.grants.reduce((sum, g) => sum + g.budget, 0);
    document.getElementById('stat-total-budget').textContent = fmtUSD(totalBudget);
  }

  // Grant AI Analysis
  document.getElementById('analyze-grants-btn').addEventListener('click', async () => {
    const output = document.getElementById('grant-ai-output');
    if (state.grants.length === 0) {
      output.innerHTML = '<p class="muted">Add grants first to analyze the portfolio.</p>';
      return;
    }
    const grantData = state.grants.map(g =>
      `${g.id} "${g.name}" [Donor: ${g.donor || 'N/A'}]: Budget ${fmtUSD(g.budget)}, Spent ${fmtUSD(g.expenditure)}, Burn Rate ${g.burnRate}%, Sub-grants: ${g.subgrants}, End Date: ${g.endDate || 'N/A'}, Countries: ${g.countries || 'N/A'}, Single Vendor: ${g.singleVendor}, Late Spend: ${g.lateSpend}, Doc Gaps: ${g.docGaps}, Ext Audit: ${g.extAudit}, Risk Score: ${g.riskScore}${g.notes ? ', Notes: ' + g.notes : ''}`
    ).join('\n');

    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      'You are an internal audit risk analyst for CIFOR-ICRAF. Provide concise, actionable risk analysis for the grant portfolio. Cover: highest-risk grants and why, burn rate anomalies, sub-grant complexity risks, timeline risks, documentation gaps, vendor concentration, and recommended audit prioritization.',
      `Analyze this grant portfolio:\n\n${grantData}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Module 3: Fraud Signal Detection ----
  document.getElementById('fraud-file-drop').addEventListener('click', () => document.getElementById('fraud-file-input').click());
  document.getElementById('fraud-file-drop').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('dragging'); });
  document.getElementById('fraud-file-drop').addEventListener('dragleave', e => e.currentTarget.classList.remove('dragging'));
  document.getElementById('fraud-file-drop').addEventListener('drop', e => { e.preventDefault(); e.currentTarget.classList.remove('dragging'); });

  document.getElementById('fraud-analyze-btn').addEventListener('click', async () => {
    const type = document.getElementById('fraud-type').value;
    const input = document.getElementById('fraud-input').value.trim();
    const output = document.getElementById('fraud-results');
    if (!input) return alert('Please enter or paste data to analyze.');

    const typeLabels = {
      procurement: 'procurement narratives and vendor justifications',
      vendor: 'vendor payment patterns',
      loa: 'LOA documentation and due diligence compliance',
      email: 'email metadata for business email compromise indicators',
      partner: 'partner payment draw-downs and milestone alignment'
    };

    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      `You are a fraud signal detection AI for CIFOR-ICRAF's internal audit unit. Analyze ${typeLabels[type]} for anomaly patterns. Flag each anomaly with severity (High/Medium/Low), explain why it matters, and suggest investigation steps.`,
      `Analyze for fraud signals:\n\n${input}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Module 4: Remote Audit ----
  document.getElementById('remote-doc-analyze').addEventListener('click', async () => {
    const input = document.getElementById('remote-doc-input').value.trim();
    const output = document.getElementById('remote-doc-output');
    if (!input) return alert('Please enter document data.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      'You are a document consistency analysis AI for internal auditors. Scan evidence for inconsistencies, unusual patterns, missing fields, and anomalies. Present findings with severity ratings.',
      `Analyze for consistency:\n\n${input}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  document.getElementById('remote-interview-gen').addEventListener('click', async () => {
    const office = document.getElementById('remote-office').value.trim();
    const context = document.getElementById('remote-context').value.trim();
    const output = document.getElementById('remote-interview-output');
    if (!context) return alert('Please provide background information.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      'You are an interview preparation assistant for CIFOR-ICRAF auditors. Generate a structured fieldwork brief with: key questions by area, risk signals, prior commitments, evidence gaps, and suggested interview sequencing.',
      `Interview brief for: ${office || '(not specified)'}\n\nBackground:\n${context}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  document.getElementById('remote-compare-btn').addEventListener('click', async () => {
    const evidence = document.getElementById('remote-evidence').value.trim();
    const statements = document.getElementById('remote-statements').value.trim();
    const output = document.getElementById('remote-compare-output');
    if (!evidence || !statements) return alert('Provide both evidence and statements.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      'You are a real-time audit flag comparison tool. Compare statements against evidence, flag inconsistencies with references, suggest follow-up questions.',
      `EVIDENCE:\n${evidence}\n\nSTATEMENTS:\n${statements}\n\nIdentify all inconsistencies.`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Module 5: Predictive Risk Scoring ----
  const entityModal = document.getElementById('entity-modal');
  document.getElementById('add-entity-btn').addEventListener('click', () => {
    state.editingEntityIdx = -1;
    document.getElementById('entity-modal-title').textContent = 'Add Entity';
    ['entity-name', 'entity-last-audit', 'entity-open-recs', 'entity-turnover',
     'entity-budget-vol', 'entity-security', 'entity-complaints', 'entity-staff',
     'entity-grant-burn', 'entity-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('entity-region').value = 'Africa';
    document.getElementById('entity-type').value = 'Country Office';
    document.getElementById('entity-donor-change').value = 'stable';
    document.getElementById('entity-reg-risk').value = 'low';
    entityModal.classList.add('show');
  });
  document.getElementById('entity-close').addEventListener('click', () => entityModal.classList.remove('show'));
  entityModal.addEventListener('click', e => { if (e.target === entityModal) entityModal.classList.remove('show'); });

  document.getElementById('save-entity-btn').addEventListener('click', () => {
    const entity = {
      name: document.getElementById('entity-name').value.trim(),
      region: document.getElementById('entity-region').value,
      type: document.getElementById('entity-type').value,
      staff: parseInt(document.getElementById('entity-staff').value) || 0,
      lastAudit: document.getElementById('entity-last-audit').value,
      openRecs: parseInt(document.getElementById('entity-open-recs').value) || 0,
      turnover: parseFloat(document.getElementById('entity-turnover').value) || 0,
      budgetVol: parseInt(document.getElementById('entity-budget-vol').value) || 1,
      security: parseInt(document.getElementById('entity-security').value) || 1,
      complaints: parseInt(document.getElementById('entity-complaints').value) || 0,
      donorChange: document.getElementById('entity-donor-change').value,
      regRisk: document.getElementById('entity-reg-risk').value,
      grantBurn: parseFloat(document.getElementById('entity-grant-burn').value) || 0,
      notes: document.getElementById('entity-notes').value.trim(),
    };
    if (!entity.name) return alert('Entity name is required.');

    entity.riskScore = calculateEntityRisk(entity);
    entity.trend = 'stable';

    if (state.editingEntityIdx >= 0) {
      const prev = state.entities[state.editingEntityIdx];
      entity.trend = entity.riskScore > (prev.riskScore || 0) ? 'up' : entity.riskScore < (prev.riskScore || 0) ? 'down' : 'stable';
      state.entities[state.editingEntityIdx] = entity;
    } else {
      state.entities.push(entity);
    }
    save('entities', state.entities);
    renderEntities();
    entityModal.classList.remove('show');
  });

  function calculateEntityRisk(e) {
    let score = 0;
    if (e.lastAudit) {
      const months = Math.floor((Date.now() - new Date(e.lastAudit).getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (months > 36) score += 18;
      else if (months > 24) score += 10;
      else if (months > 12) score += 4;
    } else { score += 18; }

    if (e.openRecs > 5) score += 12;
    else if (e.openRecs > 2) score += 6;
    else if (e.openRecs > 0) score += 2;

    if (e.turnover > 40) score += 12;
    else if (e.turnover > 20) score += 6;
    else if (e.turnover > 10) score += 2;

    score += Math.min(e.budgetVol * 1.5, 15);
    score += e.security * 3;

    if (e.complaints > 3) score += 12;
    else if (e.complaints > 1) score += 6;
    else if (e.complaints > 0) score += 2;

    if (e.donorChange === 'volatile') score += 10;
    else if (e.donorChange === 'decreasing') score += 6;

    if (e.regRisk === 'high') score += 10;
    else if (e.regRisk === 'medium') score += 4;

    if (e.grantBurn > 0) {
      if (e.grantBurn <= 10 || e.grantBurn >= 85) score += 6;
    }

    if (e.staff === 1) score += 5;

    return Math.min(Math.round(score), 100);
  }

  function renderEntities() {
    const tbody = document.getElementById('entity-tbody');
    if (state.entities.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="16"><div class="empty-state"><p>Add entities from your audit universe to begin risk scoring.</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = state.entities.map((e, i) => {
      const level = riskLevel(e.riskScore);
      const trendIcon = e.trend === 'up' ? '↑' : e.trend === 'down' ? '↓' : '→';
      const trendClass = e.trend === 'up' ? 'trend-up' : e.trend === 'down' ? 'trend-down' : 'trend-stable';
      const donorLabel = { stable: '—', increasing: '↑', decreasing: '↓⚠', volatile: '⚠⚠' }[e.donorChange] || '—';
      const regLabel = { low: '—', medium: '⚠', high: '⚠⚠' }[e.regRisk] || '—';
      return `<tr>
        <td style="color: var(--text-primary); font-weight: 500;">${e.name}</td>
        <td>${e.region}</td>
        <td>${e.type || 'CO'}</td>
        <td>${e.lastAudit || 'Never'}</td>
        <td>${e.openRecs}</td>
        <td>${e.staff || '-'}</td>
        <td>${e.turnover}%</td>
        <td>${e.budgetVol}/10</td>
        <td>${e.security}/5</td>
        <td>${e.complaints}</td>
        <td>${donorLabel}</td>
        <td>${regLabel}</td>
        <td>${e.grantBurn ? e.grantBurn + '%' : '-'}</td>
        <td><span class="risk-badge ${level}">${e.riskScore}</span></td>
        <td class="${trendClass}" style="font-size: 1.2rem; font-weight: 600;">${trendIcon}</td>
        <td>
          <button class="btn-icon edit-entity" data-idx="${i}" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-icon del-entity" data-idx="${i}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.edit-entity').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        state.editingEntityIdx = idx;
        const e = state.entities[idx];
        document.getElementById('entity-modal-title').textContent = 'Edit Entity';
        document.getElementById('entity-name').value = e.name;
        document.getElementById('entity-region').value = e.region;
        document.getElementById('entity-type').value = e.type || 'Country Office';
        document.getElementById('entity-staff').value = e.staff || '';
        document.getElementById('entity-last-audit').value = e.lastAudit;
        document.getElementById('entity-open-recs').value = e.openRecs;
        document.getElementById('entity-turnover').value = e.turnover;
        document.getElementById('entity-budget-vol').value = e.budgetVol;
        document.getElementById('entity-security').value = e.security;
        document.getElementById('entity-complaints').value = e.complaints;
        document.getElementById('entity-donor-change').value = e.donorChange || 'stable';
        document.getElementById('entity-reg-risk').value = e.regRisk || 'low';
        document.getElementById('entity-grant-burn').value = e.grantBurn || '';
        document.getElementById('entity-notes').value = e.notes || '';
        entityModal.classList.add('show');
      });
    });

    tbody.querySelectorAll('.del-entity').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this entity?')) {
          state.entities.splice(parseInt(btn.dataset.idx), 1);
          save('entities', state.entities);
          renderEntities();
        }
      });
    });
  }

  // Entity AI Analysis
  document.getElementById('analyze-entities-btn').addEventListener('click', async () => {
    const output = document.getElementById('entity-ai-output');
    if (state.entities.length === 0) {
      output.innerHTML = '<p class="muted">Add entities first.</p>';
      return;
    }
    const data = state.entities.map(e =>
      `${e.name} (${e.region}, ${e.type}): Staff ${e.staff || 'N/A'}, Last Audit ${e.lastAudit || 'Never'}, Open Recs: ${e.openRecs}, Turnover: ${e.turnover}%, Budget Vol: ${e.budgetVol}/10, Security: ${e.security}/5, Complaints: ${e.complaints}, Donor: ${e.donorChange}, Reg Risk: ${e.regRisk}, Grant Burn: ${e.grantBurn || 'N/A'}%, Score: ${e.riskScore}, Trend: ${e.trend}${e.notes ? ', Notes: ' + e.notes : ''}`
    ).join('\n');

    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      'You are a predictive risk analyst for CIFOR-ICRAF\'s IAU. Analyze audit universe entities: prioritized ranking, key risk drivers, mid-year plan adjustments, compounding signals, IIA Standards alignment. Consider internal, external, and programme signals.',
      `Analyze this audit universe:\n\n${data}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Module 6: Interview Prep & Triangulation ----
  document.getElementById('interview-gen-btn').addEventListener('click', async () => {
    const engagement = document.getElementById('interview-engagement').value.trim();
    const source = document.getElementById('interview-source').value.trim();
    const output = document.getElementById('interview-brief-output');
    if (!source) return alert('Please provide source material.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      `Interview preparation assistant for CIFOR-ICRAF. Generate structured brief:
1. **KEY QUESTIONS BY AREA**
2. **RISK SIGNALS TO PROBE**
3. **PRIOR COMMITMENTS**
4. **EVIDENCE GAPS**
5. **SUGGESTED INTERVIEW SEQUENCE**`,
      `Engagement: ${engagement || '(not specified)'}\n\nSource:\n${source}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  document.getElementById('triangulation-btn').addEventListener('click', async () => {
    const docs = document.getElementById('triangulation-docs').value.trim();
    const interviews = document.getElementById('triangulation-interviews').value.trim();
    const commitments = document.getElementById('triangulation-commitments').value.trim();
    const output = document.getElementById('triangulation-output');
    if (!docs || !interviews) return alert('Please provide both findings and interview notes.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      `Triangulation tool for CIFOR-ICRAF auditors. Flag:
1. **DIRECT CONTRADICTIONS**
2. **INCONSISTENT ACCOUNTS**
3. **UNACTED COMMITMENTS**
4. **UNSUPPORTED CLAIMS**
5. **SUGGESTED FOLLOW-UPS**
Rate severity of each.`,
      `FINDINGS:\n${docs}\n\nINTERVIEWS:\n${interviews}${commitments ? '\n\nCOMMITMENTS:\n' + commitments : ''}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Module 7: Report Drafting & QC ----
  document.getElementById('draft-gen-btn').addEventListener('click', async () => {
    const title = document.getElementById('draft-title').value.trim();
    const risk = document.getElementById('draft-risk').value;
    const notes = document.getElementById('draft-notes').value.trim();
    const output = document.getElementById('draft-output');
    if (!notes) return alert('Please enter working notes.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      `Audit report drafting assistant for CIFOR-ICRAF IAU. House style: accurate, objective, clear, concise, constructive, timely. Generate:
1. **FINDING TITLE**
2. **RISK RATING**: ${risk.toUpperCase()}
3. **CONDITION**
4. **CRITERIA**
5. **ROOT CAUSE**
6. **EFFECT/IMPACT**
7. **RECOMMENDATION**
8. **MANAGEMENT ACTION PLAN**`,
      `Finding: ${title || '(TBD)'}\nRisk: ${risk}\n\nNotes:\n${notes}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  document.getElementById('qc-check-btn').addEventListener('click', async () => {
    const input = document.getElementById('qc-input').value.trim();
    const output = document.getElementById('qc-output');
    if (!input) return alert('Please enter draft content.');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      `QC reviewer for CIFOR-ICRAF audit reports. Check COMPLETENESS, CONSISTENCY, TONE. Rate issues Critical/Major/Minor.`,
      `Review this draft:\n\n${input}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Recommendation Tracker ----
  const recModal = document.getElementById('rec-modal');
  document.getElementById('add-rec-btn').addEventListener('click', () => {
    ['rec-report', 'rec-finding', 'rec-recommendation', 'rec-owner', 'rec-due'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('rec-status').value = 'open';
    recModal.classList.add('show');
  });
  document.getElementById('rec-close').addEventListener('click', () => recModal.classList.remove('show'));
  recModal.addEventListener('click', e => { if (e.target === recModal) recModal.classList.remove('show'); });

  document.getElementById('save-rec-btn').addEventListener('click', () => {
    const rec = {
      report: document.getElementById('rec-report').value.trim(),
      finding: document.getElementById('rec-finding').value.trim(),
      recommendation: document.getElementById('rec-recommendation').value.trim(),
      owner: document.getElementById('rec-owner').value.trim(),
      due: document.getElementById('rec-due').value,
      status: document.getElementById('rec-status').value,
    };
    if (!rec.report || !rec.finding) return alert('Report and Finding are required.');
    state.recs.push(rec);
    save('recs', state.recs);
    renderRecs();
    recModal.classList.remove('show');
  });

  function renderRecs() {
    const tbody = document.getElementById('rec-tbody');
    if (state.recs.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8"><div class="empty-state"><p>No recommendations tracked yet.</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = state.recs.map((r, i) => {
      const dueDate = r.due ? new Date(r.due) : null;
      const today = new Date();
      let daysText = '-';
      if (dueDate) {
        const diff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        daysText = diff > 0 ? `${diff}d left` : diff === 0 ? 'Today' : `${Math.abs(diff)}d overdue`;
        if (diff < 0 && r.status !== 'closed') r.status = 'overdue';
      }
      return `<tr>
        <td style="color: var(--text-primary); font-weight: 500;">${r.report}</td>
        <td>${r.finding}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.recommendation}">${r.recommendation}</td>
        <td>${r.owner}</td>
        <td>${r.due || '-'}</td>
        <td><span class="status-badge ${r.status}">${r.status.replace('-', ' ')}</span></td>
        <td>${daysText}</td>
        <td>
          <button class="btn-icon del-rec" data-idx="${i}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.del-rec').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this recommendation?')) {
          state.recs.splice(parseInt(btn.dataset.idx), 1);
          save('recs', state.recs);
          renderRecs();
        }
      });
    });
  }

  document.getElementById('rec-ai-btn').addEventListener('click', async () => {
    const output = document.getElementById('rec-ai-output');
    if (state.recs.length === 0) {
      output.innerHTML = '<p class="muted">Add recommendations first.</p>';
      return;
    }
    const data = state.recs.map(r => `Report: ${r.report} | Finding: ${r.finding} | Rec: ${r.recommendation} | Owner: ${r.owner} | Due: ${r.due || 'N/A'} | Status: ${r.status}`).join('\n');
    output.innerHTML = '';
    showLoading(output);
    const response = await callLLM(
      'Recommendation follow-up analyst for CIFOR-ICRAF IAU. Highlight: overdue items, approaching deadlines, non-implementation patterns, follow-up approach.',
      `Analyze:\n\n${data}`
    );
    removeLoading(output);
    output.innerHTML = formatResponse(response);
  });

  // ---- Utility: Format AI Response ----
  function formatResponse(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h4>$1</h4>')
      .replace(/^# (.+)$/gm, '<h4>$1</h4>')
      .replace(/^[-•] (.+)$/gm, '  • $1')
      .replace(/^\d+\.\s(.+)$/gm, '  $&')
      .replace(/\n/g, '<br>');
  }

  // ---- INIT: Open DB, Load Docs, Migrate, Render ----
  async function init() {
    await openDB();

    // Migrate any docs from old localStorage to IndexedDB
    const oldDocs = JSON.parse(localStorage.getItem('auditai_docs') || '[]');
    if (oldDocs.length > 0) {
      for (const doc of oldDocs) {
        doc.uploadedAt = doc.uploadedAt || new Date().toISOString();
        const id = await dbPutDoc(doc);
        doc.id = id;
      }
      localStorage.removeItem('auditai_docs'); // Clear old storage after migration
    }

    // Load all docs from IndexedDB
    state.docs = await dbGetAllDocs();

    // Render everything
    renderDocs();
    renderGrants();
    renderEntities();
    renderRecs();
    restoreChatHistory();
    updateApiStatus();
    updateDocBadge();

    // Show last doc summary if exists
    if (state.docs.length > 0) {
      const lastDoc = state.docs[state.docs.length - 1];
      if (lastDoc.summary) {
        document.getElementById('doc-summary-container').innerHTML = `
          <div class="doc-summary-card">
            <h4>Summary: ${lastDoc.name}</h4>
            <div class="summary-text">${formatResponse(lastDoc.summary)}</div>
          </div>`;
      }
    }
  }

  init();

})();
