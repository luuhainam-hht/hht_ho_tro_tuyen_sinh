/**
 * Dùng chung mọi trang công khai: khung đầu/chân trang, tiện ích DOM an toàn (không innerHTML với
 * dữ liệu), toast, hộp xác nhận, nút mở trợ lý ảo, đăng ký Service Worker.
 */
(function () {
  'use strict';

  // replaceChildren gốc không làm phẳng mảng và in chữ "null" cho phần tử rỗng. Các trang dựng DOM
  // bằng el() + điều kiện (a ? el : null) nên chuẩn hóa một lần ở đây thay vì lọc ở mọi chỗ gọi.
  const nativeReplace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function replaceChildren(...kids) {
    return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  /** el('a', {href, class}, 'chữ', node…) – mọi chuỗi thành textNode -> chống XSS. */
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('data-') || k.startsWith('aria-') || ['for', 'role', 'type', 'name', 'value', 'href', 'src', 'id', 'title', 'colspan', 'rowspan', 'scope', 'list', 'min', 'max', 'placeholder', 'autocomplete', 'inputmode', 'maxlength', 'rows', 'target', 'rel', 'tabindex', 'download', 'accept', 'required', 'checked', 'disabled', 'selected', 'open'].includes(k)) {
        if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, v);
      } else if (typeof v === 'function' || typeof v === 'boolean') n[k] = v; // sự kiện / cờ DOM (onclick, hidden…)
      else n.setAttribute(k, v); // list, step, alt, width… : luôn dùng setAttribute, không gán property chỉ-đọc
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  function toast(message, kind = 'info') {
    let box = $('#toast');
    if (!box) { box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
    box.textContent = message;
    box.dataset.kind = kind;
    box.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 6000 : 3500);
  }

  /** Hộp xác nhận thay window.confirm (không chặn luồng, đúng giao diện). */
  function confirmDialog(message, { okText = 'Đồng ý', cancelText = 'Quay lại', danger = false } = {}) {
    return new Promise((resolve) => {
      const dlg = el('dialog', {},
        el('p', {}, message),
        el('div', { class: 'btn-row' },
          el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, value: 'ok' }, okText),
          el('button', { class: 'btn', value: 'cancel' }, cancelText)));
      dlg.addEventListener('click', (e) => { if (e.target.value) { dlg.close(e.target.value); } });
      dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  const LEVEL_SHORT = { HE_9_PLUS: 'Hệ 9+', TRUNG_CAP: 'Trung cấp', CAO_DANG: 'Cao đẳng', SO_CAP: 'Sơ cấp' };
  const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  const WEEKDAY_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const weekday = (iso) => WEEKDAY_VI[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  const money = (n) => (n ? `${Number(n).toLocaleString('vi-VN')} đ` : '');
  const params = () => new URLSearchParams(location.search);

  let metaPromise = null;
  const meta = () => (metaPromise ||= apiClient.get('/api/meta'));

  // ---------- Khung trang ----------
  const NAV = [
    ['/', 'Trang chủ'], ['/nganh.html', 'Ngành học'], ['/ho-so.html', 'Hồ sơ'], ['/lich-tuyen-sinh.html', 'Lịch tuyển sinh'],
    ['/cam-nang.html', 'Hỏi đáp'], ['/goi-y-nganh.html', 'Gợi ý ngành'], ['/lien-he.html', 'Liên hệ'],
  ];

  function renderHeader() {
    const slot = $('[data-layout="header"]');
    if (!slot) return;
    const here = location.pathname === '/index.html' ? '/' : location.pathname;
    const nav = el('nav', { class: 'nav', id: 'site-nav', 'aria-label': 'Điều hướng chính' },
      NAV.map(([href, label]) => el('a', { href, 'aria-current': here === href || (href !== '/' && here.startsWith(href.replace('.html', ''))) ? 'page' : null }, label)));
    const topbar = el('div', { class: 'topbar' }, el('div', { class: 'wrap' },
      el('span', {}, 'Hotline tuyển sinh: ', el('a', { href: 'tel:0981670588', id: 'topbar-hotline' }, '0981 670 588')),
      el('span', {}, 'Email: ', el('a', { href: 'mailto:tuyensinh@hht.edu.vn', id: 'topbar-email' }, 'tuyensinh@hht.edu.vn')),
      el('span', { class: 'topbar-right' }, el('a', { href: '/hen.html' }, 'Tra cứu lịch hẹn'), el('a', { href: 'https://hht.edu.vn', target: '_blank', rel: 'noopener' }, 'Website trường'))));
    slot.replaceWith(topbar, el('header', { class: 'site-header' },
      el('a', { class: 'skip', href: '#main' }, 'Bỏ qua, tới nội dung chính'),
      el('div', { class: 'wrap' },
        // Logo đã có tên trường -> không lặp lại chữ bên cạnh.
        el('a', { class: 'brand', href: '/', 'aria-label': 'Trường Cao đẳng Công nghệ cao Hà Nội – Trang chủ tuyển sinh' },
          el('img', { class: 'brand-logo brand-logo--full', src: '/img/logo-hht-full.png', alt: 'HHT – Trường Cao đẳng Công nghệ cao Hà Nội', width: '432', height: '64' })),
        nav,
        el('button', { class: 'btn btn--sm nav-toggle', 'aria-controls': 'site-nav', 'aria-expanded': 'false', 'data-action': 'toggle-nav' }, 'Menu'),
        el('a', { class: 'btn btn--tag btn--sm', href: '/dat-lich.html' }, 'Đặt lịch nộp hồ sơ'))));
  }

  async function renderFooter() {
    const slot = $('[data-layout="footer"]');
    if (!slot) return;
    const footer = el('footer', { class: 'site-footer' });
    slot.replaceWith(footer);
    let cfg = {};
    try { cfg = (await meta()).config; } catch { /* vẫn hiện chân trang tĩnh */ }
    const hot = $('#topbar-hotline');
    if (hot && cfg.HOTLINE) { hot.textContent = cfg.HOTLINE; hot.href = `tel:${cfg.HOTLINE.replace(/\s/g, '')}`; }
    const mail = $('#topbar-email');
    if (mail && cfg.ADMISSION_EMAIL) { mail.textContent = cfg.ADMISSION_EMAIL; mail.href = `mailto:${cfg.ADMISSION_EMAIL}`; }
    footer.append(el('div', { class: 'wrap' },
      el('div', { class: 'footer-grid' },
        el('div', {},
          el('img', { class: 'footer-logo footer-logo--full', src: '/img/logo-hht-full.png', alt: 'HHT – Trường Cao đẳng Công nghệ cao Hà Nội', width: '432', height: '64' }),
          el('h3', {}, cfg.SCHOOL_NAME || 'Trường Cao đẳng Công nghệ cao Hà Nội'),
          el('p', {}, 'Trung tâm Tuyển sinh & Giải quyết việc làm: tầng 1 nhà A, Cơ sở 1, Phố Nhuệ Giang, Phường Xuân Phương, TP. Hà Nội.'),
          el('p', {}, 'Hotline: ', el('a', { href: `tel:${(cfg.HOTLINE || '').replace(/\s/g, '')}` }, cfg.HOTLINE || ''), ' · Email: ', el('a', { href: `mailto:${cfg.ADMISSION_EMAIL || ''}` }, cfg.ADMISSION_EMAIL || ''))),
        el('div', {}, el('h3', {}, 'Thí sinh'), el('ul', {},
          el('li', {}, el('a', { href: '/nganh.html' }, 'Tra cứu ngành học')),
          el('li', {}, el('a', { href: '/ho-so.html' }, 'Checklist hồ sơ')),
          el('li', {}, el('a', { href: '/huong-dan-dang-ky.html' }, 'Hướng dẫn đăng ký trực tuyến')),
          el('li', {}, el('a', { href: '/hen.html' }, 'Tra cứu lịch hẹn')))),
        el('div', {}, el('h3', {}, 'Kênh chính thức'), el('ul', {},
          el('li', {}, el('a', { href: 'https://hht.edu.vn', rel: 'noopener', target: '_blank' }, 'Website hht.edu.vn')),
          el('li', {}, el('a', { href: cfg.OFFICIAL_REGISTER_URL || '#', rel: 'noopener', target: '_blank' }, 'Đăng ký xét tuyển trực tuyến')),
          el('li', {}, el('a', { href: cfg.FANPAGE_URL || '#', rel: 'noopener', target: '_blank' }, 'Fanpage tuyển sinh')),
          el('li', {}, el('a', { href: '/nguon-du-lieu.html' }, 'Nguồn dữ liệu của hệ thống'))))),
      el('p', { class: 'footer-note' }, `© ${new Date().getFullYear()} Trường Cao đẳng Công nghệ cao Hà Nội. Thông tin tuyển sinh tổng hợp từ các thông báo của Nhà trường; khi có khác biệt, văn bản do Nhà trường ban hành là căn cứ cuối cùng.`)));
  }

  // ---------- Trợ lý ảo nổi ----------
  function mountChatLauncher() {
    if (document.body.dataset.noChat !== undefined) return;
    const btn = el('button', { class: 'chat-launcher', 'data-action': 'toggle-chat', 'aria-expanded': 'false', 'aria-controls': 'chat-frame' });
    btn.append(svgChat(), document.createTextNode('Tư vấn tuyển sinh'));
    document.body.append(btn);
  }
  function svgChat() {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M4 5h16v11H9l-5 4z');
    s.append(p);
    return s;
  }
  /**
   * Mở khung chat; có thể gửi kèm câu hỏi, mã ngành, hoặc yêu cầu giải thích (explain = 'level:HE_9_PLUS',
   * 'support:NHA_NUOC' – từ bảng Ngành học). Khung đã mở thì gửi postMessage để giữ nguyên cuộc trò chuyện.
   */
  function openChat({ question = '', majorCode = '', explain = '' } = {}) {
    let frame = $('#chat-frame');
    const q = new URLSearchParams();
    if (question) q.set('q', question);
    if (majorCode) q.set('major', majorCode);
    if (explain) q.set('explain', explain);
    q.set('embedded', '1');
    if (!frame) {
      frame = el('iframe', { id: 'chat-frame', class: 'chat-frame', title: 'Tư vấn tuyển sinh', src: `/chat.html?${q}` });
      document.body.append(frame);
    } else if (question || explain) {
      frame.hidden = false;
      frame.contentWindow?.postMessage({ type: 'hht-chat-command', question, majorCode, explain }, location.origin);
    } else if (majorCode) {
      frame.src = `/chat.html?${q}`;
      frame.hidden = false;
    } else frame.hidden = !frame.hidden;
    const btn = $('.chat-launcher');
    if (btn) btn.setAttribute('aria-expanded', String(!frame.hidden));
  }
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data === 'hht-chat-close') { const f = $('#chat-frame'); if (f) f.hidden = true; }
  });

  actionDelegate.register({
    'toggle-nav'(btn) {
      const nav = $('#site-nav');
      const open = nav.dataset.open !== 'true';
      nav.dataset.open = String(open);
      btn.setAttribute('aria-expanded', String(open));
    },
    'toggle-chat'() { openChat(); },
    'ask'(btn) { openChat({ question: btn.dataset.question || btn.textContent, majorCode: btn.dataset.major || '' }); },
    'print'() { window.print(); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
    renderFooter();
    mountChatLauncher();
  });
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  Object.assign(window, { $, $$, el, toast, confirmDialog, openChat, hht: { LEVEL_SHORT, fmtDate, weekday, money, params, meta } });
})();
