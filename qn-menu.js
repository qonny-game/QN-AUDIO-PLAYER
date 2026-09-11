// ============================================================
// qn-menu.js
// QNシリーズ共通ハンバーガーメニュー（QN-PLAYER配布・fetch方式）
//
// 置き場所: https://qonny-game.github.io/QN-PLAYER/qn-menu.js
//
// 【ホスト側（各アプリ）が用意するもの】
// 1. <div id="qnMenuMount"></div> をヘッダーの、ハンバーガーボタンを
//    出したい位置に置く。
// 2. このスクリプトを読み込む <script> タグより前に、以下の2つの
//    グローバル変数を定義する：
//
//      window.QN_CURRENT_APP = "tempo";
//      // "player" | "pitch" | "phrase" | "tempo" | "tuner"
//      // メニュー内の該当アプリへのリンクだけが無効化・強調表示される。
//
//      window.QN_SHORTCUTS = [
//        { key: "Space", action: "Stop current tone" },
//        { key: "→", action: "Switch preset" },
//      ];
//      // このアプリにキーボードショートカットが無ければ、この変数自体を
//      // 定義しない（undefinedのままにする）。その場合Section 3は
//      // 丸ごと非表示になる。
//
// 3. <script src="https://qonny-game.github.io/QN-PLAYER/qn-menu.js"></script>
//    を body の終わり際で読み込む。
//
// 【テーマ・グロー設定の保存方針】
// テーマ・グロー設定は localStorage に保存するが、保存先は各アプリ自身
// （オリジンが別なので、そもそも共有できない）。見た目のルール・UIは
// 共通だが、実体としての設定値はアプリごとに独立している。
//
// 【fetch失敗時の挙動】
// qn-menu.html / qn-menu.css の取得に失敗した場合（オフライン、
// GitHub Pages側の問題等）、ハンバーガーメニュー自体を表示しない
// （#qnMenuMount を空のままにする。ボタンも出さない）。
// ============================================================
(() => {
  'use strict';

  const QN_MENU_BASE = 'https://qonny-game.github.io/QN-PLAYER/';
  const THEME_STORAGE_KEY = 'qn_theme';
  const GLOW_STORAGE_KEY = 'qn_glow';

  const mount = document.getElementById('qnMenuMount');
  if (!mount) return; // ホスト側にマウント先が無ければ何もしない

  // ---------- Load qn-menu.css (once) ----------
  function loadMenuCss() {
    if (document.getElementById('qnMenuCssLink')) return;
    const link = document.createElement('link');
    link.id = 'qnMenuCssLink';
    link.rel = 'stylesheet';
    link.href = QN_MENU_BASE + 'qn-menu.css';
    document.head.appendChild(link);
  }

  // ---------- Fetch qn-menu.html and inject ----------
  fetch(QN_MENU_BASE + 'qn-menu.html')
    .then(res => {
      if (!res.ok) throw new Error('qn-menu.html fetch failed: ' + res.status);
      return res.text();
    })
    .then(html => {
      loadMenuCss();
      mount.innerHTML = html;
      initMenu();
    })
    .catch(() => {
      // fetch失敗時：メニュー自体を出さない（マウント先を空のままにする）
      mount.innerHTML = '';
    });

  // ---------- Everything below runs only after successful injection ----------
  function initMenu() {
    /* ---------- Color conversion helpers ---------- */
    function hslToHex(h, s, l) {
      s /= 100; l /= 100;
      const k = n => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
      return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
    }

    function hexToHue(hex) {
      hex = hex.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16) / 255;
      const g = parseInt(hex.substr(2, 2), 16) / 255;
      const b = parseInt(hex.substr(4, 2), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0;
      const d = max - min;
      if (d !== 0) {
        switch (max) {
          case r: h = ((g - b) / d) % 6; break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h *= 60;
        if (h < 0) h += 360;
      }
      return h;
    }

    /* ---------- Rainbow animation ---------- */
    let rainbowAnimId = null;
    function updateRainbowAnimation(themeName) {
      if (rainbowAnimId) {
        cancelAnimationFrame(rainbowAnimId);
        rainbowAnimId = null;
      }
      if (themeName !== 'rainbow') {
        ['--accent-primary', '--accent-secondary', '--accent-glow', '--accent-hover-1', '--accent-hover-2'].forEach(v => {
          document.body.style.removeProperty(v);
        });
        return;
      }
      let hue = 0;
      function step() {
        hue = (hue + 0.3) % 360;
        const primary = hslToHex(hue, 85, 58);
        const secondary = hslToHex((hue + 30) % 360, 80, 40);
        const hoverA = hslToHex((hue - 10 + 360) % 360, 85, 50);
        const hoverB = hslToHex((hue + 15) % 360, 80, 32);
        document.body.style.setProperty('--accent-primary', primary);
        document.body.style.setProperty('--accent-secondary', secondary);
        document.body.style.setProperty('--accent-glow', primary + '59');
        document.body.style.setProperty('--accent-hover-1', hoverA);
        document.body.style.setProperty('--accent-hover-2', hoverB);
        rainbowAnimId = requestAnimationFrame(step);
      }
      step();
    }

    /* ---------- Glow animation ---------- */
    let glowAnimId = null;
    let glowEnabled = false;

    function stopGlow() {
      if (glowAnimId) {
        cancelAnimationFrame(glowAnimId);
        glowAnimId = null;
      }
      ['--accent-primary', '--accent-secondary', '--accent-glow', '--accent-hover-1', '--accent-hover-2'].forEach(v => {
        document.body.style.removeProperty(v);
      });
    }

    function startGlow() {
      if (glowAnimId) cancelAnimationFrame(glowAnimId);
      const baseColor = getComputedStyle(document.body).getPropertyValue('--accent-primary').trim() || '#3b82f6';
      const fixedHue = hexToHue(baseColor);
      let t = 0;
      function stepGlow() {
        t += 0.008;
        const lightness = 50 + Math.sin(t) * 15;
        const primary = hslToHex(fixedHue, 75, lightness);
        const secondary = hslToHex(fixedHue, 75, Math.max(20, lightness - 20));
        const hoverA = hslToHex(fixedHue, 80, Math.min(75, lightness + 8));
        const hoverB = hslToHex(fixedHue, 75, Math.max(15, lightness - 25));
        document.body.style.setProperty('--accent-primary', primary);
        document.body.style.setProperty('--accent-secondary', secondary);
        document.body.style.setProperty('--accent-glow', primary + '59');
        document.body.style.setProperty('--accent-hover-1', hoverA);
        document.body.style.setProperty('--accent-hover-2', hoverB);
        glowAnimId = requestAnimationFrame(stepGlow);
      }
      stepGlow();
    }

    function setGlowEnabled(enabled) {
      glowEnabled = enabled;
      try { localStorage.setItem(GLOW_STORAGE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
      const btn = document.getElementById('qnGlowToggleBtn');
      if (btn) btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
      if (enabled) {
        if (document.body.getAttribute('data-qn-theme') === 'rainbow') {
          document.body.setAttribute('data-qn-theme', 'blue');
          try { localStorage.setItem(THEME_STORAGE_KEY, 'blue'); } catch (e) {}
          updateActiveSwatch('blue');
          updateRainbowAnimation('blue');
        }
        startGlow();
      } else {
        stopGlow();
      }
    }

    function updateActiveSwatch(themeName) {
      document.querySelectorAll('.qn-theme-swatch').forEach(s => {
        s.classList.toggle('active', s.getAttribute('data-qn-theme') === themeName);
      });
    }

    /* ---------- Theme init & events ---------- */
    let storedTheme = null;
    try { storedTheme = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) {}
    const initialTheme = storedTheme || 'blue';
    document.body.setAttribute('data-qn-theme', initialTheme);
    updateActiveSwatch(initialTheme);
    updateRainbowAnimation(initialTheme);

    document.querySelectorAll('.qn-theme-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const themeName = swatch.getAttribute('data-qn-theme');
        document.body.setAttribute('data-qn-theme', themeName);
        try { localStorage.setItem(THEME_STORAGE_KEY, themeName); } catch (e) {}
        updateActiveSwatch(themeName);
        if (themeName === 'rainbow' && glowEnabled) setGlowEnabled(false);
        updateRainbowAnimation(themeName);
        if (glowEnabled && themeName !== 'rainbow') startGlow();

        // カラーテーマ選択時はメニューを閉じない。色を連続で切り替えながら
        // 見た目を比較したいというユースケースのため、他の操作（メニュー外click等）
        // で閉じるのはそのまま維持し、ここだけ閉じる処理を意図的に呼ばない。
      });
    });

    const glowToggleBtn = document.getElementById('qnGlowToggleBtn');
    if (glowToggleBtn) {
      let savedGlow = false;
      try { savedGlow = localStorage.getItem(GLOW_STORAGE_KEY) === 'on'; } catch (e) {}
      if (savedGlow) setGlowEnabled(true);
      glowToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setGlowEnabled(!glowEnabled);
      });
    }

    /* ---------- Viewport-aware popup positioning ----------
       .qn-menu-popupはposition: fixedのため、CSSのtop: calc(100% + 8px)的な
       相対計算が使えない。ボタンの実際の画面座標(getBoundingClientRect)から
       top/leftをpxで計算し、インラインstyleとして直接設定する。 */
    function positionPopup(toggleBtn, popup) {
      const btnRect = toggleBtn.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const margin = 8;

      // 上下：ボタン下に十分な空間があればその下、無ければ上向きに開く
      const spaceBelow = viewportHeight - btnRect.bottom;
      const spaceAbove = btnRect.top;
      const openUpward = spaceBelow < popupRect.height + 16 && spaceAbove > spaceBelow;
      popup.classList.toggle('open-upward', openUpward);

      const top = openUpward
        ? btnRect.top - popupRect.height - margin
        : btnRect.bottom + margin;

      // 左右：ボタンの左端に揃えるのが基本だが、画面右端からはみ出す場合は
      // 右端に収まるよう左にずらす（左端が画面外に出ないよう0未満にはしない）。
      let left = btnRect.left;
      const maxLeft = viewportWidth - popupRect.width - margin;
      left = Math.max(margin, Math.min(left, maxLeft));

      popup.style.top = `${Math.max(margin, top)}px`;
      popup.style.left = `${left}px`;
    }

    /* ---------- Popup open/close ---------- */
    const qnMenuBtn = document.getElementById('qnMenuBtn');
    const qnMenuPopup = document.getElementById('qnMenuPopup');
    if (qnMenuBtn && qnMenuPopup) {
      qnMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !qnMenuPopup.classList.contains('open');
        qnMenuPopup.classList.toggle('open', willOpen);
        qnMenuBtn.classList.toggle('active', willOpen);
        if (willOpen) {
          // display:noneが解除された直後はまだレイアウトが確定していないため、
          // 実際のサイズが取れるrequestAnimationFrame後に位置を計算する。
          requestAnimationFrame(() => positionPopup(qnMenuBtn, qnMenuPopup));
        }
      });
      qnMenuPopup.addEventListener('click', (e) => e.stopPropagation());
    }
    document.addEventListener('click', () => {
      if (qnMenuPopup) qnMenuPopup.classList.remove('open');
      if (qnMenuBtn) qnMenuBtn.classList.remove('active');
    });
    // fixed配置のため、ウィンドウリサイズ時に開いていれば位置を再計算する
    // （absolute時代は親要素基準で自動追従していたが、fixedでは追従しないため）。
    window.addEventListener('resize', () => {
      if (qnMenuBtn && qnMenuPopup && qnMenuPopup.classList.contains('open')) {
        positionPopup(qnMenuBtn, qnMenuPopup);
      }
    });

    /* ---------- Current app highlight (reads window.QN_CURRENT_APP) ---------- */
    const currentApp = window.QN_CURRENT_APP || null;
    if (currentApp) {
      document.querySelectorAll('.qn-nav-btn').forEach(btn => {
        if (btn.dataset.qnApp === currentApp) {
          btn.classList.add('current');
          btn.removeAttribute('href');
          btn.setAttribute('aria-disabled', 'true');
          btn.addEventListener('click', e => e.preventDefault());
        }
      });
    }

    /* ---------- Keyboard shortcuts section (reads window.QN_SHORTCUTS) ---------- */
    const shortcutsSection = document.getElementById('qnShortcutsSection');
    const shortcutsTbody = document.getElementById('qnShortcutsTbody');
    const shortcuts = window.QN_SHORTCUTS;
    if (Array.isArray(shortcuts) && shortcuts.length > 0 && shortcutsSection && shortcutsTbody) {
      shortcuts.forEach(row => {
        const tr = document.createElement('tr');
        const tdKey = document.createElement('td');
        // key は "Space" のような単一表記、または "↑ ↓" のように
        // スペース区切りで複数キーをまとめて1セルに入れてよい。
        String(row.key).split(' ').forEach((part, i) => {
          if (i > 0) tdKey.appendChild(document.createTextNode(' '));
          const kbd = document.createElement('kbd');
          kbd.textContent = part;
          tdKey.appendChild(kbd);
        });
        const tdAction = document.createElement('td');
        tdAction.textContent = row.action;
        tr.appendChild(tdKey);
        tr.appendChild(tdAction);
        shortcutsTbody.appendChild(tr);
      });
    } else if (shortcutsSection) {
      // window.QN_SHORTCUTS が無い/空のアプリでは Section 3 を丸ごと非表示にする
      shortcutsSection.style.display = 'none';
    }
  }
})();
