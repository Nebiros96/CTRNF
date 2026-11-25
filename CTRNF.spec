# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['time_trial_gui.py'],
    pathex=[],
    binaries=[],
    datas=[('web', 'web'), ('streaming', 'streaming'), ('utils/logo_by_LexiLoo826.png', 'utils'), ('utils/ctrnf.ico', 'utils'), ('utils/nav', 'utils/nav'), ('utils/achievements', 'utils/achievements'), ('utils/store/CTRNF-Wumpa_Coin.webp', 'utils/store'), ('data/game_tracks.csv', 'data'), ('data/game_skins.csv', 'data'), ('data/game_characters.csv', 'data'), ('data/achievements.csv', 'data'), ('data/store/store.json', 'data/store'), ('data/crates.json', 'data'), ('data/track_crate_rules.json', 'data')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['catalog_scanner'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='CTRNF',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='utils/ctrnf.ico',
)
