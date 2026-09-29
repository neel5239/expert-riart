(() => {
  const C = window.RISART;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = n => '₹' + Number(n).toLocaleString('en-IN');

  /* ---------- content from config ---------- */
  $('#beats').innerHTML = C.beats.map(b =>
    `<section class="beat${b.logo ? ' beat-brand' : ''}"${b.pos ? ` data-pos="${esc(b.pos)}"` : ''}${b.vh ? ` style="--vh:${Number(b.vh)}"` : ''}>` +
    (b.logo ? `<img class="beat-logo" src="assets/logo.png" alt="RI'S ART" width="132" height="132">` : '') +
    (b.kicker ? `<p class="kicker">${esc(b.kicker)}</p>` : '') +
    `<h2>${esc(b.h)}</h2><p>${esc(b.p)}</p></section>`).join('');

  $('#menu-groups').innerHTML = C.menu.map(g => `
    <div class="menu-group">
      <h3>${esc(g.group)}</h3>
      <ul class="swatches">
        ${g.items.map(i => `
          <li class="swatch">
            <span class="chip" data-look='${esc(JSON.stringify(i.tryon || { shade: i.shade, design: 'gloss', shape: 'round', length: 'natural' }))}' aria-hidden="true"></span>
            <h4>${esc(i.name)}</h4>
            <p>${esc(i.note)}</p>
            <div class="meta">
              <span class="price"><small>from</small>${rupees(i.price)}</span>
              <span class="time">${esc(i.time)}</span>
              <span class="acts">
                ${i.tryon ? `<button class="try" type="button" data-tryon='${esc(JSON.stringify(i.tryon))}' aria-label="Try ${esc(i.name)} on your hand">Try on</button>` : ''}
                <button class="pick" type="button" data-service="${esc(i.name)}">Book this</button>
              </span>
            </div>
          </li>`).join('')}
      </ul>
    </div>`).join('');

  // each swatch shows the service's own look as a real nail shape (shared with the try-on)
  import('./nailshape.js').then(({ nailSVG }) => {
    document.querySelectorAll('.chip[data-look]').forEach(el => {
      try { el.innerHTML = nailSVG({ ...JSON.parse(el.dataset.look), accent: true, width: 46 }); } catch {}
    });
  });

  $('#service-select').innerHTML = '<option value="">Choose a service</option>' +
    C.menu.map(g => `<optgroup label="${esc(g.group)}">${g.items.map(i =>
      `<option>${esc(i.name)}</option>`).join('')}</optgroup>`).join('');

  $('#looks-strip').innerHTML = C.looks.map(l => `
    <figure class="look"><img src="${esc(l.src)}" alt="${esc(l.name)} nail set" loading="lazy" width="480" height="600">
    <figcaption>${esc(l.name)}</figcaption></figure>`).join('');

  $('#faq-list').innerHTML = C.faq.map(([q, a]) =>
    `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');

  $('#hours').innerHTML = C.hours.map(([d, t]) => `<dt>${esc(d)}</dt><dd>${esc(t)}</dd>`).join('');

  const wa = text => `https://wa.me/${C.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  document.querySelectorAll('[data-city]').forEach(el => el.textContent = C.city);
  document.querySelectorAll('[data-address]').forEach(el => el.textContent = C.address);
  document.querySelectorAll('[data-map]').forEach(el => el.href = C.mapUrl);
  document.querySelectorAll('[data-wa]').forEach(el => el.href = wa(`Hi Ri, I'd like to book a nail appointment.`));
  document.querySelectorAll('[data-tel]').forEach(el => { el.href = 'tel:' + C.phone.replace(/\s/g, ''); el.textContent = C.phone; });
  document.querySelectorAll('[data-mail]').forEach(el => { if (C.email) { el.href = 'mailto:' + C.email; el.textContent = C.email; } else el.remove(); });
  document.querySelectorAll('[data-ig]').forEach(el => { el.href = 'https://instagram.com/' + C.instagram; el.textContent = '@' + C.instagram; });
  $('#year').textContent = new Date().getFullYear();

  /* ---------- "Book this" on a swatch preselects the form ---------- */
  const form = $('#book-form');
  document.addEventListener('click', e => {
    const b = e.target.closest('.pick');
    if (!b) return;
    form.service.value = b.dataset.service;
    $('#book').scrollIntoView({ behavior: 'instant', block: 'start' });
    form.name.focus({ preventScroll: true });
  });

  /* ---------- booking form -> WhatsApp ---------- */
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  form.date.min = today.toISOString().slice(0, 10);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const err = $('#form-error');
    const missing = [];
    [['name', 'your name'], ['service', 'a service'], ['date', 'a date']].forEach(([k, label]) => {
      const bad = !form[k].value.trim();
      form[k].setAttribute('aria-invalid', bad);
      if (bad) missing.push(label);
    });
    if (missing.length) {
      const list = missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing.at(-1) : missing[0];
      err.textContent = `Add ${list} to send your request.`;
      err.hidden = false;
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    err.hidden = true;
    const d = new Date(form.date.value + 'T00:00');
    const when = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    const lines = [
      `Hi Ri, I'd like to book at RI'S ART.`,
      `Name: ${form.name.value.trim()}`,
      `Service: ${form.service.value}`,
      `Preferred: ${when}, ${form.slot.value.toLowerCase()}`,
    ];
    if (form.idea.value.trim()) lines.push(`Design idea: ${form.idea.value.trim()}`);
    window.open(wa(lines.join('\n')), '_blank', 'noopener');
  });

  /* ---------- scroll-scrubbed film (scrollvideo recipe) ---------- */
  const film = $('#film');
  const video = $('#scrub');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let duration = 0, current = 0, target = 0, last = 0, raf = 0;

  // progress through the film block only: 0 at its top, 1 when its end reaches the viewport bottom
  function progress() {
    const max = film.offsetHeight - innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, (scrollY - film.offsetTop) / max));
  }

  function onReady() {
    duration = video.duration || 0;
    video.pause();                       // never play — seeked by hand
    // iOS paints a seeked frame only once the decoder has run, so prime it with one muted play/pause
    if (matchMedia('(pointer: coarse)').matches) video.play().then(() => { video.pause(); video.currentTime = current; }).catch(() => {});
    if (reduced) { video.currentTime = 0; panTo(0); return; }
    current = target = progress() * duration;
    video.currentTime = current;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  // on portrait screens, pan the cover-crop to keep the action in view
  const focus = C.focus || [];
  const portrait = matchMedia('(max-aspect-ratio: 6/5)');
  let lastFx = -1;
  function panTo(t) {
    if (!portrait.matches || focus.length < 2) {
      if (lastFx !== -1) { video.style.objectPosition = ''; lastFx = -1; }
      return;
    }
    let i = 1;
    while (i < focus.length - 1 && focus[i][0] < t) i++;
    const [t0, x0] = focus[i - 1], [t1, x1] = focus[i];
    const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    const fx = Math.round((x0 + (x1 - x0) * k) * 10) / 10;
    if (fx !== lastFx) { video.style.objectPosition = `${fx}% 50%`; lastFx = fx; }
  }

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    target = progress() * duration;
    current += (target - current) * (1 - Math.exp(-dt * 8));
    if (video.readyState >= 2 && Math.abs(video.currentTime - current) > 0.003) {
      video.currentTime = current;
    }
    panTo(current);
    raf = requestAnimationFrame(tick);
  }

  // Loader: the whole film downloads into memory before the site opens, so scrubbing never stalls
  // (streaming breaks it on phones: every seek is a new request, and iPhones won't preload video at all).
  // Apple devices get the MP4 (H.264); others get the smaller WebM when they can play it.
  const loader = $('#loader'), fill = $('#loader-fill'), pct = $('#loader-pct');
  const t0 = performance.now();
  let shown = 0, revealed = false;
  function setProgress(k) {
    k = Math.max(shown, Math.min(1, k)); shown = k;
    if (fill) fill.style.transform = `scaleX(${k})`;
    if (pct) pct.textContent = Math.round(k * 100);
  }
  function reveal() {
    if (revealed) return;
    revealed = true;
    setProgress(1);
    const wait = Math.max(0, 900 - (performance.now() - t0));        // long enough to see the logo
    setTimeout(() => {
      scrollTo(0, 0);
      document.documentElement.classList.remove('is-loading');
      loader?.classList.add('done');
      loader?.setAttribute('aria-hidden', 'true');
    }, wait);
  }
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';  // the film always opens from its first frame
  setTimeout(reveal, 25000);                                            // very slow connection: open anyway, film keeps streaming

  async function loadFilm() {
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && !/Chrome|Firefox/.test(navigator.userAgent));
    const sources = [...video.querySelectorAll('source')].map(el => ({ src: el.getAttribute('src'), type: el.type }));
    const order = apple ? sources.filter(x => x.type === 'video/mp4').concat(sources.filter(x => x.type !== 'video/mp4')) : sources;
    const pick = order.find(x => video.canPlayType(x.type)) || sources[sources.length - 1];
    video.addEventListener('loadedmetadata', onReady, { once: true });
    // open the site once the first frame can be shown
    video.addEventListener('loadeddata', () => Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 1500))]).then(reveal), { once: true });
    try {
      const r = await fetch(pick.src);
      if (!r.ok) throw new Error(r.status);
      const total = Number(r.headers.get('content-length')) || 0;
      let blob;
      if (r.body && total) {
        const reader = r.body.getReader(), chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got += value.length;
          setProgress(0.95 * got / total);
        }
        blob = new Blob(chunks, { type: pick.type });
      } else blob = await r.blob();
      video.querySelectorAll('source').forEach(el => el.remove());
      video.src = URL.createObjectURL(blob);
      // a device that refuses the in-memory copy streams the file instead
      video.addEventListener('error', () => { video.src = pick.src; video.load(); }, { once: true });
    } catch {
      video.src = pick.src;                // could not download it in one go: stream it instead
    }
    video.preload = 'auto';
    video.load();
  }
  loadFilm();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!reduced && duration) { last = performance.now(); raf = requestAnimationFrame(tick); }
  });

  // beat text fades with its own section
  const io = new IntersectionObserver(
    entries => entries.forEach(e => e.target.classList.toggle('in', e.isIntersecting)),
    { threshold: 0.35 }
  );
  document.querySelectorAll('.beat').forEach(el => io.observe(el));

  // the film carries no chrome: the booking pill appears only once the studio is on screen
  const pill = $('#book-pill');
  // ...and steps aside where the page already offers its own actions (booking form, try-on buttons)
  const busy = new Set();
  const own = new IntersectionObserver(entries => {
    entries.forEach(e => e.isIntersecting ? busy.add(e.target) : busy.delete(e.target));
    sync();
  }, { threshold: 0.2 });
  ['#book', '#tryon'].forEach(sel => own.observe($(sel)));
  function sync() {
    const pastFilm = scrollY > film.offsetTop + film.offsetHeight - innerHeight * 0.6;
    pill.classList.toggle('show', pastFilm && busy.size === 0);
  }
  addEventListener('scroll', sync, { passive: true });
  sync();
})();
