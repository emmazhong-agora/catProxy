const AI_DENOISER_VERSION = '2.0.2';
const AI_DENOISER_ASSETS_PATH = `https://cdn.jsdelivr.net/npm/agora-extension-ai-denoiser@${AI_DENOISER_VERSION}/external`;
const STEP_DURATION_MS = 60000;
const BASELINE_DURATION_MS = 30000;
const DUMP_SETTLE_MS = 2000;
const query = new URLSearchParams(location.search);
const appId = query.get('appId') || query.get('app_id') || query.get('appid') || '';
const token = query.get('token') || null;
const channel = query.get('channelname')?.trim() || '';
const uidInput = query.get('uid');
const uid = uidInput === null || uidInput === '' ? 0 : Number(uidInput);
const validUid = Number.isInteger(uid) && uid >= 0 && uid <= 4294967295;

const TEST_STEPS = [
    {
        id: '01-no-ains', title: 'Test 1 · No AINS', shortTitle: 'No AINS',
        purpose: 'Check whether crackling occurs on this device without AINS.',
        instruction: 'Speak and try to reproduce the crackling. The microphone is recorded for 30 seconds.',
        mode: null, level: null
    },
    ...[['NSNG', 'SOFT'], ['NSNG', 'AGGRESSIVE'], ['STATIONARY_NS', 'SOFT'], ['STATIONARY_NS', 'AGGRESSIVE']]
        .map(([mode, level], index) => ({
            id: `0${index + 2}-${mode.toLowerCase()}-${level.toLowerCase()}`,
            title: `Test 2.${index + 1} · ${mode} + ${level}`,
            shortTitle: `${mode} + ${level}`,
            purpose: `Check whether crackling occurs with ${mode} mode and ${level} level.`,
            instruction: 'Speak and try to reproduce the crackling. The AINS audio dump is collected automatically.',
            mode, level
        }))
];

const state = {
    client: null, track: null, extension: null, processor: null,
    localPlayback: false,
    monitorGeneration: 0,
    monitorContext: null, monitorSource: null, monitorAnalyser: null, monitorGain: null, monitorTimer: null,
    collecting: false,
    running: false, stopRequested: false, awaitingAnswer: false, index: -1, runtime: null,
    results: [], archive: null, archiveName: null, logStart: 0
};
const el = Object.fromEntries([
    'appIdValue', 'tokenValue', 'uidValue', 'channelValue', 'configurationError',
    'connectionLabel', 'stepList', 'stepCount', 'stepKicker', 'timerLabel',
    'stepTitle', 'stepPurpose', 'parameterRow', 'stepInstruction', 'activityLabel',
    'fileCountLabel', 'activityMeter', 'startButton', 'finishStepButton',
    'issuePrompt', 'resultsTable', 'downloadButton', 'monitorStatus', 'monitorRetry',
    'monitorEnabled', 'monitorVolume', 'monitorVolumeValue'
].map(id => [id, document.getElementById(id)]));
el.liveDot = document.querySelector('.live-dot');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function cleanName(value) {
    return String(value || 'audio.pcm').split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '_');
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function timeLeft(deadline) {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function connection(label, live = false) {
    el.connectionLabel.textContent = label;
    el.liveDot.dataset.live = String(live);
}
function setActivity(label, percent) {
    el.activityLabel.textContent = label;
    if (percent !== undefined) el.activityMeter.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
function initResults() {
    state.results = TEST_STEPS.map(step => ({
        ...step, status: 'pending', issue: 'unknown', issueAnswered: false, files: [],
        startedAt: null, endedAt: null, stoppedByUser: false, error: null
    }));
}
function renderResults() {
    if (!state.results.some(result => result.status !== 'pending')) {
        el.resultsTable.innerHTML = '<div class="results-empty">Your results will appear here after the run starts.</div>';
        return;
    }
    el.resultsTable.innerHTML = state.results.map(result => `
        <div class="result-row" role="row">
            <div class="result-name">${escapeHtml(result.title)}</div>
            <div class="result-params">${escapeHtml(result.mode ? `${result.mode} · ${result.level}` : 'AINS off')}</div>
            <div class="result-status ${result.status === 'running' ? 'result-running' : ''}">${escapeHtml(result.status)}</div>
            <div class="result-files">${result.files.length} PCM · ${escapeHtml(!result.issueAnswered ? 'No answer' : result.issue === 'unknown' ? 'Not sure' : result.issue === 'yes' ? 'Crackling' : 'No crackling')}</div>
        </div>`).join('');
}
function renderSteps() {
    el.stepCount.textContent = `${Math.max(0, state.index + 1)} / ${TEST_STEPS.length}`;
    el.stepList.innerHTML = TEST_STEPS.map((step, index) => `
        <li class="step-item ${index === state.index && state.running ? 'active' : ''} ${state.results[index].status === 'complete' ? 'done' : ''}" data-number="${index + 1}">
            <div><strong>${escapeHtml(step.shortTitle)}</strong><small>${escapeHtml(step.mode ? `${step.mode} · ${step.level}` : 'AINS disabled')}</small></div>
        </li>`).join('');
}
function renderCurrent() {
    const step = TEST_STEPS[Math.max(0, state.index)];
    const result = state.results[Math.max(0, state.index)];
    el.stepKicker.textContent = state.running ? `STEP ${state.index + 1} OF ${TEST_STEPS.length}` : 'READY TO START';
    el.stepTitle.textContent = step.title;
    el.stepPurpose.textContent = step.purpose;
    el.stepInstruction.textContent = state.awaitingAnswer
        ? 'Choose Yes, No, or Not sure to continue to the next test.'
        : step.instruction;
    el.parameterRow.hidden = false;
    el.parameterRow.innerHTML = step.mode
        ? `<span class="parameter">AINS <strong>On</strong></span><span class="parameter">Mode <strong>${escapeHtml(step.mode)}</strong></span><span class="parameter">Level <strong>${escapeHtml(step.level)}</strong></span><span class="parameter">Audio dump <strong>Automatic</strong></span>`
        : '<span class="parameter">AINS <strong>Off</strong></span><span class="parameter">Mode <strong>None</strong></span><span class="parameter">Level <strong>None</strong></span><span class="parameter">Raw mic PCM <strong>Automatic</strong></span>';
    el.fileCountLabel.textContent = `${result.files.length} PCM file${result.files.length === 1 ? '' : 's'} collected`;
    el.finishStepButton.hidden = !state.running || state.awaitingAnswer;
    el.issuePrompt.hidden = !state.running;
    el.issuePrompt.dataset.awaiting = String(state.awaitingAnswer);
    el.issuePrompt.querySelectorAll('[data-issue]').forEach(button =>
        button.classList.toggle('selected', result.issueAnswered && button.dataset.issue === result.issue));
    renderSteps();
    renderResults();
}
function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function unlockMonitor() {
    if (!state.monitorContext || state.monitorContext.state === 'closed') {
        state.monitorContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    await state.monitorContext.resume();
}
async function startLocalPlayback() {
    if (!state.track || !el.monitorEnabled.checked) return;
    stopLocalPlayback();
    const generation = state.monitorGeneration;
    const audioTrack = state.track;
    try {
        await unlockMonitor();
        // Force the SDK's MediaStreamTrack to its output, including the processor node.
        state.track.setVolume(100);
        await sleep(100);
        if (generation !== state.monitorGeneration || state.track !== audioTrack) return;
        const track = state.track.getMediaStreamTrack();
        const context = state.monitorContext;
        state.monitorSource = context.createMediaStreamSource(new MediaStream([track]));
        state.monitorAnalyser = context.createAnalyser();
        state.monitorGain = context.createGain();
        state.monitorGain.gain.value = Number(el.monitorVolume.value) / 100;
        state.monitorSource.connect(state.monitorAnalyser);
        state.monitorAnalyser.connect(state.monitorGain);
        state.monitorGain.connect(context.destination);
        state.localPlayback = true;
        const samples = new Float32Array(state.monitorAnalyser.fftSize);
        state.monitorTimer = setInterval(() => {
            state.monitorAnalyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
            el.monitorStatus.textContent = context.state !== 'running' ? 'Microphone playback blocked'
                : `${state.processor ? 'AINS output' : 'Raw microphone'} playback · ${rms > 0.0001 ? 'Audio signal detected' : 'No audio signal'}`;
            el.monitorRetry.disabled = !state.collecting;
        }, 250);
        el.monitorRetry.disabled = !state.collecting;
        console.info('[AINS TEST] LOCAL PLAYBACK STARTED', {
            processedAudio: Boolean(state.processor), contextState: context.state, trackId: track.id
        });
    } catch (error) {
        console.error('[AINS TEST] local microphone playback could not start', error);
        el.monitorStatus.textContent = 'Microphone playback failed';
        el.monitorRetry.disabled = !state.collecting;
    }
}
function stopLocalPlayback() {
    state.monitorGeneration += 1;
    clearInterval(state.monitorTimer);
    state.monitorTimer = null;
    state.monitorSource?.disconnect();
    state.monitorAnalyser?.disconnect();
    state.monitorGain?.disconnect();
    state.monitorSource = null;
    state.monitorAnalyser = null;
    state.monitorGain = null;
    state.localPlayback = false;
    el.monitorStatus.textContent = !el.monitorEnabled.checked ? 'Microphone playback off'
        : state.collecting ? 'Playback stopped. Click Play microphone audio.'
            : 'Available during each recording step';
    el.monitorRetry.disabled = !state.collecting;
}
function storeFile(result, blob, name, metadata = {}) {
    if (!(blob instanceof Blob) || !blob.size) return;
    let safeName = cleanName(name);
    if (result.files.some(file => file.name === safeName)) {
        safeName = `${result.files.length + 1}-${safeName}`;
    }
    result.files.push({ blob, name: safeName, ...metadata });
    console.info('[AINS TEST] PCM CAPTURED', {
        step: result.id, mode: result.mode, level: result.level,
        name: safeName, size: blob.size
    });
    if (state.results[state.index] === result) renderCurrent();
}

function getExtension() {
    if (state.extension) return state.extension;
    if (!window.AIDenoiser?.AIDenoiserExtension) throw new Error('AINS extension failed to load.');
    const Extension = window.AIDenoiser.AIDenoiserExtension;
    const extension = new Extension({ assetsPath: AI_DENOISER_ASSETS_PATH });
    if (!extension.checkCompatibility()) throw new Error('This browser does not support AINS.');
    AgoraRTC.registerExtensions([extension]);
    state.extension = extension;
    console.info('[AINS field test] plugin version:', AI_DENOISER_VERSION);
    return extension;
}
async function joinChannel() {
    if (!window.AgoraRTC) throw new Error('Agora RTC SDK failed to load.');
    connection('Joining channel…');
    state.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    state.client.on('user-published', async (user, mediaType) => {
        try {
            await state.client.subscribe(user, mediaType);
            if (mediaType === 'audio') user.audioTrack?.play();
        } catch (error) { console.error('[AINS field test] subscribe:', error); }
    });
    state.track = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: 'speech_standard', AEC: false, ANS: false, AGC: false
    });
    await state.client.join(appId, channel, token, uid);
    await state.client.publish([state.track]);
    connection('Connected · microphone live', true);
}
async function removeProcessor() {
    const processor = state.processor;
    if (!processor) return;
    let firstError;
    try { if (processor.enabled) await processor.disable(); } catch (error) { firstError = error; }
    // The processor owns its connection to processorDestination; track.unpipe() does not release it.
    try { await processor.unpipe(); } catch (error) { firstError ||= error; }
    try { await state.track?.unpipe(); } catch (error) { firstError ||= error; }
    try {
        if (typeof processor.destroy === 'function') await processor.destroy();
        else if (typeof processor.release === 'function') await processor.release();
    } catch (error) { firstError ||= error; }
    state.processor = null;
    if (firstError) throw firstError;
}
async function leaveChannel() {
    state.collecting = false;
    stopLocalPlayback();
    try { await removeProcessor(); } catch (error) { console.warn('[AINS field test] processor cleanup:', error); }
    if (state.track) {
        stopLocalPlayback();
        state.track.stop();
        state.track.close();
        state.track = null;
    }
    if (state.client) {
        await state.client.leave();
        state.client = null;
    }
    if (state.monitorContext) {
        await state.monitorContext.close();
        state.monitorContext = null;
    }
    connection('Test finished');
}

// Little-endian signed 16-bit mono PCM, using the browser's actual AudioContext rate.
async function recordBaseline(result, runtime) {
    await startLocalPlayback();
    const mediaTrack = state.track.getMediaStreamTrack();
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([mediaTrack]));
    const recorder = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;
    const chunks = [];
    recorder.onaudioprocess = event => {
        const samples = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i += 1) {
            const value = Math.max(-1, Math.min(1, samples[i]));
            pcm[i] = value < 0 ? value * 32768 : value * 32767;
        }
        chunks.push(pcm);
    };
    try {
        source.connect(recorder);
        recorder.connect(sink);
        sink.connect(context.destination);
        await context.resume();
        const deadline = Date.now() + BASELINE_DURATION_MS;
        while (!runtime.stop && !state.stopRequested && Date.now() < deadline) {
            el.timerLabel.textContent = timeLeft(deadline);
            setActivity('Recording microphone without AINS', 100 * (1 - (deadline - Date.now()) / BASELINE_DURATION_MS));
            await sleep(200);
        }
    } finally {
        stopLocalPlayback();
        recorder.disconnect();
        source.disconnect();
        sink.disconnect();
        await context.close();
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    chunks.forEach(chunk => {
        bytes.set(new Uint8Array(chunk.buffer), offset);
        offset += chunk.byteLength;
    });
    storeFile(result, new Blob([bytes], { type: 'application/octet-stream' }), 'microphone-raw-s16le.pcm', {
        sampleRate: context.sampleRate, channels: 1, sampleFormat: 's16le'
    });
    result.stoppedByUser = runtime.stop || state.stopRequested;
}

async function runAinsStep(step, result, runtime) {
    const processor = getExtension().createProcessor();
    state.processor = processor;
    let dumpEnded = false;
    processor.on('dump', (blob, name) => storeFile(result, blob, name));
    processor.on('dumpend', () => { dumpEnded = true; });
    processor.on('pipeerror', error => {
        runtime.error = error || new Error('AINS pipeline failed.');
        console.error('[AINS TEST] PIPE ERROR', { step: step.id, mode: step.mode, level: step.level, error: runtime.error });
    });
    try {
        await state.track.pipe(processor).pipe(state.track.processorDestination);
        await processor.enable();
        await processor.setMode(step.mode);
        await processor.setLevel(step.level);
        console.info('[AINS TEST] AINS CONFIGURED', {
            step: step.id, mode: step.mode, level: step.level, enabled: processor.enabled
        });
        if (runtime.stop || state.stopRequested) return;
        // Play only after the pipeline is configured so this step never monitors raw audio.
        await startLocalPlayback();
        await processor.dump();
        const deadline = Date.now() + STEP_DURATION_MS;
        while (!runtime.stop && !state.stopRequested && !dumpEnded && Date.now() < deadline) {
            if (runtime.error) throw runtime.error;
            el.timerLabel.textContent = timeLeft(deadline);
            setActivity('Collecting AINS audio dump', 100 * (1 - (deadline - Date.now()) / STEP_DURATION_MS));
            await sleep(200);
        }
        result.stoppedByUser = runtime.stop || state.stopRequested;
    } finally {
        stopLocalPlayback();
        setActivity('Finalizing audio files');
        // Disabling flushes the AINS dump. Keep listeners alive while late dump events arrive.
        try { if (processor.enabled) await processor.disable(); }
        finally {
            const deadline = Date.now() + DUMP_SETTLE_MS;
            while (!dumpEnded && Date.now() < deadline) await sleep(100);
            await removeProcessor();
        }
    }
}

async function buildArchive() {
    if (!window.JSZip) throw new Error('ZIP library failed to load.');
    const zip = new JSZip();
    const summary = {
        createdAt: new Date().toISOString(), appId, tokenProvided: Boolean(token), uid, channel,
        agoraRtcSdkVersion: AgoraRTC.VERSION || null, aiDenoiserVersion: AI_DENOISER_VERSION,
        userAgent: navigator.userAgent,
        steps: state.results.map(({ files, ...result }) => ({
            ...result, files: files.map(({ blob, ...file }) => ({ ...file, size: blob.size }))
        }))
    };
    zip.file('results.json', JSON.stringify(summary, null, 2));
    zip.file('console.log.txt', window.ainsConsoleLog.textSince(state.logStart));
    zip.file('README.txt', 'Each numbered folder matches a test step in results.json.\n'
        + 'Baseline microphone PCM is mono 16-bit little-endian at the sample rate in its manifest.\n'
        + 'AINS dump PCM files are emitted by agora-extension-ai-denoiser.\n'
        + 'console.log.txt contains timestamped browser and SDK logs with the token redacted.\n');
    state.results.forEach(result => {
        const folder = zip.folder(result.id);
        folder.file('manifest.json', JSON.stringify(summary.steps.find(step => step.id === result.id), null, 2));
        result.files.forEach(file => folder.file(file.name, file.blob));
    });
    state.archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    state.archiveName = `ains-field-test-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    el.downloadButton.hidden = false;
    download(state.archive, state.archiveName);
}

async function runTesting() {
    if (state.running || !appId || !channel || !validUid) return;
    state.logStart = window.ainsConsoleLog.beginRun();
    initResults();
    state.running = true;
    state.stopRequested = false;
    state.awaitingAnswer = false;
    state.archive = null;
    state.index = -1;
    el.downloadButton.hidden = true;
    el.startButton.textContent = 'Stop AINS Testing';
    el.startButton.classList.add('stop-action');
    console.info('[AINS TEST] RUN START', {
        appId, channelname: channel, uid, tokenProvided: Boolean(token),
        agoraRtcSdkVersion: window.AgoraRTC?.VERSION || null, aiDenoiserVersion: AI_DENOISER_VERSION,
        steps: TEST_STEPS.length
    });
    try {
        await joinChannel();
        for (let index = 0; index < TEST_STEPS.length && !state.stopRequested; index += 1) {
            state.index = index;
            const step = TEST_STEPS[index];
            const result = state.results[index];
            const runtime = { stop: false, error: null };
            state.runtime = runtime;
            state.awaitingAnswer = false;
            result.status = 'running';
            result.startedAt = new Date().toISOString();
            el.finishStepButton.disabled = false;
            el.timerLabel.textContent = '--:--';
            el.stepInstruction.closest('.instruction-block').hidden = false;
            renderCurrent();
            console.info(`[AINS TEST] STEP START ${index + 1}/${TEST_STEPS.length}: ${step.title}`, {
                id: step.id, purpose: step.purpose, ainsEnabled: Boolean(step.mode),
                mode: step.mode, level: step.level, channelname: channel, uid,
                maxDurationSeconds: step.mode ? STEP_DURATION_MS / 1000 : BASELINE_DURATION_MS / 1000
            });
            state.collecting = true;
            el.monitorRetry.disabled = false;
            if (step.mode) await runAinsStep(step, result, runtime);
            else await recordBaseline(result, runtime);
            state.collecting = false;
            stopLocalPlayback();
            if (!state.stopRequested && !result.issueAnswered) {
                state.awaitingAnswer = true;
                el.timerLabel.textContent = '--:--';
                setActivity('Choose a crackling result to continue', 100);
                renderCurrent();
                console.info(`[AINS TEST] WAITING FOR RESULT: ${step.title}`, { id: step.id });
                while (!result.issueAnswered && !state.stopRequested) await sleep(100);
            }
            state.awaitingAnswer = false;
            result.status = 'complete';
            result.endedAt = new Date().toISOString();
            console.info(`[AINS TEST] STEP END ${index + 1}/${TEST_STEPS.length}: ${step.title}`, {
                id: step.id, status: result.status, mode: step.mode, level: step.level,
                issue: result.issue, issueAnswered: result.issueAnswered,
                stoppedByUser: result.stoppedByUser,
                files: result.files.map(file => ({ name: file.name, size: file.blob.size }))
            });
            state.runtime = null;
            renderCurrent();
        }
    } catch (error) {
        console.error('[AINS field test] run failed:', error);
        if (state.index >= 0 && state.results[state.index].status === 'running') {
            const result = state.results[state.index];
            result.status = 'failed';
            result.error = error.message || String(error);
            result.endedAt = new Date().toISOString();
            console.error(`[AINS TEST] STEP FAILED ${state.index + 1}/${TEST_STEPS.length}: ${result.title}`, {
                id: result.id, mode: result.mode, level: result.level, error
            });
        }
        el.stepKicker.textContent = 'TEST STOPPED';
        el.stepTitle.textContent = 'The test could not continue';
        el.stepPurpose.textContent = error.message || 'Check microphone permission and try again.';
        setActivity('Test error');
    } finally {
        state.runtime = null;
        state.running = false;
        state.awaitingAnswer = false;
        try { await leaveChannel(); } catch (error) { console.warn('[AINS field test] leave:', error); }
        console.info('[AINS TEST] RUN END', {
            stoppedByUser: state.stopRequested,
            steps: state.results.map(result => ({
                id: result.id, status: result.status, mode: result.mode,
                level: result.level, issue: result.issue, fileCount: result.files.length
            }))
        });
        try { await buildArchive(); }
        catch (error) {
            console.error('[AINS field test] ZIP:', error);
            el.stepPurpose.textContent = `Could not create ZIP: ${error.message}`;
        }
        el.startButton.textContent = 'Start AINS Testing';
        el.startButton.classList.remove('stop-action');
        el.startButton.disabled = !appId || !channel || !validUid;
        el.finishStepButton.hidden = true;
        el.issuePrompt.hidden = true;
        el.timerLabel.textContent = '--:--';
        el.parameterRow.hidden = true;
        el.stepInstruction.closest('.instruction-block').hidden = true;
        if (state.archive && !state.results.some(result => result.status === 'failed')) {
            el.stepKicker.textContent = state.stopRequested ? 'TEST STOPPED' : 'RUN COMPLETE';
            el.stepTitle.textContent = 'Your test package is ready';
            el.stepPurpose.textContent = 'The ZIP contains a separate folder and parameter manifest for each step. Send it to the support team through an approved channel.';
            setActivity(state.stopRequested ? 'Partial run downloaded' : 'All steps complete', 100);
        }
        renderSteps();
        renderResults();
    }
}

el.appIdValue.textContent = appId || 'Missing';
el.tokenValue.textContent = token ? 'Provided' : 'Not provided';
el.uidValue.textContent = validUid ? String(uid) : 'Invalid';
el.channelValue.textContent = channel || 'Missing';
if (!appId || !channel || !validUid) {
    el.configurationError.hidden = false;
    el.configurationError.querySelector('strong').textContent =
        !appId ? 'This test link is missing an App ID.'
            : !channel ? 'This test link is missing a channel name.' : 'This test link has an invalid UID.';
    el.configurationError.querySelector('span').textContent =
        !appId ? 'Ask the support team for a complete link containing appId.'
            : !channel ? 'Ask the support team for a complete link containing channelname.'
                : 'UID must be a number from 0 to 4294967295. Ask the support team for a corrected link.';
    el.startButton.disabled = true;
    connection(!appId ? 'App ID required' : !channel ? 'Channel name required' : 'Invalid UID');
}
initResults();
renderCurrent();
el.startButton.addEventListener('click', () => {
    if (state.running) {
        state.stopRequested = true;
        if (state.runtime) state.runtime.stop = true;
        el.startButton.disabled = true;
        setActivity('Stopping and packaging collected audio');
    } else {
        // Resume synchronously from the Start click, before microphone/join awaits.
        unlockMonitor().then(runTesting).catch(error => {
            console.error('[AINS TEST] audio output unlock failed', error);
            el.monitorStatus.textContent = 'Audio output could not start. Click Start to retry.';
        });
    }
});
el.monitorRetry.addEventListener('click', () => {
    el.monitorEnabled.checked = true;
    startLocalPlayback();
});
el.monitorEnabled.addEventListener('change', () => {
    if (!el.monitorEnabled.checked) stopLocalPlayback();
    else if (state.collecting) startLocalPlayback();
});
el.monitorVolume.addEventListener('input', () => {
    el.monitorVolumeValue.value = `${el.monitorVolume.value}%`;
    if (state.monitorGain) state.monitorGain.gain.value = Number(el.monitorVolume.value) / 100;
});
el.finishStepButton.addEventListener('click', () => {
    if (state.runtime) state.runtime.stop = true;
    el.finishStepButton.disabled = true;
    setActivity('Finishing this step');
});
el.downloadButton.addEventListener('click', () => {
    if (state.archive) download(state.archive, state.archiveName);
});
el.issuePrompt.querySelectorAll('[data-issue]').forEach(button => button.addEventListener('click', () => {
    if (!state.running || state.index < 0) return;
    state.results[state.index].issue = button.dataset.issue;
    state.results[state.index].issueAnswered = true;
    console.info(`[AINS TEST] CRACKLING RESULT: ${state.results[state.index].title}`, {
        id: state.results[state.index].id, issue: button.dataset.issue
    });
    renderCurrent();
}));
