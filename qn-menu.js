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

  /* ---------- テーマデータ（唯一のソース） ----------
     カラーテーマを追加・編集する時は、この配列に1件追記/変更するだけでよい。
     hover色・グロー色・スウォッチの見た目・CSSカスタムプロパティ定義は
     すべてここから自動生成される（qn-menu.css/qn-menu.htmlを手で編集する必要はない）。
     表示順もこの配列の並び順のまま使われる。
     - name: data-qn-theme属性の値（英数字とハイフンのみ）
     - title: スウォッチのtitle属性（ホバー時のツールチップ）
     - primary: メインカラー(HEX)。単色テーマはprimary/secondaryを同じ値にする
     - secondary: 2色目(HEX)。単色テーマと2色テーマを区別する必要はなく、
       同じ値ならグラデーションが単色に見えるだけで済む
     - visible: 初期表示（Moreボタンを押す前）に見せるかどうか。省略時true。
       QN_THEMES_INITIAL_VISIBLE_COUNT件目以降はfalseにする運用にしている。 */
  const QN_THEMES = [
    { name: "red", title: "Red", primary: "#ef4444", secondary: "#b91c1c" },
    { name: "orange", title: "Orange", primary: "#f97316", secondary: "#c2410c" },
    { name: "amber", title: "Amber Gold", primary: "#f59e0b", secondary: "#b45309" },
    { name: "lime", title: "Lime", primary: "#84cc16", secondary: "#4d7c0f" },
    { name: "emerald", title: "Emerald Green", primary: "#10b981", secondary: "#047857" },
    { name: "teal", title: "Teal", primary: "#14b8a6", secondary: "#0f766e" },
    { name: "cyan", title: "Cyan", primary: "#06b6d4", secondary: "#0e7490" },
    { name: "sky", title: "Sky Blue", primary: "#0ea5e9", secondary: "#0369a1" },
    { name: "blue", title: "Blue (Default)", primary: "#3b82f6", secondary: "#1d4ed8" },
    { name: "indigo", title: "Indigo", primary: "#6366f1", secondary: "#4338ca" },
    { name: "purple", title: "Electric Purple", primary: "#8b5cf6", secondary: "#6d28d9" },
    { name: "violet", title: "Violet", primary: "#a855f7", secondary: "#7e22ce" },
    { name: "pink", title: "Pink", primary: "#ec4899", secondary: "#be185d" },
    { name: "rose", title: "Rose Red", primary: "#f43f5e", secondary: "#be123c" },
    { name: "red-deep", title: "Red Deep", primary: "#f44848", secondary: "#550707" },
    { name: "orange-deep", title: "Orange Deep", primary: "#ff8d3d", secondary: "#592602" },
    { name: "amber-deep", title: "Amber Deep", primary: "#fcb640", secondary: "#583904" },
    { name: "lime-deep", title: "Lime Deep", primary: "#aff04c", secondary: "#365309" },
    { name: "emerald-deep", title: "Emerald Deep", primary: "#49f4bb", secondary: "#07543b" },
    { name: "teal-deep", title: "Teal Deep", primary: "#4cf0de", secondary: "#09534b" },
    { name: "cyan-deep", title: "Cyan Deep", primary: "#3ee2fe", secondary: "#034d59" },
    { name: "sky-deep", title: "Sky Deep", primary: "#44c0f8", secondary: "#053d57" },
    { name: "blue-deep", title: "Blue Deep", primary: "#4188fb", secondary: "#042458" },
    { name: "indigo-deep", title: "Indigo Deep", primary: "#494df3", secondary: "#080954" },
    { name: "purple-deep", title: "Purple Deep", primary: "#7b43f9", secondary: "#1e0557" },
    { name: "violet-deep", title: "Violet Deep", primary: "#a042fb", secondary: "#2f0458" },
    { name: "pink-deep", title: "Pink Deep", primary: "#f14b9d", secondary: "#53092d" },
    { name: "rose-deep", title: "Rose Deep", primary: "#f94362", secondary: "#570513" },
    { name: "crimson-cyan", title: "Crimson - Cyan", primary: "#dc2626", secondary: "#06b6d4" },
    { name: "red-blue", title: "Red - Blue", primary: "#ef4444", secondary: "#2563eb" },
    { name: "red-lime", title: "Red - Lime", primary: "#ef4444", secondary: "#84cc16" },
    { name: "orange-purple", title: "Orange - Purple", primary: "#f97316", secondary: "#7c3aed" },
    { name: "orange-sky", title: "Orange - Sky", primary: "#f97316", secondary: "#0ea5e9" },
    { name: "amber-blue", title: "Amber - Blue", primary: "#f59e0b", secondary: "#1d4ed8" },
    { name: "gold-violet", title: "Gold - Violet", primary: "#f59e0b", secondary: "#7c3aed" },
    { name: "yellow-green", title: "Yellow - Green", primary: "#eab308", secondary: "#16a34a" },
    { name: "lime-indigo", title: "Lime - Indigo", primary: "#84cc16", secondary: "#4f46e5" },
    { name: "green-fuchsia", title: "Green - Fuchsia", primary: "#22c55e", secondary: "#e879f9" },
    { name: "emerald-cyan", title: "Emerald - Cyan", primary: "#10b981", secondary: "#06b6d4" },
    { name: "teal-magenta", title: "Teal - Magenta", primary: "#14b8a6", secondary: "#d946ef" },
    { name: "cyan-navy", title: "Cyan - Navy", primary: "#22d3ee", secondary: "#1e3a8a" },
    { name: "cyan-blue", title: "Cyan - Blue", primary: "#06b6d4", secondary: "#3b82f6" },
    { name: "blue-amber", title: "Blue - Amber", primary: "#2563eb", secondary: "#f59e0b" },
    { name: "indigo-orange", title: "Indigo - Orange", primary: "#4f46e5", secondary: "#f97316" },
    { name: "violet-yellow", title: "Violet - Yellow", primary: "#8b5cf6", secondary: "#eab308" },
    { name: "purple-blue", title: "Purple - Blue", primary: "#a855f7", secondary: "#2563eb" },
    { name: "purple-red", title: "Purple - Red", primary: "#a855f7", secondary: "#dc2626" },
    { name: "fuchsia-teal", title: "Fuchsia - Teal", primary: "#e879f9", secondary: "#0d9488" },
    { name: "magenta-lime", title: "Magenta - Lime", primary: "#d946ef", secondary: "#84cc16" },
    { name: "pink-red", title: "Pink - Red", primary: "#ec4899", secondary: "#ef4444" },
    { name: "rose-emerald", title: "Rose - Emerald", primary: "#f43f5e", secondary: "#10b981" },
  ];
  // 最初に見せるスウォッチの件数（これ以降はMoreボタンで展開）。
  // 現状は単色14色がちょうど収まる件数にしている。
  const QN_THEMES_INITIAL_VISIBLE_COUNT = 14;
  // rainbowは通常のCSSカスタムプロパティを持たない特殊テーマ（JSでアニメーション制御）
  // のため、動的生成の対象外にして固定でHTML側に1つだけ残す。

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

    // 明度をfactor倍だけ落とした色を返す（1に近いほど元の明るさに近い、
    // 小さいほど暗くなる）。hover色の自動計算に使う。
    function darken(hex, factor) {
      hex = hex.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16) / 255;
      const g = parseInt(hex.substr(2, 2), 16) / 255;
      const b = parseInt(hex.substr(4, 2), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0;
      const l = (max + min) / 2;
      const d = max - min;
      if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        switch (max) {
          case r: h = ((g - b) / d) % 6; break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h *= 60;
        if (h < 0) h += 360;
      }
      return hslToHex(h, s * 100, Math.max(0, l * factor) * 100);
    }

    /* ---------- テーマCSS・スウォッチの動的生成 ----------
       QN_THEMES配列から、CSSカスタムプロパティ(--accent-*)とスウォッチの
       背景グラデーションをまとめた<style>タグを1つ生成してheadに注入し、
       スウォッチのHTML(.qn-theme-swatch)も同じ配列から生成して
       #qnThemeSwatches / #qnThemeSwatchesExtra に流し込む。
       qn-menu.css/qn-menu.html側にはテーマごとの個別記述を持たせない。 */
    function buildThemeCssAndSwatches() {
      const cssParts = [];
      QN_THEMES.forEach(t => {
        const hover1 = darken(t.primary, 0.82);
        const hover2 = darken(t.secondary, 0.78);
        const r = parseInt(t.primary.slice(1, 3), 16);
        const g = parseInt(t.primary.slice(3, 5), 16);
        const b = parseInt(t.primary.slice(5, 7), 16);
        cssParts.push(
          `[data-qn-theme="${t.name}"]{--accent-primary:${t.primary};--accent-secondary:${t.secondary};` +
          `--accent-glow:rgba(${r},${g},${b},0.35);--accent-hover-1:${hover1};--accent-hover-2:${hover2};}`
        );
        cssParts.push(
          `.qn-swatch-${t.name}{background:linear-gradient(135deg,${t.primary},${t.secondary});}`
        );
      });
      const styleTag = document.createElement('style');
      styleTag.id = 'qnThemeGeneratedCss';
      styleTag.textContent = cssParts.join('\n');
      document.head.appendChild(styleTag);

      const visibleContainer = document.getElementById('qnThemeSwatches');
      const extraContainer = document.getElementById('qnThemeSwatchesExtra');
      const rainbowSwatch = document.getElementById('qnRainbowSwatch');
      if (!visibleContainer || !extraContainer) return;

      QN_THEMES.forEach((t, i) => {
        const swatch = document.createElement('div');
        swatch.className = `qn-theme-swatch qn-swatch-${t.name}`;
        swatch.setAttribute('data-qn-theme', t.name);
        swatch.title = t.title;
        if (i < QN_THEMES_INITIAL_VISIBLE_COUNT) {
          visibleContainer.appendChild(swatch);
        } else {
          // rainbowは常に最後尾に固定したいため、rainbowの直前に挿入する
          // （末尾にappendすると生成順によってrainbowより後ろに来てしまう）。
          extraContainer.insertBefore(swatch, rainbowSwatch);
        }
      });
    }
    buildThemeCssAndSwatches();

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

      /* ---------- カラーテーマ一覧のMore/Less展開 ----------
         最初の14色（単色系）だけを常時表示し、残り（濃淡・大胆な2色・rainbow）は
         Moreボタンで展開する。展開でポップアップ自体の高さが変わるため、
         開いている場合はpositionPopupで位置を再計算する。 */
      const themeMoreBtn = document.getElementById('qnThemeMoreBtn');
      const themeSwatchesExtra = document.getElementById('qnThemeSwatchesExtra');
      if (themeMoreBtn && themeSwatchesExtra) {
        themeMoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const willOpen = !themeSwatchesExtra.classList.contains('open');
          themeSwatchesExtra.classList.toggle('open', willOpen);
          themeMoreBtn.textContent = willOpen ? 'Less colors' : 'More colors';
          if (qnMenuPopup.classList.contains('open')) {
            positionPopup(qnMenuBtn, qnMenuPopup);
          }
        });
      }
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
