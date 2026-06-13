/**
 * AutoSEO v1.0 — Auto SEO Engine for Meal Planning App
 *
 * Drop-in SEO automation. Add to any page:
 *   <script src="seo/seo.js" defer></script>
 *
 * What it does automatically:
 *  - Runs 15+ SEO checks (title, meta, headings, OG, structured data, etc.)
 *  - Auto-injects missing charset, viewport, and meta description
 *  - Calculates a weighted SEO score (0–100)
 *  - Shows a floating score widget (click to expand full report)
 *  - Exports a JSON report on demand
 *  - Logs issues to the browser console
 */
(function (window, document) {
    'use strict';

    const AutoSEO = {
        version: '1.0.0',
        checks: [],
        score: 0,

        config: {
            siteUrl: window.location.origin,
            showWidget: true,
            autoFix: true,
            minDescLen: 120,
            maxDescLen: 160,
            minTitleLen: 30,
            maxTitleLen: 60,
        },

        init(config) {
            if (config) Object.assign(this.config, config);
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.run());
            } else {
                this.run();
            }
        },

        run() {
            this.checks = [];
            this._runChecks();
            this.score = this._calcScore();
            if (this.config.autoFix) this._autoFix();
            if (this.config.showWidget) this._renderWidget();
            this._logReport();
        },

        // ── Internal helpers ────────────────────────────────────────────────

        _add(id, category, weight, status, title, detail, rec) {
            this.checks.push({ id, category, weight, status, title, detail, rec: rec || '' });
        },

        _meta(name) {
            const el = document.querySelector(`meta[name="${name}"]`) ||
                       document.querySelector(`meta[property="${name}"]`);
            return el ? (el.getAttribute('content') || '') : null;
        },

        _link(rel) {
            const el = document.querySelector(`link[rel="${rel}"]`);
            return el ? (el.getAttribute('href') || '') : null;
        },

        // ── SEO Checks ──────────────────────────────────────────────────────

        _runChecks() {
            this._chkTitle();
            this._chkDescription();
            this._chkH1();
            this._chkHeadingOrder();
            this._chkCanonical();
            this._chkViewport();
            this._chkLang();
            this._chkCharset();
            this._chkOpenGraph();
            this._chkTwitterCard();
            this._chkStructuredData();
            this._chkImages();
            this._chkRobotsMeta();
            this._chkRenderBlocking();
            this._chkHttps();
            this._chkLinks();
        },

        _chkTitle() {
            const t = document.title ? document.title.trim() : '';
            if (!t) {
                this._add('title', 'On-Page', 20, 'fail', 'Title Tag',
                    'Missing <title> tag.',
                    'Add a <title> with 30–60 characters containing your primary keyword.');
            } else if (t.length < this.config.minTitleLen) {
                this._add('title', 'On-Page', 20, 'warn', 'Title Tag',
                    `Title too short (${t.length} chars): "${t}"`,
                    `Expand to ${this.config.minTitleLen}–${this.config.maxTitleLen} chars.`);
            } else if (t.length > this.config.maxTitleLen) {
                this._add('title', 'On-Page', 20, 'warn', 'Title Tag',
                    `Title too long (${t.length} chars) — may be truncated in SERPs: "${t.substring(0, 60)}..."`,
                    `Trim to under ${this.config.maxTitleLen} characters.`);
            } else {
                this._add('title', 'On-Page', 20, 'pass', 'Title Tag',
                    `Good length (${t.length} chars): "${t}"`);
            }
        },

        _chkDescription() {
            const d = this._meta('description');
            if (d === null) {
                this._add('meta-desc', 'On-Page', 15, 'fail', 'Meta Description',
                    'No meta description found.',
                    `Add <meta name="description" content="..."> with ${this.config.minDescLen}–${this.config.maxDescLen} characters.`);
            } else if (!d.trim()) {
                this._add('meta-desc', 'On-Page', 15, 'fail', 'Meta Description',
                    'Meta description is empty.',
                    'Write a compelling description of 120–160 characters.');
            } else if (d.length < this.config.minDescLen) {
                this._add('meta-desc', 'On-Page', 15, 'warn', 'Meta Description',
                    `Too short (${d.length} chars): "${d}"`,
                    `Aim for ${this.config.minDescLen}–${this.config.maxDescLen} chars to improve click-through rate.`);
            } else if (d.length > this.config.maxDescLen) {
                this._add('meta-desc', 'On-Page', 15, 'warn', 'Meta Description',
                    `Too long (${d.length} chars) — Google may truncate it.`,
                    `Keep under ${this.config.maxDescLen} characters.`);
            } else {
                this._add('meta-desc', 'On-Page', 15, 'pass', 'Meta Description',
                    `Good length (${d.length} chars).`);
            }
        },

        _chkH1() {
            const h1s = document.querySelectorAll('h1');
            if (!h1s.length) {
                this._add('h1', 'On-Page', 15, 'fail', 'H1 Heading',
                    'No H1 heading found.',
                    'Add one <h1> tag containing the primary keyword for this page.');
            } else if (h1s.length > 1) {
                this._add('h1', 'On-Page', 15, 'warn', 'H1 Heading',
                    `${h1s.length} H1 headings found — best practice is exactly one.`,
                    'Consolidate to a single <h1>; use <h2>–<h6> for sub-sections.');
            } else {
                this._add('h1', 'On-Page', 15, 'pass', 'H1 Heading',
                    `H1: "${h1s[0].textContent.trim()}"`);
            }
        },

        _chkHeadingOrder() {
            const h2 = document.querySelectorAll('h2').length;
            const h3 = document.querySelectorAll('h3').length;
            if (h3 > 0 && h2 === 0) {
                this._add('heading-order', 'On-Page', 5, 'warn', 'Heading Hierarchy',
                    'H3 headings present but no H2 — skipped a level.',
                    'Maintain logical heading order: H1 → H2 → H3.');
            } else {
                this._add('heading-order', 'On-Page', 5, 'pass', 'Heading Hierarchy',
                    `Heading structure: H1(${document.querySelectorAll('h1').length}) H2(${h2}) H3(${h3})`);
            }
        },

        _chkCanonical() {
            const c = this._link('canonical');
            if (!c) {
                this._add('canonical', 'Technical', 10, 'warn', 'Canonical URL',
                    'No canonical URL declared.',
                    'Add <link rel="canonical" href="https://yourdomain.com/page/"> to prevent duplicate-content issues.');
            } else if (!c.startsWith('http')) {
                this._add('canonical', 'Technical', 10, 'warn', 'Canonical URL',
                    `Canonical uses a relative URL: "${c}"`,
                    'Use an absolute URL for canonical tags.');
            } else {
                this._add('canonical', 'Technical', 10, 'pass', 'Canonical URL',
                    `Canonical: ${c}`);
            }
        },

        _chkViewport() {
            const v = this._meta('viewport');
            if (!v) {
                this._add('viewport', 'Technical', 10, 'fail', 'Viewport Meta',
                    'Missing viewport meta — page may not be mobile-friendly.',
                    'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">');
            } else if (!v.includes('width=device-width')) {
                this._add('viewport', 'Technical', 10, 'warn', 'Viewport Meta',
                    `Viewport set but missing "width=device-width": "${v}"`,
                    'Use content="width=device-width, initial-scale=1.0"');
            } else {
                this._add('viewport', 'Technical', 10, 'pass', 'Viewport Meta',
                    'Mobile-friendly viewport configured.');
            }
        },

        _chkLang() {
            const lang = document.documentElement.getAttribute('lang');
            if (!lang) {
                this._add('lang', 'Technical', 5, 'warn', 'Language Attribute',
                    'Missing lang attribute on <html>.',
                    'Add lang="en" (or your language code) to the <html> element.');
            } else {
                this._add('lang', 'Technical', 5, 'pass', 'Language Attribute',
                    `Language: "${lang}"`);
            }
        },

        _chkCharset() {
            const cs = document.querySelector('meta[charset]') ||
                       document.querySelector('meta[http-equiv="Content-Type"]');
            if (!cs) {
                this._add('charset', 'Technical', 5, 'warn', 'Character Encoding',
                    'No charset declaration found.',
                    'Add <meta charset="UTF-8"> as the first tag inside <head>.');
            } else {
                this._add('charset', 'Technical', 5, 'pass', 'Character Encoding',
                    'Character encoding declared.');
            }
        },

        _chkOpenGraph() {
            const required = ['og:title', 'og:description', 'og:image', 'og:url'];
            const present = required.filter(p => this._meta(p) !== null);
            if (!present.length) {
                this._add('og', 'Social', 10, 'fail', 'Open Graph Tags',
                    'No Open Graph meta tags found.',
                    'Add og:title, og:description, og:image, og:url for rich social-media previews.');
            } else if (present.length < required.length) {
                const missing = required.filter(p => this._meta(p) === null);
                this._add('og', 'Social', 10, 'warn', 'Open Graph Tags',
                    `Missing: ${missing.join(', ')}`,
                    'Add all four core OG tags for complete social previews.');
            } else {
                this._add('og', 'Social', 10, 'pass', 'Open Graph Tags',
                    'All core Open Graph tags present.');
            }
        },

        _chkTwitterCard() {
            const card = this._meta('twitter:card');
            if (!card) {
                this._add('twitter', 'Social', 5, 'warn', 'Twitter Card',
                    'No Twitter Card meta tags found.',
                    'Add <meta name="twitter:card" content="summary_large_image"> plus twitter:title and twitter:description.');
            } else {
                this._add('twitter', 'Social', 5, 'pass', 'Twitter Card',
                    `Card type: "${card}"`);
            }
        },

        _chkStructuredData() {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            if (!scripts.length) {
                this._add('schema', 'Technical', 10, 'warn', 'Structured Data (JSON-LD)',
                    'No JSON-LD structured data found.',
                    'Add JSON-LD schema markup to help search engines understand your content type.');
                return;
            }
            let invalid = 0;
            scripts.forEach(s => { try { JSON.parse(s.textContent); } catch(e) { invalid++; } });
            if (invalid) {
                this._add('schema', 'Technical', 10, 'warn', 'Structured Data (JSON-LD)',
                    `${invalid} of ${scripts.length} JSON-LD block(s) contain syntax errors.`,
                    'Validate your JSON-LD at schema.org/validator.');
            } else {
                this._add('schema', 'Technical', 10, 'pass', 'Structured Data (JSON-LD)',
                    `${scripts.length} valid JSON-LD block(s) found.`);
            }
        },

        _chkImages() {
            const imgs = document.querySelectorAll('img');
            if (!imgs.length) {
                this._add('img-alt', 'On-Page', 5, 'pass', 'Image Alt Text', 'No images on this page.');
                return;
            }
            const missing = Array.from(imgs).filter(i => i.getAttribute('alt') === null);
            if (missing.length) {
                this._add('img-alt', 'On-Page', 5, 'fail', 'Image Alt Text',
                    `${missing.length} of ${imgs.length} images missing alt attribute.`,
                    'Add descriptive alt text to every meaningful image for SEO and accessibility.');
            } else {
                this._add('img-alt', 'On-Page', 5, 'pass', 'Image Alt Text',
                    `All ${imgs.length} images have alt attributes.`);
            }
        },

        _chkRobotsMeta() {
            const r = this._meta('robots');
            if (!r) {
                this._add('robots', 'Technical', 5, 'warn', 'Robots Meta',
                    'No robots meta tag — defaults to index/follow.',
                    'Explicitly set <meta name="robots" content="index, follow"> for clarity.');
            } else if (r.includes('noindex')) {
                this._add('robots', 'Technical', 5, 'fail', 'Robots Meta',
                    `Page is set to NOINDEX: "${r}"`,
                    'Remove noindex unless you intentionally want to exclude this page from search engines.');
            } else {
                this._add('robots', 'Technical', 5, 'pass', 'Robots Meta',
                    `Robots directive: "${r}"`);
            }
        },

        _chkRenderBlocking() {
            const blocking = Array.from(
                document.querySelectorAll('head script:not([defer]):not([async]):not([type])')
            ).filter(s => s.src);
            if (blocking.length) {
                this._add('render-blocking', 'Performance', 5, 'warn', 'Render-Blocking Scripts',
                    `${blocking.length} render-blocking <script> tag(s) in <head>.`,
                    'Add defer or async to scripts in <head> to improve First Contentful Paint.');
            } else {
                this._add('render-blocking', 'Performance', 5, 'pass', 'Render-Blocking Scripts',
                    'No render-blocking scripts found in <head>.');
            }
        },

        _chkHttps() {
            const proto = window.location.protocol;
            const host = window.location.hostname;
            if (proto === 'https:' || host === 'localhost' || host === '127.0.0.1' || proto === 'file:') {
                this._add('https', 'Technical', 5, 'pass', 'HTTPS / Secure',
                    proto === 'https:' ? 'Page served over HTTPS.' : 'Local environment — HTTPS not required.');
            } else {
                this._add('https', 'Technical', 5, 'fail', 'HTTPS / Secure',
                    'Page served over HTTP.',
                    "Enable HTTPS — it's a confirmed Google ranking signal.");
            }
        },

        _chkLinks() {
            const all = document.querySelectorAll('a[href]');
            const emptyText = Array.from(all).filter(a =>
                !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]')
            );
            if (emptyText.length) {
                this._add('links', 'On-Page', 5, 'warn', 'Link Anchor Text',
                    `${emptyText.length} link(s) have no descriptive text or aria-label.`,
                    'Add descriptive anchor text or aria-label to all links for SEO and accessibility.');
            } else {
                this._add('links', 'On-Page', 5, 'pass', 'Link Anchor Text',
                    `${all.length} link(s) — all have descriptive text.`);
            }
        },

        // ── Scoring ─────────────────────────────────────────────────────────

        _calcScore() {
            let total = 0, earned = 0;
            this.checks.forEach(c => {
                total += c.weight;
                if (c.status === 'pass') earned += c.weight;
                else if (c.status === 'warn') earned += c.weight * 0.5;
            });
            return total ? Math.round((earned / total) * 100) : 0;
        },

        // ── Auto-Fix ────────────────────────────────────────────────────────

        _autoFix() {
            this._fixCharset();
            this._fixViewport();
            this._fixLang();
            this._fixDescription();
        },

        _inject(attrs) {
            const m = document.createElement('meta');
            Object.entries(attrs).forEach(([k, v]) => m.setAttribute(k, v));
            const first = document.head.firstChild;
            document.head.insertBefore(m, first);
        },

        _fixCharset() {
            if (!document.querySelector('meta[charset]')) {
                const m = document.createElement('meta');
                m.setAttribute('charset', 'UTF-8');
                document.head.insertBefore(m, document.head.firstChild);
            }
        },

        _fixViewport() {
            if (this._meta('viewport') === null) {
                this._inject({ name: 'viewport', content: 'width=device-width, initial-scale=1.0' });
            }
        },

        _fixLang() {
            if (!document.documentElement.getAttribute('lang')) {
                document.documentElement.setAttribute('lang', 'en');
            }
        },

        _fixDescription() {
            if (this._meta('description') !== null) return;
            const h1 = document.querySelector('h1');
            let text = h1 ? h1.textContent.trim() : '';
            document.querySelectorAll('p').forEach(p => {
                if (text.length >= this.config.minDescLen) return;
                const t = p.textContent.trim();
                if (t.length > 40) text += (text ? ' — ' : '') + t;
            });
            if (text.length > this.config.maxDescLen) {
                text = text.substring(0, this.config.maxDescLen - 3) + '...';
            }
            if (text) this._inject({ name: 'description', content: text });
        },

        // ── Widget ──────────────────────────────────────────────────────────

        _renderWidget() {
            if (document.getElementById('autoseo-widget')) return;

            const score = this.score;
            const color = score >= 80 ? '#2e7d32' : score >= 50 ? '#f57c00' : '#c62828';
            const fails = this.checks.filter(c => c.status === 'fail').length;
            const warns = this.checks.filter(c => c.status === 'warn').length;
            const passes = this.checks.filter(c => c.status === 'pass').length;

            const el = document.createElement('div');
            el.id = 'autoseo-widget';
            el.innerHTML = `<style>
#autoseo-widget{position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:14px;}
#aseo-badge{background:#fff;border-radius:50px;box-shadow:0 4px 20px rgba(0,0,0,.15);padding:8px 16px 8px 8px;display:flex;align-items:center;gap:10px;cursor:pointer;border:2px solid ${color};user-select:none;transition:box-shadow .2s;}
#aseo-badge:hover{box-shadow:0 6px 26px rgba(0,0,0,.22);}
#aseo-circle{width:40px;height:40px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;}
#aseo-badge-label{font-weight:600;color:#333;line-height:1.4;}
#aseo-badge-sub{font-size:11px;font-weight:400;color:#888;}
#aseo-panel{position:fixed;bottom:78px;right:20px;width:min(430px,calc(100vw - 40px));max-height:72vh;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;border:1px solid #e0e0e0;overflow:hidden;}
#aseo-panel.open{display:flex;}
#aseo-ph{background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:8px;}
#aseo-ph h3{margin:0;font-size:15px;}
#aseo-ph-sub{font-size:11px;opacity:.8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}
#aseo-ph-score{font-size:30px;font-weight:700;white-space:nowrap;}
#aseo-ph-score span{font-size:14px;}
#aseo-close{background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
#aseo-close:hover{background:rgba(255,255,255,.3);}
#aseo-body{overflow-y:auto;padding:14px;flex:1;}
.aseo-summary{display:flex;gap:8px;margin-bottom:14px;}
.aseo-sum-item{flex:1;padding:10px 6px;border-radius:10px;text-align:center;font-size:11px;font-weight:600;}
.aseo-sum-item .n{font-size:22px;font-weight:700;display:block;}
.aseo-p-bg{background:#e8f5e9;color:#2e7d32;}
.aseo-w-bg{background:#fff3e0;color:#e65100;}
.aseo-f-bg{background:#ffebee;color:#c62828;}
.aseo-cat-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;margin:12px 0 6px;}
.aseo-item{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;margin-bottom:3px;border-left:3px solid transparent;}
.aseo-item.pass{background:#f3faf3;border-left-color:#4caf50;}
.aseo-item.warn{background:#fffbf0;border-left-color:#ff9800;}
.aseo-item.fail{background:#fff5f5;border-left-color:#f44336;}
.aseo-icon{font-size:13px;flex-shrink:0;margin-top:1px;}
.aseo-title{font-weight:600;color:#333;font-size:13px;}
.aseo-detail{color:#666;font-size:12px;margin-top:2px;}
.aseo-rec{color:#1565c0;font-size:11px;margin-top:4px;font-style:italic;}
#aseo-foot{padding:10px 14px;border-top:1px solid #f0f0f0;display:flex;gap:8px;}
.aseo-btn{padding:8px 14px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;}
.aseo-btn-g{background:#2e7d32;color:#fff;flex:1;}
.aseo-btn-g:hover{background:#1b5e20;}
.aseo-btn-s{background:#f5f5f5;color:#333;}
.aseo-btn-s:hover{background:#e8e8e8;}
</style>

<div id="aseo-badge" role="button" tabindex="0" aria-label="SEO Score ${score}/100 — click for report">
  <div id="aseo-circle">${score}</div>
  <div id="aseo-badge-label">SEO Score<div id="aseo-badge-sub">${fails} error${fails!==1?'s':''} · ${warns} warning${warns!==1?'s':''}</div></div>
</div>

<div id="aseo-panel" role="dialog" aria-modal="true" aria-label="SEO Audit Report">
  <div id="aseo-ph">
    <div>
      <h3>AutoSEO Report</h3>
      <div id="aseo-ph-sub">${document.title || window.location.pathname}</div>
    </div>
    <div id="aseo-ph-score">${score}<span>/100</span></div>
    <button id="aseo-close" aria-label="Close">×</button>
  </div>

  <div id="aseo-body">
    <div class="aseo-summary">
      <div class="aseo-sum-item aseo-p-bg"><span class="n">${passes}</span>Passed</div>
      <div class="aseo-sum-item aseo-w-bg"><span class="n">${warns}</span>Warnings</div>
      <div class="aseo-sum-item aseo-f-bg"><span class="n">${fails}</span>Errors</div>
    </div>
    ${this._renderCategories()}
  </div>

  <div id="aseo-foot">
    <button class="aseo-btn aseo-btn-g" id="aseo-export">Export JSON Report</button>
    <a href="seo-audit.html" class="aseo-btn aseo-btn-s">Full Audit Tool</a>
  </div>
</div>`;

            document.body.appendChild(el);

            const badge = el.querySelector('#aseo-badge');
            const panel = el.querySelector('#aseo-panel');
            const close = el.querySelector('#aseo-close');

            const toggle = () => panel.classList.toggle('open');
            badge.addEventListener('click', toggle);
            badge.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(); });
            close.addEventListener('click', e => { e.stopPropagation(); panel.classList.remove('open'); });
            el.querySelector('#aseo-export').addEventListener('click', () => this._export());
        },

        _renderCategories() {
            const cats = {};
            this.checks.forEach(c => { (cats[c.category] = cats[c.category] || []).push(c); });
            const icons = { pass: '✓', warn: '⚠', fail: '✗' };
            return Object.entries(cats).map(([cat, items]) => `
<div class="aseo-cat-title">${cat}</div>
${items.map(c => `<div class="aseo-item ${c.status}">
  <span class="aseo-icon">${icons[c.status]}</span>
  <div>
    <div class="aseo-title">${c.title}</div>
    <div class="aseo-detail">${c.detail}</div>
    ${c.rec ? `<div class="aseo-rec">Fix: ${c.rec}</div>` : ''}
  </div>
</div>`).join('')}`).join('');
        },

        // ── Export ──────────────────────────────────────────────────────────

        _export() {
            const report = {
                tool: 'AutoSEO v' + this.version,
                url: window.location.href,
                title: document.title,
                timestamp: new Date().toISOString(),
                score: this.score,
                summary: {
                    passed: this.checks.filter(c => c.status === 'pass').length,
                    warnings: this.checks.filter(c => c.status === 'warn').length,
                    errors: this.checks.filter(c => c.status === 'fail').length
                },
                checks: this.checks
            };
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `seo-report-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        // ── Console logging ─────────────────────────────────────────────────

        _logReport() {
            const s = `background:${this.score>=80?'#2e7d32':this.score>=50?'#f57c00':'#c62828'};color:#fff;padding:2px 8px;border-radius:3px;font-weight:bold;`;
            console.group('%cAutoSEO v' + this.version, s);
            console.log(`Score: ${this.score}/100`);
            const f = this.checks.filter(c => c.status === 'fail').length;
            const w = this.checks.filter(c => c.status === 'warn').length;
            const p = this.checks.filter(c => c.status === 'pass').length;
            console.log(`${p} passed · ${w} warnings · ${f} errors`);
            this.checks.filter(c => c.status !== 'pass').forEach(c => {
                const fn = c.status === 'fail' ? console.error : console.warn;
                fn(`[${c.status.toUpperCase()}] ${c.title}: ${c.detail}`);
                if (c.rec) console.info(`  → Fix: ${c.rec}`);
            });
            console.groupEnd();
        }
    };

    window.AutoSEO = AutoSEO;
    AutoSEO.init();

}(window, document));
