/* OpenNotes website interactivity */

(() => {
  'use strict';

  /* ---------- Theme toggle ---------- */
  const THEME_KEY = 'opennotes-website-theme';
  const themeToggle = document.getElementById('themeToggle');
  const root = document.documentElement;

  function getSavedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    if (themeToggle) themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  const saved = getSavedTheme();
  if (saved) {
    setTheme(saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setTheme('dark');
  } else {
    setTheme('light');
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }

  /* ---------- Mobile nav ---------- */
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const nav = document.getElementById('nav');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open);
    });
    // Close menu when clicking a link
    navLinks.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Nav hide on scroll ---------- */
  let lastY = window.scrollY;
  let ticking = false;
  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > lastY && y > 100) nav.classList.add('nav-hidden');
        else nav.classList.remove('nav-hidden');
        lastY = y > 0 ? y : 0;
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Reveal-on-scroll ---------- */
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.feature-card, .download-card, .screenshot-card, .doc-card, .section-header').forEach((el) => {
    el.classList.add('reveal');
    observer.observe(el);
  });

  /* ---------- Smooth anchor scroll ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();
