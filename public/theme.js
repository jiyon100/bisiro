// Bisiro shared theme loader — dark/light/system mode + per-business brand color.
// Include on every owner-facing page: <link rel="stylesheet" href="/theme.css"> + <script src="/theme.js"></script>
// Call BisiroTheme.mount('elementId') to render the toggle widget into a header slot.
(function () {
  const USER_ID = window.BISIRO_USER_ID || 1; // TODO: replace with session user id once login exists

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyMode(mode) {
    const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
    document.documentElement.classList.toggle('dark', isDark);
  }

  function applyBrandColor(hex) {
    document.documentElement.style.setProperty('--brand', hex);
    // Rough darken for hover states — shift each channel down ~15%
    const darker = '#' + hex.replace('#', '').match(/.{2}/g)
      .map(h => Math.max(0, parseInt(h, 16) - 30).toString(16).padStart(2, '0'))
      .join('');
    document.documentElement.style.setProperty('--brand-dark', darker);
  }

  let current = { theme_mode: 'light', brand_color: '#2563eb' };

  async function load() {
    try {
      const res = await fetch(`/api/settings/theme?user_id=${USER_ID}`);
      if (res.ok) current = await res.json();
    } catch (_) { /* fall back to defaults */ }
    applyMode(current.theme_mode);
    applyBrandColor(current.brand_color);
  }

  async function save(partial) {
    current = { ...current, ...partial };
    applyMode(current.theme_mode);
    applyBrandColor(current.brand_color);
    try {
      await fetch(`/api/settings/theme?user_id=${USER_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
    } catch (_) { /* best-effort — UI already updated optimistically */ }
  }

  function icon(mode) {
    if (mode === 'dark')   return '🌙';
    if (mode === 'system') return '🖥️';
    return '☀️';
  }

  function mount(elementId) {
    const slot = document.getElementById(elementId);
    if (!slot) return;

    slot.innerHTML = `
      <div id="bisiroThemeToggle">
        <button id="bisiroModeBtn" title="Toggle light/dark/system">${icon(current.theme_mode)}</button>
        <input id="bisiroColorPicker" type="color" title="Brand color" value="${current.brand_color}" />
      </div>
    `;

    const modes = ['light', 'dark', 'system'];
    document.getElementById('bisiroModeBtn').addEventListener('click', () => {
      const next = modes[(modes.indexOf(current.theme_mode) + 1) % modes.length];
      document.getElementById('bisiroModeBtn').textContent = icon(next);
      save({ theme_mode: next });
    });

    document.getElementById('bisiroColorPicker').addEventListener('input', (e) => {
      applyBrandColor(e.target.value); // live preview while dragging
    });
    document.getElementById('bisiroColorPicker').addEventListener('change', (e) => {
      save({ brand_color: e.target.value });
    });
  }

  // Apply theme ASAP (before mount) to avoid a flash of the wrong mode.
  load().then(() => {
    window.BisiroTheme = { mount, current: () => current };
    document.dispatchEvent(new CustomEvent('bisiro-theme-ready'));
  });
})();
