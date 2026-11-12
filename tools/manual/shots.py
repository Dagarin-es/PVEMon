import sys
from playwright.sync_api import sync_playwright
PW='OPe6NYDDgS6ipSRaiNUk'
TABS={'es':dict(alertas='Alertas',backups='Backups',notif='Notificaciones',usuarios='Usuarios',sistema='Sistema'),
      'en':dict(alertas='Alerts',backups='Backups',notif='Notifications',usuarios='Users',sistema='System')}
def run(port,ed,lang):
    out=f'/tmp/man/shots/{ed}-{lang}-'
    with sync_playwright() as p:
        b=p.chromium.launch(); ctx=b.new_context(viewport={'width':900,'height':900},device_scale_factor=1.6)
        ctx.add_init_script(f"localStorage.setItem('pvemon.theme','dark');localStorage.setItem('pvemon.lang','{lang}')")
        pg=ctx.new_page(); pg.goto(f'http://127.0.0.1:{port}/'); pg.wait_for_timeout(900)
        pg.add_style_tag(content='header{position:static!important}') if False else None; pg.locator('input').first.fill('admin'); pg.fill('input[type=password]',PW); pg.keyboard.press('Enter'); pg.wait_for_timeout(2000)
        def shot(name,sel='main'):
            pg.add_style_tag(content='header{position:static!important}'); pg.wait_for_timeout(900); pg.locator(sel).first.screenshot(path=out+name+'.png')
        def go(h): pg.goto(f'http://127.0.0.1:{port}/{h}'); pg.wait_for_timeout(1200)
        pg.screenshot(path=out+'header.png',clip={'x':0,'y':0,'width':900,'height':64})
        go('#/' if ed=='bckmon' else '#/backups'); shot('panel')
        pg.add_style_tag(content='header{position:sticky!important;z-index:20}'); pg.locator('.menubtn').click(); pg.wait_for_timeout(400)
        bb=pg.locator('.menu').bounding_box(); pg.screenshot(path=out+'menu.png',clip={'x':500,'y':0,'width':400,'height':bb['y']+bb['height']+12}); pg.keyboard.press('Escape')
        T=TABS[lang]
        go('#/ajustes')
        def tab(k,sub=None):
            pg.get_by_role('tab',name=T[k],exact=True).first.click(); pg.wait_for_timeout(900)
            if sub: pg.locator('.tabs.sub button').nth(sub).click(); pg.wait_for_timeout(900)
        tab('alertas'); shot('alertas')
        tab('backups'); 
        if ed=='pvemon': shot('bk-pve'); pg.locator('.tabs.sub button').nth(1).click(); pg.wait_for_timeout(900)
        shot('bk-otros')
        # formato nuevo: abrir detalle y plantilla
        d=pg.locator('details.det summary').filter(has_text='formato' if lang=='es' else 'format')
        if d.count():
            d.first.click(); pg.wait_for_timeout(500)
            sel=pg.locator('select[data-lbl]').first
            sel.select_option(index=3) ; pg.wait_for_timeout(500)
            pg.add_style_tag(content='header{position:static!important}')
            pg.locator('details.det[open]').first.screenshot(path=out+'formato.png')
        tab('notif'); shot('notif')
        tab('usuarios'); shot('usuarios')
        tab('sistema'); shot('sis-exp')
        pg.locator('.tabs.sub button').nth(1).click(); pg.wait_for_timeout(900); shot('sis-ext')
        pg.locator('.tabs.sub button').nth(2).click(); pg.wait_for_timeout(1200); shot('sis-bk')
        go('#/cuenta'); shot('cuenta')
        b.close()
for a in sys.argv[1:]:
    port,ed,lang=a.split(','); run(port,ed,lang); print('ok',a)
