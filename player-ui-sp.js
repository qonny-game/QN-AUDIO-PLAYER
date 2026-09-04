// ============================================================
// player-ui-sp.js
// SP幅（スマホ）でのみ意味を持つUI要素の処理。
// player-core.js, player-ui-shared.js の後に読み込むこと
// （hapticTap, addCurrentPin 等 player-ui-shared.js の共通関数に依存するため）。
//
// 注意：ここに含まれるのは「対象要素自体がSP限定（CSSで常に非表示のPC相当が
// 存在しない）」など、関数を割らずにそのまま移動できたものだけ。
// isMobileLayout()で分岐しながらPC/SP両方の処理を1つの関数で担っているもの
// （renderPins, applyMobileTabLayout, createDualSlotMoveController等）は、
// 関数自体を書き直す必要があるため、今回は player-ui-shared.js に残したまま。
// ============================================================

// スマホ用ハンバーガーメニュー（Color/Analyzer/EQをまとめて開閉）
const headerMenuBtn = document.getElementById("headerMenuBtn");
const headerControlsEl = document.getElementById("headerControls");
if (headerMenuBtn && headerControlsEl) {
  headerMenuBtn.onclick = (e) => {
    e.stopPropagation();
    hapticTap();
    headerControlsEl.classList.toggle("open");
    headerMenuBtn.classList.toggle("active", headerControlsEl.classList.contains("open"));
  };
  headerControlsEl.onclick = (e) => {
    e.stopPropagation();
  };
  document.addEventListener("click", () => {
    headerControlsEl.classList.remove("open");
    headerMenuBtn.classList.remove("active");
  });
}

// SP幅限定：MARKERSタブ内リスト最上部の+MARKERボタン。コントロールバーのaddPinBtnと全く同じ機能。
const addPinBtnInline = document.getElementById("addPinBtnInline");
if (addPinBtnInline) {
  addPinBtnInline.onclick = addCurrentPin;
}

// SP幅限定：PLAYLISTタブ内リスト最上部のSELECT FILEボタン。既存のfileInputを発火させるだけの、
// SELECT FILE(#fileUploadWrapper)と全く同じ機能。
const selectFileBtnInline = document.getElementById("selectFileBtnInline");
if (selectFileBtnInline) {
  selectFileBtnInline.onclick = () => {
    const fileInputEl = document.getElementById("fileInput");
    if (fileInputEl) fileInputEl.click();
  };
}
