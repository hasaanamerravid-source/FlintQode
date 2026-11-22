/* FlintQode website: theme, platform detection and release links. */
const THEME_KEY = 'flintqode-website-theme';
const REPOSITORY = 'hasaanamerravid-source/FlintQode';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPOSITORY}/main`;

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const dark = theme === 'dark';
    themeToggle.textContent = dark ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeToggle.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  }
}

const savedTheme = getSavedTheme();
if (savedTheme) {
  setTheme(savedTheme);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  setTheme('dark');
} else {
  setTheme('light');
}

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}

const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
if (mediaQuery) {
  mediaQuery.addEventListener('change', (event) => {
    if (!getSavedTheme()) {
      setTheme(event.matches ? 'dark' : 'light');
    }
  });
}

/* ------------------------------------------------------------------ *
 * Platform detection
 * ------------------------------------------------------------------ */

const ua = (navigator.userAgent || '').toLowerCase();
let os = 'linux';
if (ua.includes('win')) os = 'windows';
else if (ua.includes('mac')) os = 'macos';
document.documentElement.setAttribute('data-os', os);

const PLATFORM_ASSETS = {
  windows: /-setup\.exe$/i,
  macos: /\.dmg$/i,
  linux: /\.AppImage$/i,
};

const PLATFORM_LABELS = {
  windows: 'Download for Windows',
  macos: 'Download for macOS',
  linux: 'Download for Linux',
};

/* ------------------------------------------------------------------ *
 * Latest release
 *
 * The download buttons must not be hard-coded to one version: every
 * release would otherwise require editing the website. The links below
 * carry `data-asset` patterns; the newest release on GitHub supplies the
 * real file names. The static hrefs remain a working fallback when the
 * API is unreachable or JavaScript is disabled.
 * ------------------------------------------------------------------ */

function useLatestRelease() {
  if (typeof fetch !== 'function') return;
  fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release || !Array.isArray(release.assets)) return;
      const assets = release.assets;
      const version = String(release.tag_name || '').replace(/^v/, '');
      document.querySelectorAll('[data-release-version]').forEach((element) => {
        if (version) element.textContent = `v${version}`;
      });
      document.querySelectorAll('[data-asset]').forEach((link) => {
        const pattern = new RegExp(link.getAttribute('data-asset'), 'i');
        const asset = assets.find((entry) => pattern.test(entry.name));
        if (!asset) return;
        link.setAttribute('href', asset.browser_download_url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
      });
      const platformPattern = PLATFORM_ASSETS[os];
      document.querySelectorAll('[data-download="primary"]').forEach((link) => {
        const asset = assets.find((entry) => platformPattern.test(entry.name));
        if (!asset) return;
        link.setAttribute('href', asset.browser_download_url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
        link.textContent = PLATFORM_LABELS[os];
      });
    })
    .catch(() => {
      /* keep the static fallback links */
    });
}

function showBuildNumber() {
  if (typeof fetch !== 'function') return;
  Promise.all([
    fetch(`${RAW_ROOT}/BUILD`).then((response) => (response.ok ? response.text() : '')),
    fetch(`${RAW_ROOT}/VERSION`).then((response) => (response.ok ? response.text() : '')),
  ])
    .then(([build, version]) => {
      const number = build.trim();
      const release = version.trim();
      if (/^\d+$/.test(number)) {
        document.querySelectorAll('[data-release-build]').forEach((element) => {
          element.textContent = `build ${number}`;
        });
      }
      if (/^\d+\.\d+\.\d+$/.test(release)) {
        document.querySelectorAll('[data-release-version]').forEach((element) => {
          element.textContent = `v${release}`;
        });
      }
    })
    .catch(() => {
      /* the static version and build stay visible */
    });
}

useLatestRelease();
showBuildNumber();

/* ------------------------------------------------------------------ *
 * FAQ accordion
 * ------------------------------------------------------------------ */

const faqQuestions = document.querySelectorAll('.faq-question');
faqQuestions.forEach((question) => {
  question.addEventListener('click', () => {
    const item = question.parentElement;
    if (!item || !item.classList) return;
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach((openItem) => openItem.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
    const marker = question.querySelector('span:last-child');
    if (marker) marker.textContent = wasOpen ? '▾' : '▴';
  });
});
