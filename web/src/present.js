import { toSVG } from './export.js';
import { el } from './util.js';

export const presentableFrames = (store, page) => store.childrenOf(null, page).filter((n) => n.page === page && (n.type === 'frame' || n.type === 'component' || n.type === 'section') && n.visible !== false).sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));

export const present = (store, page, startId) => {
  const frames = presentableFrames(store, page);
  if (!frames.length) return false;
  let idx = Math.max(0, frames.findIndex((f) => f.id === startId));
  const history = [];
  const root = el('div', { class: 'present', role: 'dialog', 'aria-label': 'Apresentação' });
  const stage = el('div', { class: 'slide' });
  const label = el('span');
  const prev = el('button', { text: '←', title: 'Anterior', onclick: () => go(idx - 1, 'slide-right') });
  const next = el('button', { text: '→', title: 'Próximo', onclick: () => go(idx + 1, 'slide-left') });
  const back = el('button', { text: 'Voltar', title: 'Voltar ao frame anterior', onclick: () => history.length && go(history.pop(), 'dissolve', true) });
  const close = el('button', { text: 'Sair (Esc)', onclick: () => exit() });
  root.append(stage, el('div', { class: 'hud' }, prev, label, next, back, close));
  document.body.append(root);
  const urls = [];
  const fit = (w, h) => {
    const k = Math.min((innerWidth - 80) / w, (innerHeight - 110) / h, 4);
    return { w: w * k, h: h * k, k };
  };
  const render = (transition) => {
    const f = frames[idx];
    const { svg, width, height } = toSVG(store, [f], { bounds: { x: f.x, y: f.y, w: f.w, h: f.h } });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    urls.push(url);
    const size = fit(width, height);
    const slide = el('div', { class: 'slide', style: { width: size.w + 'px', height: size.h + 'px', opacity: '0', transform: transition === 'slide-left' ? 'translateX(60px)' : transition === 'slide-right' ? 'translateX(-60px)' : transition === 'dissolve' ? 'scale(0.985)' : 'none' } });
    slide.append(el('img', { src: url, alt: f.name || 'Frame', draggable: 'false' }));
    for (const n of store.descendants(f.id)) {
      if (!n.link || !n.link.to) continue;
      const target = frames.findIndex((x) => x.id === n.link.to);
      if (target < 0) continue;
      const hot = el('button', { class: 'hot', title: `Ir para ${frames[target].name}`, style: { left: (n.x - f.x) * size.k + 'px', top: (n.y - f.y) * size.k + 'px', width: n.w * size.k + 'px', height: n.h * size.k + 'px', background: 'transparent', border: '0' } });
      hot.addEventListener('click', () => {
        history.push(idx);
        go(target, n.link.transition || 'dissolve', true);
      });
      slide.append(hot);
    }
    if (f.link && f.link.to) {
      const target = frames.findIndex((x) => x.id === f.link.to);
      if (target >= 0) slide.addEventListener('click', (e) => {
        if (e.target.classList.contains('hot')) return;
        history.push(idx);
        go(target, f.link.transition || 'dissolve', true);
      });
    }
    const old = root.querySelector('.slide');
    root.replaceChild(slide, old);
    requestAnimationFrame(() => {
      slide.style.opacity = '1';
      slide.style.transform = 'none';
    });
    label.textContent = `${f.name || 'Frame'} · ${idx + 1}/${frames.length}`;
    prev.disabled = idx === 0;
    next.disabled = idx === frames.length - 1;
  };
  const go = (i, transition, fromLink) => {
    if (i < 0 || i >= frames.length) return;
    if (!fromLink && i !== idx) history.length = 0;
    idx = i;
    render(transition);
  };
  const key = (e) => {
    if (e.key === 'Escape') exit();
    else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') go(idx + 1, 'slide-left');
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(idx - 1, 'slide-right');
    else if (e.key === 'Home') go(0, 'dissolve');
    else if (e.key === 'End') go(frames.length - 1, 'dissolve');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onResize = () => render('none');
  const exit = () => {
    removeEventListener('keydown', key, true);
    removeEventListener('resize', onResize);
    for (const u of urls) URL.revokeObjectURL(u);
    root.remove();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  addEventListener('keydown', key, true);
  addEventListener('resize', onResize);
  try {
    root.requestFullscreen && root.requestFullscreen().catch(() => {});
  } catch {}
  render('dissolve');
  return true;
};
