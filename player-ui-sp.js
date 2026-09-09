// ============================================================
// player-ui-sp.js
// SP幅（スマホ）でのみ意味を持つUI要素の処理。
// player-core.js, player-ui-shared.js の後に読み込むこと
// （hapticTap, addCurrentPin 等 player-ui-shared.js の共通関数に依存するため）。
//
// 注意：ここに含まれるのは「対象要素自体がSP限定（CSSで常に非表示のPC相当が
// 存在しない）」など、関数を割らずにそのまま移動できたものだけ。
// isMobileLayout()で分岐しながらPC/SP両方の処理を1つの関数で担っているもの
// （renderPins等）は、関数自体を書き直す必要があるため、今回は
// player-ui-shared.js に残したまま。
// ============================================================

// MARKERS/PLAYLISTタブ内リスト最上部の+MARKER/ADD FILEインラインボタン。
// コントロールバーのaddPinBtn、Basic欄のAdd Fileボタン(#fileUploadWrapper)とそれぞれ全く同じ機能で、
// リストを見ながら追加できるよう、あえてタブ内にも同じ機能のボタンを重複して置いている。
const addPinBtnInline = document.getElementById("addPinBtnInline");
if (addPinBtnInline) {
  addPinBtnInline.onclick = addCurrentPin;
}

const selectFileBtnInline = document.getElementById("selectFileBtnInline");
if (selectFileBtnInline) {
  selectFileBtnInline.onclick = () => {
    const fileInputEl = document.getElementById("fileInput");
    if (fileInputEl) fileInputEl.click();
  };
}
