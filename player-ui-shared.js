// ============================================================
// player-ui-shared.js
// PC版・SP版共通のUI操作（DOM操作・イベントハンドラ・画面レイアウト調整）。
// player-core.jsが提供する変数・関数（audio, playlist, currentSpeed,
// setAppTitle, updatePlaybackRate 等）に依存するため、必ずplayer-core.jsの
// 後に読み込むこと。
//
// このファイルの中には、isMobileLayout()でPC/SPの分岐を行っている関数が
// 多数含まれる（例: renderPins, applyPlaybackButtonsLayout,
// applyMobileTabLayout等）。将来的にPC専用/SP専用ファイルへ分割する場合は、
// これらの分岐を持つ関数を書き直す必要がある点に注意。
// 下記のSECTIONコメントは、将来の分割時の切り出し単位の目安として付けている。
// ============================================================


// 初回案内オーバーレイ：ファイルが1曲でも読み込まれたら非表示にする
function hideWelcomeOverlay() {
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.classList.add("hidden");
}

const welcomeSelectBtn = document.getElementById("welcomeSelectBtn");
if (welcomeSelectBtn) {
  welcomeSelectBtn.onclick = () => {
    const fileInput = document.getElementById("fileInput");
    if (fileInput) fileInput.click();
  };
}



async function decodeWaveform(file, token) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = getAudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    if (token !== waveformDecodeToken) return; // 別ファイルが読み込まれていたら破棄

    const channelCount = audioBuffer.numberOfChannels;
    const rawLength = audioBuffer.length;
    const samples = 1600; // 波形の解像度（全体でこの本数のピークを算出）
    const blockSize = Math.max(1, Math.floor(rawLength / samples));
    const peaks = new Float32Array(samples);

    // 全チャンネルをミックスして振幅の最大値を取る
    const channelData = [];
    for (let c = 0; c < channelCount; c++) {
      channelData.push(audioBuffer.getChannelData(c));
    }

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = Math.min(rawLength, start + blockSize);
      let max = 0;
      for (let j = start; j < end; j++) {
        for (let c = 0; c < channelCount; c++) {
          const v = Math.abs(channelData[c][j]);
          if (v > max) max = v;
        }
      }
      peaks[i] = max;
    }

    // 正規化（最大値を1.0にする）
    let peakMax = 0;
    for (let i = 0; i < samples; i++) {
      if (peaks[i] > peakMax) peakMax = peaks[i];
    }
    if (peakMax > 0) {
      for (let i = 0; i < samples; i++) {
        peaks[i] = peaks[i] / peakMax;
      }
    }

    if (token !== waveformDecodeToken) return;

    waveformPeaks = peaks;
    drawWaveform();
  } catch (err) {
    console.warn("Waveform decode failed:", err);
    waveformPeaks = null;
  }
}

function drawWaveform() {
  if (!waveformPeaks || !audio.duration) return;
  const dur = audio.duration;
  const { s1, s2, s3, s4, s5 } = getSegments(dur);
  const bounds = [0, s1, s2, s3, s4, s5, dur];

  for (let row = 0; row < 6; row++) {
    const canvas = document.getElementById(`wave${row + 1}`);
    const bar = document.getElementById(`bar${row + 1}`);
    if (!canvas || !bar) continue;

    const rect = bar.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx2d = canvas.getContext("2d");
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const rowStart = bounds[row];
    const rowEnd = bounds[row + 1];
    const totalSamples = waveformPeaks.length;

    const startIdx = Math.floor((rowStart / dur) * totalSamples);
    const endIdx = Math.max(startIdx + 1, Math.floor((rowEnd / dur) * totalSamples));
    const sliceCount = endIdx - startIdx;
    if (sliceCount <= 0) continue;

    const barGap = 1 * dpr;
    const barWidth = Math.max(1, canvas.width / sliceCount - barGap);
    const midY = canvas.height / 2;

    ctx2d.fillStyle = "rgba(255, 255, 255, 0.28)";

    for (let i = 0; i < sliceCount; i++) {
      const peak = waveformPeaks[startIdx + i] || 0;
      const barHeight = Math.max(2 * dpr, peak * canvas.height * 0.85);
      const x = i * (canvas.width / sliceCount);
      ctx2d.fillRect(x, midY - barHeight / 2, barWidth, barHeight);
    }
  }
}

window.addEventListener("resize", () => {
  if (waveformPeaks) drawWaveform();
});

// Volume persistence
const savedVolume = localStorage.getItem("mp3player_volume");
if (savedVolume !== null) {
  audio.volume = parseFloat(savedVolume);
} else {
  audio.volume = 0.8;
}

const volumeDisplay = document.getElementById("volumeDisplay");
if (volumeDisplay) {
  volumeDisplay.textContent = audio.volume.toFixed(2);
}

// VOL/SPEED/KEYボタン内に現在値を表示する共通ヘルパー
function updateAvToggleValue(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

updateAvToggleValue("volToggleValue", Math.round(audio.volume * 100) + "%");

// レインボー／同系色フェードテーマ：常時色を変化させてアクセントカラーを更新する
let rainbowAnimId = null;
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function updateRainbowAnimation(themeName) {
  if (rainbowAnimId) {
    cancelAnimationFrame(rainbowAnimId);
    rainbowAnimId = null;
  }
  if (themeName !== "rainbow") {
    // レインボー以外に切り替えたらインラインで上書きしたCSS変数をクリアする
    ["--accent-primary", "--accent-secondary", "--accent-glow", "--accent-hover-1", "--accent-hover-2"].forEach(v => {
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
    document.body.style.setProperty("--accent-primary", primary);
    document.body.style.setProperty("--accent-secondary", secondary);
    document.body.style.setProperty("--accent-glow", primary + "59");
    document.body.style.setProperty("--accent-hover-1", hoverA);
    document.body.style.setProperty("--accent-hover-2", hoverB);
    rainbowAnimId = requestAnimationFrame(step);
  }
  step();
}

// GLOW: 現在選択中のテーマの色相を軸に、明度だけをふわっと上下させるトグル効果
let glowAnimId = null;
let glowEnabled = false;

function hexToHue(hex) {
  hex = hex.replace("#", "");
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

function stopGlow() {
  if (glowAnimId) {
    cancelAnimationFrame(glowAnimId);
    glowAnimId = null;
  }
  ["--accent-primary", "--accent-secondary", "--accent-glow", "--accent-hover-1", "--accent-hover-2"].forEach(v => {
    document.body.style.removeProperty(v);
  });
}

function startGlow() {
  if (glowAnimId) cancelAnimationFrame(glowAnimId);

  // 現在のテーマのベースカラー（CSS定義値）から色相を取得する
  const baseColor = getComputedStyle(document.body).getPropertyValue("--accent-primary").trim() || "#3b82f6";
  const fixedHue = hexToHue(baseColor);

  let t = 0;
  function stepGlow() {
    t += 0.008;
    const lightness = 50 + Math.sin(t) * 15;
    const primary = hslToHex(fixedHue, 75, lightness);
    const secondary = hslToHex(fixedHue, 75, Math.max(20, lightness - 20));
    const hoverA = hslToHex(fixedHue, 80, Math.min(75, lightness + 8));
    const hoverB = hslToHex(fixedHue, 75, Math.max(15, lightness - 25));
    document.body.style.setProperty("--accent-primary", primary);
    document.body.style.setProperty("--accent-secondary", secondary);
    document.body.style.setProperty("--accent-glow", primary + "59");
    document.body.style.setProperty("--accent-hover-1", hoverA);
    document.body.style.setProperty("--accent-hover-2", hoverB);
    glowAnimId = requestAnimationFrame(stepGlow);
  }
  stepGlow();
}

function setGlowEnabled(enabled) {
  glowEnabled = enabled;
  localStorage.setItem("mp3player_glow", enabled ? "on" : "off");

  const btn = document.getElementById("glowToggleBtn");
  if (btn) btn.setAttribute("aria-checked", enabled ? "true" : "false");

  if (enabled) {
    // GLOWとレインボーは同時に動かせないため、レインボー選択中なら青(デフォルト)に戻す
    if (document.body.getAttribute("data-theme") === "rainbow") {
      document.body.setAttribute("data-theme", "blue");
      localStorage.setItem("mp3player_theme", "blue");
      updateActiveSwatch("blue");
      updateRainbowAnimation("blue");
    }
    startGlow();
  } else {
    stopGlow();
  }
}

// Theme persistence & switching
// 通常カラーテーマ一覧（レインボーは意図的に選ぶ特殊枠のためランダム候補には含めない）
const RANDOM_THEME_POOL = [
  "red", "orange", "amber", "lime", "emerald", "teal", "cyan", "sky",
  "blue", "indigo", "purple", "violet", "pink", "rose"
];

const storedTheme = localStorage.getItem("mp3player_theme");
// ユーザーがまだ一度もカラーを選んでいなければ、その回だけランダムに1色選ぶ。
// 一度選んだ後は、その色を毎回優先して復元する。
const savedTheme = storedTheme || RANDOM_THEME_POOL[Math.floor(Math.random() * RANDOM_THEME_POOL.length)];
document.body.setAttribute("data-theme", savedTheme);
updateActiveSwatch(savedTheme);
updateRainbowAnimation(savedTheme);

document.querySelectorAll(".theme-swatch").forEach(swatch => {
  swatch.onclick = () => {
    const themeName = swatch.getAttribute("data-theme");
    document.body.setAttribute("data-theme", themeName);
    localStorage.setItem("mp3player_theme", themeName);
    updateActiveSwatch(themeName);

    // レインボーを選んだらGLOWは自動でOFFにする（同時併用しない）
    if (themeName === "rainbow" && glowEnabled) {
      setGlowEnabled(false);
    }
    updateRainbowAnimation(themeName);

    // GLOWがONのままなら、新しいテーマの色相を軸に再スタートする
    if (glowEnabled && themeName !== "rainbow") {
      startGlow();
    }
  };
});

function updateActiveSwatch(themeName) {
  document.querySelectorAll(".theme-swatch").forEach(s => {
    if (s.getAttribute("data-theme") === themeName) {
      s.classList.add("active");
    } else {
      s.classList.remove("active");
    }
  });
}

// GLOWトグルスイッチ
const glowToggleBtn = document.getElementById("glowToggleBtn");
if (glowToggleBtn) {
  const savedGlow = localStorage.getItem("mp3player_glow") === "on";
  if (savedGlow) setGlowEnabled(true);

  glowToggleBtn.onclick = (e) => {
    e.stopPropagation();
    setGlowEnabled(!glowEnabled);
  };
}

// スマホ用ハンバーガーメニュー（Color/Analyzer/EQをまとめて開閉）は player-ui-sp.js に移動済み

// カラーピッカーのポップアップ開閉
const colorToggleBtn = document.getElementById("colorToggleBtn");
const colorPopup = document.getElementById("colorPopup");
if (colorToggleBtn && colorPopup) {
  colorToggleBtn.onclick = (e) => {
    e.stopPropagation();
    hapticTap();
    const willOpen = !colorPopup.classList.contains("open");
    colorPopup.classList.toggle("open", willOpen);
    colorToggleBtn.classList.toggle("active", willOpen);
    if (willOpen) keepPopupInViewport(colorToggleBtn, colorPopup);
  };

  colorPopup.onclick = (e) => {
    e.stopPropagation();
  };

  document.addEventListener("click", () => {
    colorPopup.classList.remove("open");
    colorToggleBtn.classList.remove("active");
  });

  // スウォッチを選んだらポップアップを閉じる
  document.querySelectorAll(".theme-swatch").forEach(swatch => {
    swatch.addEventListener("click", () => {
      colorPopup.classList.remove("open");
      colorToggleBtn.classList.remove("active");
      if (headerControlsEl) headerControlsEl.classList.remove("open");
      if (headerMenuBtn) headerMenuBtn.classList.remove("active");
    });
  });
}

// Keyboard Shortcutsポップアップの開閉処理は player-ui-pc.js に移動済み

document.getElementById("fileInput").onchange = e => addFilesToPlaylist(Array.from(e.target.files));

// ドラッグ&ドロップでのファイル追加処理は player-ui-pc.js に移動済み

function addFilesToPlaylist(files) {
  const audioFiles = files.filter(f => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f.name));
  if (audioFiles.length === 0) return;

  const wasEmpty = playlist.length === 0;
  audioFiles.forEach(file => {
    playlist.push({ file, name: file.name });
    // 実体ごとIndexedDBに自動保存する（次回起動時に自動復元するため）。
    // 保存自体は非同期・失敗しても再生には影響しないため、結果を待たずに進める。
    savePlaylistTrack(file);
  });
  renderPlaylist();

  if (wasEmpty) {
    playTrackAt(0);
  }
}

function renderPlaylist() {
  const box = document.getElementById("playlistBox");
  const info = document.getElementById("playlistInfo");
  if (info) info.textContent = `${playlist.length} track${playlist.length === 1 ? "" : "s"}`;
  if (!box) return;

  box.innerHTML = "";
  playlist.forEach((track, i) => {
    const item = document.createElement("div");
    item.className = "playlistItem";
    item.dataset.index = i;
    if (i === currentPlaylistIndex) item.classList.add("playing");

    // ドラッグ並び替え用のハンドル（この部分を掴んでドラッグする）
    const dragHandle = document.createElement("span");
    dragHandle.className = "playlist-drag-handle";
    dragHandle.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    item.appendChild(dragHandle);

    const nameSpan = document.createElement("span");
    nameSpan.className = "playlist-name";
    nameSpan.textContent = track.name;
    nameSpan.title = track.name;
    nameSpan.onclick = () => playTrackAt(parseInt(item.dataset.index, 10));
    item.appendChild(nameSpan);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.className = "del-btn";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (delBtn.classList.contains("confirm")) {
        hapticWarning();
        removeTrackAt(parseInt(item.dataset.index, 10));
      } else {
        hapticTap();
        delBtn.classList.add("confirm");
        delBtn.textContent = "✓";
        clearTimeout(delBtn._confirmTimer);
        delBtn._confirmTimer = setTimeout(() => {
          delBtn.classList.remove("confirm");
          delBtn.textContent = "✕";
        }, 3000);
      }
    };
    item.appendChild(delBtn);

    box.appendChild(item);
  });

  setupPlaylistDragReorder(box);
}

function removeTrackAt(index) {
  if (index < 0 || index >= playlist.length) return;

  const removingCurrent = index === currentPlaylistIndex;
  const removedName = playlist[index].name;
  playlist.splice(index, 1);
  // 実体もIndexedDBから削除する（残したままだと次回起動時に消したはずの曲が復活してしまう）
  deletePlaylistTrack(removedName);

  if (removingCurrent) {
    // 再生中の曲を削除した場合：可能なら次の曲、なければ前の曲、どちらもなければ停止
    if (playlist.length === 0) {
      currentPlaylistIndex = -1;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setAppTitle("No file loaded");
      updatePlayButtonState();
    } else {
      const nextIndex = Math.min(index, playlist.length - 1);
      playTrackAt(nextIndex);
      return; // playTrackAt内でrenderPlaylistが呼ばれる
    }
  } else if (index < currentPlaylistIndex) {
    currentPlaylistIndex--;
  }

  renderPlaylist();
}

function playTrackAt(index) {
  if (index < 0 || index >= playlist.length) return;
  currentPlaylistIndex = index;
  loadFile(playlist[index].file);
  renderPlaylist();
}

// ============================================================
// プレイリストのドラッグ並び替え（マウス・タッチ両対応）
// ドラッグハンドル(.playlist-drag-handle)を掴んで上下にドラッグすると、
// 通過した位置に応じて他のアイテムを押しのけながら並び替わる。
// 離した時点でplaylist配列を実際に並び替え、currentPlaylistIndexも追従させる。
// ============================================================
function setupPlaylistDragReorder(box) {
  const handles = box.querySelectorAll(".playlist-drag-handle");

  handles.forEach(handle => {
    let dragging = false;
    let draggedItem = null;
    let startY = 0;
    let startIndex = 0; // ドラッグ開始時点でのdraggedItemのDOM上のインデックス
    let itemHeight = 0; // 1アイテムあたりの高さ(gapを含む)。ドラッグ開始時に実測して固定する。
    let itemCount = 0;

    function getItems() {
      return Array.from(box.querySelectorAll(".playlistItem"));
    }

    // ドラッグ中のアイテム以外を、最終的にあるべき位置に並べ直す。
    // draggedItem自体はtransformで見た目だけ動かし続け、実際のDOM順序の変更は
    // ドラッグ終了時(onEnd)に一度だけ行う（ドラッグ中に頻繁にinsertBeforeし直すと、
    // その都度レイアウトが変わって基準がずれ、複数要素が一気に動いて見える不具合の原因になっていたため）。
    function onMove(clientY) {
      if (!dragging || !draggedItem) return;
      const dy = clientY - startY;
      draggedItem.style.transform = `translateY(${dy}px)`;

      if (itemHeight <= 0) return;

      // dyをアイテム高さで割って「何個分移動したか」を直接求める。
      // Math.roundにより、半分以上重なったところで初めて順位が入れ替わる自然な挙動になる。
      const moveSteps = Math.round(dy / itemHeight);
      let targetIndex = startIndex + moveSteps;
      targetIndex = Math.max(0, Math.min(itemCount - 1, targetIndex));

      const items = getItems();
      items.forEach((item, currentIndex) => {
        if (item === draggedItem) return;
        // このアイテムが現在ドラッグ中アイテムより手前(index的に小さい)にあり、
        // かつドラッグ中アイテムの移動先がそのアイテムの位置以下になった場合、1つ下にずらす。
        // 逆に後ろにあり、移動先がそのアイテムの位置以上になった場合は1つ上にずらす。
        // （実際のDOM順序は変えず、見た目の位置だけtransformでずらす。確定はonEndでまとめて行う。）
        const originalIndex = parseInt(item.dataset.dragOriginalIndex, 10);
        let shift = 0;
        if (originalIndex < startIndex && originalIndex >= targetIndex) {
          shift = 1; // ドラッグ中アイテムがこのアイテムを追い越して上に来た分、このアイテムは1つ下にずれる
        } else if (originalIndex > startIndex && originalIndex <= targetIndex) {
          shift = -1; // ドラッグ中アイテムがこのアイテムを追い越して下に来た分、このアイテムは1つ上にずれる
        }
        item.style.transform = shift !== 0 ? `translateY(${shift * itemHeight}px)` : "translateY(0px)";
      });

      draggedItem.dataset.dragTargetIndex = targetIndex;
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);

      const targetIndex = draggedItem ? parseInt(draggedItem.dataset.dragTargetIndex || startIndex, 10) : startIndex;

      if (draggedItem) {
        draggedItem.classList.remove("dragging");
        draggedItem.style.transform = "";
      }
      getItems().forEach(item => { item.style.transform = ""; });

      // playlist配列を、ドラッグ開始時の元の並び順(dragOriginalIndex)を基準に、
      // draggedItemだけをtargetIndexの位置に差し替えて作り直す。
      if (targetIndex !== startIndex) {
        const originalOrder = getItems()
          .slice()
          .sort((a, b) => parseInt(a.dataset.dragOriginalIndex, 10) - parseInt(b.dataset.dragOriginalIndex, 10))
          .map(el => playlist[parseInt(el.dataset.index, 10)]);

        const movedTrack = originalOrder[startIndex];
        originalOrder.splice(startIndex, 1);
        originalOrder.splice(targetIndex, 0, movedTrack);

        const playingTrack = currentPlaylistIndex >= 0 ? playlist[currentPlaylistIndex] : null;
        playlist.length = 0;
        originalOrder.forEach(t => playlist.push(t));
        if (playingTrack) {
          currentPlaylistIndex = playlist.indexOf(playingTrack);
        }

        persistPlaylistOrder();
      }

      renderPlaylist();
    }

    function onMouseMove(e) { onMove(e.clientY); }
    function onMouseUp() { onEnd(); }
    function onTouchMove(e) {
      if (e.touches.length !== 1) return;
      e.preventDefault(); // ドラッグ中はページの縦スクロールを止める
      onMove(e.touches[0].clientY);
    }
    function onTouchEnd() { onEnd(); }

    function startDrag(clientY) {
      draggedItem = handle.closest(".playlistItem");
      if (!draggedItem) return;

      const items = getItems();
      itemCount = items.length;
      startIndex = items.indexOf(draggedItem);
      if (startIndex === -1) return;

      // ドラッグ開始時点の並び順を、各アイテムのdatasetに固定で記録しておく。
      // ドラッグ中はDOM順序自体を変えないため、この記録がそのままonMoveでの位置計算の基準になる。
      items.forEach((item, i) => { item.dataset.dragOriginalIndex = i; });

      // 実際のアイテム1個分の高さ(gap込み)を実測する。2個以上ある時だけ隣接アイテムとの差分から求め、
      // 1個しかない場合はアイテム自体の高さをそのまま使う。
      const rect = draggedItem.getBoundingClientRect();
      if (items.length > 1) {
        const otherIndex = startIndex === 0 ? 1 : startIndex - 1;
        const otherRect = items[otherIndex].getBoundingClientRect();
        itemHeight = Math.abs(otherRect.top - rect.top) || rect.height;
      } else {
        itemHeight = rect.height;
      }

      dragging = true;
      startY = clientY;
      draggedItem.classList.add("dragging");
      draggedItem.dataset.dragTargetIndex = startIndex;
      hapticTap();
    }

    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      startDrag(e.clientY);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    handle.addEventListener("touchstart", e => {
      if (e.touches.length !== 1) return;
      startDrag(e.touches[0].clientY);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd);
    }, { passive: true });
  });
}

function loadFile(file) {
  if (!file) return;
  
  setAppTitle(file.name);
  hideWelcomeOverlay();

  const url = URL.createObjectURL(file);
  audio.src = url;
  audio.load();
  updatePlaybackRate();

  setupAudioGraph().catch(err => console.warn("setupAudioGraph failed:", err));

  // 波形解析（非同期・別トークンで前回分を無効化）
  waveformPeaks = null;
  waveformDecodeToken++;
  decodeWaveform(file, waveformDecodeToken);

  audio.onloadedmetadata = () => {
    prevTime = audio.currentTime;
    drawWaveform();
    
    const savedPins = localStorage.getItem("mp3_pins_" + file.name);
    if (savedPins) {
      try {
        const raw = JSON.parse(savedPins);
        pins = raw.map(p => typeof p === 'number' ? { t: p, enabled: true, memo: "" } : { t: p.t, enabled: p.enabled !== false, memo: p.memo || "" });
      } catch (e) { pins = []; }
    } else {
      pins = [];
    }

    renderPins();
    renderSegments();
    renderPinList();
    if (window.__qnAudioCtx && window.__qnAudioCtx.state === "suspended") {
      window.__qnAudioCtx.resume().catch(() => {});
    }
    audio.play();
    updatePlayButtonState();
  };
}



function updatePlayButtonState() {
  const playBtn = document.getElementById("playToggle");
  updateMediaSessionPlaybackState(); // Media Session連携。不要なら本行を削除するだけでよい。
  if (!playBtn) return;

  const label = playBtn.querySelector(".top-controls-btn-label");
  const labelText = label ? label.textContent : "";

  if (!audio.paused) {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    playBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
    playBtn.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.4)";
  } else {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    playBtn.style.background = "";
    playBtn.style.boxShadow = "";
  }

  const newLabel = document.createElement("span");
  newLabel.className = "top-controls-btn-label";
  newLabel.textContent = labelText || "Play";
  playBtn.appendChild(newLabel);
}

function togglePlay() {
  hapticTap();
  // ユーザー操作の直接のトリガーであるこの箇所で、AudioContextの一時停止を確実に解除する
  // （resumeはユーザー操作をきっかけに呼ぶ必要があるため、ここが最も確実なタイミング）。
  if (window.__qnAudioCtx && window.__qnAudioCtx.state === "suspended") {
    window.__qnAudioCtx.resume().catch(() => {});
  }

  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
  updatePlayButtonState();
}

// ============================================================
// Media Session API（ロック画面・通知に曲名や再生コントロールを表示する）
// この節は既存の再生ロジックに変更を加えず、navigator.mediaSessionへ情報を渡すだけの独立した機能。
// 非対応ブラウザでは"mediaSession" in navigatorがfalseになり、何もせず安全にスキップされる。
// 不要になった場合はこのブロックと、setAppTitle内のupdateMediaSessionMetadata()呼び出し1行を
// 削除するだけで元に戻せる。
// ============================================================
function updateMediaSessionMetadata(name) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: name || "QN AUDIO PLAYER",
      artist: "QNAUDIO"
    });
  } catch (e) {
    // MediaMetadata非対応環境などは無視する
  }
}

function updateMediaSessionPlaybackState() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
}

if ("mediaSession" in navigator) {
  // ロック画面・通知のコントロールボタンから、既存のtogglePlay等をそのまま呼ぶ
  navigator.mediaSession.setActionHandler("play", () => togglePlay());
  navigator.mediaSession.setActionHandler("pause", () => togglePlay());
  navigator.mediaSession.setActionHandler("previoustrack", () => {
    if (currentPlaylistIndex > 0) playTrackAt(currentPlaylistIndex - 1);
  });
  navigator.mediaSession.setActionHandler("nexttrack", () => {
    if (currentPlaylistIndex >= 0 && currentPlaylistIndex < playlist.length - 1) {
      playTrackAt(currentPlaylistIndex + 1);
    }
  });
}

audio.onplay = updatePlayButtonState;
audio.onpause = updatePlayButtonState;
audio.onended = () => {
  updatePlayButtonState();

  if (repeatMode === "one") {
    // 1曲リピート：同じ曲を繰り返す
    audio.currentTime = 0;
    audio.play();
    updatePlayButtonState();
    return;
  }

  const hasNext = currentPlaylistIndex >= 0 && currentPlaylistIndex < playlist.length - 1;

  if (hasNext) {
    // 通常・全体リピートいずれの場合も、次の曲があればそのまま進む
    playTrackAt(currentPlaylistIndex + 1);
    return;
  }

  if (repeatMode === "all" && playlist.length > 0) {
    // プレイリスト最後まで来た：全体リピートなら先頭の曲に戻ってループを続ける
    playTrackAt(0);
  }
  // repeatMode === "off" かつ次の曲がない場合はそのまま停止する
};

document.getElementById("playToggle").onclick = togglePlay;

function addCurrentPin() {
  if (!audio.duration) return;
  hapticSuccess();
  pins.push({ t: audio.currentTime, enabled: true, memo: "" });
  pins.sort((a, b) => a.t - b.t);
  renderPins();
  renderSegments();
  renderPinList();
  savePins();
}

function jumpToNextMarker() {
  const activePins = pins.filter(p => p.enabled);
  if (activePins.length === 0) return;
  hapticTap();

  const ct = audio.currentTime;
  let nextPin = activePins.find(p => p.t > ct + 0.05);
  if (!nextPin) nextPin = activePins[0];

  isSeeking = true;
  audio.currentTime = nextPin.t;
  prevTime = nextPin.t;
  audio.play();
  updatePlayButtonState();
  renderSegments(getActiveSegment(nextPin.t));
  setTimeout(() => { isSeeking = false; }, 150);
}

function jumpToPrevMarker() {
  const activePins = pins.filter(p => p.enabled);
  if (activePins.length === 0) return;
  hapticTap();

  const ct = audio.currentTime;

  // 現在地より前（＝すでに通過した）マーカーのうち、一番近いものを「直近マーカー」とする
  let targetPin = [...activePins].reverse().find(p => p.t <= ct + 0.05);

  if (targetPin) {
    const diff = ct - targetPin.t;
    if (diff <= 0.5) {
      // 直近マーカーへの到達からまだ0.5秒以内 → もう1つ前のマーカーへ
      const earlierPins = activePins.filter(p => p.t < targetPin.t - 0.05);
      if (earlierPins.length > 0) {
        targetPin = earlierPins[earlierPins.length - 1];
      } else {
        targetPin = activePins[activePins.length - 1];
      }
    }
  } else {
    targetPin = activePins[activePins.length - 1];
  }

  isSeeking = true;
  audio.currentTime = targetPin.t;
  prevTime = targetPin.t;
  audio.play();
  updatePlayButtonState();
  renderSegments(getActiveSegment(targetPin.t));
  setTimeout(() => { isSeeking = false; }, 150);
}

const prevMarkerBtn = document.getElementById("prevMarkerBtn");
if (prevMarkerBtn) prevMarkerBtn.onclick = jumpToPrevMarker;

const nextMarkerBtn = document.getElementById("nextMarkerBtn");
if (nextMarkerBtn) nextMarkerBtn.onclick = jumpToNextMarker;

document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  const activePins = pins.filter(p => p.enabled);

  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    togglePlay();
  }
  else if (e.key === "l" || e.key === "L") {
    e.preventDefault();
    const loopBtn = document.getElementById("loopToggleBtn");
    if (loopBtn) loopBtn.click();
  }
  else if (e.ctrlKey && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    const speedResetBtnEl = document.getElementById("speedResetBtn");
    if (speedResetBtnEl) speedResetBtnEl.click();
    const keyResetBtnEl = document.getElementById("keyResetBtn");
    if (keyResetBtnEl && !keyResetBtnEl.disabled) keyResetBtnEl.click();
  }
  else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    const allRepeatBtn = document.getElementById("allRepeatToggleBtn");
    if (allRepeatBtn) allRepeatBtn.click();
  }
  else if (e.key === "p" || e.key === "P" || e.key === "m" || e.key === "M") {
    e.preventDefault();
    addCurrentPin();
  }
  else if (e.ctrlKey && e.key === "ArrowRight") {
    e.preventDefault();
    setSpeed(currentSpeed + 0.01);
  }
  else if (e.ctrlKey && e.key === "ArrowLeft") {
    e.preventDefault();
    setSpeed(currentSpeed - 0.01);
  }
  else if (e.ctrlKey && e.key === "ArrowUp") {
    e.preventDefault();
    const keyUpBtnEl = document.getElementById("keyUpBtn");
    if (!keyUpBtnEl || !keyUpBtnEl.disabled) setKeySemitones(currentKeySemitones + 1);
  }
  else if (e.ctrlKey && e.key === "ArrowDown") {
    e.preventDefault();
    const keyDownBtnEl = document.getElementById("keyDownBtn");
    if (!keyDownBtnEl || !keyDownBtnEl.disabled) setKeySemitones(currentKeySemitones - 1);
  }
  else if (e.key === "ArrowRight") {
    e.preventDefault();
    jumpToNextMarker();
  }
  else if (e.key === "ArrowLeft") {
    e.preventDefault();
    jumpToPrevMarker();
  }
  else if (e.key === "ArrowUp") {
    if (activePins.length > 0) {
      e.preventDefault();
      isSeeking = true;
      audio.currentTime = activePins[0].t;
      prevTime = activePins[0].t;
      audio.play();
      updatePlayButtonState();
      renderSegments(getActiveSegment(activePins[0].t));
      setTimeout(() => { isSeeking = false; }, 150);
    }
  }
  else if (e.key === "ArrowDown") {
    if (activePins.length > 0) {
      e.preventDefault();
      isSeeking = true;
      audio.currentTime = activePins[activePins.length - 1].t;
      prevTime = activePins[activePins.length - 1].t;
      audio.play();
      updatePlayButtonState();
      renderSegments(getActiveSegment(activePins[activePins.length - 1].t));
      setTimeout(() => { isSeeking = false; }, 150);
    }
  }
  else if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const index = parseInt(e.key) - 1;
    if (pins[index] !== undefined) {
      pins[index].enabled = !pins[index].enabled;
      renderPins();
      renderSegments();
      renderPinList();
      savePins();
    }
  }
  else if (!e.ctrlKey && e.key >= "1" && e.key <= "9") {
    const index = parseInt(e.key) - 1;
    if (activePins[index] !== undefined) {
      e.preventDefault();
      isSeeking = true;
      audio.currentTime = activePins[index].t;
      prevTime = activePins[index].t;
      audio.play();
      updatePlayButtonState();
      renderSegments(getActiveSegment(activePins[index].t));
      setTimeout(() => { isSeeking = false; }, 150);
    }
  }
});

// volumeInputのイベントハンドラは player-ui-pc.js に移動済み



const speedRange = document.getElementById("speedRange");
const speedDisplay = document.getElementById("speedDisplay");
const SPEED_MIN = 0.5;
const SPEED_MAX = 1.5;
updateAvToggleValue("speedToggleValue", currentSpeed.toFixed(2) + "x");

function setSpeed(value) {
  currentSpeed = Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, value)) * 100) / 100;
  speedRange.value = currentSpeed;
  speedDisplay.textContent = currentSpeed.toFixed(2);
  updateAvToggleValue("speedToggleValue", currentSpeed.toFixed(2) + "x");
  updatePlaybackRate();
}

let lastSpeedTickValue = currentSpeed;
// iOS Safari等では、スライダードラッグ中にaudio.playbackRateを高頻度で更新すると
// 音声デコードが追いつかず「ぶつ切り」に聞こえる不具合があるため、
// ドラッグ中は表示テキストだけ即座に更新し、実際の音声エンジンへの反映(updatePlaybackRate)は
// 操作が一段落してから(最後のinputイベントから90ms後)にまとめて1回だけ行う。
let speedApplyDebounceTimer = null;
speedRange.oninput = e => {
  currentSpeed = parseFloat(e.target.value);
  if (currentSpeed !== lastSpeedTickValue) {
    hapticTick();
    lastSpeedTickValue = currentSpeed;
  }
  speedDisplay.textContent = currentSpeed.toFixed(2);
  updateAvToggleValue("speedToggleValue", currentSpeed.toFixed(2) + "x");

  clearTimeout(speedApplyDebounceTimer);
  speedApplyDebounceTimer = setTimeout(() => {
    updatePlaybackRate();
  }, 90);
};

const speedResetBtn = document.getElementById("speedResetBtn");
if (speedResetBtn) {
  speedResetBtn.onclick = () => {
    currentSpeed = 1.0;
    speedRange.value = "1.0";
    speedDisplay.textContent = "1.00";
    updateAvToggleValue("speedToggleValue", "1.00x");
    updatePlaybackRate();
  };
}

const keyDisplay = document.getElementById("keyDisplay");
const keyStepperFill = document.getElementById("keyStepperFill");
const KEY_MIN = -12;
const KEY_MAX = 12;

function renderKeyDisplay() {
  if (keyDisplay) {
    keyDisplay.textContent = (currentKeySemitones > 0 ? "+" : "") + currentKeySemitones;
  }
  if (keyStepperFill) {
    // 中央(0)を起点に、正なら右へ、負なら左へ伸びるバー
    const pct = (Math.abs(currentKeySemitones) / KEY_MAX) * 50;
    keyStepperFill.style.width = pct + "%";
    keyStepperFill.style.left = currentKeySemitones >= 0 ? "50%" : (50 - pct) + "%";
  }
  updateAvToggleValue("keyToggleValue", (currentKeySemitones > 0 ? "+" : "") + currentKeySemitones);
}

function setKeySemitones(value) {
  const clamped = Math.max(KEY_MIN, Math.min(KEY_MAX, value));
  if (clamped !== currentKeySemitones) {
    hapticTick();
  } else if (value !== clamped) {
    // 上限/下限に達していて、それ以上動かせない
    hapticWarning();
  }
  currentKeySemitones = clamped;
  renderKeyDisplay();
  updatePlaybackRate();
}

const keyUpBtn = document.getElementById("keyUpBtn");
const keyDownBtn = document.getElementById("keyDownBtn");
if (keyUpBtn) keyUpBtn.onclick = () => setKeySemitones(currentKeySemitones + 1);
if (keyDownBtn) keyDownBtn.onclick = () => setKeySemitones(currentKeySemitones - 1);

const keyResetBtn = document.getElementById("keyResetBtn");
if (keyResetBtn) keyResetBtn.onclick = () => setKeySemitones(0);

renderKeyDisplay();

// ピッチシフト(位相ボコーダー)の準備が整ったらKEY操作を有効化し、
// グレーアウトと「SOON」バッジを解除する。失敗時は無効のまま維持する。
function updateKeyControlAvailability() {
  const keyToggleBtn = document.getElementById("keyToggleBtn");
  const badge = keyToggleBtn ? keyToggleBtn.querySelector(".key-disabled-badge") : null;

  if (pitchShiftAvailable) {
    [keyToggleBtn, keyResetBtn, keyUpBtn, keyDownBtn].forEach(el => {
      if (el) el.disabled = false;
    });
    if (keyToggleBtn) {
      keyToggleBtn.classList.remove("key-disabled");
      keyToggleBtn.title = "Key";
    }
    if (badge) badge.remove();
  } else {
    [keyToggleBtn, keyResetBtn, keyUpBtn, keyDownBtn].forEach(el => {
      if (el) el.disabled = true;
    });
    if (keyToggleBtn) {
      keyToggleBtn.classList.add("key-disabled");
      keyToggleBtn.title = "Key change is unavailable in this browser (AudioWorklet not supported)";
    }
  }
}

// 10バンド・グラフィックイコライザーのUI制御
function setEqBandValue(bandIndex, gain) {
  gain = Math.max(-15, Math.min(15, Math.round(gain)));
  const slider = document.getElementById("eqBand" + bandIndex);
  const gainLabel = document.getElementById("eqGain" + bandIndex);
  if (slider) slider.value = gain;
  if (gainLabel) gainLabel.textContent = (gain > 0 ? "+" : "") + gain;
  const filter = eqFilters[bandIndex];
  if (filter) filter.gain.value = gain;
}

// 各バンドのrangeスライダー：通常のクリック/キーボード操作にも対応
const eqLastTickValues = new Array(EQ_FREQS.length).fill(0);
for (let i = 0; i < EQ_FREQS.length; i++) {
  const slider = document.getElementById("eqBand" + i);
  if (slider) {
    slider.oninput = e => {
      const gain = parseFloat(e.target.value);
      if (gain !== eqLastTickValues[i]) {
        hapticTick();
        eqLastTickValues[i] = gain;
      }
      setEqBandValue(i, gain);
    };
  }
}

// EQプリセット。各配列はEQ_FREQS([31,62,125,250,500,1000,2000,4000,8000,16000])の順に対応する10個のdB値。
const EQ_PRESETS = {
  flat:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass:   [8, 7, 6, 4, 2, 0, 0, 0, 0, 0],
  vocal:  [-2, -2, -1, 1, 4, 5, 4, 2, 0, -1],
  treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  vshape: [7, 6, 3, 0, -3, -4, -3, 0, 4, 6]
};

function applyEqPreset(presetName) {
  const values = EQ_PRESETS[presetName];
  if (!values) return;
  values.forEach((gain, i) => setEqBandValue(i, gain));
}

// プリセットボタンの選択状態(active)を更新する。nameがnullなら「どれも選ばれていない(Custom相当)」状態にする。
function setActiveEqPresetButton(name) {
  document.querySelectorAll(".eq-preset-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-preset") === name);
  });
}

document.querySelectorAll(".eq-preset-btn").forEach(btn => {
  btn.onclick = () => {
    hapticTap();
    const preset = btn.getAttribute("data-preset");
    applyEqPreset(preset);
    setActiveEqPresetButton(preset);
  };
});

// バンドを手動で操作したら、どのプリセットボタンも選択されていない状態に戻す
for (let i = 0; i < EQ_FREQS.length; i++) {
  const slider = document.getElementById("eqBand" + i);
  if (slider) {
    slider.addEventListener("input", () => {
      setActiveEqPresetButton(null);
    });
  }
}

// ドラッグで複数バンドを一気に「山なり」に描画する操作
const eqBandsEl = document.getElementById("eqBands");
if (eqBandsEl) {
  let eqDragging = false;

  function applyEqDragAt(clientX, clientY) {
    const bandEls = eqBandsEl.querySelectorAll(".eq-band");
    let changed = false;
    bandEls.forEach((bandEl, i) => {
      const track = bandEl.querySelector(".eq-slider-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      // ドラッグ中のX座標がこのバンドの列の範囲内にあるときだけ、そのバンドの値をY座標から更新する
      if (clientX >= rect.left && clientX <= rect.right) {
        const ratio = 1 - (clientY - rect.top) / rect.height; // 上が+15, 下が-15
        const gain = -15 + Math.max(0, Math.min(1, ratio)) * 30;
        setEqBandValue(i, gain);
        changed = true;
      }
    });
    if (changed) {
      setActiveEqPresetButton(null);
    }
  }

  eqBandsEl.addEventListener("mousedown", e => {
    eqDragging = true;
    applyEqDragAt(e.clientX, e.clientY);
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!eqDragging) return;
    applyEqDragAt(e.clientX, e.clientY);
  });

  document.addEventListener("mouseup", () => {
    eqDragging = false;
  });

  // タッチ操作対応
  eqBandsEl.addEventListener("touchstart", e => {
    eqDragging = true;
    const t = e.touches[0];
    applyEqDragAt(t.clientX, t.clientY);
  }, { passive: true });

  eqBandsEl.addEventListener("touchmove", e => {
    if (!eqDragging) return;
    const t = e.touches[0];
    applyEqDragAt(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  eqBandsEl.addEventListener("touchend", () => {
    eqDragging = false;
  });
}

// EQモーダルの開閉（Exportモーダルと同じパターン）
const eqToggleBtn = document.getElementById("eqToggleBtn");
const eqModalOverlay = document.getElementById("eqModalOverlay");
const eqModalCloseBtn = document.getElementById("eqModalCloseBtn");

function openEqModal() {
  hapticTap();
  if (eqModalOverlay) eqModalOverlay.classList.add("open");
}

function closeEqModal() {
  hapticTap();
  if (eqModalOverlay) eqModalOverlay.classList.remove("open");
}

if (eqToggleBtn) {
  eqToggleBtn.onclick = (e) => {
    e.stopPropagation();
    openEqModal();
  };
}
if (eqModalCloseBtn) {
  eqModalCloseBtn.onclick = () => closeEqModal();
}
if (eqModalOverlay) {
  // オーバーレイの背景部分（モーダル本体の外側）をクリックしたら閉じる
  eqModalOverlay.onclick = (e) => {
    if (e.target === eqModalOverlay) closeEqModal();
  };
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && eqModalOverlay && eqModalOverlay.classList.contains("open")) {
    closeEqModal();
  }
});

// VOL / SPEED / KEY ポップアップの開閉（同じ開閉パターンを共通化）
const avPopupInstances = [];

// ポップアップがボタンの下に開くと画面外（下方向）にはみ出す場合、
// 上に開き直す（画面内に必ず収まるようにする）。
// popup要素は position: absolute で toggleBtn の直近の position:relative 祖先を基準に配置されるため、
// 実際の画面内での収まり具合は getBoundingClientRect() で毎回判定し直す必要がある。
function keepPopupInViewport(toggleBtn, popup) {
  // 一旦「下に開く」基準の状態に戻してから採寸する（前回「上開き」のままだと採寸がずれるため）
  popup.classList.remove("open-upward");

  // 表示状態でないと正確な高さが取れないため、次のフレームで採寸する
  requestAnimationFrame(() => {
    const btnRect = toggleBtn.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    const spaceBelow = viewportHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;

    // 下方向に十分な余白がなく、上方向の方が広ければ上に開く
    if (spaceBelow < popupRect.height + 16 && spaceAbove > spaceBelow) {
      popup.classList.add("open-upward");
    }

    // 横方向も画面外にはみ出していたら、右端に揃えず画面内に収める
    const popupRectAfter = popup.getBoundingClientRect();
    if (popupRectAfter.left < 8) {
      popup.style.left = "8px";
      popup.style.right = "auto";
    } else {
      popup.style.left = "";
      popup.style.right = "";
    }
  });
}

function setupAvPopup(toggleBtnId, popupId) {
  const toggleBtn = document.getElementById(toggleBtnId);
  const popup = document.getElementById(popupId);
  if (!toggleBtn || !popup) return;

  const instance = { toggleBtn, popup };
  avPopupInstances.push(instance);

  function closeThis() {
    popup.classList.remove("open");
    toggleBtn.classList.remove("active");
  }

  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    if (toggleBtn.disabled) return;
    hapticTap();

    const willOpen = !popup.classList.contains("open");
    // VOL/SPEED/KEYは排他：開く前に他の全ポップアップを閉じる
    avPopupInstances.forEach(other => {
      if (other !== instance) {
        other.popup.classList.remove("open");
        other.toggleBtn.classList.remove("active");
      }
    });

    popup.classList.toggle("open", willOpen);
    toggleBtn.classList.toggle("active", willOpen);
    if (willOpen) keepPopupInViewport(toggleBtn, popup);
  };
  popup.onclick = (e) => {
    e.stopPropagation();
  };
  document.addEventListener("click", closeThis);
}

setupAvPopup("volToggleBtn", "volPopup");
setupAvPopup("speedToggleBtn", "speedPopup");
setupAvPopup("keyToggleBtn", "keyPopup");



function updateBars() {
  requestAnimationFrame(updateBars);
  if (!audio.duration) return;

  const dur = audio.duration;
  const ct = audio.currentTime;

  const currentValEl = document.getElementById("currentTimeVal");
  const durationValEl = document.getElementById("durationVal");
  if (currentValEl && durationValEl) {
    currentValEl.textContent = formatTime(ct);
    durationValEl.textContent = formatTime(dur);
  }

  const { s1, s2, s3, s4, s5 } = getSegments(dur);

  let p = [0, 0, 0, 0, 0, 0];
  let thresholds = [0, s1, s2, s3, s4, s5, dur];

  for (let i = 0; i < 6; i++) {
    if (ct >= thresholds[i + 1]) {
      p[i] = 100;
    } else if (ct > thresholds[i]) {
      p[i] = ((ct - thresholds[i]) / (thresholds[i + 1] - thresholds[i])) * 100;
      break;
    } else {
      p[i] = 0;
    }
  }

  for (let i = 1; i <= 6; i++) {
    const fillEl = document.getElementById(`fill${i}`);
    if (fillEl) fillEl.style.width = p[i - 1] + "%";
  }

  const activePins = pins.filter(p => p.enabled).map(p => p.t);
  if (loopEnabled && !isSeeking && !isJumping && !audio.paused && activePins.length >= 2) {
    for (let i = 0; i < activePins.length - 1; i++) {
      const start = activePins[i];
      const end = activePins[i+1];

      if (prevTime < end && ct >= end) {
        audio.currentTime = start;
        isJumping = true;
        renderSegments({ start, end });
        setTimeout(() => {
          isJumping = false;
        }, 200);
        break;
      }
    }
  }

  prevTime = audio.currentTime;
  // renderSegments()は区間が実際に変わった時だけ呼ぶ（マーカー追加/削除/シーク/Loop切替時）。
  // 毎フレーム呼ぶとDOM要素(.segmentHighlight)が再生成され続け、
  // スマホでのタップ・ドラッグ操作の途中でイベントターゲットが失われて操作不能になるため。
}

updateBars();

function calcTimeFromBarPosition(bar, barIndex, clientX) {
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const dur = audio.duration;
  const { s1, s2, s3, s4, s5 } = getSegments(dur);
  const boundaries = [0, s1, s2, s3, s4, s5, dur];
  return boundaries[barIndex] + ratio * (boundaries[barIndex + 1] - boundaries[barIndex]);
}

document.querySelectorAll(".vbar").forEach((bar, index) => {
  bar.addEventListener("click", e => {
    // MOVEモード中は、選択中のマーカーをタップした位置に移動する（シークはしない）
    if (moveModeMarkerIndex !== null && pins[moveModeMarkerIndex]) {
      const newTime = calcTimeFromBarPosition(bar, index, e.clientX);
      pins[moveModeMarkerIndex].t = Math.max(0, Math.min(audio.duration, newTime));
      pins.sort((a, b) => a.t - b.t);
      moveModeMarkerIndex = pins.findIndex(p => Math.abs(p.t - newTime) < 0.001);
      renderPins();
      renderSegments();
      renderPinList();
      savePins();
      return;
    }

    isSeeking = true;

    const clickedTime = calcTimeFromBarPosition(bar, index, e.clientX);

    audio.currentTime = clickedTime;
    prevTime = clickedTime;

    renderSegments(getActiveSegment(clickedTime));
    audio.play();
    updatePlayButtonState();

    setTimeout(() => {
      isSeeking = false;
    }, 150);
  });

  // スマホ：MOVEモード中は波形上のドラッグでも選択中マーカーを追従移動できるようにする
  let moveDragging = false;
  bar.addEventListener("touchstart", e => {
    if (moveModeMarkerIndex === null) return;
    moveDragging = true;
    e.preventDefault();
    const t = e.touches[0];
    const newTime = calcTimeFromBarPosition(bar, index, t.clientX);
    if (pins[moveModeMarkerIndex]) {
      pins[moveModeMarkerIndex].t = Math.max(0, Math.min(audio.duration, newTime));
      renderPins();
      renderSegments();
    }
  }, { passive: false });

  bar.addEventListener("touchmove", e => {
    if (!moveDragging || moveModeMarkerIndex === null) return;
    e.preventDefault();
    const t = e.touches[0];
    const newTime = calcTimeFromBarPosition(bar, index, t.clientX);
    if (pins[moveModeMarkerIndex]) {
      pins[moveModeMarkerIndex].t = Math.max(0, Math.min(audio.duration, newTime));
      renderPins();
      renderSegments();
    }
  }, { passive: false });

  bar.addEventListener("touchend", () => {
    if (!moveDragging) return;
    moveDragging = false;
    if (moveModeMarkerIndex !== null && pins[moveModeMarkerIndex]) {
      const movedTime = pins[moveModeMarkerIndex].t;
      pins.sort((a, b) => a.t - b.t);
      moveModeMarkerIndex = pins.findIndex(p => Math.abs(p.t - movedTime) < 0.001);
      renderPins();
      renderPinList();
      savePins();
    }
  });
});

const loopToggleBtn = document.getElementById("loopToggleBtn");
if (loopToggleBtn) {
  loopToggleBtn.onclick = () => {
    hapticTap();
    loopEnabled = !loopEnabled;
    loopToggleBtn.style.opacity = loopEnabled ? "1" : "0.4";
    loopToggleBtn.style.borderColor = loopEnabled ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.08)";
    renderSegments();
  };
  loopToggleBtn.style.opacity = "0.4";
}

const allRepeatToggleBtn = document.getElementById("allRepeatToggleBtn");

const REPEAT_ICON_OFF = '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>';
const REPEAT_ICON_ALL = '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>';
const REPEAT_ICON_ONE = '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg><span class="repeat-one-badge">1</span>';

function applyRepeatModeUI() {
  if (!allRepeatToggleBtn) return;

  const iconHtml = repeatMode === "one" ? REPEAT_ICON_ONE : repeatMode === "all" ? REPEAT_ICON_ALL : REPEAT_ICON_OFF;
  const labelText = repeatMode === "one" ? "Repeat 1" : repeatMode === "all" ? "Repeat All" : "Repeat";

  allRepeatToggleBtn.innerHTML = iconHtml;
  const label = document.createElement("span");
  label.className = "top-controls-btn-label";
  label.textContent = labelText;
  allRepeatToggleBtn.appendChild(label);

  const isActive = repeatMode !== "off";
  allRepeatToggleBtn.style.opacity = isActive ? "1" : "0.4";
  allRepeatToggleBtn.style.borderColor = isActive ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.08)";
  allRepeatToggleBtn.title = repeatMode === "one" ? "Repeat One (click to cycle)" : repeatMode === "all" ? "Repeat All (click to cycle)" : "Repeat Off (click to cycle)";
}

if (allRepeatToggleBtn) {
  allRepeatToggleBtn.onclick = () => {
    hapticTap();
    repeatMode = repeatMode === "off" ? "one" : repeatMode === "one" ? "all" : "off";
    applyRepeatModeUI();
  };
  applyRepeatModeUI();
}

document.getElementById("addPinBtn").onclick = addCurrentPin;

// SP幅限定の+MARKER/SELECT FILEインラインボタンは player-ui-sp.js に移動済み



// マーカーのMOVEモード（スマホ用）：選択中のマーカーindexを保持。nullなら非選択。
let moveModeMarkerIndex = null;
const isMobileLayout = () => window.matchMedia("(max-width: 768px)").matches;

function exitMoveMode() {
  moveModeMarkerIndex = null;
  renderPins();
}

function enterMoveMode(index) {
  moveModeMarkerIndex = index;
  renderPins();
}

function renderPins() {
  const dur = audio.duration;

  document.querySelectorAll(".vbar").forEach(bar => {
    bar.querySelectorAll(".vbar-line").forEach(p => p.remove());
  });

  pins.forEach((pinObj, i) => {
    const t = pinObj.t;
    const row = getPinRow(t, dur);
    const x = timeToPercentInRow(t, dur);

    const line = document.createElement("div");
    line.className = "vbar-line";
    if (!pinObj.enabled) {
      line.classList.add("disabled");
    }
    if (moveModeMarkerIndex === i) {
      line.classList.add("move-mode-active");
    }
    line.style.left = `${x}%`;

    const label = document.createElement("span");
    label.className = "vbar-label";
    label.textContent = `#${i + 1}`;
    if (moveModeMarkerIndex === i) {
      label.classList.add("move-mode-active");
    }

    function handleMarkerTapOrDrag(e) {
      e.stopPropagation();

      if (isMobileLayout()) {
        // スマホ：MOVEモード方式。選択中のマーカーを再タップしたら終了、それ以外は選択状態にする。
        if (moveModeMarkerIndex === i) {
          exitMoveMode();
        } else {
          isSeeking = true;
          audio.currentTime = pinObj.t;
          prevTime = pinObj.t;
          audio.play();
          updatePlayButtonState();
          renderSegments(getActiveSegment(pinObj.t));
          setTimeout(() => { isSeeking = false; }, 150);
          enterMoveMode(i);
        }
      } else {
        // PC：従来通りタップでそのマーカーへシーク＆再生
        isSeeking = true;
        audio.currentTime = pinObj.t;
        prevTime = pinObj.t;
        audio.play();
        updatePlayButtonState();
        renderSegments(getActiveSegment(pinObj.t));
        setTimeout(() => { isSeeking = false; }, 150);
      }
    }

    label.onclick = handleMarkerTapOrDrag;
    line.onclick = handleMarkerTapOrDrag;

    // PC：ドラッグでマーカーを直接動かせる（従来通り）
    label.onmousedown = startDragPin(i);
    line.onmousedown = startDragPin(i);
    // スマホ：ドラッグでの直接移動は行わない（MOVEモードのタップ移動に統一するため、
    // touchstartはハンドラを付けずタップ(click)だけで動くようにする）

    line.appendChild(label);

    const targetBar = document.getElementById(`bar${row}`);
    if (targetBar) {
      targetBar.appendChild(line);
    }
  });

  const activeCount = pins.filter(p => p.enabled).length;
  const loopInfo = document.getElementById("loopInfo");
  if (loopInfo) {
    loopInfo.textContent = `ACTIVE ${activeCount}/${pins.length}`;
  }
}

function renderSegments(overrideSegment) {
  const dur = audio.duration;
  if (!dur) return;

  document.querySelectorAll(".vbar").forEach(bar => {
    bar.querySelectorAll(".segmentHighlight").forEach(s => s.remove());
  });

  if (!loopEnabled) return;

  // ループジャンプ直後など、audio.currentTimeの読み取りタイミングに左右されず
  // 確実に正しい区間を描画したい場合は、呼び出し側から区間を明示的に渡す。
  const active = overrideSegment || getActiveSegment();
  if (!active) return;

  const { s1, s2, s3, s4, s5 } = getSegments(dur);
  const barsInfo = [
    { el: document.getElementById("bar1"), start: 0, end: s1 },
    { el: document.getElementById("bar2"), start: s1, end: s2 },
    { el: document.getElementById("bar3"), start: s2, end: s3 },
    { el: document.getElementById("bar4"), start: s3, end: s4 },
    { el: document.getElementById("bar5"), start: s4, end: s5 },
    { el: document.getElementById("bar6"), start: s5, end: dur }
  ];

  barsInfo.forEach(b => {
    const overlapStart = Math.max(active.start, b.start);
    const overlapEnd = Math.min(active.end, b.end);

    if (overlapStart < overlapEnd) {
      const leftPct = ((overlapStart - b.start) / (b.end - b.start)) * 100;
      const rightPct = ((overlapEnd - b.start) / (b.end - b.start)) * 100;
      const widthPct = rightPct - leftPct;

      const seg = document.createElement("div");
      seg.className = "segmentHighlight";
      seg.style.left = leftPct + "%";
      seg.style.width = widthPct + "%";

      seg.onclick = () => {
        isSeeking = true;
        audio.currentTime = active.start;
        prevTime = active.start;
        audio.play();
        updatePlayButtonState();
        renderSegments(active);
        setTimeout(() => { isSeeking = false; }, 150);
      };

      b.el.appendChild(seg);
    }
  });
}

// startDragPin関数の定義は player-ui-pc.js に移動済み（renderPins内から呼ばれる）

function renderPinList() {
  const list = document.getElementById("pinList");
  if (list) list.innerHTML = "";

  pins.forEach((pinObj, i) => {
    const div = document.createElement("div");
    div.className = "pinItem";
    if (!pinObj.enabled) {
      div.classList.add("disabled");
    }

    const infoSpan = document.createElement("span");
    infoSpan.className = "pin-info";
    // メモが入っていれば時間の代わりにメモを表示し、メモがなければ従来通り時間を表示する
    infoSpan.textContent = pinObj.memo
      ? `#${i + 1} - ${pinObj.memo}`
      : `#${i + 1} - ${pinObj.t.toFixed(2)}s`;
    if (pinObj.memo) infoSpan.title = pinObj.memo;

    infoSpan.onclick = () => { 
      isSeeking = true;
      audio.currentTime = pinObj.t; 
      prevTime = pinObj.t;
      audio.play(); 
      updatePlayButtonState();
      renderSegments(getActiveSegment(pinObj.t));
      setTimeout(() => { isSeeking = false; }, 150);
    };
    div.appendChild(infoSpan);

    // メモ編集用の鉛筆ボタン。押すとinfoSpanの表示をテキスト入力に一時的に切り替える。
    const editBtn = document.createElement("button");
    editBtn.className = "pin-edit-btn";
    editBtn.title = "Edit memo";
    editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      startPinMemoEdit(div, infoSpan, pinObj, i);
    };
    div.appendChild(editBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.textContent = pinObj.enabled ? "ON" : "OFF";
    toggleBtn.style.color = pinObj.enabled ? "var(--accent-primary)" : "#8b8b9e";
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      pinObj.enabled = !pinObj.enabled;
      renderPins();
      renderSegments();
      renderPinList();
      savePins();
    };
    div.appendChild(toggleBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.className = "del-btn";
    delBtn.style.color = "#ef4444";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (delBtn.classList.contains("confirm")) {
        hapticWarning();
        pins.splice(i, 1);
        renderPins();
        renderSegments();
        renderPinList();
        savePins();
      } else {
        hapticTap();
        delBtn.classList.add("confirm");
        delBtn.textContent = "✓";
        clearTimeout(delBtn._confirmTimer);
        delBtn._confirmTimer = setTimeout(() => {
          delBtn.classList.remove("confirm");
          delBtn.textContent = "✕";
        }, 3000);
      }
    };
    div.appendChild(delBtn);

    if (list) {
      list.appendChild(div);
    }
  });
}

// マーカーのメモ編集：infoSpanをその場でテキスト入力に差し替える。
// Enterまたはフォーカスアウトで確定し、Escでキャンセルする。
function startPinMemoEdit(itemDiv, infoSpan, pinObj, index) {
  if (itemDiv.querySelector(".pin-memo-input")) return; // 既に編集中なら何もしない

  const input = document.createElement("input");
  input.type = "text";
  input.className = "pin-memo-input";
  input.value = pinObj.memo || "";
  input.placeholder = `#${index + 1} - ${pinObj.t.toFixed(2)}s`;
  input.maxLength = 60;

  infoSpan.style.display = "none";
  itemDiv.insertBefore(input, infoSpan);
  input.focus();
  input.select();

  let finished = false;
  function commit() {
    if (finished) return;
    finished = true;
    pinObj.memo = input.value.trim();
    savePins();
    renderPinList();
  }
  function cancel() {
    if (finished) return;
    finished = true;
    renderPinList();
  }

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", e => e.stopPropagation());
}

// Keyboard Shortcuts はヘッダーのポップアップ(shortcutsToggleBtn/shortcutsPopup)に統合済み

// スマホ専用タブ切り替え（Time&Vol / Speed&Key / Markers / Playlist）
// デフォルトは "time"。
// スマホ幅では選択中タブのパネルを #mobileTabSlot （タブのすぐ下）に移動して表示する。
// これによりMarkers/Playlistタブに切り替えた際、波形や再生ボタンを飛び越えてスクロールする必要がなくなる。
// PC幅では移動処理自体を行わず、各パネルは元のレイアウト位置（Time/Speed行、サイドバー内）にそのまま表示される。
const mobileTabBtns = document.querySelectorAll(".mobile-tab-btn");
const mobileTabSlot = document.getElementById("mobileTabSlot");
const mobileTabMedia = window.matchMedia("(max-width: 768px)");

// 各パネルの元の位置（親要素と直前の兄弟）を記録しておき、PC幅に戻すときに正確に復元する
const mobileTabPanelOrigins = new Map();
document.querySelectorAll(".mobile-tab-panel").forEach(panel => {
  mobileTabPanelOrigins.set(panel, {
    parent: panel.parentNode,
    nextSibling: panel.nextSibling
  });
});

let currentMobileTab = "basic";

function applyMobileTabLayout() {
  const isMobile = mobileTabMedia.matches;

  document.querySelectorAll(".mobile-tab-panel").forEach(panel => {
    const tabName = panel.getAttribute("data-tab-panel");
    const origin = mobileTabPanelOrigins.get(panel);

    if (isMobile) {
      // スマホ幅：選択中タブのパネルだけをスロットに移動する
      if (tabName === currentMobileTab) {
        if (mobileTabSlot && panel.parentNode !== mobileTabSlot) {
          mobileTabSlot.appendChild(panel);
        }
        panel.classList.add("mobile-tab-active");
      } else {
        // 非選択タブは元の位置に戻したまま非表示にする（スロットを専有しないように）
        if (origin && panel.parentNode === mobileTabSlot) {
          origin.parent.insertBefore(panel, origin.nextSibling);
        }
        panel.classList.remove("mobile-tab-active");
      }
    } else {
      // PC幅：全パネルを元の位置に戻し、常時表示state（mobile-tab-activeクラス自体はもう無関係）
      if (origin && panel.parentNode === mobileTabSlot) {
        origin.parent.insertBefore(panel, origin.nextSibling);
      }
      panel.classList.remove("mobile-tab-active");
    }
  });
}

function setMobileTab(tabName) {
  currentMobileTab = tabName;
  mobileTabBtns.forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
  });
  applyMobileTabLayout();
}

// playbackButtonsGroup(Play/Repeat)の元の位置を、タブ移動処理が走る前に必ず記録しておく。
// これを後回しにすると、Basicタブパネルの移動でplaybackButtonsGroupも巻き込まれて位置がずれた後に
// 記録することになり、元の位置に正しく復元できなくなる。
const playbackButtonsGroup = document.getElementById("playbackButtonsGroup");
const playbackButtonsSlot = document.getElementById("playbackButtonsSlot");
let playbackButtonsOrigin = null;
if (playbackButtonsGroup) {
  playbackButtonsOrigin = {
    parent: playbackButtonsGroup.parentNode,
    nextSibling: playbackButtonsGroup.nextSibling
  };
}

function applyPlaybackButtonsLayout() {
  if (!playbackButtonsGroup || !playbackButtonsSlot || !playbackButtonsOrigin) return;

  if (isMobileLayout()) {
    if (playbackButtonsGroup.parentNode !== playbackButtonsSlot) {
      playbackButtonsSlot.appendChild(playbackButtonsGroup);
    }
  } else {
    if (playbackButtonsGroup.parentNode === playbackButtonsSlot) {
      playbackButtonsOrigin.parent.insertBefore(playbackButtonsGroup, playbackButtonsOrigin.nextSibling);
    }
  }
}

// ============================================================
// SELECT FILE・EXPORTは画面幅を問わず、常に
//   PC幅: TIME行のPlay/Repeatの右（#pcSelectFileSlot）
//   SP幅: Basicタブの一番下、EQ本体の直後（#mobileSelectFileSlot）
// のどちらかに存在する（元のサイドバー内・adjust-controls-row内には戻さない）。
// EQ本体(#eqInlineSection)は従来通りSP幅限定でBasicタブ内に移動、PC幅ではEQモーダル内に戻す。
// ============================================================
function createDualSlotMoveController(elementId, mobileSlotId, pcSlotId, insertBeforePcSlot) {
  const element = document.getElementById(elementId);
  const mobileSlot = document.getElementById(mobileSlotId);
  const pcSlot = document.getElementById(pcSlotId);
  if (!element || !mobileSlot || !pcSlot) return null;

  return function apply() {
    if (isMobileLayout()) {
      if (element.parentNode !== mobileSlot) {
        mobileSlot.appendChild(element);
      }
    } else {
      if (insertBeforePcSlot) {
        if (element.nextSibling !== pcSlot || element.parentNode !== pcSlot.parentNode) {
          pcSlot.parentNode.insertBefore(element, pcSlot);
        }
      } else {
        if (element.parentNode !== pcSlot) {
          pcSlot.appendChild(element);
        }
      }
    }
  };
}

// EQセクションはSP幅・PC幅を問わず常にEQモーダル内（元の位置）に留める。
// SP版では画面のスクロールとEQスライダーのドラッグ操作が競合し、
// スクロールできなくなる問題があったため、モーダルの中に閉じ込めて解決する。
const eqInlineSection = document.getElementById("eqInlineSection");
const mobileSelectFileSlotEl = document.getElementById("mobileSelectFileSlot");
let eqInlineOrigin = null;
if (eqInlineSection) {
  eqInlineOrigin = {
    parent: eqInlineSection.parentNode,
    nextSibling: eqInlineSection.nextSibling
  };
}

function applyEqInlineLayout() {
  if (!eqInlineSection || !eqInlineOrigin) return;
  if (eqInlineSection.parentNode !== eqInlineOrigin.parent) {
    eqInlineOrigin.parent.insertBefore(eqInlineSection, eqInlineOrigin.nextSibling);
  }
}

// EXPORTボタン：SP幅ではEQ本体の直後・SELECT FILEの直前、PC幅ではpcSelectFileSlotの直前（Repeatの右、SelectFileより先）
const applyExportBtnLayout = createDualSlotMoveController("exportToggleBtn", "mobileSelectFileSlot", "pcSelectFileSlot", true);

// SELECT FILE：SP幅ではExportの直後（Basicタブ最後）、PC幅ではpcSelectFileSlotの中（Exportの後）
const applySelectFileLayout = createDualSlotMoveController("fileUploadWrapper", "mobileSelectFileSlot", "pcSelectFileSlot", false);

function applyMobileBasicExtras() {
  applyEqInlineLayout();
  if (applyExportBtnLayout) applyExportBtnLayout();
  if (applySelectFileLayout) applySelectFileLayout();
}

mobileTabBtns.forEach(btn => {
  btn.onclick = () => {
    hapticTap();
    setMobileTab(btn.getAttribute("data-tab"));
    applyPlaybackButtonsLayout();
    applyMobileBasicExtras();
  };
});

// 画面幅がPC⇔スマホの境界を跨いだ時にも再配置する
if (mobileTabMedia.addEventListener) {
  mobileTabMedia.addEventListener("change", () => {
    applyMobileTabLayout();
    applyPlaybackButtonsLayout();
    applyMobileBasicExtras();
  });
} else if (mobileTabMedia.addListener) {
  mobileTabMedia.addListener(() => {
    applyMobileTabLayout();
    applyPlaybackButtonsLayout();
    applyMobileBasicExtras();
  });
}

setMobileTab("basic");
applyPlaybackButtonsLayout();
applyMobileBasicExtras();

function syncAllMobileLayout() {
  applyPlaybackButtonsLayout();
  applyMobileBasicExtras();
}
window.addEventListener("resize", syncAllMobileLayout);

function syncTopControlsSpacerHeight() {
  const topControls = document.getElementById("topControls");
  const spacer = document.getElementById("topControlsSpacer");
  const tabSlot = document.getElementById("mobileTabSlot");
  if (!topControls || !spacer) return;
  if (isMobileLayout()) {
    const h = topControls.getBoundingClientRect().height;
    spacer.style.height = h + "px";
    // SP幅ではbody自体はスクロールしない(overflow: hidden)ため、bodyへのpadding-bottomは意味を持たない。
    // 実際にスクロールするのは#mobileTabSlotなので、そちらにtopControlsの高さ分の余白を確保し、
    // スクロール最下部のコンテンツがtopControls(画面下部固定)の裏に隠れないようにする。
    if (tabSlot) tabSlot.style.paddingBottom = (h + 8) + "px";
    document.body.style.paddingBottom = "";
  } else {
    spacer.style.height = "0px";
    document.body.style.paddingBottom = "";
    if (tabSlot) tabSlot.style.paddingBottom = "";
  }
}
syncTopControlsSpacerHeight();
window.addEventListener("resize", syncTopControlsSpacerHeight);

window.onload = async () => {
  updatePlayButtonState();
  applyPlaybackButtonsLayout();
  applyMobileBasicExtras();
  syncTopControlsSpacerHeight();
  await restorePlaylistFromStorage();
};

// 起動時、IndexedDBに保存されている曲を全てプレイリストへ復元する。
// addFilesToPlaylistと違い、復元時は自動再生しない（ユーザー操作なしのplay()はブラウザにブロックされ得るうえ、
// 意図せず音が鳴るのを避けるため）。また復元した曲を再度IndexedDBに書き戻す必要はない。
async function restorePlaylistFromStorage() {
  const savedFiles = await loadAllPlaylistTracks();
  if (savedFiles.length === 0) return;

  savedFiles.forEach(file => {
    playlist.push({ file, name: file.name });
  });
  renderPlaylist();

  // 1曲目を選曲済み状態にする（タイトル表示・波形読み込みまで行うが、
  // loadFile()自体はaudio.play()を呼ばないため自動再生はされない）。
  playTrackAt(0);
}

// ============================================================
// ハプティクス（対応デバイスのみ、非対応環境では何も起きず安全に無視される）
// docs/ui-motion-haptics-design.md の4パターンに対応：
//   tap     : ボタン全般の押下、タブ切替、ポップアップ開閉、スウォッチ選択
//   tick    : スライダーが目盛りの区切りを跨いだ瞬間（呼び出し側で間引くこと）
//   success : マーカー追加、Export完了など「達成」の区切り
//   warning : 削除確認、エラー、範囲の上限/下限到達など注意を引きたい場面
// ============================================================
function hapticTap() {
  if (navigator.vibrate) navigator.vibrate(10);
}
function hapticTick() {
  if (navigator.vibrate) navigator.vibrate(6);
}
function hapticSuccess() {
  if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
}
function hapticWarning() {
  if (navigator.vibrate) navigator.vibrate([20, 60, 20, 60, 20]);
}

// ============================================================
// エクスポート処理本体：AudioBuffer -> WAV変換、OfflineAudioContextでのレンダリング
// ============================================================

// AudioBufferをWAV(PCM 16bit, リトルエンディアン)形式のBlobに変換する。


// ============================================================
// エクスポートモーダル：開閉と、Range/Effects/FileName等の状態管理
// ============================================================
const exportToggleBtn = document.getElementById("exportToggleBtn");
const exportModalOverlay = document.getElementById("exportModalOverlay");
const exportModalCloseBtn = document.getElementById("exportModalCloseBtn");
const exportRangeAll = document.getElementById("exportRangeAll");
const exportRangeMarker = document.getElementById("exportRangeMarker");
const exportMarkerSelect = document.getElementById("exportMarkerSelect");
const exportFileNameInput = document.getElementById("exportFileName");
const exportRunBtn = document.getElementById("exportRunBtn");
const exportStatusEl = document.getElementById("exportStatus");

// currentFileNameの拡張子を除いた部分を、エクスポートファイル名の初期値として使う


// 有効なマーカー（ON状態）のペア一覧をプルダウンに反映する
function populateExportMarkerSelect() {
  const activePins = pins.filter(p => p.enabled).sort((a, b) => a.t - b.t);
  exportMarkerSelect.innerHTML = "";

  if (activePins.length < 2) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No marker pairs available";
    exportMarkerSelect.appendChild(opt);
    exportMarkerSelect.disabled = true;
    if (exportRangeMarker) exportRangeMarker.disabled = true;
    return;
  }

  if (exportRangeMarker) exportRangeMarker.disabled = false;
  for (let i = 0; i < activePins.length - 1; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `#${i + 1} (${activePins[i].t.toFixed(2)}s) → #${i + 2} (${activePins[i + 1].t.toFixed(2)}s)`;
    exportMarkerSelect.appendChild(opt);
  }
  exportMarkerSelect.disabled = !exportRangeMarker.checked;
}

function setExportStatus(text, kind) {
  exportStatusEl.textContent = text || "";
  exportStatusEl.classList.remove("error", "success");
  if (kind) exportStatusEl.classList.add(kind);
}

function openExportModal() {
  hapticTap();
  exportFileNameInput.value = suggestExportFileName();
  populateExportMarkerSelect();
  setExportStatus("");
  exportModalOverlay.classList.add("open");
}

function closeExportModal() {
  hapticTap();
  exportModalOverlay.classList.remove("open");
}

if (exportToggleBtn) {
  exportToggleBtn.onclick = () => openExportModal();
}
if (exportModalCloseBtn) {
  exportModalCloseBtn.onclick = () => closeExportModal();
}
if (exportModalOverlay) {
  // オーバーレイの背景部分（モーダル本体の外側）をクリックしたら閉じる
  exportModalOverlay.onclick = (e) => {
    if (e.target === exportModalOverlay) closeExportModal();
  };
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && exportModalOverlay && exportModalOverlay.classList.contains("open")) {
    closeExportModal();
  }
});

if (exportRangeAll) {
  exportRangeAll.onchange = () => {
    exportMarkerSelect.disabled = true;
  };
}
if (exportRangeMarker) {
  exportRangeMarker.onchange = () => {
    exportMarkerSelect.disabled = !exportRangeMarker.checked || exportMarkerSelect.options.length === 0 || exportMarkerSelect.options[0].value === "";
  };
}

if (exportRunBtn) {
  exportRunBtn.onclick = async () => {
    hapticTap();

    if (currentPlaylistIndex < 0 || !playlist[currentPlaylistIndex]) {
      setExportStatus("No file loaded.", "error");
      return;
    }

    // 書き出す範囲(開始・終了秒)を決定する
    let startTime = 0;
    let endTime = audio.duration || 0;

    if (exportRangeMarker && exportRangeMarker.checked) {
      const selectedIndex = exportMarkerSelect.value;
      if (selectedIndex === "" || selectedIndex === null) {
        setExportStatus("Please select a marker pair.", "error");
        return;
      }
      const activePins = pins.filter(p => p.enabled).sort((a, b) => a.t - b.t);
      const i = parseInt(selectedIndex, 10);
      if (!activePins[i] || !activePins[i + 1]) {
        setExportStatus("Invalid marker pair.", "error");
        return;
      }
      startTime = activePins[i].t;
      endTime = activePins[i + 1].t;
    }

    const applySpeed = !!(document.getElementById("exportApplySpeed") && document.getElementById("exportApplySpeed").checked);
    const applyKey = !!(document.getElementById("exportApplyKey") && document.getElementById("exportApplyKey").checked);
    const applyEq = !!(document.getElementById("exportApplyEq") && document.getElementById("exportApplyEq").checked);

    const fileNameBase = (exportFileNameInput.value || "output").trim() || "output";

    exportRunBtn.disabled = true;
    setExportStatus("Processing...");

    try {
      const renderedBuffer = await renderExportBuffer(startTime, endTime, applySpeed, applyKey, applyEq);
      const wavBlob = audioBufferToWavBlob(renderedBuffer);

      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameBase.toLowerCase().endsWith(".wav") ? fileNameBase : fileNameBase + ".wav";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // ダウンロード用のURLはこの後すぐには不要になるため、少し待ってから解放する
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setExportStatus("Export complete.", "success");
      hapticSuccess();
    } catch (err) {
      console.warn("Export failed:", err);
      setExportStatus("Export failed: " + (err && err.message ? err.message : "unknown error"), "error");
      hapticWarning();
    } finally {
      exportRunBtn.disabled = false;
    }
  };
}

// 背景の周波数アナライザー描画
const bgCanvas = document.getElementById("bgAnalyzer");
let analyzerEnabled = localStorage.getItem("mp3player_analyzer") !== "off";

const analyzerToggleBtn = document.getElementById("analyzerToggleBtn");
function applyAnalyzerToggleUI() {
  if (!analyzerToggleBtn) return;
  if (analyzerEnabled) {
    analyzerToggleBtn.classList.add("active");
  } else {
    analyzerToggleBtn.classList.remove("active");
  }
  if (bgCanvas) bgCanvas.style.opacity = analyzerEnabled ? "" : "0";
}
applyAnalyzerToggleUI();

if (analyzerToggleBtn) {
  analyzerToggleBtn.onclick = () => {
    analyzerEnabled = !analyzerEnabled;
    localStorage.setItem("mp3player_analyzer", analyzerEnabled ? "on" : "off");
    applyAnalyzerToggleUI();
  };
}

if (bgCanvas) {
  const bgCtx = bgCanvas.getContext("2d");

  function resizeBgCanvas() {
    const dpr = window.devicePixelRatio || 1;
    bgCanvas.width = window.innerWidth * dpr;
    bgCanvas.height = window.innerHeight * dpr;
  }
  resizeBgCanvas();
  window.addEventListener("resize", resizeBgCanvas);

  function drawBgAnalyzer() {
    requestAnimationFrame(drawBgAnalyzer);

    const w = bgCanvas.width;
    const h = bgCanvas.height;
    bgCtx.clearRect(0, 0, w, h);

    if (!analyzerEnabled || !analyserNode || audio.paused) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    const accentColor = getComputedStyle(document.body).getPropertyValue("--accent-primary").trim() || "#3b82f6";

    const barCount = bufferLength;
    const barWidth = w / barCount;
    const gap = barWidth * 0.25;

    bgCtx.fillStyle = accentColor;
    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i] / 255;
      const barHeight = value * h * 0.9;
      const x = i * barWidth;
      const y = h - barHeight;
      bgCtx.fillRect(x, y, barWidth - gap, barHeight);
    }
  }
  drawBgAnalyzer();
}
