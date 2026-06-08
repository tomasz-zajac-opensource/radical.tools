/* ─── Hub: Architecture Concept Hub ─────────────────────────────────────── */

(function () {
  'use strict';

  const CATEGORY_ICONS = {
    'pattern': '🏗️',
    'fitness-function': '🎯',
    'requirement': '📋',
    'adr': '📄'
  };

  const CATEGORY_LABELS = {
    'pattern': 'Pattern',
    'fitness-function': 'Fitness Function',
    'requirement': 'Requirement',
    'adr': 'ADR Template'
  };

  let allConcepts = [];
  let activeCategory = null;
  let activeTag = null;
  let searchQuery = '';

  /* ── Bootstrap ──────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const res = await fetch('hub-data.json');
      allConcepts = await res.json();
    } catch (e) {
      document.getElementById('hub-main').innerHTML =
        '<div class="hub-empty"><div class="hub-empty-icon">⚠️</div><h3>Failed to load concepts</h3><p>Could not fetch hub-data.json</p></div>';
      return;
    }

    parseHash();
    renderSidebar();
    renderTagCloud();
    renderCards();
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
        const haystack = [c.name, c.description, ...(c.tags || [])].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  /* ── Sidebar ────────────────────────────────────────────────────────── */

  function renderSidebar() {
    const counts = { all: allConcepts.length };
    for (const c of allConcepts) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }

    const nav = document.getElementById('cat-nav');
    if (!nav) return;

    const items = [
      { key: null, label: 'All', count: counts.all },
      { key: 'pattern', label: 'Patterns', count: counts['pattern'] || 0 },
      { key: 'fitness-function', label: 'Fitness Functions', count: counts['fitness-function'] || 0 },
      { key: 'requirement', label: 'Requirements', count: counts['requirement'] || 0 },
      { key: 'adr', label: 'ADR Templates', count: counts['adr'] || 0 }
    ];

    nav.innerHTML = items.map(it =>
      `<li><a href="#" data-category="${it.key}" class="${activeCategory === it.key ? 'active' : ''}">
        ${it.label}
        <span class="hub-cat-count">${it.count}</span>
      </a></li>`
    ).join('');
  }

  /* ── Tag Cloud ──────────────────────────────────────────────────────── */

  function renderTagCloud() {
    const freq = {};
    for (const c of allConcepts) {
      for (const t of (c.tags || [])) {
        freq[t] = (freq[t] || 0) + 1;
      }
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const el = document.getElementById('tag-cloud');
    if (!el) return;

    el.innerHTML = sorted.map(([tag, count]) =>
      `<span class="hub-tag-pill${activeTag === tag ? ' active' : ''}" data-tag="${tag}">${tag}<span class="tag-count">${count}</span></span>`
    ).join('');
  }

  /* ── Cards ──────────────────────────────────────────────────────────── */

  function renderCards() {
    const list = filtered();
    const main = document.getElementById('hub-main');
    if (!main) return;

    const countEl = document.getElementById('hub-result-count');
    if (countEl) countEl.textContent = `${list.length} concept${list.length !== 1 ? 's' : ''}`;

    const container = document.getElementById('hub-cards');
    if (!container) return;

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

    const meta = buildMetaBadges(concept);
    const tags = (concept.tags || []).map(t =>
      `<span class="hub-card-tag" data-tag="${t}">${t}</span>`
    ).join('');

    const jsonStr = escapeHtml(JSON.stringify(buildEnvelope(concept), null, 2));

    return `
    <article class="hub-card" data-id="${concept.id}">
      <div class="hub-card-header">
        <span class="hub-card-icon">${icon}</span>
        <span class="hub-card-title">${escapeHtml(concept.name)}</span>
        <span class="hub-card-category"><span class="hub-badge badge-accent">${catLabel}</span></span>
      </div>
      <p class="hub-card-desc">${escapeHtml(concept.description)}</p>
      ${meta ? `<div class="hub-meta-row">${meta}</div>` : ''}
      ${tags ? `<div class="hub-card-tags">${tags}</div>` : ''}
      <div class="hub-actions">
        <button class="hub-btn hub-btn-primary" data-copy="${concept.id}">📋 Copy JSON</button>
        <button class="hub-btn" data-download="${concept.id}">⬇ Download .json</button>
        <button class="hub-json-toggle" data-toggle="${concept.id}">{ } Preview JSON</button>
      </div>
      <div class="hub-json-preview" id="json-${concept.id}">
        <pre><code>${jsonStr}</code></pre>
      </div>
    </article>`;
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
    }

    return badges.join('');
  }

  function badge(label, value, cls) {
    return `<span class="hub-badge ${cls || ''}"><span class="hub-badge-label">${label}:</span> ${escapeHtml(value)}</span>`;
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
    // Category nav
    document.getElementById('cat-nav')?.addEventListener('click', e => {
      const link = e.target.closest('[data-category]');
      if (!link) return;
      e.preventDefault();
      const cat = link.dataset.category;
      activeCategory = cat === 'null' ? null : cat;
      updateHash();
      highlightCategoryNav();
      renderCards();
    });

    // Search
    document.getElementById('hub-search')?.addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      renderCards();
    });

    // Tag cloud
    document.getElementById('tag-cloud')?.addEventListener('click', e => {
      const pill = e.target.closest('[data-tag]');
      if (!pill) return;
      toggleTag(pill.dataset.tag);
    });

    // Card interactions (delegated)
    document.getElementById('hub-cards')?.addEventListener('click', e => {
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
        return;
      }
    });

    // Hash change
    window.addEventListener('hashchange', () => {
      activeCategory = null;
      activeTag = null;
      parseHash();
      highlightCategoryNav();
      renderTagCloud();
      renderCards();
    });
  }

  function toggleTag(tag) {
    activeTag = activeTag === tag ? null : tag;
    updateHash();
    renderTagCloud();
    renderCards();
  }

  function highlightCategoryNav() {
    const nav = document.getElementById('cat-nav');
    if (!nav) return;
    nav.querySelectorAll('[data-category]').forEach(a => {
      const cat = a.dataset.category;
      a.classList.toggle('active', (cat === 'null' ? null : cat) === activeCategory);
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
