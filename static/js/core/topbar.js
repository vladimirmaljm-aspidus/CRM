/* =========================================================================
 *  ASPIDUS — TOP BAR (V23.1 #2)
 * =========================================================================
 *  Horizontalni bar koji sedi iznad sadrzaja i drzi:
 *    - Global search dugme (otvara Cmd+K palettu)
 *    - Breadcrumbs mount (levo)
 *    - Notifications ikonu (bell)
 *    - Quick actions (New offer, New deal, itd — po permisiji)
 *    - Preferences (settings dropdown → Profile / Security / Preferences / Sign out)
 *
 *  Sam sebe montira u element sa id="topbar-mount". Ako ga nema,
 *  auto-injektuje pre body-first-child-a.
 * ========================================================================= */

(function () {
    'use strict';
    if (window.topbarMounted) return;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function build() {
        const user = (window.state && window.state.user) || {};
        const initial = (user.username || '?').charAt(0).toUpperCase();
        // V23.1: TOP BAR — samo hamburger (mobile), breadcrumbs, user menu.
        // Namerno BEZ duplirane notification bell ikonice (postoji već u sidebar
        // header-u kroz checkAllNotifications) i BEZ "+ New offer" (Quick Actions
        // u sidebar-u služe za to). Global Search se dostiže preko ⌘K prečice
        // kojoj se ne treba dugme u topbar-u — cmdk.js ga hvata globalno.
        //
        // User menu drži sve LIČNE stranice (Security, Preferences, Register).
        // Admin-only linkovi su u sidebar-u pod "System" grupom da ih ne
        // dupliramo u topbar-u i sidebar-u istovremeno.
        const html = `
        <div id="topbar" class="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-2 flex items-center gap-3">
            <button id="tb-hamburger" title="Menu" class="lg:hidden p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 -ml-2" aria-label="Toggle sidebar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            <div id="breadcrumbs-mount" class="flex-shrink min-w-0 flex-1"></div>

            <div class="relative">
                <button id="tb-menu-btn" class="flex items-center gap-2 hover:bg-slate-100 rounded-lg px-2 py-1" aria-label="User menu">
                    <div class="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold">${esc(initial)}</div>
                    <span class="text-xs text-slate-600 hidden sm:inline">${esc(user.username || 'Guest')}</span>
                </button>
                <div id="tb-menu" class="hidden absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                    <a href="/profile/security" class="block px-3 py-2 text-sm hover:bg-slate-50 text-slate-700">🔐 Security Center</a>
                    <button onclick="if(window.openPreferences)openPreferences()" class="w-full text-left block px-3 py-2 text-sm hover:bg-slate-50 text-slate-700">⚙ Preferences</button>
                    <a href="/documents/register" class="block px-3 py-2 text-sm hover:bg-slate-50 text-slate-700">📚 Document Register</a>
                    <div class="border-t border-slate-100 my-1"></div>
                    <button onclick="if(window.logout)logout()" class="w-full text-left block px-3 py-2 text-sm hover:bg-red-50 text-red-600">→ Sign out</button>
                </div>
            </div>
        </div>
        `;
        let mount = document.getElementById('topbar-mount');
        if (!mount) {
            mount = document.createElement('div');
            mount.id = 'topbar-mount';
            document.body.insertBefore(mount, document.body.firstChild);
        }
        mount.innerHTML = html;

        // Wire hamburger — off-canvas toggle on mobile
        document.getElementById('tb-hamburger')?.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-mobile-open');
        });
        // Klik na overlay zatvara sidebar
        document.body.addEventListener('click', (e) => {
            if (document.body.classList.contains('sidebar-mobile-open')) {
                const sb = document.getElementById('app-sidebar');
                if (sb && !sb.contains(e.target) && e.target.id !== 'tb-hamburger'
                    && !(e.target.closest && e.target.closest('#tb-hamburger'))) {
                    document.body.classList.remove('sidebar-mobile-open');
                }
            }
        });

        // Wire user menu (svi ostali linkovi žive u sidebar-u ili direktno u meniju)
        const menuBtn = document.getElementById('tb-menu-btn');
        const menu = document.getElementById('tb-menu');
        menuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (menu && !menu.contains(e.target) && e.target !== menuBtn) menu.classList.add('hidden');
        });

        // Mount breadcrumbs
        if (window.mountBreadcrumbs) window.mountBreadcrumbs('breadcrumbs-mount');

        window.topbarMounted = true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }

    // Ekspoze API za re-render (npr. posle logina, kad se state.user promeni)
    window.rebuildTopbar = () => { window.topbarMounted = false; build(); };
})();
