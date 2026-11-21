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

/* ---------- FAQ accordion ---------- */
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

