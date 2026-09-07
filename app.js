(() => {
  'use strict';

  // ---------- Haptics (QNAUDIO player-ui-shared.js と同じ実装) ----------
  function hapticTap() { if (navigator.vibrate) navigator.vibrate(10); }
  function hapticTick() { if (navigator.vibrate) navigator.vibrate(6); }
  function hapticSuccess() { if (navigator.vibrate) navigator.vibrate([15, 40, 15]); }

  // ---------- Sound pairs (6 pairs = 12 sounds) ----------
  // Each pair has A/B sounds. A cell cycles OFF → A → B → OFF.
  // The picker lets you choose a pair (e.g. Bass) — not A/B individually.
  // pitch adjusts the pitch of bass/snare/hihat (1.0 = base).
  const SOUND_PAIRS = {
    bass:   { label: 'Bass',   kind: 'bass',
              A: { color: '#ef4444', pitch: 1.0 }, B: { color: '#fca5a5', pitch: 1.5 } },
    snare:  { label: 'Snare',  kind: 'snare',
              A: { color: '#f59e0b', pitch: 1.0 }, B: { color: '#fcd34d', pitch: 1.3 } },
    hihat:  { label: 'Hat',    kind: 'hihat',
              A: { color: '#eab308', pitch: 1.0, dur: 0.06 }, B: { color: '#fde047', pitch: 1.0, dur: 0.15 } },
    click:  { label: 'Click',  kind: 'click',
              A: { color: '#3b82f6', freq: 1500 }, B: { color: '#93c5fd', freq: 1000 } },
    beep:   { label: 'Beep',   kind: 'beep',
              A: { color: '#22d3ee', freq: 1760 }, B: { color: '#a5f3fc', freq: 880 } },
    clave:  { label: 'Clave',  kind: 'clave',
              A: { color: '#a78bfa', freq: 1400 }, B: { color: '#ddd6fe', freq: 900 } },
  };
  const SOUND_PAIR_ORDER = ['bass', 'snare', 'hihat', 'click', 'beep', 'clave'];

  function soundVariant(pairKey, variant) {
    // variant: 'A' or 'B'
    const pair = SOUND_PAIRS[pairKey];
    return { ...pair[variant], label: `${pair.label}${variant}`, kind: pair.kind };
  }

  // ---------- Division kinds ----------
  const DIVISIONS = {
    sixteenth:      { steps: 4, label: '16th' },
    eighthTriplet:  { steps: 3, label: '8th Triplet' },
  };

  // 行ごとにマス数が違っても、拍の境目（表示上の縦線）を必ず揃えるための基準値。
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  function lcm(a, b) { return (a * b) / gcd(a, b); }
  const STEP_GRID_UNIT = Object.values(DIVISIONS).map(d => d.steps).reduce(lcm, 1);

  // 行(段)は「分割は全拍共通で1つ」「パターンは拍数×マス数ぶんの通し配列」を持つ。
  // 各マスは 'off' | 'A' | 'B' の3状態（タップで off→A→B→off と循環）。
  function makeLayerRow(pairKey, divKey, beatsPerBar) {
    const totalSteps = DIVISIONS[divKey].steps * beatsPerBar;
    return {
      sound: pairKey,
      division: divKey,
      pattern: new Array(totalSteps).fill('off'),
    };
  }

  function nextCellState(s) {
    if (s === 'off') return 'A';
    if (s === 'A') return 'B';
    return 'off';
  }

  // ---------- State ----------
  const state = {
    bpm: 120,
    beatsPerBar: 4,
    rows: [
      makeLayerRow('hihat', 'sixteenth', 4),
      makeLayerRow('snare', 'sixteenth', 4),
      makeLayerRow('bass', 'sixteenth', 4),
    ],
    currentBeat: -1,
    playing: false,
  };

  // "8 Beat" は常にプリセット一覧の先頭に固定表示される組み込みプリセット
  // （削除不可、ユーザー保存のプリセットとは別扱い）。4/4・16分割固定で、
  // 押した瞬間いつでも定番の8ビートに戻せるようにする。
  function buildEightBeatPreset() {
    const beatsPerBar = 4;
    const hihat = makeLayerRow('hihat', 'sixteenth', beatsPerBar);
    const snare = makeLayerRow('snare', 'sixteenth', beatsPerBar);
    const bass = makeLayerRow('bass', 'sixteenth', beatsPerBar);
    for (let bi = 0; bi < beatsPerBar; bi++) {
      hihat.pattern[bi * 4 + 0] = 'A';
      hihat.pattern[bi * 4 + 2] = 'A';
    }
    snare.pattern[1 * 4] = 'A';
    snare.pattern[3 * 4] = 'A';
    bass.pattern[0 * 4] = 'A';
    bass.pattern[2 * 4] = 'A';
    return {
      name: '8 Beat',
      builtin: true,
      bpm: 120,
      beatsPerBar,
      rows: [hihat, snare, bass],
    };
  }

  // "Shuffle Beat" も同じく組み込みの固定プリセット。8分3連(ALL 3)で、
  // ハイハット=1・3・4拍目の頭とウラ(0,2マス目)、スネア=2拍目の頭とウラのみ、
  // バス=1・2拍目の頭のみ、という跳ねたシャッフルのノリ。
  function buildShuffleBeatPreset() {
    const beatsPerBar = 4;
    const hihat = makeLayerRow('hihat', 'eighthTriplet', beatsPerBar);
    const snare = makeLayerRow('snare', 'eighthTriplet', beatsPerBar);
    const bass = makeLayerRow('bass', 'eighthTriplet', beatsPerBar);
    [0, 2, 3].forEach(bi => {
      hihat.pattern[bi * 3 + 0] = 'A';
      hihat.pattern[bi * 3 + 2] = 'A';
    });
    snare.pattern[1 * 3 + 0] = 'A';
    snare.pattern[1 * 3 + 2] = 'A';
    bass.pattern[0 * 3] = 'A';
    bass.pattern[1 * 3] = 'A';
    return {
      name: 'Shuffle Beat',
      builtin: true,
      bpm: 120,
      beatsPerBar,
      rows: [hihat, snare, bass],
    };
  }

  // 一番上に固定表示する組み込みプリセットの一覧（この順で表示、いずれも削除不可）
  function builtinPresets() {
    return [buildEightBeatPreset(), buildShuffleBeatPreset()];
  }

  // 初回起動時（保存済みの作業状態がまだない場合）は、組み込みの8ビートを
  // そのまま作業中の状態としてもセットしておく。
  function applyDefaultEightBeat() {
    applySerializedState(buildEightBeatPreset());
  }

  // ---------- 永続化（作業中の状態を自動保存し、再読み込み時に復元） ----------
  const STORAGE_KEY = 'qntempo.workingState.v1';
  const PRESETS_KEY = 'qntempo.presets.v1';

  function serializeState() {
    return {
      bpm: state.bpm,
      beatsPerBar: state.beatsPerBar,
      rows: state.rows.map(r => ({ sound: r.sound, division: r.division, pattern: r.pattern.slice() })),
    };
  }

  function applySerializedState(saved) {
    if (!saved || !Array.isArray(saved.rows) || saved.rows.length !== 3) return false;
    state.bpm = saved.bpm || 120;
    state.beatsPerBar = saved.beatsPerBar || 4;
    state.rows = saved.rows.map(r => ({
      sound: SOUND_PAIRS[r.sound] ? r.sound : 'click',
      division: DIVISIONS[r.division] ? r.division : 'sixteenth',
      pattern: Array.isArray(r.pattern) ? r.pattern.slice() : [],
    }));
    return true;
  }

  let saveTimer = null;
  function saveWorkingState() {
    // 連続操作（マス連打など）で毎回書き込まないよう、少し間引く
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
      } catch (e) { /* 保存できない環境でもアプリの動作自体は継続する */ }
    }, 250);
  }

  function loadWorkingState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      return applySerializedState(JSON.parse(raw));
    } catch (e) {
      return false;
    }
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function savePresets(list) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    } catch (e) { /* 保存できない環境でもアプリの動作自体は継続する */ }
  }

  const hadSavedState = loadWorkingState();
  if (!hadSavedState) applyDefaultEightBeat();

  const BPM_PRESETS = [60, 80, 100, 120, 140, 160, 180, 200];

  const TEMPO_NAMES = [
    [40, 'Grave'], [50, 'Largo'], [60, 'Lento'], [66, 'Adagio'],
    [76, 'Andante'], [92, 'Andantino'], [108, 'Moderato'], [120, 'Allegretto'],
    [140, 'Allegro'], [160, 'Vivace'], [176, 'Presto'], [999, 'Prestissimo']
  ];
  function tempoName(bpm) {
    for (const [max, name] of TEMPO_NAMES) if (bpm <= max) return name;
    return 'Prestissimo';
  }

  // ---------- DOM refs ----------
  const beatsSeq = document.getElementById('beatsSeq');
  const beatCounter = document.getElementById('beatCounter');
  const bpmVal = document.getElementById('bpmVal');
  const bpmPresetGrid = document.getElementById('bpmPresetGrid');
  const tempoNameEl = document.getElementById('tempoName');
  const bpmMinus = document.getElementById('bpmMinus');
  const bpmPlus = document.getElementById('bpmPlus');
  const bpmMinus2 = document.getElementById('bpmMinus2');
  const bpmPlus2 = document.getElementById('bpmPlus2');
  const tapBtn = document.getElementById('tapBtn');
  const tapReadout = document.getElementById('tapReadout');
  const playToggle = document.getElementById('playToggle');
  const playIcon = document.getElementById('playIcon');

  const sigToggleBtn = document.getElementById('sigToggleBtn');
  const sigToggleValue = document.getElementById('sigToggleValue');
  const sigPopup = document.getElementById('sigPopup');
  const sigBackdrop = document.getElementById('sigBackdrop');
  const sigGrid = document.getElementById('sigGrid');
  const sigCloseBtn = document.getElementById('sigCloseBtn');

  const metaDivToggle = document.getElementById('metaDivToggle');

  const soundPickPopup = document.getElementById('soundPickPopup');
  const soundPickBackdrop = document.getElementById('soundPickBackdrop');
  const soundPickTitle = document.getElementById('soundPickTitle');
  const soundChoiceGrid = document.getElementById('soundChoiceGrid');
  const divChoiceRow = document.getElementById('divChoiceRow');
  const soundPickCloseBtn = document.getElementById('soundPickCloseBtn');

  const presetBtn = document.getElementById('presetBtn');
  const presetPopup = document.getElementById('presetPopup');
  const presetBackdrop = document.getElementById('presetBackdrop');
  const presetNameInput = document.getElementById('presetNameInput');
  const presetSaveBtn = document.getElementById('presetSaveBtn');
  const presetList = document.getElementById('presetList');
  const presetCloseBtn = document.getElementById('presetCloseBtn');

  const topControls = document.getElementById('topControls');
  const topControlsSpacer = document.getElementById('topControlsSpacer');

  let activeSoundLayerIndex = null;

  // ---------- Spacer sync ----------
  function syncSpacer() {
    topControlsSpacer.style.height = topControls.offsetHeight + 'px';
  }
  window.addEventListener('resize', syncSpacer);

  // ---------- Popup helpers ----------
  function openPopup(popup, backdrop) {
    hapticTap();
    popup.classList.add('open');
    backdrop.classList.add('open');
  }
  function closePopup(popup, backdrop) {
    popup.classList.remove('open');
    backdrop.classList.remove('open');
  }

  // ---------- プリセット保存・呼び出し ----------
  presetBtn.addEventListener('click', () => {
    presetNameInput.value = '';
    renderPresetList();
    openPopup(presetPopup, presetBackdrop);
  });
  presetCloseBtn.addEventListener('click', () => { hapticTap(); closePopup(presetPopup, presetBackdrop); });
  presetBackdrop.addEventListener('click', () => closePopup(presetPopup, presetBackdrop));

  presetSaveBtn.addEventListener('click', () => {
    const name = presetNameInput.value.trim();
    if (!name) { hapticTap(); presetNameInput.focus(); return; }
    hapticSuccess();
    const list = loadPresets();
    list.unshift({ name, savedAt: Date.now(), ...serializeState() });
    savePresets(list);
    presetNameInput.value = '';
    renderPresetList();
  });

  function renderPresetList() {
    const list = loadPresets();
    presetList.innerHTML = '';

    // 組み込みプリセット（8 Beat, Shuffle Beat）は常に一番上、削除不可
    builtinPresets().forEach(preset => {
      presetList.appendChild(renderPresetRow(preset, null, true));
    });

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'preset-empty';
      empty.textContent = 'No presets saved yet';
      presetList.appendChild(empty);
      return;
    }
    list.forEach((preset, idx) => {
      presetList.appendChild(renderPresetRow(preset, idx, false));
    });
  }

  function renderPresetRow(preset, idx, builtin) {
    const row = document.createElement('div');
    row.className = 'preset-row' + (builtin ? ' preset-row-builtin' : '');

    const name = document.createElement('span');
    name.className = 'preset-row-name';
    name.textContent = preset.name;
    name.title = 'Tap to load';
    name.addEventListener('click', () => {
      hapticSuccess();
      applySerializedState(preset);
      setBpm(state.bpm, true);
      sigToggleValue.textContent = presetLabelFor(state.beatsPerBar);
      renderBeats();
      closePopup(presetPopup, presetBackdrop);
    });
    row.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'preset-row-meta';
    meta.textContent = `${preset.bpm} BPM`;
    row.appendChild(meta);

    if (builtin) {
      const badge = document.createElement('span');
      badge.className = 'preset-row-badge';
      badge.textContent = 'BUILT-IN';
      row.appendChild(badge);
    } else {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'preset-row-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hapticTick();
        const current = loadPresets();
        current.splice(idx, 1);
        savePresets(current);
        renderPresetList();
      });
      row.appendChild(delBtn);
    }

    return row;
  }

  const BEATS_PER_ROW_GROUP = 4;

  // ---------- Step painting (tap = cycle off→A→B→off, drag = paint the same state) ----------
  // Whatever state the first cell in a drag has, that state gets applied to every
  // cell the finger passes over. A plain tap (no movement) still cycles the state.
  // 再描画(renderBeats)はDOMを作り直してしまい、ドラッグ中のpointer captureが
  // 外れてしまうため、ドラッグ中は state.rows.pattern と該当要素の見た目だけを
  // 直接更新し、ドラッグ終了時に一度だけ renderBeats() する。
  let paintState = null;      // the state being "painted" during this drag (off/A/B)
  let paintTouched = null;    // Set of "layer:step" keys already painted this drag
  let paintRow = null;        // the row object currently being painted

  function stepKeyFromEl(el) {
    if (!el || !el.classList || !el.classList.contains('layer-step')) return null;
    return `${el.dataset.layer}:${el.dataset.step}`;
  }

  function setStepVisual(el, cellState, row) {
    el.classList.toggle('on', cellState !== 'off');
    if (cellState !== 'off') {
      const pair = SOUND_PAIRS[row.sound];
      el.style.setProperty('--snd-color', pair[cellState].color);
    } else {
      el.style.removeProperty('--snd-color');
    }
  }

  beatsSeq.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.layer-step');
    if (!el) return;
    e.preventDefault();
    const layerIndex = parseInt(el.dataset.layer, 10);
    const stepIndex = parseInt(el.dataset.step, 10);
    const row = state.rows[layerIndex];
    if (!row) return;

    // タップ時は今の状態を次の状態へ進める（off→A→B→off）。
    // これがそのままドラッグ中に塗る対象の状態になる。
    paintState = nextCellState(row.pattern[stepIndex]);
    paintRow = row;
    paintTouched = new Set([stepKeyFromEl(el)]);
    row.pattern[stepIndex] = paintState;
    setStepVisual(el, paintState, row);
    hapticTick();
    beatsSeq.setPointerCapture(e.pointerId);
  });

  beatsSeq.addEventListener('pointermove', (e) => {
    if (paintState === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const key = stepKeyFromEl(el);
    if (!key || paintTouched.has(key)) return;
    const layerIndex = parseInt(el.dataset.layer, 10);
    // ドラッグは同じ段（行）の中だけで有効にする（違う段のマスは対象外）
    if (state.rows[layerIndex] !== paintRow) return;
    const stepIndex = parseInt(el.dataset.step, 10);
    paintTouched.add(key);
    paintRow.pattern[stepIndex] = paintState;
    setStepVisual(el, paintState, paintRow);
    hapticTick();
  });

  function endPaint() {
    if (paintState === null) return;
    paintState = null;
    paintTouched = null;
    paintRow = null;
    renderBeats();
  }
  beatsSeq.addEventListener('pointerup', endPaint);
  beatsSeq.addEventListener('pointercancel', endPaint);
  beatsSeq.addEventListener('pointerleave', endPaint);

  // ---------- Render: beats-seq ----------
  // 1グループ=最大4拍として、5拍目以降は次のグループ（次の行の並び）に折り返す。
  // 各グループの中に3段（音色ボタン+パターン）を描画する。
  function renderBeats() {
    beatsSeq.innerHTML = '';
    for (let groupStart = 0; groupStart < state.beatsPerBar; groupStart += BEATS_PER_ROW_GROUP) {
      const groupEnd = Math.min(groupStart + BEATS_PER_ROW_GROUP, state.beatsPerBar);
      const groupEl = document.createElement('div');
      groupEl.className = 'seq-row-group';
      state.rows.forEach((row, li) => {
        groupEl.appendChild(renderSeqRow(row, li, groupStart, groupEnd));
      });
      beatsSeq.appendChild(groupEl);
    }
    updateBeatCounter();
    updateMetaDivToggle();
    saveWorkingState();
  }

  function renderSeqRow(row, layerIndex, groupStart, groupEnd) {
    const rowEl = document.createElement('div');
    rowEl.className = 'seq-row';
    rowEl.dataset.layer = layerIndex;

    const pair = SOUND_PAIRS[row.sound];

    // 音色ボタン（ペア単位・A/Bは選ばせない。分割の選択もこのボタンのポップアップ内で行う）
    const soundBtn = document.createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'layer-sound-btn';
    soundBtn.title = `Row ${layerIndex + 1}: ${pair.label} (tap to change sound/division)`;
    soundBtn.innerHTML = `<span class="sound-dot-pair"><i style="background:${pair.A.color}"></i><i style="background:${pair.B.color}"></i></span>`;
    soundBtn.addEventListener('click', () => openSoundPicker(layerIndex));
    rowEl.appendChild(soundBtn);

    const track = document.createElement('div');
    track.className = 'seq-track';
    const stepsPerBeat = DIVISIONS[row.division].steps;
    const unitPerStep = STEP_GRID_UNIT / stepsPerBeat;

    for (let bi = groupStart; bi < groupEnd; bi++) {
      const cell = document.createElement('div');
      cell.className = 'seq-beat-cell' + (state.currentBeat === bi ? ' active' : '');
      cell.dataset.beat = bi;

      const stepsEl = document.createElement('div');
      stepsEl.className = 'layer-steps';
      stepsEl.style.gridTemplateColumns = `repeat(${stepsPerBeat}, ${unitPerStep}fr)`;

      for (let s = 0; s < stepsPerBeat; s++) {
        const globalIndex = bi * stepsPerBeat + s;
        const cellState = row.pattern[globalIndex];
        const step = document.createElement('button');
        step.type = 'button';
        step.className = 'layer-step' + (cellState !== 'off' ? ' on' : '');
        if (cellState !== 'off') {
          step.style.setProperty('--snd-color', pair[cellState].color);
        }
        step.dataset.step = globalIndex;
        step.dataset.layer = layerIndex;
        stepsEl.appendChild(step);
      }
      cell.appendChild(stepsEl);
      track.appendChild(cell);
    }

    rowEl.appendChild(track);
    return rowEl;
  }

  function updateBeatCounter() {
    const shown = state.currentBeat < 0 ? 1 : state.currentBeat + 1;
    beatCounter.innerHTML = `${shown}<span class="stage-meta-total">/ ${state.beatsPerBar}</span>`;
  }

  // ---------- ALL 16 / ALL 3 toggle (applies the chosen division to every row at once) ----------
  function updateMetaDivToggle() {
    const allSame = state.rows.every(r => r.division === state.rows[0].division);
    metaDivToggle.querySelectorAll('.meta-div-btn').forEach(btn => {
      btn.classList.toggle('selected', allSame && btn.dataset.division === state.rows[0].division);
    });
  }

  metaDivToggle.querySelectorAll('.meta-div-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      hapticTap();
      const divKey = btn.dataset.division;
      state.rows.forEach(row => {
        row.division = divKey;
        row.pattern = new Array(DIVISIONS[divKey].steps * state.beatsPerBar).fill('off');
      });
      renderBeats();
    });
  });

  // ---------- 音色ミニピッカー（段の音色ボタンをタップして開く。音色(ペア単位)＋分割を
  // まとめて設定する。決定ボタンを押すまでポップアップは閉じない。） ----------
  SOUND_PAIR_ORDER.forEach(key => {
    const pair = SOUND_PAIRS[key];
    const cell = document.createElement('div');
    cell.className = 'sound-choice-cell';
    cell.dataset.sound = key;
    cell.innerHTML = `<span class="sc-dot-pair"><i style="background:${pair.A.color}"></i><i style="background:${pair.B.color}"></i></span><span class="sc-label">${pair.label}</span>`;
    cell.addEventListener('click', () => {
      if (activeSoundLayerIndex === null) return;
      hapticTap();
      state.rows[activeSoundLayerIndex].sound = key;
      soundChoiceGrid.querySelectorAll('.sound-choice-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      renderBeats();
    });
    soundChoiceGrid.appendChild(cell);
  });

  Object.keys(DIVISIONS).forEach(divKey => {
    const cell = document.createElement('div');
    cell.className = 'div-choice-cell';
    cell.dataset.division = divKey;
    cell.textContent = DIVISIONS[divKey].label;
    cell.addEventListener('click', () => {
      if (activeSoundLayerIndex === null) return;
      hapticTap();
      const row = state.rows[activeSoundLayerIndex];
      row.division = divKey;
      row.pattern = new Array(DIVISIONS[divKey].steps * state.beatsPerBar).fill('off');
      divChoiceRow.querySelectorAll('.div-choice-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      renderBeats();
    });
    divChoiceRow.appendChild(cell);
  });

  function openSoundPicker(layerIndex) {
    activeSoundLayerIndex = layerIndex;
    const row = state.rows[layerIndex];
    soundPickTitle.textContent = `Row ${layerIndex + 1}`;
    soundChoiceGrid.querySelectorAll('.sound-choice-cell').forEach(c => {
      c.classList.toggle('selected', c.dataset.sound === row.sound);
    });
    divChoiceRow.querySelectorAll('.div-choice-cell').forEach(c => {
      c.classList.toggle('selected', c.dataset.division === row.division);
    });
    openPopup(soundPickPopup, soundPickBackdrop);
  }

  soundPickCloseBtn.addEventListener('click', () => {
    hapticTap();
    closePopup(soundPickPopup, soundPickBackdrop);
    activeSoundLayerIndex = null;
  });
  soundPickBackdrop.addEventListener('click', () => {
    closePopup(soundPickPopup, soundPickBackdrop);
    activeSoundLayerIndex = null;
  });

  // ---------- Time signature popup ----------
  function presetLabelFor(n) {
    const map = { 2: '2/4', 3: '3/4', 4: '4/4', 6: '6/8', 8: '8/8' };
    return map[n] || `${n}/4`;
  }

  function setBeatsPerBar(n) {
    state.beatsPerBar = n;
    state.rows.forEach(row => {
      const stepsPerBeat = DIVISIONS[row.division].steps;
      row.pattern = new Array(stepsPerBeat * n).fill('off');
    });
    state.currentBeat = -1;
    renderBeats();
    sigToggleValue.textContent = presetLabelFor(n);
  }

  const SIG_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
  SIG_OPTIONS.forEach(n => {
    const cell = document.createElement('div');
    cell.className = 'choice-cell' + (n === state.beatsPerBar ? ' selected' : '');
    cell.textContent = presetLabelFor(n);
    cell.dataset.beats = n;
    cell.addEventListener('click', () => {
      hapticTap();
      sigGrid.querySelectorAll('.choice-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      setBeatsPerBar(n);
    });
    sigGrid.appendChild(cell);
  });

  sigToggleBtn.addEventListener('click', () => {
    sigGrid.querySelectorAll('.choice-cell').forEach(c => {
      c.classList.toggle('selected', parseInt(c.dataset.beats, 10) === state.beatsPerBar);
    });
    openPopup(sigPopup, sigBackdrop);
  });
  sigCloseBtn.addEventListener('click', () => { hapticTap(); closePopup(sigPopup, sigBackdrop); });
  sigBackdrop.addEventListener('click', () => closePopup(sigPopup, sigBackdrop));

  // ---------- BPM controls (プリセット方式) ----------
  function setBpm(v, force) {
    v = Math.max(30, Math.min(260, Math.round(v)));
    if (v === state.bpm && !force) return;
    state.bpm = v;
    bpmVal.textContent = v;
    tempoNameEl.textContent = tempoName(v);
    updatePresetSelection();
    if (state.playing) rebaseSchedule();
    saveWorkingState();
  }

  function updatePresetSelection() {
    bpmPresetGrid.querySelectorAll('.bpm-preset-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.bpm, 10) === state.bpm);
    });
  }

  BPM_PRESETS.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'bpm-preset-btn';
    btn.type = 'button';
    btn.dataset.bpm = v;
    btn.textContent = v;
    btn.addEventListener('click', () => { hapticTap(); setBpm(v); });
    bpmPresetGrid.appendChild(btn);
  });

  function rebaseSchedule() {
    if (scheduledQueue.length > 0) {
      nextNoteTime = scheduledQueue[scheduledQueue.length - 1].time + secondsPerBeat();
    }
    const ctx = ensureCtx();
    if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime + 0.05;
  }

  function stepBpm(dir) { setBpm(state.bpm + dir); hapticTick(); }
  bpmMinus.addEventListener('click', () => stepBpm(-1));
  bpmPlus.addEventListener('click', () => stepBpm(1));
  bpmMinus2.addEventListener('click', () => stepBpm(-1));
  bpmPlus2.addEventListener('click', () => stepBpm(1));

  const holdStoppers = [];
  function attachHold(btn, dir) {
    let holdTimeout = null;
    let holdInterval = null;
    const clearAll = () => {
      clearTimeout(holdTimeout);
      clearInterval(holdInterval);
      holdTimeout = null;
      holdInterval = null;
    };
    const start = () => {
      clearAll();
      holdTimeout = setTimeout(() => {
        holdInterval = setInterval(() => setBpm(state.bpm + dir), 90);
      }, 350);
    };
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('touchend', clearAll);
    btn.addEventListener('touchcancel', clearAll);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', clearAll);
    btn.addEventListener('mouseleave', clearAll);
    holdStoppers.push(clearAll);
  }
  attachHold(bpmMinus, -1);
  attachHold(bpmPlus, 1);
  attachHold(bpmMinus2, -1);
  attachHold(bpmPlus2, 1);

  window.addEventListener('touchend', () => holdStoppers.forEach(stop => stop()), { passive: true });
  window.addEventListener('mouseup', () => holdStoppers.forEach(stop => stop()));

  // ---------- TAP tempo ----------
  let tapTimes = [];
  tapBtn.addEventListener('click', () => {
    const now = performance.now();
    tapTimes = tapTimes.filter(t => now - t < 2200);
    tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = 60000 / avg;
      setBpm(bpm);
      tapReadout.textContent = Math.round(bpm) + ' BPM';
      hapticSuccess();
    } else {
      tapReadout.textContent = '—';
      hapticTap();
    }
  });

  // ---------- Sound engine ----------
  let audioCtx = null;
  function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playSound(pairKey, variant, time) {
    const ctx = ensureCtx();
    const def = soundVariant(pairKey, variant);

    if (def.kind === 'bass') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const pitch = def.pitch || 1.0;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150 * pitch, time);
      osc.frequency.exponentialRampToValueAtTime(45 * pitch, time + 0.12);
      gain.gain.setValueAtTime(1, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
      osc.start(time);
      osc.stop(time + 0.24);
      return;
    }

    if (def.kind === 'snare') {
      const pitch = def.pitch || 1.0;
      const bufferSize = ctx.sampleRate * 0.2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 1000 * pitch;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.9, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(time);
      noise.stop(time + 0.2);

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180 * pitch, time);
      oscGain.gain.setValueAtTime(0.5, time);
      oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.13);
      return;
    }

    if (def.kind === 'hihat') {
      const dur = def.dur || 0.06;
      const bufferSize = ctx.sampleRate * (dur + 0.02);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(time);
      noise.stop(time + dur + 0.01);
      return;
    }

    if (def.kind === 'clave') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(def.freq, time);
      gain.gain.setValueAtTime(0.6, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
      return;
    }

    // click / beep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = def.kind === 'beep' ? 'sine' : 'square';
    osc.frequency.setValueAtTime(def.freq, time);
    const dur = def.kind === 'beep' ? 0.09 : 0.045;
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  // ---------- Scheduler (look-ahead方式でズレを防止) ----------
  let schedulerTimer = null;
  let nextNoteTime = 0;
  let beatIndex = 0;
  const SCHEDULE_AHEAD = 0.12;
  const LOOKAHEAD_MS = 25;
  const scheduledQueue = [];
  const stepFlashQueue = [];
  let visualRAF = null;

  function secondsPerBeat() { return 60.0 / state.bpm; }

  function scheduler() {
    const ctx = ensureCtx();
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const beatDur = secondsPerBeat();

      state.rows.forEach((row, li) => {
        const stepsPerBeat = DIVISIONS[row.division].steps;
        const stepDur = beatDur / stepsPerBeat;
        for (let s = 0; s < stepsPerBeat; s++) {
          const globalIndex = beatIndex * stepsPerBeat + s;
          const cellState = row.pattern[globalIndex];
          const t = nextNoteTime + s * stepDur;
          // 実際に音が鳴るマスだけをフラッシュ対象にする。offのマスまで
          // キューに積むと、鳴っていないマスまで一瞬光って見えてしまう。
          if (cellState !== 'off') {
            playSound(row.sound, cellState, t);
            stepFlashQueue.push({ time: t, beat: beatIndex, layer: li, step: globalIndex });
          }
        }
      });

      scheduledQueue.push({ time: nextNoteTime, beat: beatIndex });
      beatIndex = (beatIndex + 1) % state.beatsPerBar;
      nextNoteTime += beatDur;
    }
  }

  function visualLoop() {
    const ctx = ensureCtx();
    const now = ctx.currentTime;
    while (scheduledQueue.length && scheduledQueue[0].time <= now) {
      const item = scheduledQueue.shift();
      state.currentBeat = item.beat;
      updateBeatCounter();
      flashBeatBlock(item.beat);
    }
    while (stepFlashQueue.length && stepFlashQueue[0].time <= now) {
      const item = stepFlashQueue.shift();
      flashStep(item.beat, item.layer, item.step);
    }
    if (state.playing) visualRAF = requestAnimationFrame(visualLoop);
  }

  function flashBeatBlock(i) {
    beatsSeq.querySelectorAll('.seq-beat-cell').forEach(c => c.classList.remove('active'));
    beatsSeq.querySelectorAll(`.seq-beat-cell[data-beat="${i}"]`).forEach(c => c.classList.add('active'));
  }

  function flashStep(beatIdx, layerIdx, globalStepIdx) {
    const rows = beatsSeq.querySelectorAll(`.seq-row[data-layer="${layerIdx}"]`);
    rows.forEach(row => {
      const cell = row.querySelector(`.seq-beat-cell[data-beat="${beatIdx}"]`);
      if (!cell) return;
      const stepEl = cell.querySelector(`.layer-step[data-step="${globalStepIdx}"]`);
      if (!stepEl) return;
      stepEl.classList.add('playing');
      setTimeout(() => stepEl.classList.remove('playing'), 120);
    });
  }

  function start() {
    const ctx = ensureCtx();
    state.playing = true;
    beatIndex = 0;
    state.currentBeat = -1;
    scheduledQueue.length = 0;
    stepFlashQueue.length = 0;
    nextNoteTime = ctx.currentTime + 0.06;
    schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
    visualRAF = requestAnimationFrame(visualLoop);
    playToggle.classList.add('playing');
    playIcon.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
  }

  function stop() {
    state.playing = false;
    clearInterval(schedulerTimer);
    cancelAnimationFrame(visualRAF);
    state.currentBeat = -1;
    beatsSeq.querySelectorAll('.seq-beat-cell').forEach(c => c.classList.remove('active'));
    beatsSeq.querySelectorAll('.layer-step.playing').forEach(s => s.classList.remove('playing'));
    updateBeatCounter();
    playToggle.classList.remove('playing');
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }

  playToggle.addEventListener('click', () => {
    ensureCtx();
    hapticTap();
    if (state.playing) stop(); else start();
  });

  // ---------- Init ----------
  // loadWorkingState()が復元したBPMをそのまま画面に反映する（強制上書きしない）
  setBpm(state.bpm, true);
  sigToggleValue.textContent = presetLabelFor(state.beatsPerBar);
  updatePresetSelection();
  renderBeats();
  syncSpacer();
})();
