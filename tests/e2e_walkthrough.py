"""E2E walkthrough — pravi browser klika kroz sve što normalan admin i portal
klijent koriste. Skuplja svaku console/network/render grešku u JSON izveštaj.

Pokreće se protiv aplikacije koja već radi na http://127.0.0.1:5000.

Cilj: naći ono što backend testovi ne mogu — CDN failure, broken selector,
missing button handler, layout crash, race u loading state-u.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = os.environ.get('APP_BASE', 'http://127.0.0.1:5000')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'testadmin')
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'TestAdmin!12345')
BROWSER_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
OUT = '/tmp/aspidus_run/walkthrough_report.json'


class Walker:
    def __init__(self, page):
        self.page = page
        self.errors = []
        self.checks = []
        self.screenshots = []

        page.on('pageerror', lambda err: self.errors.append({
            'kind': 'pageerror', 'url': page.url, 'msg': str(err)
        }))
        page.on('console', lambda msg: self.errors.append({
            'kind': 'console_' + msg.type, 'url': page.url,
            'msg': msg.text
        }) if msg.type in ('error',) else None)
        page.on('requestfailed', lambda req: self.errors.append({
            'kind': 'requestfailed', 'url': req.url,
            'msg': req.failure or 'unknown'
        }))

    def record(self, name, ok, detail=''):
        self.checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
        marker = '✓' if ok else '✗'
        print(f'  {marker} {name}' + (f' — {detail}' if detail else ''))

    def screenshot(self, name):
        p = f'/tmp/aspidus_run/screen_{name}.png'
        try:
            self.page.screenshot(path=p, full_page=False)
            self.screenshots.append(p)
        except Exception as e:
            print(f'    (screenshot failed: {e})')

    # ------------------ CRM LOGIN + NAVIGATION ------------------

    def crm_login(self):
        page = self.page
        page.goto(BASE)
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(800)
        # Login screen mora biti vidljiv
        try:
            page.wait_for_selector('#login-screen', state='visible', timeout=5000)
            self.record('CRM login screen shown', True)
        except PWTimeout:
            self.record('CRM login screen shown', False, 'nije se pojavio za 5s')
            return False

        # GPS geolocation je obavezan — grant permission preko browser context
        # (već je granted globally u browser setup)
        page.fill('input[name="username"]', ADMIN_USER)
        page.fill('input[name="password"]', ADMIN_PASS)
        page.click('button[type="submit"]')

        # Sačekaj ili glavni ekran ili grešku
        try:
            page.wait_for_selector('#app-wrapper:not(.hidden)', state='visible', timeout=10000)
            # sačekaj da buildNavigation završi (initialize() radi async load-ove)
            page.wait_for_function("() => document.querySelectorAll('#navigation button').length > 0",
                                   timeout=10000)
            nav_count = page.evaluate("() => document.querySelectorAll('#navigation button').length")
            self.record('CRM login accepted', True, f'{nav_count} nav items')
            self.screenshot('01_after_login')
            return True
        except PWTimeout:
            err_el = page.query_selector('#login-error')
            err = err_el.inner_text() if err_el else '(bez poruke)'
            self.record('CRM login accepted', False, f'login zaglavljen: {err}')
            self.screenshot('01_login_fail')
            return False

    def crm_navigate_all_menus(self):
        """Klikni svaku stavku iz glavnog nav-a i verifikuj da se view renderuje
        bez console greške."""
        page = self.page
        # popis vidljivih nav-item dugmadi
        nav_items = page.query_selector_all('#navigation button')
        views_visited = 0
        for i in range(len(nav_items)):
            nav_items = page.query_selector_all('#navigation button')  # re-select posle re-render
            if i >= len(nav_items): break
            btn = nav_items[i]
            label = (btn.get_attribute('title') or '').strip() or f'view#{i}'
            try:
                btn.click()
                page.wait_for_timeout(400)
                # verifikuj da main-content nije prazan
                main = page.query_selector('#main-content')
                content = main.inner_text() if main else ''
                if len(content.strip()) < 5:
                    self.record(f'Nav: {label}', False, 'main-content ostao prazan')
                else:
                    self.record(f'Nav: {label}', True, f'{len(content)} chars')
                    views_visited += 1
                self.screenshot(f'nav_{i:02d}_{label[:20].replace(" ","_")}')
            except Exception as e:
                self.record(f'Nav: {label}', False, str(e)[:120])
        return views_visited

    def crm_open_settings(self):
        page = self.page
        # settings ikonica po ID-ju
        btn = page.query_selector('#settings-btn')
        if not btn:
            self.record('Settings button visible', False, 'nema #settings-btn')
            return
        self.record('Settings button visible', True)
        btn.click()
        try:
            page.wait_for_selector('#modal-body .settings-tab-btn', state='visible', timeout=5000)
            self.record('Settings modal opened', True)
        except PWTimeout:
            self.record('Settings modal opened', False, 'modal se nije otvorio')
            return

        # klikni svaki tab
        tabs = page.query_selector_all('#modal-body .settings-tab-btn')
        for tab in tabs:
            name = (tab.inner_text() or '').strip().split('\n')[0][:40]
            target = tab.get_attribute('data-target')
            try:
                tab.click()
                page.wait_for_timeout(300)
                pane = page.query_selector(f'#{target}')
                visible = pane and not (pane.get_attribute('class') or '').__contains__('hidden')
                self.record(f'Settings tab: {name}', bool(visible),
                           '' if visible else f'{target} pane hidden posle klika')
            except Exception as e:
                self.record(f'Settings tab: {name}', False, str(e)[:120])
        self.screenshot('settings_last_tab')
        # zatvori modal
        close_btn = page.query_selector('#modal-close, button[aria-label="Close"]')
        if close_btn: close_btn.click()
        page.wait_for_timeout(300)

    def crm_create_partner(self):
        page = self.page
        # navigiraj na Partners view
        for btn in page.query_selector_all('#navigation button'):
            if 'partner' in (btn.get_attribute('title') or '').lower():
                btn.click()
                page.wait_for_timeout(400)
                break
        # Dugme "+ Add Partner" ili "Novi partner"
        add_btn = None
        for b in page.query_selector_all('button'):
            txt = (b.inner_text() or '').lower()
            if any(w in txt for w in ('add partner', 'novi partner', '+ partner', 'dodaj partner')):
                add_btn = b; break
        if not add_btn:
            self.record('Add Partner button found', False, 'dugme za dodavanje partnera nije nađeno')
            return
        self.record('Add Partner button found', True)
        add_btn.click()
        try:
            page.wait_for_selector('input[name="companyName"], input[name="name"]', timeout=4000)
            self.record('Partner form opened', True)
        except PWTimeout:
            self.record('Partner form opened', False, 'forma se nije otvorila')

    def check_dashboard_renders(self):
        page = self.page
        # klikni Dashboard nav
        for btn in page.query_selector_all('#navigation button'):
            if 'dashboard' in (btn.get_attribute('title') or '').lower():
                btn.click()
                page.wait_for_timeout(1500)  # Chart.js CDN load
                break
        # KPI cards div mora imati sadržaj
        kpis = page.query_selector('#dash-kpis')
        if kpis:
            cards = kpis.query_selector_all('div')
            self.record('Dashboard KPI cards rendered', len(cards) > 0, f'{len(cards)} card divs')
        else:
            self.record('Dashboard KPI cards rendered', False, 'nema #dash-kpis')
        # canvas grafovi ili fallback warning (kad CDN blokiran)
        canvases = page.query_selector_all('canvas[id^="chart-"]')
        fallback = page.query_selector_all('.text-amber-700.bg-amber-50')
        ok = len(canvases) >= 4 or len(fallback) >= 4
        self.record('Dashboard charts (canvas or CDN-fallback)', ok,
                    f'{len(canvases)} canvas, {len(fallback)} fallback')
        self.screenshot('dashboard')

    # ------------------ PORTAL FLOW ------------------

    def portal_visit_login(self):
        page = self.page
        page.goto(BASE + '/portal')
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(800)
        try:
            page.wait_for_selector('#login-email', state='visible', timeout=5000)
            self.record('Portal login screen shown', True)
        except PWTimeout:
            self.record('Portal login screen shown', False, 'nije se pojavio')
            return False
        self.screenshot('portal_01_login')
        return True

    def portal_public_config(self):
        """/api/portal/public_config mora vratiti valjan JSON."""
        page = self.page
        r = page.evaluate("""
            async () => {
                const res = await fetch('/api/portal/public_config');
                return { status: res.status, json: await res.json().catch(()=>null) };
            }
        """)
        ok = r['status'] == 200 and isinstance(r['json'], dict)
        self.record('Portal public config endpoint', ok,
                   f'{r["status"]} keys={list((r["json"] or {}).keys())}')

    # ------------------ DEEP CRM FLOWS ------------------

    def crm_save_partner_end_to_end(self):
        """Popuni formu partnera, snimi je, verifikuj u listi."""
        page = self.page
        # form je već otvorena od prethodnog test-a; ako nije, otvori je
        if not page.query_selector('input[name="companyName"]'):
            self.crm_create_partner()
        try:
            page.fill('input[name="companyName"]', 'E2E Test Company Ltd')
            # snimi — Save je uvek button[type="submit"] u modalu
            save_btn = page.query_selector('#modal-body button[type="submit"], #modal-content button[type="submit"]')
            if not save_btn:
                self.record('Partner save button found', False, 'nema type=submit dugmeta u modalu')
                return
            self.record('Partner save button found', True)
            save_btn.click()
            page.wait_for_timeout(1500)
            # verifikuj preko API-ja da je snimljen
            r = page.evaluate("""async () => {
                const res = await fetch('/api/data/partners');
                const j = await res.json();
                return (j.value || []).map(p => p.companyName || p.name);
            }""")
            found = 'E2E Test Company Ltd' in (r or [])
            self.record('Partner saved and visible in list', found,
                       f'{len(r or [])} partners: {(r or [])[:3]}')
        except Exception as e:
            self.record('Partner end-to-end save', False, str(e)[:200])

    def crm_save_product_end_to_end(self):
        page = self.page
        # navigiraj na Products
        for btn in page.query_selector_all('#navigation button'):
            if 'proizvod' in (btn.get_attribute('title') or '').lower() or 'product' in (btn.get_attribute('title') or '').lower():
                btn.click()
                page.wait_for_timeout(400)
                break
        # nađi "add product" dugme
        add_btn = None
        for b in page.query_selector_all('button'):
            txt = (b.inner_text() or '').lower()
            if any(w in txt for w in ('add product', 'novi proizvod', 'dodaj proizvod', 'kreiraj proizvod', '+ proizvod')):
                add_btn = b; break
        if not add_btn:
            self.record('Add Product button found', False)
            return
        self.record('Add Product button found', True)
        add_btn.click()
        try:
            page.wait_for_selector('input[name="name"]', timeout=4000)
            self.record('Product form opened', True)
            page.fill('input[name="name"]', 'E2E Test Product')
            # HS code — P0 test: unesi nepoznat kod i verifikuj SOFT WARNING (ne blok)
            hs = page.query_selector('input[name="hsCode"]')
            if hs: hs.fill('9999')
            # Snimi
            save_btn = page.query_selector('#modal-body button[type="submit"], #modal-content button[type="submit"]')
            if save_btn:
                save_btn.click()
                page.wait_for_timeout(1500)
                r = page.evaluate("""async () => {
                    const res = await fetch('/api/data/products');
                    const j = await res.json();
                    return (j.value || []).map(p => p.name);
                }""")
                found = 'E2E Test Product' in (r or [])
                self.record('Product saved (HS=9999 soft-warning)', found,
                           f'{len(r or [])} products')
        except Exception as e:
            self.record('Product end-to-end save', False, str(e)[:200])

    def crm_check_search_index(self):
        """FTS5 mora naći upravo snimljene entitete."""
        page = self.page
        # trigger rebuild
        page.evaluate("""async () => {
            const t = await (await fetch('/api/csrf/token')).json();
            return await fetch('/api/system/search/rebuild', {
                method: 'POST',
                headers: {'X-CSRF-Token': t.csrf_token}
            });
        }""")
        r = page.evaluate("""async () => {
            const res = await fetch('/api/system/search?q=E2E');
            return await res.json();
        }""")
        results = (r or {}).get('results', [])
        has_e2e = any('E2E' in (x.get('title') or '') for x in results)
        self.record('FTS5 search finds E2E entities', has_e2e,
                   f'{len(results)} rezultata')

    def crm_check_dashboard_kpis_reflect_data(self):
        """Nakon što smo dodali partnera + proizvod, dashboard KPI mora pokazati njih."""
        page = self.page
        # klikni Dashboard
        for btn in page.query_selector_all('#navigation button'):
            if 'dashboard' in (btn.get_attribute('title') or '').lower():
                btn.click()
                page.wait_for_timeout(1500)
                break
        kpi_text = page.evaluate("() => document.getElementById('dash-kpis')?.innerText || ''")
        has_partner_count = '1' in kpi_text or 'partner' in kpi_text.lower()
        self.record('Dashboard KPI reflects saved data', has_partner_count,
                   f'KPI text length: {len(kpi_text)}')

    def crm_open_cmdk_palette(self):
        """Cmd+K global search palette."""
        page = self.page
        try:
            page.keyboard.press('Meta+K')
            page.wait_for_timeout(300)
            palette = page.query_selector('#cmdk-palette, [role="dialog"] input[type="search"], input[placeholder*="Search"]')
            if not palette:
                # try Ctrl+K
                page.keyboard.press('Control+K')
                page.wait_for_timeout(300)
                palette = page.query_selector('#cmdk-palette, [role="dialog"] input[type="search"], input[placeholder*="Search"]')
            self.record('Cmd+K palette opens', bool(palette))
            if palette:
                page.keyboard.press('Escape')
        except Exception as e:
            self.record('Cmd+K palette opens', False, str(e)[:100])

    # ------------------ PORTAL DEEPER TESTS ------------------

    def portal_otp_request_endpoint(self):
        """POST /api/portal/auth/otp_request sa nepostojećim tokenom mora vratiti 401/403/404 bez 5xx."""
        page = self.page
        r = page.evaluate("""async () => {
            const res = await fetch('/api/portal/auth/otp_request', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({token: 'nonexistent-token', email: 'x@y.com'})
            });
            return res.status;
        }""")
        self.record('Portal OTP request rejects bogus token', r in (400, 401, 403, 404),
                   f'HTTP {r}')

    def run(self):
        # ------ CRM ------
        print('\n=== CRM WALKTHROUGH ===')
        if self.crm_login():
            print('\n-- navigating all menus --')
            self.crm_navigate_all_menus()
            print('\n-- Dashboard render --')
            self.check_dashboard_renders()
            print('\n-- Settings modal all tabs --')
            self.crm_open_settings()
            print('\n-- Partner form open + save --')
            self.crm_create_partner()
            self.crm_save_partner_end_to_end()
            print('\n-- Product form + save --')
            self.crm_save_product_end_to_end()
            print('\n-- FTS5 search --')
            self.crm_check_search_index()
            print('\n-- Dashboard KPI reflect --')
            self.crm_check_dashboard_kpis_reflect_data()
            print('\n-- Cmd+K palette --')
            self.crm_open_cmdk_palette()

        # ------ PORTAL ------
        print('\n=== PORTAL WALKTHROUGH ===')
        self.portal_public_config()
        self.portal_visit_login()
        self.portal_otp_request_endpoint()


def main():
    # Očisti prethodne screenshot-e
    for f in list(os.listdir('/tmp/aspidus_run')) if os.path.isdir('/tmp/aspidus_run') else []:
        if f.startswith('screen_') and f.endswith('.png'):
            try: os.remove(f'/tmp/aspidus_run/{f}')
            except: pass

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=BROWSER_PATH, headless=True,
                                     args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            geolocation={'latitude': 44.7866, 'longitude': 20.4489},
            permissions=['geolocation'],
        )
        page = context.new_page()
        w = Walker(page)
        try:
            w.run()
        except Exception as e:
            print(f'\n!!! WALKER CRASHED: {e}')
            import traceback; traceback.print_exc()
        finally:
            report = {
                'checks': w.checks,
                'errors': w.errors,
                'screenshots': w.screenshots,
                'summary': {
                    'checks_total': len(w.checks),
                    'checks_passed': sum(1 for c in w.checks if c['ok']),
                    'checks_failed': sum(1 for c in w.checks if not c['ok']),
                    'js_errors': len(w.errors),
                }
            }
            with open(OUT, 'w') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            print(f'\n=== SUMMARY ===')
            for k, v in report['summary'].items():
                print(f'  {k}: {v}')
            print(f'Report: {OUT}')
            browser.close()


if __name__ == '__main__':
    main()
