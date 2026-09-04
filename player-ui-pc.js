// ============================================================
// player-ui-pc.js
// PC幅（マウス操作前提）でのみ意味を持つUI要素の処理。
// player-core.js, player-ui-shared.js の後に読み込むこと
// （hapticTap, keepPopupInViewport, addFilesToPlaylist, renderPins,
//  renderSegments, renderPinList, savePins 等の共通関数に依存するため）。
//
// 注意：startDragPinはrenderPins()内(player-ui-shared.js側)から
// onmousedown ハンドラとして参照される。関数宣言はホイスティングされ、
// かつrenderPinsが実際に呼ばれるのはファイル読み込み完了後（曲を読み込んだ時点）
// のため問題ないが、読み込み順序を変えないこと。
// ============================================================

// Keyboard Shortcutsポップアップの開閉（ヘッダーDグループ）
const shortcutsToggleBtn = document.getElementById("shortcutsToggleBtn");
const shortcutsPopup = document.getElementById("shortcutsPopup");
if (shortcutsToggleBtn && shortcutsPopup) {
  shortcutsToggleBtn.onclick = (e) => {
    e.stopPropagation();
    hapticTap();
    const willOpen = !shortcutsPopup.classList.contains("open");
    shortcutsPopup.classList.toggle("open", willOpen);
    shortcutsToggleBtn.classList.toggle("active", willOpen);
    if (willOpen) keepPopupInViewport(shortcutsToggleBtn, shortcutsPopup);
  };

  shortcutsPopup.onclick = (e) => {
    e.stopPropagation();
  };

  document.addEventListener("click", () => {
    shortcutsPopup.classList.remove("open");
    shortcutsToggleBtn.classList.remove("active");
  });
}

document.addEventListener("dragover", e => {
  e.preventDefault();
  document.body.classList.add("dragover");
});

document.addEventListener("dragleave", e => {
  if (e.clientX === 0 && e.clientY === 0) {
    document.body.classList.remove("dragover");
  }
});

document.addEventListener("drop", e => {
  e.preventDefault();
  document.body.classList.remove("dragover");
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    addFilesToPlaylist(Array.from(e.dataTransfer.files));
  }
});

const volumeInput = document.getElementById("volume");
if (volumeInput) {
  volumeInput.value = audio.volume;
  volumeInput.oninput = e => {
    const val = parseFloat(e.target.value);
    audio.volume = val;
    if (volumeDisplay) volumeDisplay.textContent = val.toFixed(2);
    updateAvToggleValue("volToggleValue", Math.round(val * 100) + "%");
    localStorage.setItem("mp3player_volume", val);
  };
}

function startDragPin(index) {
  return function(e) {
    e.stopPropagation();
    if (e.type === "touchstart") e.preventDefault();
    isSeeking = true;
    const dur = audio.duration;
    const { s1, s2, s3, s4, s5 } = getSegments(dur);
    const bounds = [0, s1, s2, s3, s4, s5, dur];

    const bars = [
      document.getElementById("bar1"),
      document.getElementById("bar2"),
      document.getElementById("bar3"),
      document.getElementById("bar4"),
      document.getElementById("bar5"),
      document.getElementById("bar6")
    ];

    function moveAt(clientX, clientY) {
      let targetBarIndex = 0;
      let rects = bars.map(b => b.getBoundingClientRect());

      if (clientY <= rects[0].bottom) {
        targetBarIndex = 0;
      } else if (clientY >= rects[rects.length - 1].top) {
        targetBarIndex = rects.length - 1;
      } else {
        for (let i = 0; i < rects.length - 1; i++) {
          const mid = (rects[i].bottom + rects[i+1].top) / 2;
          if (clientY <= mid) {
            targetBarIndex = i;
            break;
          }
          targetBarIndex = i + 1;
        }
      }

      const rect = rects[targetBarIndex];
      const rowStart = bounds[targetBarIndex];
      const rowEnd = bounds[targetBarIndex + 1];

      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const t = rowStart + ratio * (rowEnd - rowStart);

      pins[index].t = Math.max(0, Math.min(dur, t));

      renderPins();
      renderSegments();
      renderPinList();
    }

    function move(ev) {
      moveAt(ev.clientX, ev.clientY);
    }

    function moveTouch(ev) {
      if (ev.touches.length === 0) return;
      ev.preventDefault();
      moveAt(ev.touches[0].clientX, ev.touches[0].clientY);
    }

    function stop() {
      pins.sort((a, b) => a.t - b.t);
      
      prevTime = audio.currentTime;
      setTimeout(() => { isSeeking = false; }, 150);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
      document.removeEventListener("touchmove", moveTouch);
      document.removeEventListener("touchend", stop);
      document.removeEventListener("touchcancel", stop);

      renderPins();
      renderSegments();
      renderPinList();
      savePins();
    }

    if (e.type === "touchstart") {
      document.addEventListener("touchmove", moveTouch, { passive: false });
      document.addEventListener("touchend", stop);
      document.addEventListener("touchcancel", stop);
    } else {
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", stop);
    }
  };
}

