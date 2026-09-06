// Bisiro Shell — sidebar renderer + theme system.
// Include BEFORE body content on every owner/admin page.
(function () {
  var THEME_KEY = 'bisiro-theme';
  var DEFAULT_THEME = 'blue';
  var THEME_DOTS = {
    light: 'linear-gradient(135deg,#f6f7f9 50%,#2f6bff 50%)',
    dark:  'linear-gradient(135deg,#0a0d13 50%,#5b8cff 50%)',
    blue:  'linear-gradient(135deg,#0e1730 50%,#4d8bff 50%)',
    green: 'linear-gradient(135deg,#0d1d18 50%,#2dd4a7 50%)',
    warm:  'linear-gradient(135deg,#fffdf8 50%,#cf7a1c 50%)',
  };

  var OWNER_NAV = [
    { id: 'dashboard',  label: 'Dashboard',         href: '/dashboard.html' },
    { id: 'messages',   label: 'Messages',           href: '/messages.html' },
    { id: 'inventory',  label: 'Inventory',          href: '/inventory.html' },
    { id: 'credits',    label: 'Credits & billing',  href: '/credits.html' },
    { id: 'aisetup',    label: 'AI setup',           href: '/aisetup.html' },
    { id: 'settings',   label: 'Settings',           href: '/settings.html' },
  ];

  var ADMIN_NAV = [
    { id: 'overview',    label: 'Overview',    href: '/admin.html' },
    { id: 'subscribers', label: 'Subscribers', href: '/admin.html?tab=subscribers' },
    { id: 'payments',    label: 'Payments',    href: '/admin.html?tab=payments' },
    { id: 'pricing',     label: 'Pricing',     href: '/admin.html?tab=pricing' },
    { id: 'replyLogs',   label: 'Reply logs',  href: '/admin.html?tab=replyLogs' },
  ];

  function savedTheme() {
    try { return localStorage.getItem(THEME_KEY) || DEFAULT_THEME; } catch (_) { return DEFAULT_THEME; }
  }

  function applyTheme(id) {
    var el = document.getElementById('bisiro-app');
    if (el) el.setAttribute('data-theme', id);
    document.documentElement.setAttribute('data-theme', id);
  }

  function renderSidebar(cfg) {
    var role   = cfg.role   || 'owner';
    var active = cfg.active || 'dashboard';
    var user   = cfg.user   || {};
    var badge  = cfg.badge  || {};
    var theme  = savedTheme();
    var nav    = role === 'admin' ? ADMIN_NAV : OWNER_NAV;
    var subtitle = role === 'admin' ? 'Admin Console' : '';

    var navHtml = nav.map(function (item) {
      var isActive = item.id === active;
      var b = badge[item.id];
      var dotStyle = isActive
        ? 'background:var(--accent);'
        : 'border:1.5px solid var(--text-faint);background:transparent;';
      return '<a href="' + item.href + '" class="bs-nav-btn' + (isActive ? ' active' : '') + '" style="margin-bottom:2px;">'
        + '<span style="display:flex;align-items:center;gap:11px;">'
        + '<span style="width:7px;height:7px;border-radius:2px;flex:none;' + dotStyle + '"></span>'
        + item.label + '</span>'
        + (b ? '<span class="bs-badge">' + b + '</span>' : '')
        + '</a>';
    }).join('');

    var dotsHtml = Object.keys(THEME_DOTS).map(function (id) {
      return '<button class="bs-theme-dot' + (theme === id ? ' active' : '') + '" '
        + 'style="background:' + THEME_DOTS[id] + ';" '
        + 'title="' + id.charAt(0).toUpperCase() + id.slice(1) + '" '
        + 'onclick="BisiroShell.setTheme(\'' + id + '\')">'
        + '</button>';
    }).join('');

    var name = user.business_name || user.name || (role === 'admin' ? 'Admin' : 'Bisiro');
    var sub  = role === 'admin' ? 'Platform owner' : (user.tier ? user.tier + ' plan' : 'Business owner');

    return '<div style="display:flex;align-items:center;gap:11px;padding:4px 8px 22px;">'
      + '<div style="width:36px;height:36px;border-radius:9px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:16px;color:var(--accent-contrast);flex:none;">B</div>'
      + '<div><div style="font-family:\'Space Grotesk\',sans-serif;font-weight:600;font-size:18px;line-height:1;color:var(--text);">Bisiro</div>'
      + (subtitle ? '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-faint);margin-top:3px;">' + subtitle + '</div>' : '')
      + '</div></div>'
      + '<nav style="display:flex;flex-direction:column;gap:2px;">' + navHtml + '</nav>'
      + '<div style="flex:1;"></div>'
      + '<div style="border-top:1px solid var(--border);padding-top:14px;">'
      + '<div class="bs-label" style="padding:0 4px 8px;">Theme</div>'
      + '<div style="display:flex;align-items:center;gap:6px;padding:5px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;width:max-content;">' + dotsHtml + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px;margin-top:16px;padding:4px;">'
      + '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));flex:none;"></div>'
      + '<div style="min-width:0;">'
      + '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);">' + name + '</div>'
      + '<div style="font-size:11px;color:var(--text-faint);">' + sub + '</div>'
      + '</div></div></div>';
  }

  var _config = {};

  window.BisiroShell = {
    init: function (cfg) {
      _config = cfg || {};
      applyTheme(savedTheme());
      var el = document.getElementById('bisiro-sidebar');
      if (el) el.innerHTML = renderSidebar(_config);
    },
    setTheme: function (id) {
      try { localStorage.setItem(THEME_KEY, id); } catch (_) {}
      applyTheme(id);
      var el = document.getElementById('bisiro-sidebar');
      if (el) el.innerHTML = renderSidebar(_config);
    },
    updateUser: function (user) {
      _config.user = user;
      var el = document.getElementById('bisiro-sidebar');
      if (el) el.innerHTML = renderSidebar(_config);
    },
    updateBadge: function (id, val) {
      if (!_config.badge) _config.badge = {};
      _config.badge[id] = val;
      var el = document.getElementById('bisiro-sidebar');
      if (el) el.innerHTML = renderSidebar(_config);
    },
  };

  // Apply theme immediately to avoid flash before DOMContentLoaded
  applyTheme(savedTheme());
})();
