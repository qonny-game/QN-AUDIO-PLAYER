let audio = new Audio();
let pins = [];
let loopEnabled = false;
// リピートモード: "off" -> "one"（1曲リピート） -> "all"（プレイリスト全体を繰り返し） -> "off" ...
let repeatMode = "off";
let isSeeking = false;
let isJumping = false;
let prevTime = 0;

// プレイリスト管理
let playlist = []; // { file: File, name: string }[]
let currentPlaylistIndex = -1;

// 波形解析用
let waveformPeaks = null; // Float32Array (0-1 正規化された振幅の配列)
let waveformDecodeToken = 0;

// 現在のファイル名。表示用のDOM(#appTitle)はマーキー化されているため、
// マーカー保存キー等で「実際のファイル名」が必要な箇所はこの変数を参照する（appTitle.textContentは見ない）。
let currentFileName = "No file loaded";

function setAppTitle(name) {
  currentFileName = name;
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

    // ピッチシフト：振幅スペクトルをビン単位でシフト（テンポは変えず音程だけ動かす）
    const shiftedMag = new Float32Array(half + 1);
    const shiftedFreq = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) {
      const dst = Math.round(k * pitchRatio);
      if (dst >= 0 && dst <= half) {
        shiftedMag[dst] += magnitude[k];
        shiftedFreq[dst] = trueFreq[k] * pitchRatio;
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
    const pitchRatio = Math.pow(2, pitchSemitones / 12);

    const numChannels = Math.min((input && input.length) || 0, this.channels) || 1;

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


// リアルタイム周波数アナライザー（背景ビジュアライザー用）
let analyserNode = null;
let analyserSetupDone = false;

// 10バンド・グラフィックイコライザー
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
let eqFilters = []; // BiquadFilterNode[10]

// 本格ピッチシフト（テンポ固定で音程のみ変更）。
// AudioWorkletの初期化に失敗した場合のみ、速度連動フォールバックに切り替える。
let pitchShiftNode = null;
let pitchShiftAvailable = false;

async function setupAudioGraph() {
  if (analyserSetupDone) return;
  analyserSetupDone = true;

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

  analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 256;
  analyserNode.smoothingTimeConstant = 0.8;

  // 本格ピッチシフト（位相ボコーダー、AudioWorklet）の初期化を試みる。
  // 成功すれば source -> pitchShiftNode -> EQ -> analyser -> destination
  // 失敗すれば     source ->                EQ -> analyser -> destination （playbackRateで速度連動キー変更にフォールバック）
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

  let node = source;
  if (pitchShiftAvailable && pitchShiftNode) {
    node.connect(pitchShiftNode.input);
    node = pitchShiftNode;
  }
  eqFilters.forEach(filter => {
    node.connect(filter);
    node = filter;
  });
  node.connect(analyserNode);
  analyserNode.connect(ctx.destination);

  // 音声グラフが確定してからKey/Speedの現在値を反映する
  updatePlaybackRate();
  updateKeyControlAvailability();
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

// スマホ用ハンバーガーメニュー（Color/Analyzer/EQをまとめて開閉）
const headerMenuBtn = document.getElementById("headerMenuBtn");
const headerControlsEl = document.getElementById("headerControls");
if (headerMenuBtn && headerControlsEl) {
  headerMenuBtn.onclick = (e) => {
    e.stopPropagation();
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

// カラーピッカーのポップアップ開閉
const colorToggleBtn = document.getElementById("colorToggleBtn");
const colorPopup = document.getElementById("colorPopup");
if (colorToggleBtn && colorPopup) {
  colorToggleBtn.onclick = (e) => {
    e.stopPropagation();
    colorPopup.classList.toggle("open");
    colorToggleBtn.classList.toggle("active", colorPopup.classList.contains("open"));
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

document.getElementById("fileInput").onchange = e => addFilesToPlaylist(Array.from(e.target.files));

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

function addFilesToPlaylist(files) {
  const audioFiles = files.filter(f => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f.name));
  if (audioFiles.length === 0) return;

  const wasEmpty = playlist.length === 0;
  audioFiles.forEach(file => {
    playlist.push({ file, name: file.name });
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
    if (i === currentPlaylistIndex) item.classList.add("playing");

    const nameSpan = document.createElement("span");
    nameSpan.className = "playlist-name";
    nameSpan.textContent = track.name;
    nameSpan.title = track.name;
    nameSpan.onclick = () => playTrackAt(i);
    item.appendChild(nameSpan);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      removeTrackAt(i);
    };
    item.appendChild(delBtn);

    box.appendChild(item);
  });
}

function removeTrackAt(index) {
  if (index < 0 || index >= playlist.length) return;

  const removingCurrent = index === currentPlaylistIndex;
  playlist.splice(index, 1);

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
        pins = raw.map(p => typeof p === 'number' ? { t: p, enabled: true } : { t: p.t, enabled: p.enabled !== false });
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

function savePins() {
  if (currentFileName && currentFileName !== "No file loaded") {
    localStorage.setItem("mp3_pins_" + currentFileName, JSON.stringify(pins));
  }
}

function updatePlayButtonState() {
  const playBtn = document.getElementById("playToggle");
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
  pins.push({ t: audio.currentTime, enabled: true });
  pins.sort((a, b) => a.t - b.t);
  renderPins();
  renderSegments();
  renderPinList();
  savePins();
}

function jumpToNextMarker() {
  const activePins = pins.filter(p => p.enabled);
  if (activePins.length === 0) return;

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
    // 本格版：テンポと音程を完全に分離
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.playbackRate = currentSpeed;
    try {
      pitchShiftNode.setTransposeSemitones(currentKeySemitones);
    } catch (e) {
      // 何らかの理由でノードが壊れていたら以降はフォールバックに切り替える
      pitchShiftAvailable = false;
      updateKeyControlAvailability();
      audio.preservesPitch = false;
      audio.mozPreservesPitch = false;
      audio.webkitPreservesPitch = false;
      const rate = currentSpeed * Math.pow(2, currentKeySemitones / 12);
      audio.playbackRate = rate;
    }
  } else {
    // 簡易版：SpeedとKeyを合成（音程維持はオフにし、playbackRateの変化がそのまま音程にも反映されるようにする）
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
    const rate = currentSpeed * Math.pow(2, currentKeySemitones / 12);
    audio.playbackRate = rate;
  }
}

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

speedRange.oninput = e => {
  currentSpeed = parseFloat(e.target.value);
  speedDisplay.textContent = currentSpeed.toFixed(2);
  updateAvToggleValue("speedToggleValue", currentSpeed.toFixed(2) + "x");
  updatePlaybackRate();
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
  currentKeySemitones = Math.max(KEY_MIN, Math.min(KEY_MAX, value));
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
for (let i = 0; i < EQ_FREQS.length; i++) {
  const slider = document.getElementById("eqBand" + i);
  if (slider) {
    slider.oninput = e => setEqBandValue(i, parseFloat(e.target.value));
  }
}

const eqResetBtn = document.getElementById("eqResetBtn");
if (eqResetBtn) {
  eqResetBtn.onclick = () => {
    for (let i = 0; i < EQ_FREQS.length; i++) setEqBandValue(i, 0);
    const presetSelect = document.getElementById("eqPresetSelect");
    if (presetSelect) presetSelect.value = "flat";
  };
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

const eqPresetSelect = document.getElementById("eqPresetSelect");
if (eqPresetSelect) {
  eqPresetSelect.onchange = (e) => {
    const preset = e.target.value;
    if (preset === "custom") return; // ユーザーが手動で調整した状態はそのまま維持
    applyEqPreset(preset);
  };
}

// バンドを手動で操作したらプリセット選択を「Custom」表示に戻す
for (let i = 0; i < EQ_FREQS.length; i++) {
  const slider = document.getElementById("eqBand" + i);
  if (slider) {
    slider.addEventListener("input", () => {
      if (eqPresetSelect) eqPresetSelect.value = "custom";
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
      const presetSelect = document.getElementById("eqPresetSelect");
      if (presetSelect) presetSelect.value = "custom";
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

// EQポップアップの開閉
const eqToggleBtn = document.getElementById("eqToggleBtn");
const eqPopup = document.getElementById("eqPopup");
if (eqToggleBtn && eqPopup) {
  eqToggleBtn.onclick = (e) => {
    e.stopPropagation();
    eqPopup.classList.toggle("open");
    eqToggleBtn.classList.toggle("active", eqPopup.classList.contains("open"));
  };
  eqPopup.onclick = (e) => {
    e.stopPropagation();
  };
  document.addEventListener("click", () => {
    eqPopup.classList.remove("open");
    eqToggleBtn.classList.remove("active");
  });
}

// VOL / SPEED / KEY ポップアップの開閉（同じ開閉パターンを共通化）
const avPopupInstances = [];

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
  };
  popup.onclick = (e) => {
    e.stopPropagation();
  };
  document.addEventListener("click", closeThis);
}

setupAvPopup("volToggleBtn", "volPopup");
setupAvPopup("speedToggleBtn", "speedPopup");
setupAvPopup("keyToggleBtn", "keyPopup");

function getActiveSegment(atTime) {
  const dur = audio.duration;
  const activePins = pins.filter(p => p.enabled).map(p => p.t);
  if (!dur || activePins.length < 2) return null;

  const ct = atTime !== undefined ? atTime : audio.currentTime;

  for (let i = 0; i < activePins.length - 1; i++) {
    const start = activePins[i];
    const end = activePins[i+1];

    if (i === activePins.length - 2) {
      if (ct >= start && ct <= end) return { start, end };
    } else {
      if (ct >= start && ct < end) return { start, end };
    }
  }

  if (ct < activePins[0]) return { start: activePins[0], end: activePins[1] };
  if (ct > activePins[activePins.length - 1]) return { start: activePins[activePins.length - 2], end: activePins[activePins.length - 1] };

  return { start: activePins[0], end: activePins[1] };
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
    repeatMode = repeatMode === "off" ? "one" : repeatMode === "one" ? "all" : "off";
    applyRepeatModeUI();
  };
  applyRepeatModeUI();
}

document.getElementById("addPinBtn").onclick = addCurrentPin;

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
    infoSpan.textContent = `#${i + 1} - ${pinObj.t.toFixed(2)}s`;
    
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
    delBtn.style.color = "#ef4444";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      pins.splice(i, 1);
      renderPins();
      renderSegments();
      renderPinList();
      savePins();
    };
    div.appendChild(delBtn);

    if (list) {
      list.appendChild(div);
    }
  });
}

// Keyboard Shortcuts の折りたたみトグル処理（デフォルトは閉じた状態）
const shortcutsHeader = document.getElementById("shortcutsHeader");
if (shortcutsHeader) {
  shortcutsHeader.onclick = () => {
    const section = document.getElementById("shortcutsSection");
    const icon = document.getElementById("shortcutsIcon");
    section.classList.toggle("open");
    if (section.classList.contains("open")) {
      icon.textContent = "▲";
    } else {
      icon.textContent = "▼";
    }
  };
}

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

let currentMobileTab = "markers";

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

mobileTabBtns.forEach(btn => {
  btn.onclick = () => setMobileTab(btn.getAttribute("data-tab"));
});

// 画面幅がPC⇔スマホの境界を跨いだ時にも再配置する
if (mobileTabMedia.addEventListener) {
  mobileTabMedia.addEventListener("change", applyMobileTabLayout);
} else if (mobileTabMedia.addListener) {
  mobileTabMedia.addListener(applyMobileTabLayout);
}

setMobileTab("markers");

// スマホ幅でtop-controlsを画面下部固定にした際、元の位置の高さ分をスペーサーで確保する
function syncTopControlsSpacerHeight() {
  const topControls = document.getElementById("topControls");
  const spacer = document.getElementById("topControlsSpacer");
  if (!topControls || !spacer) return;
  if (isMobileLayout()) {
    const h = topControls.getBoundingClientRect().height;
    spacer.style.height = h + "px";
    // フッターがtopControls(画面下部固定)の裏に隠れないよう、
    // ページ全体の下側にも同じ高さ分の余白を確保する
    document.body.style.paddingBottom = h + "px";
  } else {
    spacer.style.height = "0px";
    document.body.style.paddingBottom = "";
  }
}
syncTopControlsSpacerHeight();
window.addEventListener("resize", syncTopControlsSpacerHeight);

window.onload = () => {
  updatePlayButtonState();
  syncTopControlsSpacerHeight();
};

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