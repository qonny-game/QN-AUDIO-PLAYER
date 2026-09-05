// ============================================================
// player-core.js
// 音声処理とデータ管理を担う中核ロジック。DOM操作を一切含まない
// （例外的にsetAppTitleのみ、曲名確定というcore的処理のためここに置くが、
//  #appTitle要素が存在しない環境でも安全に動くようガードされている）。
// PC版・SP版どちらの画面からも、このファイルの関数・変数を共通で利用する。
// このファイルは player-ui-shared.js より先に読み込むこと。
// ============================================================

let audio = new Audio();
let pins = [];
let loopEnabled = false;

// マーカーの色付けに使うカラーパレット。テーマカラー(RANDOM_THEME_POOL、player-ui-shared.js)と
// 同じ配色・同じ--accent-primaryの値を流用する。テーマを切り替えてもマーカーの色自体は
// 変わらないよう、名前と色コードをここに固定で持つ（テーマ変更時のCSS変数切替とは独立させる）。
const MARKER_COLOR_PALETTE = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  lime: "#84cc16",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#8b5cf6",
  violet: "#a855f7",
  pink: "#ec4899",
  rose: "#f43f5e"
};

// リピートモード: "off" -> "one"（1曲リピート） -> "all"（プレイリスト全体を繰り返し） -> "off" ...
let repeatMode = "off";
let isSeeking = false;
let isJumping = false;
let prevTime = 0;

// プレイリスト管理
let playlist = []; // { file: File, name: string }[]
let currentPlaylistIndex = -1;

// ============================================================
// プレイリスト永続化(IndexedDB)
// 音声ファイルの実体(Blob)ごとブラウザ内に保存し、ページを再読み込みしても
// プレイリストが「表示だけ残って再生できない」状態にならないようにする。
// キーはファイル名（savePins等、既存のマーカー保存キーと合わせる）。
// ============================================================
const PLAYLIST_DB_NAME = "qnaudio_playlist_db";
const PLAYLIST_DB_VERSION = 1;
const PLAYLIST_STORE_NAME = "tracks";

function openPlaylistDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB not supported")); return; }
    const req = indexedDB.open(PLAYLIST_DB_NAME, PLAYLIST_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PLAYLIST_STORE_NAME)) {
        db.createObjectStore(PLAYLIST_STORE_NAME, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 曲を1件、実体(Blob)ごと保存する。同名ファイルは上書きする。
// savedAtを明示的に指定しない場合は現在時刻（＝新規追加として最後尾）になる。
async function savePlaylistTrack(file, savedAt, enabled) {
  try {
    const db = await openPlaylistDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLIST_STORE_NAME, "readwrite");
      tx.objectStore(PLAYLIST_STORE_NAME).put({
        name: file.name,
        type: file.type,
        blob: file,
        savedAt: typeof savedAt === "number" ? savedAt : Date.now(),
        enabled: enabled !== false
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("savePlaylistTrack failed:", err);
  }
}

// 指定ファイル名の曲をストレージから削除する。
async function deletePlaylistTrack(name) {
  try {
    const db = await openPlaylistDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLIST_STORE_NAME, "readwrite");
      tx.objectStore(PLAYLIST_STORE_NAME).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("deletePlaylistTrack failed:", err);
  }
}

// 保存されている全曲を読み込む。{ file: File, enabled: boolean } の配列を返す。
async function loadAllPlaylistTracks() {
  try {
    const db = await openPlaylistDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLIST_STORE_NAME, "readonly");
      const req = tx.objectStore(PLAYLIST_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    // savedAt昇順（保存された順）に並べ、BlobをFile相当のオブジェクトに復元する
    records.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    return records.map(r => ({
      file: new File([r.blob], r.name, { type: r.type || r.blob.type }),
      enabled: r.enabled !== false
    }));
  } catch (err) {
    console.warn("loadAllPlaylistTracks failed:", err);
    return [];
  }
}

// 現在のplaylist配列の並び順を、IndexedDB側のsavedAtにも反映する
// （ドラッグ並び替え後、次回起動時にも並び替えた順序が復元されるようにするため）。
// savedAtに単純増加の連番を振り直すことで、既存のsavedAt昇順ソートと矛盾なく順序を保てる。
// 各トラックのON/OFF状態(enabled)も同時に保存する。
async function persistPlaylistOrder() {
  const base = Date.now();
  await Promise.all(playlist.map((track, i) => savePlaylistTrack(track.file, base + i, track.enabled)));
}

// 波形解析用
let waveformPeaks = null; // Float32Array (0-1 正規化された振幅の配列)
let waveformDecodeToken = 0;

// 現在のファイル名。表示用のDOM(#appTitle)はマーキー化されているため、
// マーカー保存キー等で「実際のファイル名」が必要な箇所はこの変数を参照する（appTitle.textContentは見ない）。
let currentFileName = "No file loaded";

function setAppTitle(name) {
  currentFileName = name;
  updateMediaSessionMetadata(name); // Media Session連携。不要なら本行を削除するだけでよい。
  const appTitle = document.getElementById("appTitle");
  const appTitleText = document.getElementById("appTitleText");
  if (!appTitle || !appTitleText) return;

  // マーキー用の複製テキストが残っていれば削除してから作り直す
  const inner = document.getElementById("appTitleInner");
  if (inner) {
    inner.querySelectorAll(".marquee-clone").forEach(el => el.remove());
  }
  appTitleText.textContent = name;
  appTitle.classList.remove("marquee");

  // 描画後に実際の幅を計測し、コンテナに収まらない場合だけマーキーを有効化する
  requestAnimationFrame(() => {
    if (!appTitle || !appTitleText) return;
    const overflowing = appTitleText.scrollWidth > appTitle.clientWidth;
    if (overflowing && inner) {
      // シームレスにループさせるため同じテキストをもう一つ複製して並べる
      const clone = document.createElement("span");
      clone.id = "appTitleTextClone";
      clone.className = "marquee-clone";
      clone.textContent = name;
      inner.appendChild(clone);

      // 文字数に応じてスクロール速度（時間）を調整し、読みやすい一定の速さにする
      const duration = Math.max(6, name.length * 0.28);
      appTitle.style.setProperty("--marquee-duration", duration + "s");
      appTitle.classList.add("marquee");
    }
  });
}

function getAudioCtx() {
  if (!window.__qnAudioCtx) {
    window.__qnAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // ブラウザの自動再生ポリシーによりAudioContextが一時停止状態のまま生成されることがある
  // （特にモバイルで顕著）。その場合、音声グラフを通しても一切音が出ないため、
  // 取得のたびにresumeを試みて確実に動作状態へ復帰させる。
  if (window.__qnAudioCtx.state === "suspended") {
    window.__qnAudioCtx.resume().catch(() => {});
  }
  return window.__qnAudioCtx;
}

// ============================================================
// 本格ピッチシフト（テンポ固定・音程のみ変更、音質重視）
// 位相ボコーダー（Phase Vocoder）をAudioWorkletProcessorとして自前実装。
// 外部CDN・外部ライブラリへの依存は一切なく、このファイル内のソースコードを
// Blob URL化してAudioContext.audioWorklet.addModule()に渡すことで、
// ネットワーク環境に左右されず確実に動作する。
//
// アルゴリズム概要：
//  1. 入力音声をオーバーラップさせた窓(Hann窓)付きフレームに分割（STFT分析）
//  2. FFTで周波数領域に変換し、各ビンの位相の増分から真の瞬時周波数を推定
//  3. ピッチ比に応じて振幅スペクトルをビン単位でシフト（周波数領域ピッチシフト）
//  4. シフト後のビンに対し、目標ホップサイズに合わせて位相を蓄積し直す
//  5. IFFTで時間領域に戻し、Hann窓を掛けてオーバーラップ加算（OLA）で合成
// この方式（周波数領域ビンシフト、時間伸縮なし）は、テンポを一切変えずに
// 音程だけを動かせるため、SPEEDとKEYが完全に独立するという要件に合致する。
// ============================================================

const PHASE_VOCODER_WORKLET_SOURCE = `
// in-place Radix-2 FFT。re/imは同じ長さ(2のべき乗)のFloat32Array。
// inverse=trueでIFFT（結果はNで正規化済み）。
function fft(re, im, inverse) {
  const n = re.length;
  if (n <= 1) return;

  // ビット反転並び替え
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tRe = re[i]; re[i] = re[j]; re[j] = tRe;
      let tIm = im[i]; im[i] = im[j]; im[j] = tIm;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// 入力用の累積バッファ：追記のみ・読み取りは非破壊（consumeで明示的に先頭を捨てる）。
// STFTはオーバーラップして同じ区間を繰り返し読む必要があるため、
// 「読んだら消える」FIFOではなく、この形の方が正しく実装できる。
class AccumBuffer {
  constructor() {
    this.data = new Float32Array(0);
    this.length = 0;
  }
  push(chunk) {
    const merged = new Float32Array(this.length + chunk.length);
    merged.set(this.data.subarray(0, this.length), 0);
    merged.set(chunk, this.length);
    this.data = merged;
    this.length = merged.length;
  }
  // 先頭からframeSize分をコピーして返す（データは消費しない）
  peek(frameSize) {
    const out = new Float32Array(frameSize);
    out.set(this.data.subarray(0, Math.min(frameSize, this.length)));
    return out;
  }
  // 先頭からn分を破棄する
  consume(n) {
    if (n >= this.length) {
      this.data = new Float32Array(0);
      this.length = 0;
      return;
    }
    this.data = this.data.slice(n);
    this.length = this.data.length;
  }
}

// 出力用のオーバーラップ加算(OLA)バッファ：各フレームの合成結果を「加算」で書き込み、
// 先頭から確定した分だけ順次取り出す。
class OlaBuffer {
  constructor(size) {
    this.data = new Float32Array(size);
    this.readPos = 0; // このインデックスより前は既に出力済み・未使用
    this.writeBase = 0; // 次にaddするフレームの書き込み開始オフセット（readPos基準の相対値ではなく絶対値）
    this.size = size;
  }
  // offsetは「現在のreadPosからの相対位置」ではなく、これまでの書き込み進行に対する絶対オフセットで管理する。
  addAt(absOffset, samples) {
    for (let i = 0; i < samples.length; i++) {
      const idx = (absOffset + i) % this.size;
      this.data[idx] += samples[i];
    }
  }
  // absPosから n サンプル分を取り出し、取り出した領域はゼロクリアする（加算バッファの再利用のため）
  drain(absPos, n, out) {
    for (let i = 0; i < n; i++) {
      const idx = (absPos + i) % this.size;
      out[i] = this.data[idx];
      this.data[idx] = 0;
    }
  }
}

class PhaseVocoderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "pitchSemitones", defaultValue: 0, minValue: -24, maxValue: 24 }];
  }

  constructor() {
    super();
    this.frameSize = 2048;
    this.hopSize = this.frameSize / 4; // 75%オーバーラップ
    this.channels = 2;

    this.inputBuf = [new AccumBuffer(), new AccumBuffer()];
    // OLAリングは十分な余裕を持たせる（frameSizeの数倍）
    this.olaSize = this.frameSize * 8;
    this.outputOla = [new OlaBuffer(this.olaSize), new OlaBuffer(this.olaSize)];
    this.olaWritePos = [0, 0]; // 次にOLA書き込みする絶対位置（フレームごとにhopSizeずつ進む）
    this.olaReadPos = [0, 0];  // 次に出力として取り出す絶対位置
    this.availableOut = [0, 0]; // olaWritePos - olaReadPos に相当する、出力可能なサンプル数の目安

    this.window = new Float32Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) {
      // Hann窓
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.frameSize - 1));
    }

    this.lastPhase = [new Float32Array(this.frameSize / 2 + 1), new Float32Array(this.frameSize / 2 + 1)];
    this.sumPhase = [new Float32Array(this.frameSize / 2 + 1), new Float32Array(this.frameSize / 2 + 1)];

    this.omega = new Float32Array(this.frameSize / 2 + 1);
    for (let k = 0; k <= this.frameSize / 2; k++) {
      this.omega[k] = (2 * Math.PI * this.hopSize * k) / this.frameSize;
    }

    // Hann窓・75%オーバーラップ(hop = frameSize/4)でのOLA正規化ゲイン。
    // 窓を2回(分析・合成)掛けるため、理論上の合計ゲインの逆数を掛けて振幅を正しく戻す。
    this.olaGain = 1 / 1.5;

    // ピッチキーがちょうど0半音の時は、FFT分析・合成を一切通さず入力をそのまま出力する
    // バイパス経路を使う（丸め誤差やHann窓によるわずかな音質劣化を避けるため）。
    // FFT経路は約frameSize分の遅延を持つため、切替時に音がずれないよう同じ遅延を意図的に持たせる。
    this.bypassDelaySize = this.frameSize * 2; // 余裕を持たせたリングバッファサイズ
    this.bypassDelayLine = [new Float32Array(this.bypassDelaySize), new Float32Array(this.bypassDelaySize)];
    this.bypassWritePos = [0, 0];
    this.bypassReadPos = [0, 0];
    this.bypassFilled = [0, 0]; // 遅延分がまだ溜まっていない起動直後は0埋めで出力する
  }

  // バイパス経路：FFTを一切通さず、hopSize分の遅延だけ与えて入力をそのまま出力にコピーする。
  // FFT経路と同程度の遅延（hopSize * バッファ充填分）を持たせることで、
  // ピッチキーを0↔非0に切り替えた瞬間の出力タイミングのズレ（ノイズ・音飛びの原因）を避ける。
  processChannelBypass(ch, inputChunk, outputChunk) {
    const size = this.bypassDelaySize;
    const delayLine = this.bypassDelayLine[ch];

    for (let i = 0; i < inputChunk.length; i++) {
      delayLine[this.bypassWritePos[ch]] = inputChunk[i];
      this.bypassWritePos[ch] = (this.bypassWritePos[ch] + 1) % size;
      if (this.bypassFilled[ch] < size) this.bypassFilled[ch]++;
    }

    // FFT経路の遅延（frameSizeがまとまるまで無音、以降hopSizeずつ進む）に合わせて、
    // 遅延バッファがhopSize分以上溜まるまでは無音を出す。
    for (let i = 0; i < outputChunk.length; i++) {
      if (this.bypassFilled[ch] > this.hopSize) {
        outputChunk[i] = delayLine[this.bypassReadPos[ch]];
        this.bypassReadPos[ch] = (this.bypassReadPos[ch] + 1) % size;
        this.bypassFilled[ch]--;
      } else {
        outputChunk[i] = 0;
      }
    }
  }

  processChannel(ch, pitchRatio) {
    const frameSize = this.frameSize;
    const hopSize = this.hopSize;
    const half = frameSize / 2;

    const frame = this.inputBuf[ch].peek(frameSize);
    this.inputBuf[ch].consume(hopSize);

    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      re[i] = frame[i] * this.window[i];
      im[i] = 0;
    }

    fft(re, im, false);

    const magnitude = new Float32Array(half + 1);
    const phase = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) {
      magnitude[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      phase[k] = Math.atan2(im[k], re[k]);
    }

    // 真の瞬時周波数を求め、位相を蓄積し直す（位相ボコーダーの核心部）
    const trueFreq = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) {
      let deltaPhase = phase[k] - this.lastPhase[ch][k];
      this.lastPhase[ch][k] = phase[k];
      deltaPhase -= this.omega[k];
      let deltaPhaseWrapped = ((deltaPhase + Math.PI) % (2 * Math.PI)) - Math.PI;
      if (deltaPhaseWrapped < -Math.PI) deltaPhaseWrapped += 2 * Math.PI;
      trueFreq[k] = this.omega[k] + deltaPhaseWrapped;
    }

    // ピッチシフト：出力ビンごとに対応する入力位置を逆算し、前後のビンを線形補間する。
    // （以前は入力ビンを整数丸めでシフト先に配る「順方向」方式だったが、
    //  シフト量によっては出力ビンの1割前後が誰にも埋められず「歯抜け」になり、
    //  これが金属的・ロボットっぽいノイズの主因だったため、逆方向の補間方式に変更した。）
    //
    // pitchRatio<1(音程を下げる方向、Speedを上げた時の補正で発生)の場合、出力の高い方のビンほど
    // 参照したい入力位置(dst/pitchRatio)がhalfを超えてしまう。元の音声データに存在しない
    // より高い周波数成分は物理的に作れないため、これ自体は避けられないが、
    // 「範囲外になった瞬間に振幅が0へ垂直に落ちる」形だと、そこだけ不自然な減衰・シャリつきとして
    // 耳につきやすい。範囲外になったら直前の有効な値をなだらかに保持するようにし、
    // 急激な変化を避ける（＝結果として全体の音量感・低域の存在感も自然に保たれる）。
    let lastValidMag = 0;
    let lastValidFreq = 0;
    const shiftedMag = new Float32Array(half + 1);
    const shiftedFreq = new Float32Array(half + 1);
    for (let dst = 0; dst <= half; dst++) {
      const srcPos = dst / pitchRatio;
      const srcLow = Math.floor(srcPos);
      const srcHigh = srcLow + 1;
      const frac = srcPos - srcLow;

      if (srcLow >= 0 && srcLow <= half) {
        const magLow = magnitude[srcLow];
        const magHigh = srcHigh <= half ? magnitude[srcHigh] : magLow;
        shiftedMag[dst] = magLow * (1 - frac) + magHigh * frac;

        const freqLow = trueFreq[srcLow];
        const freqHigh = srcHigh <= half ? trueFreq[srcHigh] : freqLow;
        shiftedFreq[dst] = (freqLow * (1 - frac) + freqHigh * frac) * pitchRatio;

        lastValidMag = shiftedMag[dst];
        lastValidFreq = shiftedFreq[dst];
      } else if (srcPos > half) {
        // 参照したい入力位置が範囲を超えた（=これより上は元データに存在しない高域）場合、
        // 直前の有効な値を減衰させながら引き継ぎ、垂直に無音落ちしないようにする。
        lastValidMag *= 0.7;
        shiftedMag[dst] = lastValidMag;
        shiftedFreq[dst] = lastValidFreq;
      }
    }

    for (let k = 0; k <= half; k++) {
      this.sumPhase[ch][k] += shiftedFreq[k];
      const outPhase = this.sumPhase[ch][k];
      re[k] = shiftedMag[k] * Math.cos(outPhase);
      im[k] = shiftedMag[k] * Math.sin(outPhase);
      if (k > 0 && k < half) {
        re[frameSize - k] = re[k];
        im[frameSize - k] = -im[k];
      }
    }

    fft(re, im, true);

    // 合成窓を掛けてからOLAバッファに加算する（開始位置はこれまでの書き込み進行分＝olaWritePos）
    const synthesized = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      synthesized[i] = re[i] * this.window[i] * this.olaGain;
    }
    this.outputOla[ch].addAt(this.olaWritePos[ch], synthesized);
    this.olaWritePos[ch] += hopSize;
    this.availableOut[ch] += hopSize;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const pitchSemitones = parameters.pitchSemitones[0];
    const numChannels = Math.min((input && input.length) || 0, this.channels) || 1;

    // ピッチキーがちょうど0半音の時はFFT処理を一切通さずバイパスする（音質劣化を避けるため）。
    if (pitchSemitones === 0) {
      for (let ch = 0; ch < numChannels; ch++) {
        const inputChunk = (input && input[ch] && input[ch].length > 0) ? input[ch] : new Float32Array(output[ch] ? output[ch].length : 0);
        if (output[ch]) {
          this.processChannelBypass(ch, inputChunk, output[ch]);
        }
      }
      if (numChannels === 1 && output.length > 1) {
        output[1].set(output[0]);
      }
      return true;
    }

    const pitchRatio = Math.pow(2, pitchSemitones / 12);

    for (let ch = 0; ch < numChannels; ch++) {
      if (input && input[ch] && input[ch].length > 0) {
        this.inputBuf[ch].push(input[ch]);
      }
      while (this.inputBuf[ch].length >= this.frameSize) {
        this.processChannel(ch, pitchRatio);
      }

      if (output[ch]) {
        const need = output[ch].length;
        if (this.availableOut[ch] >= need) {
          this.outputOla[ch].drain(this.olaReadPos[ch], need, output[ch]);
          this.olaReadPos[ch] += need;
          this.availableOut[ch] -= need;
        } else {
          output[ch].fill(0);
        }
      }
    }
    // モノラル入力をステレオ出力にも複製する
    if (numChannels === 1 && output.length > 1) {
      output[1].set(output[0]);
    }

    return true;
  }
}

registerProcessor("phase-vocoder-processor", PhaseVocoderProcessor);
`;


// AudioWorkletProcessorのソースをBlob化してモジュールとして登録するためのURL。
// 1つのAudioContextにつき一度だけ登録すればよい。
let phaseVocoderWorkletModuleAdded = null;

async function ensurePhaseVocoderWorklet(audioContext) {
  if (phaseVocoderWorkletModuleAdded === audioContext) return;
  const blob = new Blob([PHASE_VOCODER_WORKLET_SOURCE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await audioContext.audioWorklet.addModule(url);
    phaseVocoderWorkletModuleAdded = audioContext;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// PitchShiftノード（AudioWorkletNodeベース）。
// setupAudioGraphからは非同期で初期化されるため、生成直後は無音扱いにしておき、
// 準備が整い次第、音声グラフに接続し直す。
function createPitchShiftNode(audioContext) {
  const node = new AudioWorkletNode(audioContext, "phase-vocoder-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });

  return {
    node: node,
    input: node,
    output: node,
    connect: function(dest) { return node.connect(dest); },
    disconnect: function() { return node.disconnect.apply(node, arguments); },
    setTransposeSemitones: function(semitones) {
      const param = node.parameters.get("pitchSemitones");
      if (param) param.setTargetAtTime(semitones, audioContext.currentTime, 0.01);
    }
  };
}


let audioGraphSetupDone = false;

// 10バンド・グラフィックイコライザー
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
let eqFilters = []; // BiquadFilterNode[10]

// 本格ピッチシフト（テンポ固定で音程のみ変更）。
// AudioWorkletの初期化に失敗した場合のみ、速度連動フォールバックに切り替える。
let pitchShiftNode = null;
let pitchShiftAvailable = false;

async function setupAudioGraph() {
  if (audioGraphSetupDone) return;
  audioGraphSetupDone = true;

  const ctx = getAudioCtx();
  let source;
  try {
    source = ctx.createMediaElementSource(audio);
  } catch (err) {
    console.warn("Audio graph setup failed:", err);
    return;
  }

  eqFilters = EQ_FREQS.map(freq => {
    const filter = ctx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    filter.gain.value = 0;
    return filter;
  });

  // 本格ピッチシフト（位相ボコーダー、AudioWorklet）は、Key機能自体がUI上無効化されている間は
  // 生成しない。AudioWorkletNodeは接続されている限りprocess()が音声サンプルレートに応じて
  // 常時呼ばれ続ける仕様のため、Keyを一切使わない場合でも存在するだけで負荷・メモリ確保が続き、
  // 特にiOS Safari(ホーム画面アプリ化時含む)で長時間再生後にページがクラッシュ/再読み込みされる
  // 不具合の原因になっていた。#keyToggleBtnがdisabledのままなら、この初期化自体を丸ごとスキップする。
  const keyFeatureEnabled = !!(document.getElementById("keyToggleBtn") && !document.getElementById("keyToggleBtn").disabled);
  if (keyFeatureEnabled) {
    try {
      if (!ctx.audioWorklet) throw new Error("AudioWorklet is not supported in this browser");
      await ensurePhaseVocoderWorklet(ctx);
      pitchShiftNode = createPitchShiftNode(ctx);
      pitchShiftAvailable = true;
    } catch (err) {
      console.warn("Pitch shift unavailable, falling back to speed-linked key change:", err);
      pitchShiftAvailable = false;
      pitchShiftNode = null;
    }
  } else {
    pitchShiftAvailable = false;
    pitchShiftNode = null;
  }

  let node = source;
  if (pitchShiftAvailable && pitchShiftNode) {
    node.connect(pitchShiftNode.input);
    node = pitchShiftNode;
  }
  eqFilters.forEach(filter => {
    node.connect(filter);
    node = filter;
  });
  node.connect(ctx.destination);

  // 音声グラフが確定してからKey/Speedの現在値を反映する
  updatePlaybackRate();
  updateKeyControlAvailability();
}

// 再生速度と音程（Key）の制御。
// pitchShiftAvailable が true の場合（位相ボコーダー初期化成功時、高音質）:
//   audio.preservesPitch = true にし、ブラウザネイティブの高品質な実装でSpeed変更時の音程を自動維持する。
//   Keyは自前の位相ボコーダー(pitchShiftNode)で音程のみ変更する。
//   結果、SpeedとKeyは完全に独立して動く（どちらを動かしても他方に影響しない）。
// false の場合（AudioWorklet非対応ブラウザ等でのフォールバック）:
//   audio.preservesPitch = false にし、2^(semitones/12) をSpeedに掛け合わせて
//   playbackRateに反映することで、疑似的にKey変更を表現する（この場合のみSpeedとKeyが連動する）。
let currentSpeed = 1.0;
let currentKeySemitones = 0;

function updatePlaybackRate() {
  if (pitchShiftAvailable && pitchShiftNode) {
    // SpeedもaudioのpreservesPitchには任せず、位相ボコーダー側で完結させる。
    // 理由：iOS Safari(WebKit)は、preservesPitch=trueでplaybackRateを1.0未満(減速)にした際、
    // ネイティブのタイムストレッチ処理の品質が低く「スライスしたような」ぶつ切り音になる不具合があるため。
    // 対策として、常にpreservesPitch=falseにしてplaybackRateだけで速度を変え(音程も一緒に動く)、
    // その音程のズレを位相ボコーダーのpitchSemitonesに「Key分 + Speed変化を打ち消す分」を
    // まとめて渡すことで補正する。playbackRateをr倍にすると音程は12*log2(r)半音分動くため、
    // その逆方向(-12*log2(r))を位相ボコーダーに追加すれば、体感上はSpeedとKeyが完全に独立して見える。
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
    audio.playbackRate = currentSpeed;
    const speedPitchCompensation = -12 * Math.log2(currentSpeed);
    // 位相ボコーダーのpitchSemitonesパラメータはminValue:-24, maxValue:24の制約を持つため、
    // Key(-12〜12)とSpeed補正(約-7〜12)を合算した値が万一その範囲を超えないよう明示的にクランプする。
    const totalPitchShift = Math.max(-24, Math.min(24, currentKeySemitones + speedPitchCompensation));
    try {
      pitchShiftNode.setTransposeSemitones(totalPitchShift);
    } catch (e) {
      // 何らかの理由でノードが壊れていたら以降はSpeed/Key自体を無効化する（フォールバックはしない）
      pitchShiftAvailable = false;
      currentSpeed = 1.0;
      currentKeySemitones = 0;
      updateKeyControlAvailability();
      audio.preservesPitch = true;
      audio.mozPreservesPitch = true;
      audio.webkitPreservesPitch = true;
      audio.playbackRate = 1.0;
    }
  } else {
    // AudioWorklet(位相ボコーダー)が使えない環境では、Speed/Key機能自体を提供しない。
    // playbackRateベースの簡易フォールバック（音質が悪く、iOSでの不具合の原因にもなり得た）は
    // 撤去し、常に等速・音程そのままで再生する。
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.playbackRate = 1.0;
  }
}

function savePins() {
  if (currentFileName && currentFileName !== "No file loaded") {
    localStorage.setItem("mp3_pins_" + currentFileName, JSON.stringify(pins));
  }
}

function getActiveSegment(atTime) {
  const dur = audio.duration;
  const activePinObjs = pins.filter(p => p.enabled);
  const activePins = activePinObjs.map(p => p.t);
  if (!dur || activePins.length < 2) return null;

  const ct = atTime !== undefined ? atTime : audio.currentTime;

  function withColor(startIndex, endIndex) {
    return { start: activePins[startIndex], end: activePins[endIndex], color: activePinObjs[startIndex].color || null };
  }

  for (let i = 0; i < activePins.length - 1; i++) {
    const start = activePins[i];
    const end = activePins[i+1];

    if (i === activePins.length - 2) {
      if (ct >= start && ct <= end) return withColor(i, i + 1);
    } else {
      if (ct >= start && ct < end) return withColor(i, i + 1);
    }
  }

  if (ct < activePins[0]) return withColor(0, 1);
  if (ct > activePins[activePins.length - 1]) return withColor(activePins.length - 2, activePins.length - 1);

  return withColor(0, 1);
}

function getSegments(dur) {
  const step = dur / 6;
  return {
    s1: step,
    s2: step * 2,
    s3: step * 3,
    s4: step * 4,
    s5: step * 5
  };
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00.00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const sText = s.toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${sText}`;
}

function getPinRow(t, dur) {
  const { s1, s2, s3, s4, s5 } = getSegments(dur);
  if (t <= s1) return 1;
  if (t <= s2) return 2;
  if (t <= s3) return 3;
  if (t <= s4) return 4;
  if (t <= s5) return 5;
  return 6;
}

function timeToPercentInRow(t, dur) {
  const { s1, s2, s3, s4, s5 } = getSegments(dur);
  const bounds = [0, s1, s2, s3, s4, s5, dur];
  const row = getPinRow(t, dur) - 1;
  const start = bounds[row];
  const end = bounds[row + 1];
  return ((t - start) / (end - start)) * 100;
}

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2; // 16bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // RIFFヘッダー
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  // fmtチャンク
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmtチャンクサイズ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // バイトレート
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // ビット深度
  // dataチャンク
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // チャンネルごとのサンプルデータを取り出しておく
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  // インターリーブしながら16bit PCMに変換して書き込む
  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channelData[ch][i];
      sample = Math.max(-1, Math.min(1, sample)); // クリッピング
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// AudioBufferをMP3形式のBlobに変換する（lamejsを使用）。
// kbpsは128/192/320などのビットレート。lamejsが読み込まれていない環境では例外を投げる。
function audioBufferToMp3Blob(audioBuffer, kbps) {
  if (typeof lamejs === "undefined" || !lamejs.Mp3Encoder) {
    throw new Error("MP3 encoder (lamejs) is not available");
  }

  const numChannels = Math.min(2, audioBuffer.numberOfChannels); // lamejsはモノラル/ステレオのみ対応
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;

  // Float32サンプルを16bit PCM整数(Int16Array)に変換しておく（WAV変換と同じクリッピング処理）
  function toInt16Array(channelData) {
    const out = new Int16Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      let sample = Math.max(-1, Math.min(1, channelData[i]));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }

  const left = toInt16Array(audioBuffer.getChannelData(0));
  const right = numChannels === 2 ? toInt16Array(audioBuffer.getChannelData(1)) : null;

  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps || 128);
  const mp3Chunks = [];
  const blockSize = 1152; // lamejsが1回のencodeBufferで処理する推奨サンプル数

  for (let i = 0; i < numFrames; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const mp3buf = numChannels === 2
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
      : encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
  }

  const finalBuf = encoder.flush();
  if (finalBuf.length > 0) mp3Chunks.push(finalBuf);

  return new Blob(mp3Chunks, { type: "audio/mp3" });
}

// 指定した範囲(startTime〜endTime秒)・エフェクト設定(applySpeed/applyKey/applyEq)で
// OfflineAudioContextを使って音声をレンダリングし、結果のAudioBufferを返す。
// 元ファイルは毎回再デコードする（再生用に保持されているAudioBufferがないため、常に正確な結果を得るため）。
async function renderExportBuffer(startTime, endTime, applySpeed, applyKey, applyEq, targetSampleRate) {
  if (currentPlaylistIndex < 0 || !playlist[currentPlaylistIndex]) {
    throw new Error("No file loaded");
  }
  const file = playlist[currentPlaylistIndex].file;
  const arrayBuffer = await file.arrayBuffer();

  // 一時的なAudioContextでデコードする（decodeAudioDataはOfflineAudioContextでも呼べるが、
  // 既存のgetAudioCtx()があればそれを使い回した方が余計なコンテキスト生成を避けられる）。
  const decodeCtx = getAudioCtx();
  const sourceBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));

  const speed = applySpeed ? currentSpeed : 1.0;
  const keySemitones = applyKey ? currentKeySemitones : 0;
  // 出力サンプルレート。未指定なら元ファイルのサンプルレートのまま（従来通り）。
  // OfflineAudioContextのサンプルレートと入力(sourceBuffer)のサンプルレートが異なる場合、
  // AudioBufferSourceNode側で自動的にリサンプリングされるため、明示的な変換処理は不要。
  const outputSampleRate = targetSampleRate || sourceBuffer.sampleRate;

  const clampedStart = Math.max(0, Math.min(startTime, sourceBuffer.duration));
  const clampedEnd = Math.max(clampedStart, Math.min(endTime, sourceBuffer.duration));
  const rangeDuration = clampedEnd - clampedStart;
  if (rangeDuration <= 0) {
    throw new Error("Invalid export range");
  }

  // 出力の長さは「元の区間長 / 再生速度」（速度を上げれば短く、下げれば長くなる）
  const outputDuration = rangeDuration / speed;
  const outputLength = Math.max(1, Math.ceil(outputDuration * outputSampleRate));

  const offlineCtx = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    outputLength,
    outputSampleRate
  );

  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = sourceBuffer;
  bufferSource.playbackRate.value = speed;

  let currentNode = bufferSource;

  // Key（ピッチシフト）：pitchShiftAvailable（AudioWorkletが使える環境）の場合のみ、
  // 再生画面と同じ位相ボコーダーWorkletを使う。使えない環境ではKeyの適用自体をスキップする
  // （速度連動フォールバックは書き出し用途とは相性が悪いため、書き出しでは無理に再現しない）。
  if (applyKey && keySemitones !== 0 && pitchShiftAvailable) {
    await ensurePhaseVocoderWorklet(offlineCtx);
    const pitchNode = new AudioWorkletNode(offlineCtx, "phase-vocoder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [sourceBuffer.numberOfChannels]
    });
    const pitchParam = pitchNode.parameters.get("pitchSemitones");
    if (pitchParam) pitchParam.setValueAtTime(keySemitones, 0);
    currentNode.connect(pitchNode);
    currentNode = pitchNode;
  }

  // EQ：再生中と同じ10バンドの設定値をそのまま複製して適用する
  if (applyEq && eqFilters.length > 0) {
    for (let i = 0; i < eqFilters.length; i++) {
      const gain = eqFilters[i].gain.value;
      if (gain === 0) continue; // 変化がないバンドは接続を省略してよい
      const filter = offlineCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = EQ_FREQS[i];
      filter.Q.value = 1.4;
      filter.gain.value = gain;
      currentNode.connect(filter);
      currentNode = filter;
    }
  }

  currentNode.connect(offlineCtx.destination);
  bufferSource.start(0, clampedStart, rangeDuration);

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}

function suggestExportFileName() {
  if (!currentFileName || currentFileName === "No file loaded") return "output";
  const dot = currentFileName.lastIndexOf(".");
  return dot > 0 ? currentFileName.slice(0, dot) : currentFileName;
}

