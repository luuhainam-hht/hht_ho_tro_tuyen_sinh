/**
 * Đoạn nhúng cho website trường:
 *   <script src="https://<ten-mien-he-thong>/widget.js" async></script>
 * Tạo nút "Tư vấn tuyển sinh" + iframe chat.html chạy trên tên miền hệ thống
 * (website trường phải có trong ALLOWED_EMBED_ORIGINS để iframe được phép hiển thị).
 * Không dùng innerHTML, không thêm style nội tuyến dạng thẻ <style> để tương thích CSP của trang chủ.
 */
(function () {
  'use strict';
  if (window.__hhtWidget) return;
  window.__hhtWidget = true;
  const script = document.currentScript;
  const origin = new URL(script.src).origin;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Tư vấn tuyển sinh';
  btn.setAttribute('aria-expanded', 'false');
  Object.assign(btn.style, {
    position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483000', background: '#c8102e', color: '#ffffff',
    border: '0', borderRadius: '999px', padding: '12px 20px', font: '700 15px system-ui, sans-serif', cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(31,41,51,.25)',
  });
  let frame = null;
  btn.addEventListener('click', () => {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.src = `${origin}/chat.html?embedded=1`;
      frame.title = 'Tư vấn tuyển sinh';
      Object.assign(frame.style, {
        position: 'fixed', right: '18px', bottom: '80px', width: 'min(400px, calc(100vw - 24px))', height: 'min(620px, calc(100vh - 110px))',
        border: '0', borderRadius: '14px', boxShadow: '0 12px 36px rgba(31,41,51,.22)', zIndex: '2147483000', background: '#fff',
      });
      document.body.appendChild(frame);
    } else frame.hidden = !frame.hidden;
    btn.setAttribute('aria-expanded', String(!frame.hidden));
  });
  window.addEventListener('message', (e) => { if (e.origin === origin && e.data === 'hht-chat-close' && frame) { frame.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  document.body.appendChild(btn);
})();
