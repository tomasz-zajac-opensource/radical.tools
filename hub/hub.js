/* ─── Hub: Architecture Concept Hub ─────────────────────────────────────── */

(function () {
  'use strict';

  const CATEGORY_ICONS = {
    'pattern': '🏗️',
    'fitness-function': '🎯',
    'requirement': '📋',
    'adr': '📄',
    'blueprint': '🔷'
  };

  const CATEGORY_LABELS = {
    'pattern': 'Pattern',
    'fitness-function': 'Fitness Function',
    'requirement': 'Requirement',
    'adr': 'ADR Template',
    'blueprint': 'Blueprint'
  };

  const CAT_COLORS = {
    'pattern':          '#2563eb',
    'fitness-function': '#059669',
    'requirement':      '#d97706',
    'adr':              '#7c3aed',
    'blueprint':        '#0891b2'
  };

  let allConcepts = [];
  let activeCategory = null;
  let activeTag = null;
  let searchQuery = '';
  let selectedIds = new Set();

  const STUDIO_URL = 'https://studio.radical.tools';

  /* ── Bootstrap ──────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const res = await fetch('hub-data.json');
      allConcepts = await res.json();
    } catch (e) {
      document.getElementById('hub-cards').innerHTML =
        '<div class="hub-empty"><div class="hub-empty-icon">⚠️</div><h3>Failed to load concepts</h3><p>Could not fetch hub-data.json</p></div>';
      return;
    }

    parseHash();
    renderFilterBar();
    renderCards();
    renderSelectionBar();
    bindEvents();
  });

  /* ── Hash Routing ───────────────────────────────────────────────────── */

  function parseHash() {
    const hash = location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.has('category')) activeCategory = params.get('category');
    if (params.has('tag')) activeTag = params.get('tag');
  }

  function updateHash() {
    const parts = [];
    if (activeCategory) parts.push('category=' + activeCategory);
    if (activeTag) parts.push('tag=' + activeTag);
    location.hash = parts.length ? parts.join('&') : '';
  }

  /* ── Filtering ──────────────────────────────────────────────────────── */

  function filtered() {
    return allConcepts.filter(c => {
      if (activeCategory && c.category !== activeCategory) return false;
      if (activeTag && !(c.tags || []).includes(activeTag)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const catLabel = (CATEGORY_LABELS[c.category] || c.category).toLowerCase();
        const haystack = [c.name, c.description, c.category, catLabel, ...(c.tags || [])].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  /* ── Filter Bar ────────────────────────────────────────────────────── */

  function renderFilterBar() {
    const el = document.getElementById('hub-filter-bar');
    if (!el) return;
    const items = [
      { key: null,               label: 'All',           color: '#64748b' },
      { key: 'pattern',          label: 'Patterns',      color: CAT_COLORS['pattern'] },
      { key: 'fitness-function', label: 'Fitness Fns',   color: CAT_COLORS['fitness-function'] },
      { key: 'requirement',      label: 'Requirements',  color: CAT_COLORS['requirement'] },
      { key: 'adr',              label: 'ADRs',          color: CAT_COLORS['adr'] },
      { key: 'blueprint',        label: 'Blueprints',    color: CAT_COLORS['blueprint'] },
    ];
    el.innerHTML = items.map(item => {
      const count = item.key === null
        ? allConcepts.length
        : allConcepts.filter(c => c.category === item.key).length;
      if (count === 0) return '';
      const active = activeCategory === item.key;
      return `<button class="hub-filter-chip${active ? ' active' : ''}" data-category="${item.key}" style="--chip-color:${item.color}">
        ${item.label}
        <span class="hub-filter-count">${count}</span>
      </button>`;
    }).filter(Boolean).join('');
  }

  /* ── Cards ──────────────────────────────────────────────────────────── */

  function renderCards() {
    const countEl = document.getElementById('hub-result-count');
    const container = document.getElementById('hub-cards');
    if (!container) return;

    const list = filtered();
    if (countEl) countEl.textContent = `${list.length} concept${list.length !== 1 ? 's' : ''}`;

    if (list.length === 0) {
      container.innerHTML =
        '<div class="hub-empty"><div class="hub-empty-icon">🔍</div><h3>No concepts found</h3><p>Try adjusting your search or filters.</p></div>';
      return;
    }

    container.innerHTML = list.map(c => cardHTML(c)).join('');
  }
  function cardHTML(concept) {
    const icon = CATEGORY_ICONS[concept.category] || '📦';
    const catLabel = CATEGORY_LABELS[concept.category] || concept.category;
    const catColor = CAT_COLORS[concept.category] || '#6b7280';

    const meta = buildMetaBadges(concept);
    const tags = (concept.tags || []).map(t =>
      `<span class="hub-card-tag" data-tag="${t}">${t}</span>`
    ).join('');

    const ICON_COPY = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>`;
    const ICON_DOWNLOAD = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/><path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 6.779a.75.75 0 1 1 1.06-1.06l1.97 1.97Z"/></svg>`;
    const ICON_EYE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/></svg>`;
    const isSelected = selectedIds.has(concept.id);
    const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`;
    const ICON_PLUS = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>`;

    return `
    <article class="hub-card${isSelected ? ' selected' : ''}" style="--cat-color:${catColor}" data-id="${concept.id}">
      <div class="hub-card-body">
        <div class="hub-card-header">
          <span class="hub-card-icon">${icon}</span>
          <span class="hub-card-title">${escapeHtml(concept.name)}</span>
          <span class="hub-card-category"><span class="hub-badge badge-accent">${catLabel}</span></span>
        </div>
        <p class="hub-card-desc">${escapeHtml(concept.description)}</p>
        ${meta ? `<div class="hub-meta-row">${meta}</div>` : ''}
        ${templateParamsHTML(concept)}
        ${tags ? `<div class="hub-card-tags">${tags}</div>` : ''}
      </div>
      <div class="hub-actions">
        <button class="hub-btn hub-btn-select${isSelected ? ' active' : ''}" data-select="${concept.id}">
          ${isSelected ? ICON_CHECK + ' Selected' : ICON_PLUS + ' Select'}
        </button>
        <button class="hub-btn" data-copy="${concept.id}">${ICON_COPY} Copy JSON</button>
        <button class="hub-btn" data-download="${concept.id}">${ICON_DOWNLOAD} Download</button>
        <button class="hub-json-toggle" data-toggle="${concept.id}">${ICON_EYE} Preview</button>
      </div>
      <div class="hub-json-preview" id="json-${concept.id}">
        ${previewHTML(concept)}
      </div>
    </article>`;
  }

  function templateParamsHTML(concept) {
    const params = concept.templateParams;
    if (!params || params.length === 0) return '';
    const pills = params.map(p => {
      const tooltip = p.hint ? `${p.label} (default: ${p.hint})` : p.label;
      return `<span class="hub-param-pill" title="${escapeHtml(tooltip)}">${escapeHtml(p.key)}</span>`;
    }).join('');
    return `<div class="hub-param-row"><span class="hub-param-label">params:</span>${pills}</div>`;
  }

  function buildMetaBadges(concept) {
    const badges = [];
    const node = concept.nodes && concept.nodes[0];
    if (!node) return '';

    switch (concept.category) {
      case 'fitness-function':
        if (node.category) badges.push(badge('Category', node.category));
        if (node.trigger) badges.push(badge('Trigger', node.trigger));
        badges.push(badge('Automated', node.automated ? 'yes' : 'no', node.automated ? 'badge-green' : 'badge-orange'));
        if (node.threshold) badges.push(badge('Threshold', node.threshold, 'badge-violet'));
        break;

      case 'requirement':
        if (node.ears_type) badges.push(badge('EARS', node.ears_type, 'badge-accent'));
        if (node.priority) badges.push(badge('Priority', node.priority, node.priority === 'must' ? 'badge-orange' : ''));
        if (node.status) badges.push(badge('Status', node.status, node.status === 'approved' ? 'badge-green' : ''));
        break;

      case 'adr':
        if (node.status) badges.push(badge('Status', node.status, node.status === 'accepted' ? 'badge-green' : 'badge-orange'));
        break;

      case 'pattern':
        badges.push(badge('Nodes', String(concept.nodes.length)));
        badges.push(badge('Relations', String((concept.relations || []).length)));
        break;

      case 'blueprint':
        badges.push(badge('Elements', String(concept.nodes.length)));
        badges.push(badge('Relations', String((concept.relations || []).length)));
        if (node.domain) badges.push(badge('Domain', node.domain));
        if (node.status) badges.push(badge('Status', node.status, node.status === 'approved' ? 'badge-green' : ''));
        break;
    }

    return badges.join('');
  }

  function badge(label, value, cls) {
    return `<span class="hub-badge ${cls || ''}"><span class="hub-badge-label">${label}:</span> ${escapeHtml(value)}</span>`;
  }

  /* ── Visual Preview ────────────────────────────────────────────────── */

  const NODE_COLORS = {
    person: '#08427b', system: '#1168bd', container: '#438dd5',
    component: '#85bbf0', database: '#0e6db5', webapp: '#2563eb',
    queue: '#7c3aed', domain: '#5b21b6', group: '#4b5563',
    'fitness-fn': '#0e7490', requirement: '#065f46', adr: '#92400e',
    blueprint: '#1e3a5f',
  };
  const NODE_TYPE_LABELS = {
    person: 'Person', system: 'System', container: 'Container',
    component: 'Component', database: 'Database', webapp: 'Web App',
    queue: 'Queue', domain: 'Domain', group: 'Group',
    'fitness-fn': 'Fitness Fn', requirement: 'Requirement', adr: 'ADR',
    blueprint: 'Blueprint',
  };

  function infoBadge(label, value, cls) {
    if (value === undefined || value === null || value === '') return '';
    return `<span class="hub-prev-badge ${cls||''}"><span class="hub-prev-badge-label">${label}</span>${escapeHtml(String(value))}</span>`;
  }

  function proseSec(label, value) {
    if (!value) return '';
    return `<div class="hub-prev-prose"><div class="hub-prev-prose-label">${label}</div><div class="hub-prev-prose-body">${escapeHtml(String(value))}</div></div>`;
  }

  function nodeExtras(n) {
    const badges = [];
    const prose = [];
    switch (n.type) {
      case 'fitness-fn':
        if (n.category) badges.push(infoBadge('Category', n.category));
        if (n.trigger)  badges.push(infoBadge('Trigger', n.trigger));
        badges.push(infoBadge('Automated', n.automated ? 'yes' : 'no', n.automated ? 'hub-prev-badge-green' : 'hub-prev-badge-orange'));
        if (n.status)    badges.push(infoBadge('Status', n.status, n.status === 'active' ? 'hub-prev-badge-green' : ''));
        if (n.threshold) prose.push(proseSec('Threshold', n.threshold));
        break;
      case 'requirement':
        if (n.ears_type) badges.push(infoBadge('EARS', n.ears_type, 'hub-prev-badge-accent'));
        if (n.priority)  badges.push(infoBadge('Priority', n.priority, n.priority === 'must' ? 'hub-prev-badge-orange' : ''));
        if (n.status)    badges.push(infoBadge('Status', n.status, n.status === 'approved' ? 'hub-prev-badge-green' : ''));
        if (n.action)    prose.push(proseSec('Action', n.action));
        if (n.rationale) prose.push(proseSec('Rationale', n.rationale));
        if (n.trigger)   prose.push(proseSec('Trigger', n.trigger));
        if (n.precondition) prose.push(proseSec('Precondition', n.precondition));
        if (n.unwanted_condition) prose.push(proseSec('Unwanted condition', n.unwanted_condition));
        if (n.feature)   prose.push(proseSec('Feature', n.feature));
        break;
      case 'adr':
        if (n.status) badges.push(infoBadge('Status', n.status, n.status === 'accepted' ? 'hub-prev-badge-green' : 'hub-prev-badge-orange'));
        if (n.date)   badges.push(infoBadge('Date', n.date));
        if (n.context)      prose.push(proseSec('Context', n.context));
        if (n.decision)     prose.push(proseSec('Decision', n.decision));
        if (n.consequences) prose.push(proseSec('Consequences', n.consequences));
        if (n.alternatives) prose.push(proseSec('Alternatives considered', n.alternatives));
        break;
      case 'system':
      case 'person':
        if (n.external) badges.push(infoBadge('External', 'yes', 'hub-prev-badge-orange'));
        break;
    }
    return { badges: badges.join(''), prose: prose.join('') };
  }

  function previewHTML(concept) {
    const nodeMap = {};
    for (const n of (concept.nodes || [])) nodeMap[n.id] = n;

    const childrenOf = {};
    for (const n of (concept.nodes || [])) {
      if (n.parentId) {
        if (!childrenOf[n.parentId]) childrenOf[n.parentId] = [];
        childrenOf[n.parentId].push(n);
      }
    }
    const rootNodes = (concept.nodes || []).filter(n => !n.parentId);

    function renderNode(n, depth) {
      const color = NODE_COLORS[n.type] || '#6b7280';
      const typeLabel = NODE_TYPE_LABELS[n.type] || n.type;
      const children = childrenOf[n.id] || [];
      const extras = nodeExtras(n);
      const techHtml = n.technology ? `<span class="hub-prev-tech">${escapeHtml(n.technology)}</span>` : '';
      const descHtml = n.description ? `<div class="hub-prev-desc">${escapeHtml(n.description)}</div>` : '';
      return `<div class="hub-prev-node" style="--node-color:${color};margin-left:${depth * 18}px">
        <div class="hub-prev-node-row">
          <span class="hub-prev-type">${typeLabel}</span>
          <span class="hub-prev-name">${escapeHtml(n.label || '')}</span>
          ${techHtml}
        </div>
        ${descHtml}
        ${extras.badges ? `<div class="hub-prev-badges">${extras.badges}</div>` : ''}
        ${extras.prose}
        ${children.map(c => renderNode(c, depth + 1)).join('')}
      </div>`;
    }

    const nodesHtml = rootNodes.map(n => renderNode(n, 0)).join('');

    const relHtml = (concept.relations || []).map(r => {
      const src = nodeMap[r.sourceId];
      const tgt = nodeMap[r.targetId];
      if (!src || !tgt) return '';
      return `<div class="hub-prev-rel">
        <span class="hub-prev-rel-node">${escapeHtml(src.label || r.sourceId)}</span>
        <span class="hub-prev-rel-arrow">→</span>
        ${r.label ? `<span class="hub-prev-rel-label">${escapeHtml(r.label)}</span>` : ''}
        ${r.technology ? `<span class="hub-prev-rel-tech">[${escapeHtml(r.technology)}]</span>` : ''}
        <span class="hub-prev-rel-arrow">→</span>
        <span class="hub-prev-rel-node">${escapeHtml(tgt.label || r.targetId)}</span>
      </div>`;
    }).join('');

    return `<div class="hub-preview-panel">
      <div class="hub-prev-section">
        <div class="hub-prev-title">Elements (${(concept.nodes||[]).length})</div>
        <div class="hub-prev-nodes">${nodesHtml}</div>
      </div>
      ${relHtml ? `<div class="hub-prev-section">
        <div class="hub-prev-title">Relations (${(concept.relations||[]).length})</div>
        <div class="hub-prev-rels">${relHtml}</div>
      </div>` : ''}
    </div>`;
  }

  /* ── DiagramData Envelope ───────────────────────────────────────────── */

  function buildEnvelope(concept) {
    return {
      nodes: concept.nodes || [],
      relations: concept.relations || [],
      sequences: [],
      views: [],
      snapshots: [],
      presentations: [],
      metamodel: null
    };
  }

  /* ── Events ─────────────────────────────────────────────────────────── */

  function bindEvents() {
    // Filter bar (category chips)
    document.getElementById('hub-filter-bar')?.addEventListener('click', e => {
      const chip = e.target.closest('[data-category]');
      if (!chip) return;
      const cat = chip.dataset.category;
      activeCategory = cat === 'null' ? null : cat;
      updateHash();
      highlightFilterBar();
      renderCards();
    });

    // Search
    document.getElementById('hub-search')?.addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      renderCards();
    });

    // Card interactions (delegated)
    document.getElementById('hub-cards')?.addEventListener('click', e => {
      // Select/deselect card
      const selectBtn = e.target.closest('[data-select]');
      if (selectBtn) {
        toggleSelection(selectBtn.dataset.select);
        return;
      }

      // Tag click on card
      const cardTag = e.target.closest('.hub-card-tag[data-tag]');
      if (cardTag) {
        toggleTag(cardTag.dataset.tag);
        return;
      }

      // Copy JSON
      const copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        const concept = allConcepts.find(c => c.id === copyBtn.dataset.copy);
        if (concept) copyJSON(concept);
        return;
      }

      // Download
      const dlBtn = e.target.closest('[data-download]');
      if (dlBtn) {
        const concept = allConcepts.find(c => c.id === dlBtn.dataset.download);
        if (concept) downloadJSON(concept);
        return;
      }

      // Toggle JSON preview
      const toggleBtn = e.target.closest('[data-toggle]');
      if (toggleBtn) {
        const preview = document.getElementById('json-' + toggleBtn.dataset.toggle);
        if (preview) preview.classList.toggle('open');
        toggleBtn.classList.toggle('open');
        return;
      }
    });

    // Hash change
    window.addEventListener('hashchange', () => {
      activeCategory = null;
      activeTag = null;
      parseHash();
      highlightFilterBar();
      renderCards();
    });
  }

  function toggleTag(tag) {
    activeTag = activeTag === tag ? null : tag;
    updateHash();
    renderCards();
  }

  /* ── Selection ──────────────────────────────────────────────────── */

  function toggleSelection(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    // Update card appearance without full re-render
    const card = document.querySelector(`.hub-card[data-id="${id}"]`);
    if (card) {
      const sel = selectedIds.has(id);
      card.classList.toggle('selected', sel);
      const btn = card.querySelector('.hub-btn-select');
      if (btn) {
        btn.classList.toggle('active', sel);
        const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`;
        const ICON_PLUS = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>`;
        btn.innerHTML = sel ? ICON_CHECK + ' Selected' : ICON_PLUS + ' Select';
      }
    }
    renderSelectionBar();
  }

  function renderSelectionBar() {
    let bar = document.getElementById('hub-selection-bar');
    if (selectedIds.size === 0) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'hub-selection-bar';
      document.body.appendChild(bar);
    }
    const names = [...selectedIds]
      .map(id => allConcepts.find(c => c.id === id)?.name ?? id)
      .slice(0, 3)
      .join(', ');
    const overflow = selectedIds.size > 3 ? ` +${selectedIds.size - 3} more` : '';
    bar.innerHTML = `
      <div class="hub-selbar-info">
        <span class="hub-selbar-count">${selectedIds.size}</span>
        <span class="hub-selbar-names">${escapeHtml(names)}${escapeHtml(overflow)}</span>
      </div>
      <div class="hub-selbar-actions">
        <button class="hub-selbar-clear">Clear</button>
        <a class="hub-selbar-import" href="${buildStudioUrl()}" target="_blank" rel="noopener">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/><path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 6.779a.75.75 0 1 1 1.06-1.06l1.97 1.97Z"/></svg>
          Import to Studio
        </a>
      </div>`;
    bar.querySelector('.hub-selbar-clear')?.addEventListener('click', () => {
      selectedIds.clear();
      document.querySelectorAll('.hub-card.selected').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.hub-btn-select.active').forEach(btn => {
        btn.classList.remove('active');
        const ICON_PLUS = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>`;
        btn.innerHTML = ICON_PLUS + ' Select';
      });
      renderSelectionBar();
    });
  }

  function buildStudioUrl() {
    const ids = [...selectedIds].join(',');
    return `${STUDIO_URL}?hub=${encodeURIComponent(ids)}`;
  }

  function highlightFilterBar() {
    const bar = document.getElementById('hub-filter-bar');
    if (!bar) return;
    bar.querySelectorAll('[data-category]').forEach(btn => {
      const cat = btn.dataset.category;
      btn.classList.toggle('active', (cat === 'null' ? null : cat) === activeCategory);
    });
  }

  /* ── Copy / Download ────────────────────────────────────────────────── */

  function copyJSON(concept) {
    const json = JSON.stringify(buildEnvelope(concept), null, 2);
    navigator.clipboard.writeText(json).then(() => showToast('JSON copied to clipboard'));
  }

  function downloadJSON(concept) {
    const json = JSON.stringify(buildEnvelope(concept), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = concept.id + '.radical.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ── Toast ──────────────────────────────────────────────────────────── */

  function showToast(msg) {
    let toast = document.querySelector('.hub-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'hub-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
