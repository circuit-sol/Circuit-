(() => {
    'use strict';
    const $ = (s, p = document) => p.querySelector(s);
    const $$ = (s, p = document) => [...p.querySelectorAll(s)];

    const state = { page: 'drop', wallet: false, addr: null, minted: 0, max: 40 };

    // ── Particles ──
    function initParticles() {
        const c = $('#particles'); if (!c) return;
        const ctx = c.getContext('2d');
        let w, h, particles = [];
        function resize() { w = c.width = window.innerWidth; h = c.height = window.innerHeight; }
        resize(); window.addEventListener('resize', resize);
        for (let i = 0; i < 50; i++) {
            particles.push({
                x: Math.random() * w, y: Math.random() * h,
                vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
                r: Math.random() * 1.5 + .5, a: Math.random() * .3 + .05
            });
        }
        function draw() {
            ctx.clearRect(0, 0, w, h);
            particles.forEach(p => {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
                if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255,255,255,${p.a})`; ctx.fill();
            });
            requestAnimationFrame(draw);
        }
        draw();
    }

    // ── Nav Pill ──
    function updatePill() {
        const pill = $('#nav-pill');
        const active = $(`.nav-link.active`);
        if (!pill || !active) return;
        const center = $('#nav-center');
        const cr = center.getBoundingClientRect();
        const ar = active.getBoundingClientRect();
        pill.style.left = (ar.left - cr.left) + 'px';
        pill.style.width = ar.width + 'px';
    }

    // ── Router ──
    function pageFromHash() {
        const h = location.hash.replace('#/', '').replace('#', '');
        return ['confirm', 'garment'].includes(h) ? h : 'drop';
    }

    function navigate(page) {
        if (page === state.page) return;
        const prev = $(`#page-${state.page}`);
        const next = $(`#page-${page}`);
        if (!prev || !next) return;
        prev.classList.remove('visible');
        setTimeout(() => {
            prev.classList.remove('active');
            next.classList.add('active');
            void next.offsetWidth;
            next.classList.add('visible');
            state.page = page;
            setNavActive();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 280);
    }

    function setNavActive() {
        $$('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === state.page));
        $$('.drawer-link').forEach(l => l.classList.toggle('active', l.dataset.page === state.page));
        setTimeout(updatePill, 50);
    }

    // ── Wallet ──
    function connectWallet() {
        if (state.wallet) return;
        state.wallet = true;
        state.addr = genAddr();
        const short = state.addr.slice(0, 4) + '...' + state.addr.slice(-4);
        $$('.btn-wallet').forEach(b => {
            b.classList.add('connected');
            const label = $('span:last-child', b) || $('span', b);
            if (label) label.textContent = short;
        });
        toast('✓', 'Wallet connected: ' + short);
    }

    function genAddr() {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
        let a = ''; for (let i = 0; i < 44; i++) a += c[Math.floor(Math.random() * c.length)];
        return a;
    }

    function genTx() {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
        let s = ''; for (let i = 0; i < 88; i++) s += c[Math.floor(Math.random() * c.length)];
        return s;
    }

    // ── Confirm Order ──
    function handleOrder() {
        if (!state.wallet) { toast('⚠', 'Connect your wallet first'); return; }
        const btn = $('#btn-order');
        const tx = $('#drop-tx');
        btn.disabled = true;
        const txt = $('.bp-text', btn); if (txt) txt.textContent = 'Signing...';
        setTimeout(() => {
            const sig = genTx();
            const url = `https://solscan.io/tx/${sig}?cluster=devnet`;
            tx.innerHTML = `<div class="tx-msg ok">✓ Order confirmed. Payment locked in escrow. <a href="${url}" target="_blank">View on Solscan ↗</a></div>
                <button class="btn-primary btn-next" id="btn-goto-confirm"><span class="bp-text">Go to Delivery Confirmation</span><span class="bp-arrow"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span></button>`;
            if (txt) txt.textContent = 'Order Confirmed';
            toast('✓', 'Escrow created on Solana Devnet');
            state.minted = Math.min(state.minted + 1, state.max);
            updateProgress();
            const gotoBtn = $('#btn-goto-confirm');
            if (gotoBtn) gotoBtn.addEventListener('click', () => {
                location.hash = '/confirm'; navigate('confirm');
            });
        }, 2000);
    }

    // ── Confirm Delivery ──
    function handleDeliver() {
        if (!state.wallet) { toast('⚠', 'Connect your wallet first'); return; }
        const btn = $('#btn-deliver');
        const tx = $('#confirm-tx');
        btn.disabled = true;
        const txt = $('.bp-text', btn); if (txt) txt.textContent = 'Signing...';
        setTimeout(() => {
            const sig = genTx();
            const url = `https://solscan.io/tx/${sig}?cluster=devnet`;
            tx.innerHTML = `<div class="tx-msg ok">✓ Delivery confirmed. Payment released to designer. <a href="${url}" target="_blank">View on Solscan ↗</a></div>
                <button class="btn-primary btn-next" id="btn-goto-passport"><span class="bp-text">View Digital Passport</span><span class="bp-arrow"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span></button>`;
            if (txt) txt.textContent = 'Delivery Confirmed';
            toast('✓', 'Funds released from escrow');
            const gotoBtn = $('#btn-goto-passport');
            if (gotoBtn) gotoBtn.addEventListener('click', () => {
                location.hash = '/garment'; navigate('garment');
            });
        }, 2000);
    }

    // ── Progress ──
    function updateProgress() {
        const fill = $('#mint-fill');
        const count = $('#minted-count');
        const status = $('#mint-status');
        if (!fill) return;
        const pct = (state.minted / state.max) * 100;
        fill.style.width = pct + '%';
        if (count) count.textContent = state.minted;
        if (status && state.minted >= state.max) {
            status.textContent = 'Sold Out';
            status.classList.add('sold-out');
        }
    }

    // ── Toast ──
    let tt = null;
    function toast(icon, msg) {
        const el = $('#toast');
        if (!el) return;
        if (tt) clearTimeout(tt);
        $('#toast-icon').textContent = icon;
        $('#toast-text').textContent = msg;
        el.classList.add('show');
        tt = setTimeout(() => el.classList.remove('show'), 3500);
    }

    // ── Mobile ──
    function toggleDrawer() {
        const h = $('#hamburger'), d = $('#drawer');
        h.classList.toggle('open');
        d.classList.toggle('open');
        document.body.classList.toggle('drawer-open', d.classList.contains('open'));
    }
    function closeDrawer() {
        const h = $('#hamburger'), d = $('#drawer');
        if (h) h.classList.remove('open');
        if (d) d.classList.remove('open');
        document.body.classList.remove('drawer-open');
    }

    // ── Scroll ──
    function onScroll() {
        const nav = $('#navbar');
        if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
    }

    // ── Init ──
    function init() {
        initParticles();

        // Initial page
        state.page = pageFromHash();
        $$('.page').forEach(p => p.classList.remove('active', 'visible'));
        const ap = $(`#page-${state.page}`);
        if (ap) {
            ap.classList.add('active');
            requestAnimationFrame(() => requestAnimationFrame(() => ap.classList.add('visible')));
        }
        setNavActive();
        setTimeout(updatePill, 100);

        // Progress animation
        state.minted = 36;
        setTimeout(updateProgress, 600);

        // Update owner on passport if wallet connected
        window.addEventListener('hashchange', () => navigate(pageFromHash()));

        // Nav links
        $$('.nav-link, .drawer-link').forEach(l => {
            l.addEventListener('click', e => {
                e.preventDefault();
                const p = l.dataset.page;
                location.hash = p === 'drop' ? '/' : '/' + p;
                navigate(p);
                closeDrawer();
            });
        });

        // Brand
        const brand = $('#nav-brand');
        if (brand) brand.addEventListener('click', e => {
            e.preventDefault(); location.hash = '/'; navigate('drop');
        });

        // Wallet buttons
        $$('#btn-wallet, #btn-wallet-m').forEach(b => b.addEventListener('click', connectWallet));

        // Action buttons
        const ob = $('#btn-order'); if (ob) ob.addEventListener('click', handleOrder);
        const db = $('#btn-deliver'); if (db) db.addEventListener('click', handleDeliver);

        // Hamburger
        const hm = $('#hamburger'); if (hm) hm.addEventListener('click', toggleDrawer);

        // Scroll
        window.addEventListener('scroll', onScroll, { passive: true });

        // Resize: close drawer, update pill
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) closeDrawer();
            updatePill();
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
