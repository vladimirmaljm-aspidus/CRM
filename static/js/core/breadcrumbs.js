/* =========================================================================
 *  ASPIDUS — BREADCRUMBS (V23.1 #8)
 * =========================================================================
 *  Dinamicka klikabilna putanja koja pokazuje "gde si u aplikaciji".
 *
 *  API:
 *    window.setBreadcrumbs([{ label:'Partners', href:'#partners' }, {label:'Vectra'}])
 *    window.pushBreadcrumb({label, href})              // dodaj krajnji
 *    window.popBreadcrumb()                            // obrisi krajnji
 *    window.mountBreadcrumbs(containerId = 'breadcrumbs-mount')
 *
 *  Svaki modul (dashboard, partners, deals, ...) na startu poziva
 *  setBreadcrumbs([...]) i biblioteka renderuje redu.
 *
 *  Prvi item je uvek klikabilan (vraca na dashboard: href='#dashboard').
 *  Poslednji item je NEKLIKABILAN (trenutna stranica). Sredji su linkovi.
 * ========================================================================= */

(function () {
    'use strict';
    if (window.breadcrumbsInitialized) return;
    window.breadcrumbsInitialized = true;

    let _crumbs = [{ label: 'Dashboard', href: '#dashboard', icon: '🏠' }];
    let _mount = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function render() {
        if (!_mount) _mount = document.getElementById('breadcrumbs-mount');
        if (!_mount) return;
        const parts = _crumbs.map((c, i) => {
            const isLast = i === _crumbs.length - 1;
            const iconHtml = c.icon ? `<span class="text-xs mr-1">${esc(c.icon)}</span>` : '';
            if (isLast) {
                return `<span class="text-slate-800 font-semibold flex items-center">${iconHtml}${esc(c.label)}</span>`;
            }
            if (c.href) {
                return `<a href="${esc(c.href)}" class="text-slate-500 hover:text-indigo-600 transition flex items-center">${iconHtml}${esc(c.label)}</a>`;
            }
            if (c.onclick) {
                return `<a href="javascript:void(0)" data-bc-idx="${i}" class="text-slate-500 hover:text-indigo-600 transition flex items-center">${iconHtml}${esc(c.label)}</a>`;
            }
            return `<span class="text-slate-500 flex items-center">${iconHtml}${esc(c.label)}</span>`;
        });
        const sep = '<span class="text-slate-300 mx-1.5">›</span>';
        _mount.innerHTML = `<nav aria-label="Breadcrumbs" class="flex items-center flex-wrap text-xs py-1.5">${parts.join(sep)}</nav>`;
        _mount.querySelectorAll('[data-bc-idx]').forEach(a => {
            a.addEventListener('click', () => {
                const idx = parseInt(a.dataset.bcIdx, 10);
                const c = _crumbs[idx];
                if (c && typeof c.onclick === 'function') c.onclick();
            });
        });
    }

    window.setBreadcrumbs = function (crumbs) {
        if (!Array.isArray(crumbs)) return;
        // Uvek zapocinji sa Dashboard (osim ako prvi vec ima href='#dashboard')
        const first = crumbs[0];
        if (!first || first.href !== '#dashboard') {
            _crumbs = [{ label: 'Dashboard', href: '#dashboard', icon: '🏠' }, ...crumbs];
        } else {
            _crumbs = crumbs.slice();
        }
        render();
    };

    window.pushBreadcrumb = function (c) {
        _crumbs.push(c);
        render();
    };

    window.popBreadcrumb = function () {
        if (_crumbs.length > 1) _crumbs.pop();
        render();
    };

    window.mountBreadcrumbs = function (containerId) {
        _mount = document.getElementById(containerId || 'breadcrumbs-mount');
        render();
    };

    // Slusa route promene (hash-based) i resetuje na "Dashboard" ako nijedan
    // modul jos nije postavio breadcrumbs za novu rutu.
    window.addEventListener('hashchange', () => {
        // Odloži da modul ima priliku da postavi svoje
        setTimeout(() => {
            if (_crumbs.length === 1) render();
        }, 100);
    });

    // Auto-mount ako je container prisutan
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.mountBreadcrumbs());
    } else {
        window.mountBreadcrumbs();
    }
})();
