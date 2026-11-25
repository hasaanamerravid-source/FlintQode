/* FlintQode website: theme, platform detection and release links. */
const THEME_KEY = 'flintqode-website-theme';
const REPOSITORY = 'hasaanamerravid-source/FlintQode';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const UPDATE_MANIFEST_URL = 'assets/data/update-manifest.json';
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
    themeToggle.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
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
 * carry `data-asset` patterns; the generated update manifest supplies the
 * exact tag-qualified URLs and checksums. GitHub's `/releases/latest`
 * endpoint is only a fallback if the manifest has not been published yet.
 * The static hrefs remain a working fallback when JavaScript is disabled.
 * ------------------------------------------------------------------ */

function releaseFromManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.assets)) return null;
  const tag = manifest.tag || (manifest.version ? `v${manifest.version}` : '');
  if (!tag) return null;
  return {
    tag_name: tag,
    assets: manifest.assets.map((asset) => ({
      name: asset.name,
      browser_download_url: asset.url,
      digest: asset.sha256,
    })),
  };
}

function applyRelease(release) {
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
    if (asset.digest) link.setAttribute('data-checksum', asset.digest);
  });
  const platformPattern = PLATFORM_ASSETS[os];
  document.querySelectorAll('[data-download="primary"]').forEach((link) => {
    const asset = assets.find((entry) => platformPattern.test(entry.name));
    if (!asset) return;
    link.setAttribute('href', asset.browser_download_url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
    if (asset.digest) link.setAttribute('data-checksum', asset.digest);
    link.textContent = PLATFORM_LABELS[os];
  });
}

function useLatestRelease() {
  if (typeof fetch !== 'function') return;
  fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((manifest) => releaseFromManifest(manifest))
    .then((release) => {
      if (release) return release;
      return fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
        .then((response) => (response.ok ? response.json() : null));
    })
    .then((release) => applyRelease(release))
    .catch(() => {
      /* keep the static fallback links */
    });
}

useLatestRelease();

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
