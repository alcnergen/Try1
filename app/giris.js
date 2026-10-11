/* Vitrin — giriş ekranı */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const form = $('[data-form]');
  const email = $('#email');
  const password = $('#password');
  const errorEl = $('[data-error]');
  const submit = $('[data-submit]');
  const params = new URLSearchParams(location.search);

  if (params.has('kayit')) {
    $('[data-title]').textContent = 'Ücretsiz hesabını oluştur';
    $('[data-sub]').textContent = 'E-postanı ve bir şifre yaz; ilk 10 görsel bizden.';
    $('[data-submit-label]').textContent = 'Hesap oluştur';
    password.autocomplete = 'new-password';
  }

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  };

  $('[data-toggle-password]').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
  });

  $('[data-fill-demo]').addEventListener('click', () => {
    email.value = 'demo@vitrin.app';
    password.value = 'vitrin2026';
    showError('');
    submit.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!email.value.trim() || !email.checkValidity()) { showError('Geçerli bir e-posta adresi gir.'); email.focus(); return; }
    if (password.value.length < 4) { showError('Şifre en az 4 karakter olmalı.'); password.focus(); return; }

    submit.disabled = true;
    submit.classList.add('is-loading');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Giriş yapılamadı. Lütfen tekrar dene.');
      const next = params.get('next');
      location.assign(next && next.startsWith('/') && !next.startsWith('//') ? next : '/panel');
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : err.message);
      submit.disabled = false;
      submit.classList.remove('is-loading');
    }
  });
})();
