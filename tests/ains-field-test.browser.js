async (page) => {
    await page.goto('http://localhost:8765/ains-test.html?appId=test-app&token=secret-value&uid=0&channelname=test-channel');
    await page.evaluate(() => {
        class FakeAudioContext {
            constructor() { this.sampleRate = 48000; this.destination = {}; this.state = 'running'; }
            createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
            createAnalyser() { return { fftSize: 32, getFloatTimeDomainData(samples) { samples.fill(.25); }, connect() {}, disconnect() {} }; }
            createScriptProcessor() {
                return {
                    onaudioprocess: null,
                    connect() {
                        setTimeout(() => this.onaudioprocess?.({
                            inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.25) }
                        }), 25);
                    },
                    disconnect() {}
                };
            }
            createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
            async resume() {}
            async close() {}
        }
        window.AudioContext = FakeAudioContext;
        window.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
        let serial = 0;
        const destination = { piped: false };
        class FakeProcessor {
            constructor() { this.handlers = {}; this.enabled = false; this.serial = ++serial; this.piped = false; }
            on(name, handler) { this.handlers[name] = handler; }
            pipe(target) {
                if (target.piped) throw new Error('Processor AudioProcessorDestination already being piped, please call AIDenoiserProcessor.unpipe() beforehand.');
                target.piped = true;
                this.piped = true;
                return Promise.resolve();
            }
            async unpipe() {
                this.piped = false;
                destination.piped = false;
            }
            async enable() { this.enabled = true; }
            async setMode(mode) { this.mode = mode; }
            async setLevel(level) { this.level = level; }
            async dump() { this.dumpStarted = true; }
            async disable() {
                this.enabled = false;
                if (this.dumpStarted) {
                    this.handlers.dump(new Blob([new Uint8Array([this.serial, 1, 2, 3])]), 'input.pcm');
                    this.handlers.dumpend();
                }
            }
            async destroy() { if (this.piped) throw new Error('Processor destroyed while piped'); }
        }
        window.AIDenoiser = {
            AIDenoiserExtension: class {
                checkCompatibility() { return true; }
                createProcessor() { return new FakeProcessor(); }
            }
        };
        const track = {
            processorDestination: destination,
            setVolume() { (window.playbackChecks ||= []).push(destination.piped); },
            play() { (window.playbackChecks ||= []).push(destination.piped); },
            getMediaStreamTrack() { return { id: destination.piped ? 'processed' : 'raw' }; },
            pipe(processor) { return processor; },
            async unpipe() {},
            stop() {},
            close() {}
        };
        window.AgoraRTC = {
            VERSION: 'mock',
            registerExtensions() {},
            createClient() {
                return {
                    on() {},
                    async join(...args) { window.joinArgs = args; },
                    async publish() {},
                    async leave() {}
                };
            },
            async createMicrophoneAudioTrack() { return track; }
        };
    });
    await page.getByRole('button', { name: 'Start AINS Testing' }).click();
    await page.waitForFunction(() => state.index === 0 && state.runtime);
    await page.evaluate(() => console.warn('SDK diagnostic token=secret-value', { token: 'secret-value' }));
    await page.waitForTimeout(200);
    await page.getByLabel('Hear my microphone').uncheck();
    if (await page.evaluate(() => state.localPlayback || state.monitorSource !== null)) {
        throw new Error('Monitor switch did not disconnect playback');
    }
    await page.getByLabel('Hear my microphone').check();
    await page.waitForFunction(() => state.localPlayback);
    await page.getByLabel('Playback volume').fill('35');
    if (await page.evaluate(() => state.monitorGain.gain.value !== .35)) {
        throw new Error('Playback volume did not update monitor gain');
    }
    await page.getByRole('button', { name: 'Finish This Step' }).click();
    await page.waitForFunction(() => state.awaitingAnswer);
    await page.waitForTimeout(250);
    await page.screenshot({ path: '/tmp/ains-answer-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/ains-answer-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    if (await page.evaluate(() => state.index !== 0 || state.results[0].issueAnswered)) {
        throw new Error('Advanced without required crackling response');
    }
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    for (let index = 1; index < 5; index += 1) {
        await page.waitForFunction(i => state.index === i && state.runtime && !state.runtime.stop, index);
        await page.getByRole('button', { name: 'Finish This Step' }).click();
        await page.waitForFunction(() => state.awaitingAnswer);
        await page.getByRole('button', { name: index === 4 ? 'Not sure' : 'No', exact: true }).click();
    }
    await page.waitForFunction(() => !state.running && state.archive);
    const report = await page.evaluate(async () => {
        const zip = await JSZip.loadAsync(state.archive);
        const summary = JSON.parse(await zip.file('results.json').async('string'));
        const log = await zip.file('console.log.txt').async('string');
        return {
            join: window.joinArgs,
            steps: summary.steps.map(step => ({
                id: step.id, title: step.title, status: step.status, mode: step.mode, level: step.level,
                issue: step.issue, issueAnswered: step.issueAnswered,
                files: step.files.map(file => [file.name, file.size])
            })),
            entries: Object.keys(zip.files),
            tokenInArchive: JSON.stringify(summary).includes('secret-value') || log.includes('secret-value'),
            log,
            playbackChecks: window.playbackChecks
        };
    });
    if (JSON.stringify(report.join) !== JSON.stringify(['test-app', 'test-channel', 'secret-value', 0])) {
        throw new Error('Unexpected join configuration: ' + JSON.stringify(report.join));
    }
    if (report.steps.length !== 5 || report.steps.some(step => step.status !== 'complete' || step.files.length === 0 || step.files.some(file => file[1] === 0))) {
        throw new Error('Missing step or nonempty PCM: ' + JSON.stringify(report.steps));
    }
    if (report.tokenInArchive || report.steps.some(step => !report.entries.includes(step.id + '/manifest.json'))) {
        throw new Error('ZIP manifest or token handling failed');
    }
    if (JSON.stringify(report.playbackChecks) !== JSON.stringify([false, false, true, true, true, true])) {
        throw new Error('Local playback did not follow baseline/AINS pipeline: ' + JSON.stringify(report.playbackChecks));
    }
    if (!report.steps.every(step => step.issueAnswered)
        || report.steps[0].issue !== 'yes' || report.steps[4].issue !== 'unknown'
        || !report.log.includes('[REDACTED]') || !report.log.includes('[AINS TEST] RUN END')
        || report.steps.some(step => !report.log.includes('STEP START') || !report.log.includes(step.title))) {
        throw new Error('Required responses or step console log missing');
    }
    await page.getByRole('button', { name: 'Start AINS Testing' }).click();
    await page.waitForFunction(() => state.index === 0 && state.runtime);
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Stop AINS Testing' }).click();
    await page.waitForFunction(() => !state.running && state.archive);
    const partial = await page.evaluate(() => state.results.map(step => [step.status, step.files.length]));
    if (partial[0][0] !== 'complete' || partial[0][1] !== 1 || partial.slice(1).some(step => step[0] !== 'pending')) {
        throw new Error('Partial run missing baseline audio or advanced after Stop: ' + JSON.stringify(partial));
    }
    await page.goto('http://localhost:8765/ains-test.html?channelname=test-channel&uid=invalid');
    if (await page.getByRole('button', { name: 'Start AINS Testing' }).isEnabled()) throw new Error('Missing App ID accepted');
    await page.goto('http://localhost:8765/ains-test.html?appId=test-app&uid=0');
    if (await page.getByRole('button', { name: 'Start AINS Testing' }).isEnabled()) throw new Error('Missing channelname accepted');
    await page.goto('http://localhost:8765/ains-test.html?appId=test-app&channel=test-channel');
    if (await page.getByRole('button', { name: 'Start AINS Testing' }).isEnabled()) throw new Error('Old channel alias accepted');
    await page.goto('http://localhost:8765/ains-test.html?appId=test-app&channelname=test-channel&uid=invalid');
    if (await page.getByRole('button', { name: 'Start AINS Testing' }).isEnabled()) throw new Error('Invalid UID accepted');
    await page.goto('http://localhost:8765/ains-test.html?appId=test-app&channelname=test-channel');
    await page.evaluate(() => {
        AgoraRTC.createClient = () => ({ on() {}, async join() { throw new Error('join failure'); }, async leave() {} });
        AgoraRTC.createMicrophoneAudioTrack = async () => ({ stop() {}, close() {} });
    });
    await page.getByRole('button', { name: 'Start AINS Testing' }).click();
    await page.waitForFunction(() => !state.running && state.archive);
    const failureLog = await page.evaluate(async () => {
        const zip = await JSZip.loadAsync(state.archive);
        return zip.file('console.log.txt').async('string');
    });
    if (!failureLog.includes('join failure') || !failureLog.includes('[AINS TEST] RUN END')) {
        throw new Error('Join failure ZIP missing console diagnostics');
    }
    console.log(JSON.stringify(report, null, 2));
}
