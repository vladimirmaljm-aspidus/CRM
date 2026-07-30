/* =========================================================================
 *  ASPIDUS PORTAL — SESSION HEARTBEAT + AUTO-REFRESH
 * =========================================================================
 *  Nezavisno od /static/js/core/session_heartbeat.js koji je za CRM.
 *  Portal koristi drukciji session model (auth_key + portal_token) pa mu
 *  treba svoj endpoint (/api/portal/heartbeat/<token>).
 *
 *  Cilj: klijent NIKAD ne izgubi pola ispunjene KYC forme zato sto je tiho
 *  istekla portal sesija. Pre isteka dobija warning modal sa produzenjem.
 * ========================================================================= */

(function() {
    'use strict';

    const HEARTBEAT_MS = 60 * 1000;   // proveri svaki 1 min
    const WARN_BEFORE_SEC = 90;        // upozori 90s pre isteka
    let warningShown = false;
    let lastActive = Date.now();

    // Osvezi lastActive na svaki user event → sto duze aktivnost, duze sesija
    ['click','keydown','scroll','mousemove','touchstart','input'].forEach(evt =>
        window.addEventListener(evt, () => { lastActive = Date.now(); }, { passive: true })
    );

    function getPortalContext() {
        // portal_token iz URL-a — /portal/<token>
        const parts = window.location.pathname.split('/').filter(Boolean);
        const token = parts[parts.length - 1] || '';
        const authKey = sessionStorage.getItem('portal_auth_' + token) || '';
        return { token, authKey };
    }

    async function ping() {
        const { token, authKey } = getPortalContext();
        if (!token || !authKey) return null;
        try {
            const r = await fetch(`/api/portal/heartbeat/${encodeURIComponent(token)}`, {
                headers: { 'X-Portal-Auth': authKey },
                credentials: 'same-origin',
            });
            if (r.status === 401) {
                // sesija je vec pala — pozvi login
                clearSessionAndRedirect();
                return null;
            }
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    }

    function clearSessionAndRedirect() {
        const { token } = getPortalContext();
        try { sessionStorage.removeItem('portal_auth_' + token); } catch(_) {}
        // Vraca korisnika na /portal/login umesto da mu prikaze slomljen ekran
        window.location.href = '/portal/login';
    }

    function showExpiryWarning(secondsLeft) {
        if (warningShown) return;
        warningShown = true;

        const overlay = document.createElement('div');
        overlay.id = 'portal-sess-warn';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.innerHTML = `
          <div style="background:white;border-radius:16px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(15,23,42,.35);overflow:hidden;font-family:inherit;">
            <div style="padding:22px;">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:22px;">&#9202;</div>
                <div>
                  <div style="font-size:17px;font-weight:700;color:#0f172a;">Session expiring</div>
                  <div style="font-size:12px;color:#64748b;margin-top:2px;">Signing you out in <b id="portal-sess-cnt">${secondsLeft}s</b></div>
                </div>
              </div>
              <p style="font-size:13px;color:#475569;line-height:1.55;margin:0 0 16px;">
                Your session is about to expire due to inactivity. Click <b>Stay signed in</b>
                to keep working, or <b>Sign out</b> to end now. Unsubmitted forms may be lost
                if the session ends.
              </p>
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="portal-sess-out" style="padding:9px 14px;border-radius:10px;background:white;color:#334155;border:1px solid #e5e7eb;font-weight:500;font-size:13px;cursor:pointer;">Sign out</button>
                <button id="portal-sess-stay" style="padding:9px 18px;border-radius:10px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;font-weight:600;font-size:13px;cursor:pointer;">Stay signed in</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        let cnt = secondsLeft;
        const cntEl = document.getElementById('portal-sess-cnt');
        const timer = setInterval(() => {
            cnt--;
            if (cntEl) cntEl.textContent = cnt + 's';
            if (cnt <= 0) { clearInterval(timer); clearSessionAndRedirect(); }
        }, 1000);

        document.getElementById('portal-sess-stay').onclick = async () => {
            clearInterval(timer);
            overlay.remove();
            warningShown = false;
            lastActive = Date.now();
            await ping(); // resetuje last_active na serveru
        };
        document.getElementById('portal-sess-out').onclick = () => {
            clearInterval(timer);
            clearSessionAndRedirect();
        };
    }

    async function tick() {
        const info = await ping();
        if (!info) return;
        const remaining = Number(info.remaining_seconds || 0);
        if (remaining > 0 && remaining <= WARN_BEFORE_SEC) {
            showExpiryWarning(remaining);
        } else if (remaining > WARN_BEFORE_SEC && warningShown) {
            const el = document.getElementById('portal-sess-warn');
            if (el) el.remove();
            warningShown = false;
        }
    }

    function start() {
        // Ne pokreci ako klijent jos nije prosao login (nema auth_key)
        const { token, authKey } = getPortalContext();
        if (!token || !authKey) return;
        // Prvi tick za par sekundi da UI stigne da se ucita
        setTimeout(tick, 3000);
        setInterval(tick, HEARTBEAT_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
