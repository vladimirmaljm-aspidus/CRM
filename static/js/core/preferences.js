/* =========================================================================
 *  ASPIDUS — USER PROFILE & PREFERENCES panel
 * =========================================================================
 * Otvara se kroz avatar/username u sidebaru ili keyboard shortcut Cmd+,
 * Nudi:
 *   • Ime, email, telefon (za trenutnog usera)
 *   • Menjanje lozinke
 *   • Jezik (SR / EN)
 *   • Tema (Auto / Light / Dark)
 *   • Density (Comfortable / Compact)
 *   • Notification preferences
 *   • Personalni potpis + pečat (permission-based)
 *   • Session info (last login, IP, device)
 *
 * Svi ovi se čuvaju u localStorage + PATCH-uju backend za trajno.
 */

(function() {
    'use strict';

    // --- Utility: prefs storage layer ---
    const PREF_KEY = 'aspidus.prefs.v1';
    function getPrefs() {
        try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); }
        catch(_) { return {}; }
    }
    function setPrefs(patch) {
        const cur = getPrefs();
        const next = Object.assign({}, cur, patch);
        localStorage.setItem(PREF_KEY, JSON.stringify(next));
        applyPrefs(next);
        return next;
    }
    function applyPrefs(p) {
        const html = document.documentElement;
        // Theme
        if (p.theme === 'dark') html.setAttribute('data-theme', 'dark');
        else if (p.theme === 'light') html.setAttribute('data-theme', 'light');
        else html.removeAttribute('data-theme'); // auto
        // Density
        html.setAttribute('data-density', p.density || 'comfortable');
        // Language — deferred to i18n system if exists
        if (p.language && typeof window.setLanguage === 'function') {
            try { window.setLanguage(p.language); } catch(_) {}
        }

        // === DISPLAY CUSTOMIZATION (v22.2) ===
        // Sve vrednosti se prosleduju kao CSS custom props na <html> tako
        // da svaki prozor/modal (osim onih sa hardcoded fixed size-ovima)
        // odmah ih preuzme bez reload-a.

        // Font size: 'sm' | 'md' (default) | 'lg' | 'xl'
        const FONT_SIZE_MAP = { sm: '13px', md: '14px', lg: '16px', xl: '18px' };
        const fs = FONT_SIZE_MAP[p.fontSize] || FONT_SIZE_MAP.md;
        html.style.setProperty('--user-font-size', fs);

        // UI zoom (85 / 100 / 115 / 130 %). Ne koristi CSS `zoom` (Firefox ga
        // ne implementira), vec preko root font-size skaliranja.
        const zoom = parseInt(p.zoom || 100, 10);
        html.style.setProperty('--user-zoom', (zoom / 100).toString());
        // Root font size je bazna jedinica za rem — sve `rem` u modern.css skaliraju.
        html.style.fontSize = (16 * (zoom / 100)) + 'px';

        // Modal size: 'compact' | 'normal' (default) | 'wide' | 'full'
        const MODAL_MAX = { compact: '520px', normal: '800px', wide: '1120px', full: '96vw' };
        html.style.setProperty('--user-modal-max', MODAL_MAX[p.modalSize] || MODAL_MAX.normal);
        html.setAttribute('data-modal-size', p.modalSize || 'normal');

        // Font family: 'system' (default) | 'sans' | 'serif' | 'mono'
        const FONT_FAM = {
            system: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            sans:   '"Helvetica Neue", Arial, sans-serif',
            serif:  'Georgia, "Times New Roman", serif',
            mono:   'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
        };
        html.style.setProperty('--user-font-family', FONT_FAM[p.fontFamily] || FONT_FAM.system);

        // Line height: 'tight' | 'normal' (default) | 'relaxed'
        const LH = { tight: '1.35', normal: '1.55', relaxed: '1.75' };
        html.style.setProperty('--user-line-height', LH[p.lineHeight] || LH.normal);

        // High contrast toggle (accessibility)
        if (p.highContrast) html.setAttribute('data-high-contrast', 'on');
        else html.removeAttribute('data-high-contrast');

        // Reduce motion (accessibility) — kill animations/transitions
        if (p.reduceMotion) html.setAttribute('data-reduce-motion', 'on');
        else html.removeAttribute('data-reduce-motion');

        // === LAYOUT CUSTOMIZATION (v22.3) ===

        // Sidebar width — 'narrow' (5.5rem, icon-only), 'normal' (18rem), 'wide' (22rem)
        const SB_WIDTH = { narrow: '5.5rem', normal: '18rem', wide: '22rem' };
        html.style.setProperty('--user-sidebar-w', SB_WIDTH[p.sidebarWidth] || SB_WIDTH.normal);
        html.setAttribute('data-sidebar-w', p.sidebarWidth || 'normal');

        // Main content max width — 'compact' (900px), 'normal' (1400px, default), 'full' (100%)
        const CONTENT_MAX = { compact: '900px', normal: '1400px', full: '100%' };
        html.style.setProperty('--user-content-max', CONTENT_MAX[p.contentMax] || CONTENT_MAX.normal);

        // Accent color — hex string, default indigo #4f46e5
        const accent = (p.accentColor && /^#[0-9a-fA-F]{6}$/.test(p.accentColor)) ? p.accentColor : '#4f46e5';
        html.style.setProperty('--user-accent', accent);
        // Sekundarna nijansa (soft bg) — 15% alpha (rgba jer nema RGB variable)
        // Konvertujemo hex -> rgba za soft accent
        const rgb = accent.match(/^#(..)(..)(..)$/);
        if (rgb) {
            const r = parseInt(rgb[1], 16), g = parseInt(rgb[2], 16), b = parseInt(rgb[3], 16);
            html.style.setProperty('--user-accent-rgb', `${r}, ${g}, ${b}`);
            html.style.setProperty('--user-accent-soft', `rgba(${r}, ${g}, ${b}, 0.12)`);
        }

        // Border radius scale — 'sharp' (4px), 'normal' (10px), 'round' (16px)
        const RADIUS = { sharp: '4px', normal: '10px', round: '16px' };
        html.style.setProperty('--user-radius', RADIUS[p.borderRadius] || RADIUS.normal);
    }
    // Apply on load
    applyPrefs(getPrefs());

    // --- Preferences modal ---
    async function openPreferences() {
        const cur = getPrefs();
        // Uvek dovuci svez profil sa servera — state.user moze biti stale.
        let user = (window.state && window.state.user) || {};
        try {
            const r = await fetch('/api/users/me', { credentials: 'same-origin' });
            if (r.ok) {
                const fresh = await r.json();
                user = Object.assign({}, user, fresh);
                if (window.state && window.state.user) Object.assign(window.state.user, fresh);
                // Restore notif checkboxes iz notif_prefs (server je izvor istine)
                if (fresh.notif_prefs) {
                    const np = fresh.notif_prefs;
                    setPrefs({
                        notifPortal: np.portal !== false,
                        notifDeals:  np.deals !== false,
                        notifEmail:  np.email === true,
                        notifSound:  np.sound === true,
                    });
                }
            }
        } catch(_) {}

        const html = `
        <div class="pref-modal-overlay" onclick="if(event.target===this)closePreferences()">
          <div class="pref-modal">
            <div class="pref-head">
              <div>
                <div class="pref-title">👤 Profile & Preferences</div>
                <div class="pref-subtitle">${escapeHtml(user.username || 'unknown')} · ${escapeHtml(user.role || 'user')}</div>
              </div>
              <button class="pref-close" onclick="closePreferences()">×</button>
            </div>
            <div class="pref-tabs">
              <button class="pref-tab active" data-tab="profile">Profile</button>
              <button class="pref-tab" data-tab="security">Security</button>
              <button class="pref-tab" data-tab="appearance">Appearance</button>
              <button class="pref-tab" data-tab="notifications">Notifications</button>
              <button class="pref-tab" data-tab="session">Session</button>
            </div>
            <div class="pref-body">
              <!-- PROFILE -->
              <div class="pref-pane active" data-pane="profile">
                <div class="pref-field">
                  <label>Username</label>
                  <input type="text" value="${escapeHtml(user.username || '')}" disabled>
                  <p class="pref-hint">Username se ne može menjati.</p>
                </div>
                <div class="pref-field">
                  <label>Full name</label>
                  <input type="text" id="pref-fullname" value="${escapeHtml(user.full_name || user.fullName || '')}" placeholder="Vladimir Maljković">
                </div>
                <div class="pref-field">
                  <label>Email</label>
                  <input type="email" id="pref-email" value="${escapeHtml(user.email || '')}" placeholder="vladimir@aspidus.co">
                </div>
                <div class="pref-field">
                  <label>Phone</label>
                  <input type="tel" id="pref-phone" value="${escapeHtml(user.phone || '')}" placeholder="+381 60 000 0000">
                </div>
                <div class="pref-actions">
                  <button class="pref-btn pref-btn-primary" onclick="saveProfile()">Save Profile</button>
                </div>
              </div>

              <!-- SECURITY -->
              <div class="pref-pane" data-pane="security">
                <div class="pref-field">
                  <label>Current password</label>
                  <input type="password" id="pref-cur-pwd" placeholder="••••••••">
                </div>
                <div class="pref-field">
                  <label>New password</label>
                  <input type="password" id="pref-new-pwd" placeholder="•••••••• (min. 8 karaktera)">
                </div>
                <div class="pref-field">
                  <label>Confirm new password</label>
                  <input type="password" id="pref-conf-pwd" placeholder="••••••••">
                </div>
                <div class="pref-actions">
                  <button class="pref-btn pref-btn-primary" onclick="saveCrmPassword()">Change Password</button>
                </div>
                <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb">
                <div class="pref-field">
                  <label style="display:flex;align-items:center;gap:8px">
                    <span>Two-Factor Authentication (TOTP)</span>
                    <span id="pref-2fa-status" class="pref-badge">checking...</span>
                  </label>
                  <p class="pref-hint">Google Authenticator ili Authy app. Preporučeno za admin naloge.</p>
                  <button class="pref-btn pref-btn-secondary" onclick="open2FA()">Manage 2FA</button>
                </div>

                <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb">
                <div class="pref-field">
                  <label>Sign out all other devices</label>
                  <p class="pref-hint">Ako misliš da neko drugi ima pristup tvom nalogu, ovo odmah ukida SVE druge otvorene sesije (na drugim uređajima). Ova sesija ostaje aktivna.</p>
                  <button class="pref-btn pref-btn-danger" onclick="killAllOtherSessions()">🚪 Kill all other sessions</button>
                </div>
              </div>

              <!-- APPEARANCE -->
              <div class="pref-pane" data-pane="appearance">
                <div class="pref-field">
                  <label>Theme</label>
                  <div class="pref-radio-group pref-grid-3">
                    <label class="pref-radio"><input type="radio" name="theme" value="auto"  ${!cur.theme || cur.theme === 'auto' ? 'checked' : ''}><span>🖥 Auto</span></label>
                    <label class="pref-radio"><input type="radio" name="theme" value="light" ${cur.theme === 'light' ? 'checked' : ''}><span>☀️ Light</span></label>
                    <label class="pref-radio"><input type="radio" name="theme" value="dark"  ${cur.theme === 'dark' ? 'checked' : ''}><span>🌙 Dark</span></label>
                  </div>
                </div>
                <div class="pref-field">
                  <label>Language</label>
                  <select id="pref-language">
                    <option value="sr" ${cur.language === 'sr' ? 'selected' : ''}>🇷🇸 Srpski</option>
                    <option value="en" ${cur.language === 'en' || !cur.language ? 'selected' : ''}>🇬🇧 English</option>
                  </select>
                </div>

                <hr style="margin:20px 0 16px;border:none;border-top:1px solid #e5e7eb">
                <div class="pref-field-title">📐 Display &amp; Typography</div>
                <p class="pref-hint" style="margin-bottom:12px">Live preview — sve promene se primenjuju odmah bez reload-a i traju u svim prozorima/modalima.</p>

                <div class="pref-field">
                  <label>Font size</label>
                  <div class="pref-radio-group pref-grid-4">
                    <label class="pref-radio"><input type="radio" name="fontSize" value="sm" ${cur.fontSize === 'sm' ? 'checked' : ''}><span>S · 13px</span></label>
                    <label class="pref-radio"><input type="radio" name="fontSize" value="md" ${!cur.fontSize || cur.fontSize === 'md' ? 'checked' : ''}><span>M · 14px</span></label>
                    <label class="pref-radio"><input type="radio" name="fontSize" value="lg" ${cur.fontSize === 'lg' ? 'checked' : ''}><span>L · 16px</span></label>
                    <label class="pref-radio"><input type="radio" name="fontSize" value="xl" ${cur.fontSize === 'xl' ? 'checked' : ''}><span>XL · 18px</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>UI zoom · <span id="pref-zoom-val">${cur.zoom || 100}%</span></label>
                  <input type="range" id="pref-zoom" min="80" max="140" step="5" value="${cur.zoom || 100}" style="width:100%">
                  <p class="pref-hint">Skalira ceo interfejs, ne menja pojedinacan font. 100% je default.</p>
                </div>

                <div class="pref-field">
                  <label>Modal / window width</label>
                  <div class="pref-radio-group pref-grid-4">
                    <label class="pref-radio"><input type="radio" name="modalSize" value="compact" ${cur.modalSize === 'compact' ? 'checked' : ''}><span>Compact</span></label>
                    <label class="pref-radio"><input type="radio" name="modalSize" value="normal"  ${!cur.modalSize || cur.modalSize === 'normal' ? 'checked' : ''}><span>Normal</span></label>
                    <label class="pref-radio"><input type="radio" name="modalSize" value="wide"    ${cur.modalSize === 'wide' ? 'checked' : ''}><span>Wide</span></label>
                    <label class="pref-radio"><input type="radio" name="modalSize" value="full"    ${cur.modalSize === 'full' ? 'checked' : ''}><span>Fullscreen</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Density</label>
                  <div class="pref-radio-group pref-grid-2">
                    <label class="pref-radio"><input type="radio" name="density" value="comfortable" ${!cur.density || cur.density === 'comfortable' ? 'checked' : ''}><span>Comfortable</span></label>
                    <label class="pref-radio"><input type="radio" name="density" value="compact"     ${cur.density === 'compact' ? 'checked' : ''}><span>Compact</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Font family</label>
                  <div class="pref-radio-group pref-grid-4">
                    <label class="pref-radio"><input type="radio" name="fontFamily" value="system" ${!cur.fontFamily || cur.fontFamily === 'system' ? 'checked' : ''}><span>System</span></label>
                    <label class="pref-radio"><input type="radio" name="fontFamily" value="sans"   ${cur.fontFamily === 'sans' ? 'checked' : ''}><span>Sans</span></label>
                    <label class="pref-radio"><input type="radio" name="fontFamily" value="serif"  ${cur.fontFamily === 'serif' ? 'checked' : ''}><span>Serif</span></label>
                    <label class="pref-radio"><input type="radio" name="fontFamily" value="mono"   ${cur.fontFamily === 'mono' ? 'checked' : ''}><span>Mono</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Line height</label>
                  <div class="pref-radio-group pref-grid-3">
                    <label class="pref-radio"><input type="radio" name="lineHeight" value="tight"   ${cur.lineHeight === 'tight' ? 'checked' : ''}><span>Tight</span></label>
                    <label class="pref-radio"><input type="radio" name="lineHeight" value="normal"  ${!cur.lineHeight || cur.lineHeight === 'normal' ? 'checked' : ''}><span>Normal</span></label>
                    <label class="pref-radio"><input type="radio" name="lineHeight" value="relaxed" ${cur.lineHeight === 'relaxed' ? 'checked' : ''}><span>Relaxed</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Accessibility</label>
                  <div class="pref-radio-group pref-grid-2">
                    <label class="pref-radio"><input type="checkbox" id="pref-high-contrast" ${cur.highContrast ? 'checked' : ''}><span>🔆 High contrast</span></label>
                    <label class="pref-radio"><input type="checkbox" id="pref-reduce-motion" ${cur.reduceMotion ? 'checked' : ''}><span>⏸ Reduce motion</span></label>
                  </div>
                </div>

                <hr style="margin:20px 0 16px;border:none;border-top:1px solid #e5e7eb">
                <div class="pref-field-title">🖼 Layout &amp; Colors</div>
                <p class="pref-hint" style="margin-bottom:12px">Podesi širinu levog panela, širinu glavne oblasti i akcentnu boju cele aplikacije.</p>

                <div class="pref-field">
                  <label>Sidebar width</label>
                  <div class="pref-radio-group pref-grid-3">
                    <label class="pref-radio"><input type="radio" name="sidebarWidth" value="narrow" ${cur.sidebarWidth === 'narrow' ? 'checked' : ''}><span>Narrow · 5.5rem</span></label>
                    <label class="pref-radio"><input type="radio" name="sidebarWidth" value="normal" ${!cur.sidebarWidth || cur.sidebarWidth === 'normal' ? 'checked' : ''}><span>Normal · 18rem</span></label>
                    <label class="pref-radio"><input type="radio" name="sidebarWidth" value="wide"   ${cur.sidebarWidth === 'wide' ? 'checked' : ''}><span>Wide · 22rem</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Main content width</label>
                  <div class="pref-radio-group pref-grid-3">
                    <label class="pref-radio"><input type="radio" name="contentMax" value="compact" ${cur.contentMax === 'compact' ? 'checked' : ''}><span>Compact · 900px</span></label>
                    <label class="pref-radio"><input type="radio" name="contentMax" value="normal"  ${!cur.contentMax || cur.contentMax === 'normal' ? 'checked' : ''}><span>Normal · 1400px</span></label>
                    <label class="pref-radio"><input type="radio" name="contentMax" value="full"    ${cur.contentMax === 'full' ? 'checked' : ''}><span>Full width</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Border radius</label>
                  <div class="pref-radio-group pref-grid-3">
                    <label class="pref-radio"><input type="radio" name="borderRadius" value="sharp"  ${cur.borderRadius === 'sharp' ? 'checked' : ''}><span>Sharp · 4px</span></label>
                    <label class="pref-radio"><input type="radio" name="borderRadius" value="normal" ${!cur.borderRadius || cur.borderRadius === 'normal' ? 'checked' : ''}><span>Normal · 10px</span></label>
                    <label class="pref-radio"><input type="radio" name="borderRadius" value="round"  ${cur.borderRadius === 'round' ? 'checked' : ''}><span>Round · 16px</span></label>
                  </div>
                </div>

                <div class="pref-field">
                  <label>Accent color</label>
                  <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                    <input type="color" id="pref-accent" value="${escapeHtml(cur.accentColor || '#4f46e5')}"
                           style="width:64px; height:44px; padding:0; border:1px solid #e2e8f0; border-radius:10px; cursor:pointer;">
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      ${['#4f46e5', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#0f172a'].map(c =>
                        `<button type="button" data-preset-accent="${c}" class="tk-color-swatch"
                                 style="width:32px;height:32px;border-radius:8px;background:${c};border:2px solid ${cur.accentColor === c ? '#0f172a' : 'transparent'};cursor:pointer;"
                                 title="${c}"></button>`
                      ).join('')}
                    </div>
                  </div>
                  <p class="pref-hint">Boja se primenjuje na dugmiće, aktivne stavke u menu-ju i akcente kroz aplikaciju.</p>
                </div>

                <div class="pref-actions">
                  <button class="pref-btn pref-btn-secondary" onclick="resetDisplay()">Reset defaults</button>
                  <button class="pref-btn pref-btn-primary" onclick="saveAppearance()">Save Preferences</button>
                </div>
              </div>

              <!-- NOTIFICATIONS -->
              <div class="pref-pane" data-pane="notifications">
                <div class="pref-field">
                  <label style="display:flex;align-items:center;gap:8px">
                    <input type="checkbox" id="pref-notif-portal" ${cur.notifPortal !== false ? 'checked' : ''}>
                    <span>Portal events (KYC, RFQ, ponude)</span>
                  </label>
                </div>
                <div class="pref-field">
                  <label style="display:flex;align-items:center;gap:8px">
                    <input type="checkbox" id="pref-notif-deals" ${cur.notifDeals !== false ? 'checked' : ''}>
                    <span>Deal updates (nova ponuda, promena statusa)</span>
                  </label>
                </div>
                <div class="pref-field">
                  <label style="display:flex;align-items:center;gap:8px">
                    <input type="checkbox" id="pref-notif-email" ${cur.notifEmail === true ? 'checked' : ''}>
                    <span>Email digest (dnevni sažetak umesto svake notifikacije)</span>
                  </label>
                </div>
                <div class="pref-field">
                  <label style="display:flex;align-items:center;gap:8px">
                    <input type="checkbox" id="pref-notif-sound" ${cur.notifSound === true ? 'checked' : ''}>
                    <span>Zvuk kada dodje nova notifikacija</span>
                  </label>
                </div>
                <div class="pref-actions">
                  <button class="pref-btn pref-btn-primary" onclick="saveNotifications()">Save Preferences</button>
                </div>
              </div>

              <!-- SESSION -->
              <div class="pref-pane" data-pane="session">
                <div class="pref-info-block">
                  <div class="pref-info-row"><b>Login time:</b> <span id="sess-login">—</span></div>
                  <div class="pref-info-row"><b>Last activity:</b> <span id="sess-activity">—</span></div>
                  <div class="pref-info-row"><b>Session TTL:</b> <span id="sess-ttl">—</span></div>
                  <div class="pref-info-row"><b>IP:</b> <span id="sess-ip">—</span></div>
                  <div class="pref-info-row"><b>Device:</b> <span id="sess-device">${escapeHtml(navigator.userAgent.substring(0,60))}...</span></div>
                </div>
                <div class="pref-actions" style="gap:8px">
                  <button class="pref-btn pref-btn-secondary" onclick="refreshSession()">🔄 Refresh</button>
                  <button class="pref-btn pref-btn-danger" onclick="logoutNow()">Sign out</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        `;
        const wrap = document.createElement('div');
        wrap.id = 'pref-wrap';
        wrap.innerHTML = html;
        document.body.appendChild(wrap);

        // Tab switcher
        wrap.querySelectorAll('.pref-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                wrap.querySelectorAll('.pref-tab').forEach(t => t.classList.remove('active'));
                wrap.querySelectorAll('.pref-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                wrap.querySelector(`.pref-pane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
            });
        });

        // Populate session tab
        refreshSession();
        // 2FA status
        check2FAStatus();

        // === LIVE PREVIEW za display controls ===
        // Svaka izmena se odmah primenjuje (bez klika na Save) — Save samo
        // perzistira u localStorage. Ako user zatvori bez Save-a, apply se
        // reset-uje pri sledecem otvaranju iz stored prefs.
        const livePreview = () => {
            const p = Object.assign({}, getPrefs(), {
                theme:        document.querySelector('input[name="theme"]:checked')?.value,
                density:      document.querySelector('input[name="density"]:checked')?.value,
                fontSize:     document.querySelector('input[name="fontSize"]:checked')?.value,
                zoom:         parseInt(document.getElementById('pref-zoom')?.value || 100, 10),
                modalSize:    document.querySelector('input[name="modalSize"]:checked')?.value,
                fontFamily:   document.querySelector('input[name="fontFamily"]:checked')?.value,
                lineHeight:   document.querySelector('input[name="lineHeight"]:checked')?.value,
                highContrast: !!document.getElementById('pref-high-contrast')?.checked,
                reduceMotion: !!document.getElementById('pref-reduce-motion')?.checked,
                sidebarWidth: document.querySelector('input[name="sidebarWidth"]:checked')?.value,
                contentMax:   document.querySelector('input[name="contentMax"]:checked')?.value,
                borderRadius: document.querySelector('input[name="borderRadius"]:checked')?.value,
                accentColor:  document.getElementById('pref-accent')?.value || '#4f46e5',
            });
            applyPrefs(p);
        };
        wrap.querySelectorAll('input[name="theme"], input[name="density"], input[name="fontSize"], input[name="modalSize"], input[name="fontFamily"], input[name="lineHeight"], input[name="sidebarWidth"], input[name="contentMax"], input[name="borderRadius"]').forEach(el => {
            el.addEventListener('change', livePreview);
        });
        const zoomEl = document.getElementById('pref-zoom');
        const zoomVal = document.getElementById('pref-zoom-val');
        if (zoomEl) zoomEl.addEventListener('input', (e) => {
            if (zoomVal) zoomVal.textContent = e.target.value + '%';
            livePreview();
        });
        ['pref-high-contrast', 'pref-reduce-motion'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', livePreview);
        });
        // Accent color picker + preset swatches
        const accentEl = document.getElementById('pref-accent');
        if (accentEl) accentEl.addEventListener('input', livePreview);
        wrap.querySelectorAll('[data-preset-accent]').forEach(sw => {
            sw.addEventListener('click', () => {
                const c = sw.dataset.presetAccent;
                if (accentEl) accentEl.value = c;
                // Ažuriraj outline na aktivnom preset-u
                wrap.querySelectorAll('[data-preset-accent]').forEach(x => {
                    x.style.border = '2px solid ' + (x.dataset.presetAccent === c ? '#0f172a' : 'transparent');
                });
                livePreview();
            });
        });
    }

    function closePreferences() {
        const w = document.getElementById('pref-wrap');
        if (w) w.remove();
    }

    async function saveProfile() {
        const full_name = document.getElementById('pref-fullname').value.trim();
        const email = document.getElementById('pref-email').value.trim();
        const phone = document.getElementById('pref-phone').value.trim();
        const csrf = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || '';
        try {
            const r = await fetch('/api/users/me', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ full_name, email, phone })
            });
            let j = {};
            try { j = await r.json(); } catch(_) {}
            if (r.ok && j.status === 'ok') {
                if (typeof showToast === 'function') showToast('✓ Profile updated.', 'success');
                if (window.state && window.state.user) {
                    Object.assign(window.state.user, { full_name, email, phone });
                }
            } else {
                const msg = j.error || j.message || `HTTP ${r.status}`;
                if (typeof showToast === 'function') showToast('Error: ' + msg, 'error', { requestId: j.request_id });
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Network error: ' + e.message, 'error');
        }
    }

    async function saveCrmPassword() {
        const cur = document.getElementById('pref-cur-pwd').value;
        const nw = document.getElementById('pref-new-pwd').value;
        const cf = document.getElementById('pref-conf-pwd').value;
        if (!cur || !nw) { showToast && showToast('Both current and new password required.', 'error'); return; }
        if (nw.length < 8) { showToast && showToast('New password too short (min 8 chars).', 'error'); return; }
        if (nw !== cf) { showToast && showToast('Confirmation does not match new password.', 'error'); return; }
        const csrf = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || '';
        try {
            const r = await fetch('/api/users/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ current: cur, next: nw })
            });
            let j = {};
            try { j = await r.json(); } catch(_) {}
            if (r.ok && j.status === 'success') {
                showToast && showToast('✓ Password changed.', 'success');
                document.getElementById('pref-cur-pwd').value = '';
                document.getElementById('pref-new-pwd').value = '';
                document.getElementById('pref-conf-pwd').value = '';
            } else {
                const msg = j.error || j.message || `HTTP ${r.status}`;
                showToast && showToast(msg, 'error', { requestId: j.request_id });
            }
        } catch (e) { showToast && showToast('Network error: ' + e.message, 'error'); }
    }

    function saveAppearance() {
        setPrefs({
            theme:        document.querySelector('input[name="theme"]:checked')?.value,
            density:      document.querySelector('input[name="density"]:checked')?.value,
            language:     document.getElementById('pref-language')?.value,
            fontSize:     document.querySelector('input[name="fontSize"]:checked')?.value,
            zoom:         parseInt(document.getElementById('pref-zoom')?.value || 100, 10),
            modalSize:    document.querySelector('input[name="modalSize"]:checked')?.value,
            fontFamily:   document.querySelector('input[name="fontFamily"]:checked')?.value,
            lineHeight:   document.querySelector('input[name="lineHeight"]:checked')?.value,
            highContrast: !!document.getElementById('pref-high-contrast')?.checked,
            reduceMotion: !!document.getElementById('pref-reduce-motion')?.checked,
            sidebarWidth: document.querySelector('input[name="sidebarWidth"]:checked')?.value,
            contentMax:   document.querySelector('input[name="contentMax"]:checked')?.value,
            borderRadius: document.querySelector('input[name="borderRadius"]:checked')?.value,
            accentColor:  document.getElementById('pref-accent')?.value || '#4f46e5',
        });
        showToast && showToast('✓ Preferences saved & applied.', 'success');
    }

    function resetDisplay() {
        // Vrati sve display + layout podesavanja na default, cuvajuci ostale prefs
        setPrefs({
            fontSize: 'md', zoom: 100, modalSize: 'normal',
            fontFamily: 'system', lineHeight: 'normal', density: 'comfortable',
            highContrast: false, reduceMotion: false,
            sidebarWidth: 'normal', contentMax: 'normal', borderRadius: 'normal',
            accentColor: '#4f46e5',
        });
        closePreferences();
        setTimeout(openPreferences, 100);
        showToast && showToast('Display reset to defaults.', 'info');
    }
    window.resetDisplay = resetDisplay;

    async function saveNotifications() {
        const notif_prefs = {
            portal: document.getElementById('pref-notif-portal').checked,
            deals:  document.getElementById('pref-notif-deals').checked,
            email:  document.getElementById('pref-notif-email').checked,
            sound:  document.getElementById('pref-notif-sound').checked,
        };
        // 1) Sacuvaj lokalno za instant efekat
        setPrefs({
            notifPortal: notif_prefs.portal,
            notifDeals:  notif_prefs.deals,
            notifEmail:  notif_prefs.email,
            notifSound:  notif_prefs.sound,
        });
        // 2) Sinhronizuj sa serverom (users.notif_prefs) tako da radi cross-device
        const csrf = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || '';
        try {
            const r = await fetch('/api/users/me', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ notif_prefs })
            });
            let j = {};
            try { j = await r.json(); } catch(_) {}
            if (r.ok && j.status === 'ok') {
                showToast && showToast('✓ Notification preferences saved.', 'success');
                if (window.state && window.state.user) {
                    window.state.user.notif_prefs = notif_prefs;
                }
            } else {
                showToast && showToast('Saved locally but server sync failed: ' + (j.error || r.status),
                                       'warn', { requestId: j.request_id });
            }
        } catch (e) {
            showToast && showToast('Saved locally, network sync failed.', 'warn');
        }
    }

    async function check2FAStatus() {
        const badge = document.getElementById('pref-2fa-status');
        if (!badge) return;
        try {
            const r = await fetch('/api/2fa/status');
            const j = await r.json();
            badge.textContent = j.enabled ? '✓ Enabled' : 'Not set up';
            badge.className = 'pref-badge ' + (j.enabled ? 'pref-badge-green' : 'pref-badge-amber');
        } catch(_) { badge.textContent = 'Unknown'; }
    }

    function open2FA() {
        if (typeof window.show2FASetup === 'function') { closePreferences(); window.show2FASetup(); return; }
        window.location.href = '/2fa/setup';
    }

    async function refreshSession() {
        try {
            const r = await fetch('/api/session/info');
            if (!r.ok) return;
            const j = await r.json();
            const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
            set('sess-login', j.login_time || '—');
            set('sess-activity', j.last_active || '—');
            set('sess-ttl', j.ttl_seconds ? (Math.round(j.ttl_seconds/60) + ' min inactivity') : '—');
            set('sess-ip', j.ip || '—');
        } catch(_) {}
    }

    function logoutNow() {
        if (confirm('Sign out?')) window.location.href = '/logout';
    }

    async function killAllOtherSessions() {
        if (!confirm('Sign out ALL your other sessions on other devices?\n\nThis session (right now) stays active.')) return;
        const csrf = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || '';
        try {
            const r = await fetch('/api/users/kill-all-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            });
            let j = {};
            try { j = await r.json(); } catch(_) {}
            if (r.ok && j.status === 'ok') {
                if (typeof showToast === 'function') showToast('✓ All other sessions signed out.', 'success', 5000);
                else alert('All other sessions have been signed out.');
            } else {
                const msg = j.error || j.message || `HTTP ${r.status}`;
                if (typeof showToast === 'function') showToast('Error: ' + msg, 'error', { requestId: j.request_id });
                else alert('Error: ' + msg);
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Network error: ' + e.message, 'error');
            else alert('Network error');
        }
    }
    window.killAllOtherSessions = killAllOtherSessions;


    // Expose
    window.openPreferences = openPreferences;
    window.closePreferences = closePreferences;
    window.saveProfile = saveProfile;
    window.saveCrmPassword = saveCrmPassword;
    window.saveAppearance = saveAppearance;
    window.saveNotifications = saveNotifications;
    window.refreshSession = refreshSession;
    window.logoutNow = logoutNow;
    window.open2FA = open2FA;

    // Keyboard shortcut Cmd/Ctrl + , to open
    document.addEventListener('keydown', async e => {
        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
            e.preventDefault();
            await openPreferences();
        }
    });

    // Auto-inject styles once
    if (!document.getElementById('pref-modal-styles')) {
        const s = document.createElement('style');
        s.id = 'pref-modal-styles';
        s.textContent = `
        .pref-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,.55); backdrop-filter:blur(6px); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; animation:pref-fade .15s ease; }
        .pref-modal { background:white; border-radius:18px; width:100%; max-width:720px; max-height:90vh; overflow:hidden; box-shadow:0 30px 80px rgba(15,23,42,.35); display:flex; flex-direction:column; animation:pref-slide .2s cubic-bezier(.4,0,.2,1); }
        @keyframes pref-fade { from{opacity:0} to{opacity:1} }
        @keyframes pref-slide { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
        .pref-head { padding:22px 26px 16px; border-bottom:1px solid #e5e7eb; display:flex; align-items:center; justify-content:space-between; }
        .pref-title { font-size:18px; font-weight:700; color:#0f172a; letter-spacing:-.01em; }
        .pref-subtitle { font-size:12px; color:#64748b; margin-top:2px; }
        .pref-close { width:32px; height:32px; border-radius:8px; background:#f1f5f9; border:none; font-size:20px; cursor:pointer; color:#475569; }
        .pref-close:hover { background:#e2e8f0; }
        .pref-tabs { display:flex; gap:2px; padding:8px 20px 0; border-bottom:1px solid #e5e7eb; overflow-x:auto; }
        .pref-tab { background:transparent; border:none; padding:10px 14px; border-radius:8px 8px 0 0; font-size:13px; font-weight:500; color:#64748b; cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; white-space:nowrap; }
        .pref-tab:hover { color:#4f46e5; background:#f8fafc; }
        .pref-tab.active { color:#4f46e5; border-bottom-color:#4f46e5; font-weight:600; }
        .pref-body { padding:22px 26px; overflow-y:auto; flex:1; }
        .pref-pane { display:none; }
        .pref-pane.active { display:block; }
        .pref-field { margin-bottom:16px; }
        .pref-field label { display:block; font-size:12px; font-weight:600; color:#334155; margin-bottom:6px; }
        .pref-field input:not([type="radio"]):not([type="checkbox"]), .pref-field select { width:100%; padding:10px 14px; border:1px solid #e2e8f0; border-radius:10px; font-size:13px; transition:border-color .15s; }
        .pref-field input:focus, .pref-field select:focus { outline:none; border-color:#4f46e5; box-shadow:0 0 0 4px rgba(79,70,229,.15); }
        .pref-field input:disabled { background:#f8fafc; color:#94a3b8; }
        .pref-hint { color:#94a3b8; font-size:11px; margin-top:4px; }
        .pref-radio-group { display:flex; flex-direction:column; gap:10px; }
        .pref-radio-group.pref-grid-2 { display:grid; grid-template-columns:repeat(2,1fr); }
        .pref-radio-group.pref-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); }
        .pref-radio-group.pref-grid-4 { display:grid; grid-template-columns:repeat(2,1fr); }
        @media (min-width:640px) { .pref-radio-group.pref-grid-4 { grid-template-columns:repeat(4,1fr); } }
        .pref-radio { display:flex; align-items:center; justify-content:center; gap:8px; padding:9px 12px; border:1px solid #e2e8f0; border-radius:10px; cursor:pointer; font-size:12px; font-weight:500; transition:all .15s; text-align:center; }
        .pref-radio:hover { border-color:#c7d2fe; }
        .pref-radio:has(input:checked) { border-color:#4f46e5; background:#eef2ff; font-weight:600; color:#4338ca; }
        .pref-radio input { margin:0; flex-shrink:0; }
        .pref-radio input[type="radio"], .pref-radio input[type="checkbox"] { accent-color:#4f46e5; }
        .pref-field-title { font-size:13px; font-weight:700; color:#0f172a; letter-spacing:-.01em; margin-bottom:4px; }
        input[type="range"] { accent-color:#4f46e5; }
        .pref-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; padding-top:16px; border-top:1px solid #f1f5f9; }
        .pref-btn { padding:9px 18px; border-radius:10px; font-weight:600; font-size:13px; border:none; cursor:pointer; transition:all .15s; }
        .pref-btn-primary { background:linear-gradient(135deg,#4f46e5,#7c3aed); color:white; box-shadow:0 4px 12px -2px rgba(79,70,229,.35); }
        .pref-btn-primary:hover { transform:translateY(-1px); }
        .pref-btn-secondary { background:white; color:#334155; border:1px solid #e2e8f0; }
        .pref-btn-secondary:hover { background:#f8fafc; }
        .pref-btn-danger { background:#ef4444; color:white; }
        .pref-btn-danger:hover { background:#dc2626; }
        .pref-badge { padding:2px 10px; border-radius:999px; font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
        .pref-badge-green { background:#dcfce7; color:#166534; }
        .pref-badge-amber { background:#fef3c7; color:#92400e; }
        .pref-info-block { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; }
        .pref-info-row { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; color:#334155; border-bottom:1px dashed #e5e7eb; }
        .pref-info-row:last-child { border-bottom:none; }
        `;
        document.head.appendChild(s);
    }
})();
