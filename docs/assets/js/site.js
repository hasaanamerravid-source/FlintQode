const THEME_KEY = 'opennotes-website-theme';

function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
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

const ua = (navigator.userAgent || '').toLowerCase();
let os = 'linux';
if (ua.includes('win')) os = 'windows';
else if (ua.includes('mac')) os = 'macos';
document.documentElement.setAttribute('data-os', os);

const assetFor = {
  windows: 'https://github.com/hasaanamerravid-source/OpenNotesCode/releases/download/v1.2.0/OpenNotes_1.2.0_x64-setup.exe',
  linux: 'https://github.com/hasaanamerravid-source/OpenNotesCode/releases/download/v1.2.0/OpenNotes_1.2.0_amd64.AppImage',
};
document.querySelectorAll('a.btn-primary[href="downloads.html"]').forEach((link) => {
  const url = assetFor[os];
  if (url) {
    link.setAttribute('href', url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
    const label = os === 'windows' ? 'Download for Windows' : 'Download for Linux';
    link.textContent = label;
  }
});
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

