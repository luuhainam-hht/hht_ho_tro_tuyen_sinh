/**
 * Mã QR cho lịch hẹn (chạy hoàn toàn trên trình duyệt, không gửi mã đi đâu):
 *   - hhtQr.ticketQr(appt)   : khối QR trên phiếu hẹn + nút tải ảnh PNG (in/lưu vào điện thoại).
 *   - hhtQr.scan()           : mở camera quét QR (thí sinh tra cứu, cán bộ check-in); có lựa chọn chọn ảnh chụp.
 *   - hhtQr.extractCode(txt) : lấy mã HS-XXXX-XXXX từ nội dung QR (URL /hen.html?code=…) hoặc chuỗi gõ tay.
 * Nội dung QR là đường dẫn tra cứu -> quét bằng camera điện thoại thường cũng mở đúng trang lịch hẹn.
 * Thư viện: qrcode-generator (MIT) nạp sẵn; jsQR (Apache-2.0) chỉ nạp khi bấm quét (≈130 KB).
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const DARK = '#1f2933';
  const JSQR_SRC = '/js/vendor/jsqr.min.js?v=1.4.0';
  const CODE_BODY = /^[0-9A-HJKMNP-TV-Z]{8}$/;

  const trackUrl = (code) => `${location.origin}/hen.html?code=${encodeURIComponent(code)}`;

  function build(text) {
    if (typeof qrcode !== 'function') throw new Error('Chưa nạp thư viện tạo mã QR');
    const q = qrcode(0, 'M'); // tự chọn phiên bản nhỏ nhất; mức sửa lỗi M (~15%) đủ cho giấy in hơi nhòe
    q.addData(text);
    q.make();
    return q;
  }

  /** SVG thuần (không inline style -> hợp CSP style-src 'self'); một <path> cho mọi ô đen. */
  function svg(text, { size = 184, margin = 4, label = 'Mã QR' } = {}) {
    const q = build(text);
    const n = q.getModuleCount();
    const dim = n + margin * 2;
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
    s.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', String(dim)); bg.setAttribute('height', String(dim)); bg.setAttribute('fill', '#fff');
    let d = '';
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', DARK);
    s.append(bg, p);
    return s;
  }

  /** Ảnh PNG có chú thích (mã + giờ hẹn) để lưu vào điện thoại hoặc gửi qua Zalo. */
  function pngDataUrl(text, { scale = 10, margin = 4, lines = [] } = {}) {
    const q = build(text);
    const n = q.getModuleCount();
    const qrPx = (n + margin * 2) * scale;
    const lineH = Math.round(scale * 3.2);
    const cv = document.createElement('canvas');
    cv.width = qrPx;
    cv.height = qrPx + (lines.length ? lines.length * lineH + scale * 2 : 0);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = DARK;
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) g.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    g.textAlign = 'center';
    lines.forEach((t, i) => {
      g.font = `${i === 0 ? 700 : 400} ${Math.round(scale * (i === 0 ? 2.6 : 1.8))}px 'Be Vietnam Pro', system-ui, sans-serif`;
      g.fillStyle = i === 0 ? '#c8102e' : DARK;
      g.fillText(t, cv.width / 2, qrPx + scale + lineH * (i + 0.75), cv.width - scale * 2);
    });
    return cv.toDataURL('image/png');
  }

  /** Mã hẹn từ: URL trong QR, "hs a1b2 c3d4", "HSA1B2C3D4"… Đọc nhầm O->0, I/L->1 như phía máy chủ. */
  function extractCode(raw) {
    let s = String(raw || '').trim();
    try { const u = new URL(s); s = u.searchParams.get('code') || ''; } catch { /* không phải URL */ }
    s = s.toUpperCase().replace(/[\s-]/g, '');
    if (s.startsWith('HS')) s = s.slice(2);
    s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
    return CODE_BODY.test(s) ? `HS-${s.slice(0, 4)}-${s.slice(4)}` : null;
  }

  /** Khối QR trên phiếu hẹn. appt: { code, date, startTime, endTime } */
  function ticketQr(a) {
    const url = trackUrl(a.code);
    let image;
    try { image = svg(url, { label: `Mã QR của lịch hẹn ${a.code}` }); } catch { return null; } // lỗi QR không được làm hỏng phiếu hẹn
    const when = a.date ? `${hht.weekday(a.date)}, ${hht.fmtDate(a.date)} · ${a.startTime} – ${a.endTime}` : '';
    const dl = el('a', { class: 'btn btn--sm', href: '#', download: `ma-hen-${a.code}.png` }, 'Tải ảnh QR');
    // Tạo PNG khi bấm (không tốn công nếu không dùng); href gán ngay trước khi trình duyệt tải.
    dl.addEventListener('click', () => { dl.href = pngDataUrl(url, { lines: [a.code, when, 'Quét để tra cứu lịch hẹn'].filter(Boolean) }); });
    const copy = el('button', { class: 'btn btn--sm', type: 'button' }, 'Sao chép mã');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(a.code); toast(`Đã sao chép ${a.code}`, 'ok'); } catch { toast('Trình duyệt không cho sao chép, hãy ghi lại mã', 'error'); }
    });
    return el('figure', { class: 'qr-box' },
      image,
      el('figcaption', { class: 'small muted' }, 'Xuất trình mã QR này tại bàn tiếp nhận. Quét bằng camera điện thoại để mở lại lịch hẹn.'),
      el('div', { class: 'btn-row qr-actions no-print' }, dl, copy));
  }

  // ---------------- Quét QR ----------------
  let jsqrPromise = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    jsqrPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSQR_SRC; s.async = true;
      s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('Không nạp được bộ đọc QR')));
      s.onerror = () => { jsqrPromise = null; reject(new Error('Không nạp được bộ đọc QR, kiểm tra kết nối mạng')); };
      document.head.append(s);
    });
    return jsqrPromise;
  }

  function decodeCanvas(jsQR, cv) {
    const g = cv.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, cv.width, cv.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  }

  /** Đọc QR trong một ảnh (ảnh chụp màn hình phiếu hẹn, ảnh đã tải về). */
  async function scanImageFile(file) {
    const jsQR = await loadJsQR();
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); // ảnh 12MP -> thu nhỏ cho nhanh
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const hit = decodeCanvas(jsQR, cv);
    return hit ? hit.data : null;
  }

  /**
   * Hộp thoại quét: camera sau (nếu có) + nút chọn ảnh. Trả về mã hẹn đã chuẩn hóa, hoặc null nếu người dùng đóng.
   * Camera cần HTTPS hoặc localhost; truy cập qua http://IP-LAN thì chỉ dùng được "Chọn ảnh".
   */
  function scan({ title = 'Quét mã QR lịch hẹn' } = {}) {
    return new Promise((resolve) => {
      let stream = null; let raf = 0; let done = false;
      const video = document.createElement('video');
      video.setAttribute('playsinline', ''); video.muted = true; video.className = 'qr-video';
      const status = el('p', { class: 'small muted', role: 'status' }, 'Đang mở camera…');
      const file = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'qr-file' });
      const dlg = el('dialog', { class: 'qr-dialog', 'aria-label': title },
        el('h3', {}, title),
        el('div', { class: 'qr-frame' }, video, el('span', { class: 'qr-aim', 'aria-hidden': 'true' })),
        status,
        el('div', { class: 'btn-row' },
          el('label', { class: 'btn btn--sm', for: 'qr-file' }, 'Chọn ảnh có mã QR'), file,
          el('button', { class: 'btn btn--sm', type: 'button', value: 'close' }, 'Đóng')));

      const finish = (code) => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(code);
      };
      const accept = (text) => {
        const code = extractCode(text);
        if (code) { if (navigator.vibrate) navigator.vibrate(60); finish(code); return true; }
        status.textContent = 'Mã QR này không phải mã lịch hẹn HS-XXXX-XXXX.';
        return false;
      };

      dlg.addEventListener('click', (e) => { if (e.target.value === 'close') finish(null); });
      dlg.addEventListener('cancel', () => finish(null));
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        status.textContent = 'Đang đọc ảnh…';
        try {
          const text = await scanImageFile(f);
          if (!text) status.textContent = 'Không tìm thấy mã QR trong ảnh. Hãy chụp rõ, đủ sáng, không bị cắt góc.';
          else accept(text);
        } catch (e) { status.textContent = e.message; }
        file.value = '';
      });
      document.body.append(dlg);
      dlg.showModal();

      (async () => {
        let jsQR;
        try { jsQR = await loadJsQR(); } catch (e) { status.textContent = e.message; return; }
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          status.textContent = 'Trình duyệt chỉ cho mở camera trên trang HTTPS. Bạn có thể bấm "Chọn ảnh có mã QR".';
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        } catch (e) {
          status.textContent = e.name === 'NotAllowedError'
            ? 'Bạn chưa cho phép dùng camera. Cấp quyền camera cho trang này hoặc bấm "Chọn ảnh có mã QR".'
            : 'Không mở được camera trên thiết bị này. Bấm "Chọn ảnh có mã QR".';
          return;
        }
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        status.textContent = 'Đưa mã QR vào giữa khung hình.';
        const cv = document.createElement('canvas');
        let last = 0;
        const tick = (t) => {
          if (done) return;
          raf = requestAnimationFrame(tick);
          if (t - last < 120 || video.readyState < 2) return; // ~8 khung/giây là đủ, đỡ nóng máy
          last = t;
          const k = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
          cv.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, cv.width, cv.height);
          const hit = decodeCanvas(jsQR, cv);
          if (hit && hit.data) accept(hit.data);
        };
        raf = requestAnimationFrame(tick);
      })();
    });
  }

  window.hhtQr = { svg, pngDataUrl, extractCode, ticketQr, scan, scanImageFile, trackUrl };
})();
