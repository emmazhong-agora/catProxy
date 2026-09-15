// Agora logging: enableLogUpload must be the first AgoraRTC call (before registerExtensions in beauty.js, etc.).
if (typeof AgoraRTC !== 'undefined' && typeof AgoraRTC.enableLogUpload === 'function') {
    AgoraRTC.enableLogUpload();
}
if (typeof AgoraRTC !== 'undefined' && typeof AgoraRTC.setLogLevel === 'function') {
    AgoraRTC.setLogLevel(0); // 0 = DEBUG — full API logs (max verbosity; not the SDK default)
}

// Agora client configuration
window.LOCAL_VIDEO_PLAY_CONFIG = { fit: 'contain' };

const AI_DENOISER_VERSION = '2.0.2';
const AI_DENOISER_ASSETS_PATH = `https://cdn.jsdelivr.net/npm/agora-extension-ai-denoiser@${AI_DENOISER_VERSION}/external`;
console.info(`[AINS] agora-extension-ai-denoiser version: ${AI_DENOISER_VERSION}`);

let client;
let client2;
let localAudioTrack;
let localVideoTrack;
let remoteAudioTrack;
let remoteVideoTrack;
let isLocalAudioPublished = false;
let isDualStreamEnabled = false;
let isVirtualBackgroundEnabled = false;
let isAinsEnabled = false;
let ainsMode = 'NSNG';
let ainsExtension;
let ainsProcessor;
let startTime;
let statsInterval;

const AUDIO_DUMP_EXPECTED_FILES = 9;
const AUDIO_DUMP_CAPTURE_WARMUP_MS = 1000;
const audioDumpState = {
    active: false,
    files: [],
    startedAt: null,
    statusTimer: null,
    archiveBlob: null,
    archiveName: null,
    finalizing: false,
    captureTrack: null,
    captureStartedForDump: false,
    microphoneEnabledAtStart: null,
    microphonePublishedAtStart: null
};

//Agora net-quality stats
var clientNetQuality = {uplink: 0, downlink: 0};
var clientNetQuality2 = {uplink: 0, downlink: 0};

// Add new variables for virtual background
let lastVirtualBgCost = 0;
let settingsToggleBtn;

// Add audio profiles configuration
const audioProfiles = [{
    label: "speech_low_quality",
    detail: "16 Khz, mono, 24Kbps",
    value: "speech_low_quality"
}, {
    label: "speech_standard",
    detail: "32 Khz, mono, 24Kbps",
    value: "speech_standard"
}, {
    label: "music_standard",
    detail: "48 Khz, mono, 40 Kbps",
    value: "music_standard"
}, {
    label: "standard_stereo",
    detail: "48 Khz, stereo, 64 Kbps",
    value: "standard_stereo"
}, {
    label: "high_quality",
    detail: "48 Khz, mono, 129 Kbps",
    value: "high_quality"
}, {
    label: "high_quality_stereo",
    detail: "48 Khz, stereo, 192 Kbps",
    value: "high_quality_stereo"
}, {
    label: "320_high",
    detail: "48 Khz, stereo, 320 Kbps",
    value: {
        bitrate: 320,
        sampleRate: 48000,
        sampleSize: 16,
        stereo: true
    }
}];

// Add SVC variables
let isSVCEnabled = false;
let currentSpatialLayer = 3;
let currentTemporalLayer = 3;
let layers = {}; // Add layers object to track per-uid settings

// DOM Elements
const appIdInput = document.getElementById('appId');
const tokenInput = document.getElementById('token');
const channelNameInput = document.getElementById('channelName');
const userIdInput = document.getElementById('userId');
const micSelect = document.getElementById('micSelect');
const cameraSelect = document.getElementById('cameraSelect');
const videoProfileSelect = document.getElementById('videoProfile');
const cloudProxySelect = document.getElementById('cloudProxy');
const geoFenceSelect = document.getElementById('geoFence');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const muteMicBtn = document.getElementById('muteMicBtn');
const muteCameraBtn = document.getElementById('muteCameraBtn');
const dualStreamBtn = document.getElementById('dualStreamBtn');
const switchStreamBtn = document.getElementById('switchStreamBtn');
const virtualBgBtn = document.getElementById('virtualBgBtn');
const ainsBtn = document.getElementById('ainsBtn');
const audioDumpBtn = document.getElementById('audioDumpBtn');
const audioDumpPanel = document.getElementById('audioDumpPanel');
const audioDumpMessage = document.getElementById('audioDumpMessage');
const audioDumpStatus = document.getElementById('audioDumpStatus');
const audioDumpProgress = document.getElementById('audioDumpProgress');
const audioDumpProgressBar = audioDumpPanel?.querySelector('[role="progressbar"]');
const audioDumpFileCount = document.getElementById('audioDumpFileCount');
const downloadAudioDumpBtn = document.getElementById('downloadAudioDumpBtn');
const beautyBtn = document.getElementById('beautyBtn');
const watermarkBtn = document.getElementById('watermarkBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localStats = document.getElementById('localStats');
const remoteStats = document.getElementById('remoteStats');
const localNetworkGraph = document.getElementById('localNetworkGraph');
const localFpsGraph = document.getElementById('localFpsGraph');
const remoteNetworkGraph = document.getElementById('remoteNetworkGraph');
const remoteFpsGraph = document.getElementById('remoteFpsGraph');

// Add new DOM elements for virtual background controls
const virtualBgTypeSelect = document.getElementById('virtualBgType');
const virtualBgColorGroup = document.getElementById('virtualBgColorGroup');
const virtualBgColorInput = document.getElementById('virtualBgColor');
const colorValueDisplay = document.getElementById('colorValue');
const virtualBgImgGroup = document.getElementById('virtualBgImgGroup');
const virtualBgImgUrlInput = document.getElementById('virtualBgImgUrl');
const virtualBgVideoGroup = document.getElementById('virtualBgVideoGroup');
const virtualBgVideoUrlInput = document.getElementById('virtualBgVideoUrl');
const virtualBgBlurGroup = document.getElementById('virtualBgBlurGroup');
const virtualBgBlurSelect = document.getElementById('virtualBgBlur');

// Add new chart variables
let virtualBgCostChart;
let resolutionChart;
let virtualBgCostData;
let resolutionData;
let networkChart;
let fpsChart;
let networkData;
let fpsData;

// Add new DOM elements
const audioProfileSelect = document.getElementById('audioProfile');
const svcControls = document.getElementById('svcControls');
const spatialLayerInput = document.getElementById('spatialLayer');
const temporalLayerInput = document.getElementById('temporalLayer');
const applySVCBtn = document.getElementById('applySVCBtn');

// Define chart options globally
const chartOptions = {
    curveType: 'function',
    legend: { position: 'bottom' },
    backgroundColor: { fill: 'transparent' },
    hAxis: { textPosition: 'none' },
    vAxis: { minValue: 0 },
    animation: {
        duration: 0 // Disable animation to prevent blinking
    },
    tooltip: {
        trigger: 'focus',
        ignoreBounds: true
    }
};

// Initialize Google Charts
google.charts.load('current', {'packages':['corechart']});
google.charts.setOnLoadCallback(initializeCharts);

function initializeCharts() {
    networkData = new google.visualization.DataTable();
    networkData.addColumn('number', 'Time');
    networkData.addColumn('number', 'Upload');
    networkData.addColumn('number', 'Download');

    fpsData = new google.visualization.DataTable();
    fpsData.addColumn('number', 'Time');
    fpsData.addColumn('number', 'Local FPS');
    fpsData.addColumn('number', 'Remote FPS');

    virtualBgCostData = new google.visualization.DataTable();
    virtualBgCostData.addColumn('number', 'Time');
    virtualBgCostData.addColumn('number', 'Cost');

    resolutionData = new google.visualization.DataTable();
    resolutionData.addColumn('number', 'Time');
    resolutionData.addColumn('number', 'Send Width');
    resolutionData.addColumn('number', 'Send Height');
    resolutionData.addColumn('number', 'Receive Width');
    resolutionData.addColumn('number', 'Receive Height');

    networkChart = new google.visualization.LineChart(document.getElementById('networkQualityChart'));
    fpsChart = new google.visualization.LineChart(document.getElementById('fpsChart'));
    virtualBgCostChart = new google.visualization.LineChart(document.getElementById('virtualBgCostChart'));
    resolutionChart = new google.visualization.LineChart(document.getElementById('resolutionChart'));

    networkChart.draw(networkData, {
        ...chartOptions,
        title: 'Network Bandwidth',
        vAxis: { title: 'Bitrate (Mbps)', minValue: 0, maxValue: 10 }
    });

    fpsChart.draw(fpsData, {
        ...chartOptions,
        title: 'Frame Rate',
        vAxis: { title: 'FPS', minValue: 0, maxValue: 60 }
    });

    virtualBgCostChart.draw(virtualBgCostData, {
        ...chartOptions,
        title: 'Virtual Background Cost',
        vAxis: { title: 'Cost', minValue: 0 }
    });

    resolutionChart.draw(resolutionData, {
        ...chartOptions,
        title: 'Resolution',
        vAxis: { title: 'Pixels', minValue: 0, maxValue: 1920 }
    });
}

// Video profiles configuration
const videoProfiles = [
    { label: "120p", detail: "160×120, 15fps", value: "120p" },
    { label: "120p_1", detail: "160×120, 15fps", value: "120p_1" },
    { label: "120p_3", detail: "120×120, 15fps", value: "120p_3" },
    { label: "180p", detail: "320×180, 15fps", value: "180p" },
    { label: "180p_1", detail: "320×180, 15fps", value: "180p_1" },
    { label: "180p_3", detail: "180×180, 15fps", value: "180p_3" },
    { label: "180p_4", detail: "240×180, 15fps", value: "180p_4" },
    { label: "240p", detail: "320×240, 15fps", value: "240p" },
    { label: "240p_1", detail: "320×240, 15fps", value: "240p_1" },
    { label: "240p_3", detail: "240×240, 15fps", value: "240p_3" },
    { label: "240p_4", detail: "424×240, 15fps", value: "240p_4" },
    { label: "360p", detail: "640×360, 15fps", value: "360p" },
    { label: "360p_1", detail: "640×360, 15fps", value: "360p_1" },
    { label: "360p_3", detail: "360×360, 15fps", value: "360p_3" },
    { label: "360p_4", detail: "640×360, 30fps", value: "360p_4" },
    { label: "360p_6", detail: "360×360, 30fps", value: "360p_6" },
    { label: "360p_7", detail: "480×360, 15fps", value: "360p_7" },
    { label: "360p_8", detail: "480×360, 30fps", value: "360p_8" },
    { label: "360p_9", detail: "640×360, 15fps", value: "360p_9" },
    { label: "360p_10", detail: "640×360, 24fps", value: "360p_10" },
    { label: "360p_11", detail: "640×360, 24fps", value: "360p_11" },
    { label: "480p", detail: "640×480, 15fps", value: "480p" },
    { label: "480p_1", detail: "640×480, 15fps", value: "480p_1" },
    { label: "480p_2", detail: "640×480, 30fps", value: "480p_2" },
    { label: "480p_3", detail: "480×480, 15fps", value: "480p_3" },
    { label: "480p_4", detail: "640×480, 30fps", value: "480p_4" },
    { label: "480p_6", detail: "480×480, 30fps", value: "480p_6" },
    { label: "480p_8", detail: "848×480, 15fps", value: "480p_8" },
    { label: "480p_9", detail: "848×480, 30fps", value: "480p_9" },
    { label: "480p_10", detail: "640×480, 10fps", value: "480p_10" },
    { label: "720p", detail: "1280×720, 15fps", value: "720p" },
    { label: "720p_1", detail: "1280×720, 15fps", value: "720p_1" },
    { label: "720p_2", detail: "1280×720, 30fps", value: "720p_2" },
    { label: "720p_3", detail: "1280×720, 30fps", value: "720p_3" },
    { label: "720p_auto", detail: "1280×720, 30fps", value: "720p_auto" },
    { label: "720p_5", detail: "960×720, 15fps", value: "720p_5" },
    { label: "720p_6", detail: "960×720, 30fps", value: "720p_6" },
    { label: "1080p", detail: "1920×1080, 15fps", value: "1080p" },
    { label: "1080p_1", detail: "1920×1080, 15fps", value: "1080p_1" },
    { label: "1080p_2", detail: "1920×1080, 30fps", value: "1080p_2" },
    { label: "1080p_3", detail: "1920×1080, 30fps", value: "1080p_3" },
    { label: "1080p_5", detail: "1920×1080, 60fps", value: "1080p_5" }
  ];

// Regions configuration
const regions = [
    { label: "Global", value: "GLOBAL" },
    { label: "Africa", value: "AFRICA" },
    { label: "Asia", value: "ASIA" },
    { label: "China", value: "CHINA" },
    { label: "Europe", value: "EUROPE" },
    { label: "Hong Kong & Macau", value: "HKMC" },
    { label: "India", value: "INDIA" },
    { label: "Japan", value: "JAPAN" },
    { label: "North America", value: "NORTH_AMERICA" },
    { label: "Oceania", value: "OCEANIA" },
    { label: "Oversea", value: "OVERSEA" },
    { label: "South America", value: "SOUTH_AMERICA" },
    { label: "United States", value: "US" }
];

// Proxy modes configuration
const proxyModes = [
    {
        label: "Close",
        detail: "Disable Cloud Proxy",
        value: "0",
    },
    {
        label: "UDP Mode",
        detail: "Enable Cloud Proxy via UDP protocol",
        value: "3",
    },
    {
        label: "TCP Mode",
        detail: "Enable Cloud Proxy via TCP/TLS port 443",
        value: "5",
    }
];

// Add new variables for SVC popup
const svcPopup = document.querySelector('.svc-popup');
const svcOverlay = document.querySelector('.svc-popup-overlay');
const svcSaveBtn = document.querySelector('.svc-popup-footer .save');
const svcCancelBtn = document.querySelector('.svc-popup-footer .cancel');
const enableSVCCheckbox = document.getElementById('enableSVC');

// Add click counter for logo
let logoClickCount = 0;
let logoClickTimeout;

// Initialize Agora client
async function initializeAgoraClient() {
    //AgoraRTC.setParameter("TURN_DOMAIN", "edge.sd-rtn.com");
    // Set WebAudio initialization options
    AgoraRTC.setParameter('WEBAUDIO_INIT_OPTIONS', {
        latencyHint: 0.03,
        sampleRate: 48000,
    });

    AgoraRTC.setParameter("EXPERIMENTS", {"netqSensitivityMode": 1});

    client = AgoraRTC.createClient({ mode: "live", codec: "vp9" });
    client2 = AgoraRTC.createClient({ mode: "live", codec: "vp9" });

    await client.setClientRole("host");
    await client2.setClientRole("audience");

    setupEventHandlers();
}

// Set up event handlers
function setupEventHandlers() {
    // Network quality handlers
    client.on("network-quality", (stats) => {
        //console.log("Network quality changed:", stats);
        clientNetQuality.uplink = stats.uplinkNetworkQuality;
        clientNetQuality.downlink = stats.downlinkNetworkQuality;
    });

    client2.on("network-quality", (stats) => {
        //console.log("Client2 network quality changed:", stats);
        clientNetQuality2.uplink = stats.uplinkNetworkQuality;
        clientNetQuality2.downlink = stats.downlinkNetworkQuality;
    });

    // Connection state handlers
    client.on("connection-state-change", (state, reason) => {
        console.log("Connection state changed:", state, reason);
        showPopup(`Connection state changed to: ${state}`);
    });

    client2.on("connection-state-change", (state, reason) => {
        console.log("Client2 connection state changed:", state, reason);
        showPopup(`Client2 connection state changed to: ${state}`);
    });

    // Cloud proxy handlers
    client.on("is-using-cloud-proxy", (isUsing) => {
        console.log("Using cloud proxy:", isUsing);
        showPopup(`Cloud proxy ${isUsing ? "enabled" : "disabled"}`);
    });

    client.on("join-fallback-to-proxy", () => {
        console.log("Falling back to proxy");
        showPopup("Falling back to proxy");
    });

    // Stream type change handler
    client2.on("stream-type-changed", (uid, streamType) => {
        console.log("Stream type changed for user", uid, "to", streamType);
        showPopup(`Stream type changed to ${streamType === 0 ? "high" : "low"} quality`);
    });

    // Existing user-published handlers
    client.on("user-published", async (user, mediaType) => {
        try {
            await client.subscribe(user, mediaType);
            console.log("Subscribed to", mediaType, "from user", user.uid);
            
            if (mediaType === "audio") {
                remoteAudioTrack = user.audioTrack;
                remoteAudioTrack.play();
                console.log("Playing remote audio");
            } else if (mediaType === "video") {
                remoteVideoTrack = user.videoTrack;
                remoteVideo.innerHTML = ''; // Clear no-video div
                remoteVideoTrack.play(remoteVideo);
                console.log("Playing remote video");
            }
        } catch (error) {
            console.error("Error in user-published handler:", error);
        }
    });

    client.on("user-unpublished", async (user, mediaType) => {
        if (mediaType === "audio") {
            remoteAudioTrack = null;
        } else if (mediaType === "video") {
            remoteVideoTrack = null;
            remoteVideo.innerHTML = '<div class="no-video"></div>';
        }
    });

    client2.on("user-published", async (user, mediaType) => {
        try {
            if (user.uid === client.uid) {
                await client2.subscribe(user, mediaType);
                console.log("Client2 subscribed to", mediaType, "from user", user.uid);
                client2.setStreamFallbackOption(user, 0);

                if (mediaType === "video" && user.videoTrack) {
                    remoteVideoTrack = user.videoTrack;
                    remoteVideo.innerHTML = ''; // Clear no-video div
                    remoteVideoTrack.play(remoteVideo);
                    console.log("Client2 playing remote video");
                } else if (mediaType === "audio" && user.audioTrack) {
                    remoteAudioTrack = user.audioTrack;
                    remoteAudioTrack.play();
                    console.log("Client2 playing remote audio");
                }
            }
        } catch (error) {
            console.error("Error in client2 user-published handler:", error);
        }
    });

    client2.on("user-unpublished", async (user, mediaType) => {
        if (user.uid === client.uid && mediaType === "video") {
            remoteVideoTrack = null;
            remoteVideo.innerHTML = '<div class="no-video"></div>';
        }
    });
}

// Get devices
async function getDevices() {
    console.log("EMOJI Getting devices");
    try {
        const devices = await AgoraRTC.getDevices();

        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        const videoDevices = devices.filter(device => device.kind === 'videoinput');



        // Populate microphone select
        micSelect.innerHTML = audioDevices.map(device => 
            `<option value="${device.deviceId}">${device.label || `Microphone ${device.deviceId}`}</option>`
        ).join('');

        // Populate camera select
        cameraSelect.innerHTML = videoDevices.map(device => 
            `<option value="${device.deviceId}">${device.label || `Camera ${device.deviceId}`}</option>`
        ).join('');
    } catch (error) {
        console.error("Error getting devices:", error);
    }
}

// Create local tracks
async function createLocalTracks() {
    try {
        const selectedAudioProfile = audioProfileSelect.value;
        const audioProfile = selectedAudioProfile.startsWith('{')
            ? JSON.parse(selectedAudioProfile)
            : selectedAudioProfile;

        // Create audio track with selected profile
        /*const audioProfile = audioProfileSelect.value;
        localVideoTrack = await AgoraRTC.createCameraVideoTrack({
            encoderConfig: videoProfileSelect.value,
            deviceId: cameraSelect.value,
            scalabiltyMode: isSVCEnabled ? "3SL3TL" : undefined
        });
        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
            encoderConfig: audioProfile,
            deviceId: micSelect.value
        });*/
        [localAudioTrack, localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
            {
                encoderConfig: audioProfile,
                deviceId: micSelect.value
            },
            {
                encoderConfig: videoProfileSelect.value,
                deviceId: cameraSelect.value,
                scalabiltyMode: isSVCEnabled ? "3SL3TL" : undefined
            }
        );

        // Play local video track
        localVideo.innerHTML = ''; // Clear no-video div
        localVideoTrack.play("localVideo", window.LOCAL_VIDEO_PLAY_CONFIG);

        // Expose for effect pipeline helpers (beauty.js).
        window.localVideoTrack = localVideoTrack;
    } catch (error) {
        console.error("Error creating local tracks:", error);
        throw error;
    }
}

/* Create local video track
async function createLocalVideoTrack() {
    try {
        const selectedProfile = videoProfileSelect.value || "720p_3"; // Default to 720p_3 if none selected
        const config = videoProfiles.find(p => p.value === selectedProfile) || videoProfiles.find(p => p.value === "720p_3");
        
        localVideoTrack = await AgoraRTC.createCameraVideoTrack({
            encoderConfig: config.value,
            optimizationMode: "motion",
            source: cameraSelect.value
        });
        
        // Set initial encoder configuration
        await localVideoTrack.setEncoderConfiguration(config.value);
        
        // ... rest of the function ...
    } catch (error) {
        console.error("Error creating local video track:", error);
        throw error;
    }
}
*/

// Join channel
async function joinChannel() {
    try {
        const appId = appIdInput.value;
        const token = tokenInput.value || null;
        const channelName = channelNameInput.value;
        const uid = userIdInput.value ? parseInt(userIdInput.value) : null;

        if (!appId || !channelName) {
            showPopup("Please enter App ID and Channel Name");
            return;
        }

        // Reset all graphs at the start of a new call
        if (networkData) networkData.removeRows(0, networkData.getNumberOfRows());
        if (fpsData) fpsData.removeRows(0, fpsData.getNumberOfRows());
        if (virtualBgCostData) virtualBgCostData.removeRows(0, virtualBgCostData.getNumberOfRows());
        if (resolutionData) resolutionData.removeRows(0, resolutionData.getNumberOfRows());

        showPopup("Initializing Agora client...");
        await initializeAgoraClient();
        
        showPopup("Creating local tracks...");
        await createLocalTracks();

        // Set region if selected
        if (geoFenceSelect.value !== "GLOBAL") {
            showPopup(`Setting region to ${geoFenceSelect.value}...`);
            AgoraRTC.setArea({areaCode: geoFenceSelect.value});
        }

        // Set proxy mode if selected
        const proxyMode = parseInt(cloudProxySelect.value);
        if (proxyMode > 0) {
            showPopup(`Starting proxy server in ${proxyMode === 3 ? 'UDP' : 'TCP'} mode...`);
            await client.startProxyServer(proxyMode);
            await client2.startProxyServer(proxyMode);
        }

        // Enable dual stream mode before joining only if SVC is not enabled
        if (!isSVCEnabled) {
            showPopup("Enabling dual stream mode...");
            await client.enableDualStream();
            isDualStreamEnabled = true;
            dualStreamBtn.textContent = "Disable Dual Stream";
            switchStreamBtn.textContent = "Set to Low Quality";
            dualStreamBtn.disabled = false;
            dualStreamBtn.style.opacity = '1';
            switchStreamBtn.disabled = false;
            switchStreamBtn.style.opacity = '1';
        } else {
            showPopup("Dual stream disabled because SVC is enabled");
            isDualStreamEnabled = false;
            dualStreamBtn.textContent = "Enable Dual Stream";
            dualStreamBtn.disabled = true;
            dualStreamBtn.style.opacity = '0.5';
            switchStreamBtn.textContent = "Set to High Quality";
            switchStreamBtn.disabled = true;
            switchStreamBtn.style.opacity = '0.5';
        }

        // Join channel as host
        showPopup(`Joining channel ${channelName} as host...`);
        await client.join(appId, channelName, token, uid);
        await client.publish([localVideoTrack]);
        await localAudioTrack.setEnabled(false);
        isLocalAudioPublished = false;

        // Join channel as audience
        showPopup("Joining channel as audience...");
        await client2.join(appId, channelName, token, null);
        
        startTime = Date.now();
        startStatsMonitoring();

        // Update UI
        joinBtn.disabled = true;
        joinBtn.style.opacity = '0.5';
        leaveBtn.disabled = false;
        leaveBtn.style.opacity = '1';

        // Enable control buttons
        [muteMicBtn, muteCameraBtn, switchStreamBtn, virtualBgBtn, ainsBtn, beautyBtn].forEach(btn => {
            if (!btn) return;
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = '#fff3cd';
        });
        if (watermarkBtn) {
            watermarkBtn.disabled = false;
            watermarkBtn.style.opacity = '1';
            watermarkBtn.style.background = '#fff3cd';
        }

        // Audio starts unpublished so a diagnostic dump can capture locally without sending it.
        if (localAudioTrack) {
            muteMicBtn.textContent = "Unmute Mic";
            showPopup("Audio muted by default");
        }

        showPopup("Successfully joined channel!");
    } catch (error) {
        console.error("Error joining channel:", error);
        showPopup(`Failed to join channel: ${error.message}`);
    }
}

// Leave channel
async function leaveChannel() {
    try {
        showPopup("Starting leave process...");
        
        // Disable beauty effect (if enabled) before closing the track.
        if (window.isBeautyEnabled && typeof window.toggleBeauty === 'function') {
            try {
                await window.toggleBeauty();
            } catch (e) {
                console.warn("Failed to disable beauty on leave:", e);
            }
        }

        if (window.isWatermarkEnabled && typeof window.disableWatermark === 'function') {
            try {
                await window.disableWatermark();
            } catch (e) {
                console.warn("Failed to disable watermark on leave:", e);
            }
        }

        // Remove processors before closing tracks
        if (localVideoTrack && isVirtualBackgroundEnabled) {
            showPopup("Removing virtual background processor...");
            try {
                // Reuse the toggle logic to ensure we disable + release the processor.
                await toggleVirtualBackground();
                showPopup("Virtual background processor removed");
            } catch (error) {
                console.error("Error removing virtual background processor:", error);
                showPopup("Error removing virtual background processor");
            }
        }
        if (localAudioTrack && ainsProcessor) {
            showPopup("Removing AINS processor...");
            try {
                await detachAinsProcessor();
                showPopup("AINS processor removed");
            } catch (error) {
                console.error("Error removing AINS processor:", error);
                showPopup("Error removing AINS processor");
            }
        }

        // Stop proxy server if enabled
        const proxyMode = parseInt(cloudProxySelect.value);
        if (proxyMode > 0) {
            showPopup("Stopping proxy server...");
            try {
                await client.stopProxyServer();
                await client2.stopProxyServer();
                showPopup("Proxy server stopped");
            } catch (error) {
                console.error("Error stopping proxy server:", error);
                showPopup("Error stopping proxy server");
            }
        }

        // Close tracks
        showPopup("Closing tracks...");
        if (localAudioTrack) {
            localAudioTrack.close();
            localAudioTrack = null;
            isLocalAudioPublished = false;
        }
        if (localVideoTrack) {
            localVideoTrack.close();
            localVideoTrack = null;
        }
        if (remoteAudioTrack) {
            remoteAudioTrack.close();
            remoteAudioTrack = null;
        }
        if (remoteVideoTrack) {
            remoteVideoTrack.close();
            remoteVideoTrack = null;
        }
        showPopup("All tracks closed");

        // Clear video containers before leaving
        if (localVideo) {
            localVideo.innerHTML = '<div class="no-video">🐱</div>';
        }
        if (remoteVideo) {
            remoteVideo.innerHTML = '<div class="no-video">🐱</div>';
        }

        // Reset stats
        showPopup("Resetting stats...");
        if (localStats) {
            localStats.innerHTML = '';
        }
        if (remoteStats) {
            remoteStats.innerHTML = '';
        }

        // Reset overall stats
        if (document.getElementById('overallStats')) {
            document.getElementById('overallStats').innerHTML = '';
        }
        if (document.getElementById('localVideoStats')) {
            document.getElementById('localVideoStats').innerHTML = '';
        }
        if (document.getElementById('remoteVideoStats')) {
            document.getElementById('remoteVideoStats').innerHTML = '';
        }

        // Reset states
        isVirtualBackgroundEnabled = false;
        window.isVirtualBackgroundEnabled = false;
        isDualStreamEnabled = false;
        isAinsEnabled = false;
        virtualBgBtn.textContent = "Enable Virtual Background";
        dualStreamBtn.textContent = "Enable Dual Stream";
        ainsBtn.textContent = "Enable AINS";
        updateAudioDumpControls();
        window.isBeautyEnabled = false;
        if (beautyBtn) beautyBtn.textContent = "Enable Beauty";
        const beautyControlsEl = document.getElementById('beautyControls');
        if (beautyControlsEl) beautyControlsEl.style.display = 'none';
        window.isWatermarkEnabled = false;
        if (watermarkBtn) watermarkBtn.textContent = "Enable Watermark";
        muteMicBtn.textContent = "Mute Mic";
        muteCameraBtn.textContent = "Mute Camera";
        switchStreamBtn.textContent = "Set to Low Quality";

        // Update UI
        joinBtn.disabled = false;
        joinBtn.style.opacity = '1';
        leaveBtn.disabled = true;
        leaveBtn.style.opacity = '0.5';

        // Disable control buttons
        [muteMicBtn, muteCameraBtn, dualStreamBtn, switchStreamBtn, virtualBgBtn, ainsBtn, beautyBtn].forEach(btn => {
            if (!btn) return;
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.background = '#fff3cd';
        });
        if (watermarkBtn) {
            watermarkBtn.disabled = true;
            watermarkBtn.style.opacity = '0.5';
            watermarkBtn.style.background = '#fff3cd';
        }

        // Leave channels
        showPopup("Leaving channels...");
        if (client) {
            await client.leave();
        }
        if (client2) {
            await client2.leave();
        }
        
        stopStatsMonitoring();

        showPopup("Successfully left channel!");

    } catch (error) {
        console.error("Error leaving channel:", error);
        showPopup("Failed to leave channel");
    }
}

// Toggle microphone
async function toggleMicrophone() {
    if (!localAudioTrack || audioDumpState.active || audioDumpState.finalizing) return;

    if (localAudioTrack.enabled) {
        if (isLocalAudioPublished) {
            await client.unpublish([localAudioTrack]);
            isLocalAudioPublished = false;
        }
        await localAudioTrack.setEnabled(false);
        muteMicBtn.textContent = "Unmute Mic";
    } else {
        await localAudioTrack.setEnabled(true);
        try {
            await client.publish([localAudioTrack]);
            isLocalAudioPublished = true;
            muteMicBtn.textContent = "Mute Mic";
        } catch (error) {
            await localAudioTrack.setEnabled(false);
            isLocalAudioPublished = false;
            throw error;
        }
    }
    updateAudioDumpControls();
}

// Toggle camera
async function toggleCamera() {
    if (localVideoTrack) {
        if (localVideoTrack.enabled) {
            await localVideoTrack.setEnabled(false);
            muteCameraBtn.textContent = "Unmute Camera";
            localVideo.innerHTML = '<div class="no-video"></div>';
        } else {
            await localVideoTrack.setEnabled(true);
            muteCameraBtn.textContent = "Mute Camera";
            localVideo.innerHTML = '';
            localVideoTrack.play("localVideo", window.LOCAL_VIDEO_PLAY_CONFIG);
        }
    }
}

// Switch the local camera device (preserves virtual background if enabled).
async function switchCamera() {
    // Only allow switching while in a call.
    if (!client || leaveBtn?.disabled) return;
    if (!cameraSelect?.value) return;
    if (!localVideoTrack) return;

    const oldVideoTrack = localVideoTrack;
    const shouldRestoreVirtualBackground = isVirtualBackgroundEnabled;

    try {
        showPopup("Switching camera...");

        // Prefer Agora's in-place device switching (keeps processors/pipeline intact).
        // This is the same pattern used in `broadcastaway`.
        if (typeof localVideoTrack.setDevice === 'function') {
            await localVideoTrack.setDevice(cameraSelect.value);

            // Ensure the local preview is displaying the (now) updated track.
            if (localVideoTrack.enabled) {
                localVideoTrack.play("localVideo", window.LOCAL_VIDEO_PLAY_CONFIG);
            }

            // If VB is enabled, re-apply options so the processor stays consistent.
            if (shouldRestoreVirtualBackground) {
                await updateVirtualBackground();
            }

            showPopup("Camera switched");
            return;
        }

        // Virtual background processors are tied to the track piping.
        // Disable first so we cleanly unpipe + release.
        if (shouldRestoreVirtualBackground) {
            await toggleVirtualBackground(); // disable
        }

        // Stop showing the old track immediately.
        if (localVideo) localVideo.innerHTML = '<div class="no-video"></div>';

        // Replace the published video track.
        // Guarded by the "only while in a call" check above, so failures here are edge cases.
        try {
            // Agora Web SDK expects an array of tracks to unpublish.
            await client.unpublish([oldVideoTrack]);
        } catch (e) {
            // If unpublish fails (edge cases), we still proceed with the replacement.
            console.warn("Failed to unpublish old video track:", e);
        }

        // Release the old camera track.
        try {
            oldVideoTrack.close();
        } catch (e) {
            // Ignore close errors; we are replacing the track anyway.
        }

        // Create a new camera track using the currently selected camera device.
        const newVideoTrack = await AgoraRTC.createCameraVideoTrack({
            deviceId: cameraSelect.value,
            encoderConfig: videoProfileSelect?.value,
            scalabiltyMode: isSVCEnabled ? "3SL3TL" : undefined
        });

        localVideoTrack = newVideoTrack;
        localVideoTrack.play("localVideo", window.LOCAL_VIDEO_PLAY_CONFIG);

        try {
            await client.publish([localVideoTrack]);
        } catch (e) {
            console.warn("Failed to publish new video track:", e);
            throw e;
        }

        // Re-enable virtual background on the new track (re-pipes processor).
        if (shouldRestoreVirtualBackground) {
            await toggleVirtualBackground(); // enable
        }

        showPopup("Camera switched");
    } catch (error) {
        console.error("Error switching camera:", error);
        showPopup("Failed to switch camera");

        // Best-effort recovery: restore the old track reference for further actions.
        if (!localVideoTrack) {
            localVideoTrack = oldVideoTrack;
        }
    }
}

// Toggle dual stream
async function toggleDualStream() {
    if (!client) return;

    // Prevent toggling if SVC is enabled
    if (isSVCEnabled) {
        showPopup("Cannot enable dual stream while SVC is enabled");
        return;
    }

    try {
        if (!isDualStreamEnabled) {
            await client.enableDualStream();
            isDualStreamEnabled = true;
            dualStreamBtn.textContent = "Disable Dual Stream";
        } else {
            await client.disableDualStream();
            isDualStreamEnabled = false;
            dualStreamBtn.textContent = "Enable Dual Stream";
        }
    } catch (error) {
        console.error("Error toggling dual stream:", error);
    }
}

// Switch stream quality
async function switchStream() {
    if (!client2 || !client2.remoteUsers.length) {
        showPopup("No remote user to switch stream");
        return;
    }

    const remoteUser = client2.remoteUsers.find(user => user.uid === client.uid);
    if (!remoteUser) {
        showPopup("Remote user not found");
        return;
    }

    try {
        // Get current stream type from button text
        const currentText = switchStreamBtn.textContent;
        let newStreamType;
        let newButtonText;

        if (currentText === "Set to High Quality") {
            newStreamType = 0; // High quality
            newButtonText = "Set to Low Quality";
        } else if (currentText === "Set to Low Quality") {
            newStreamType = 1; // Low quality
            newButtonText = "Set to High Quality";
        }
        
        // Set the stream type for the remote user
        await client2.setRemoteVideoStreamType(remoteUser.uid, newStreamType);
        
        switchStreamBtn.textContent = newButtonText;
        showPopup(`Switched to ${newStreamType === 0 ? "high" : "low"} quality stream`);
    } catch (error) {
        console.error("Error switching stream:", error);
        showPopup("Failed to switch stream quality");
    }
}

// Add popup function
function showPopup(message) {
    // Create container if it doesn't exist
    let container = document.querySelector('.popup-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'popup-container';
        document.body.appendChild(container);
    }

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.textContent = message;
    container.appendChild(popup);
    
    // Remove popup after delay
    setTimeout(() => {
        popup.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            popup.remove();
            // Remove container if empty
            if (container.children.length === 0) {
                container.remove();
            }
        }, 300);
    }, 5000); // Increased from 3000 to 5000ms
}

window.showPopup = showPopup;

// Helper function to load media with CORS handling
async function loadMediaWithCORS(url, type) {
    try {
        if (type === 'img') {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
            return img;
        } else if (type === 'video') {
            const video = document.createElement('video');
            video.crossOrigin = "anonymous";
            video.src = url;
            video.loop = true;
            video.muted = true;
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = reject;
            });
            return video;
        }
    } catch (error) {
        console.error(`Error loading ${type}:`, error);
        throw new Error(`Failed to load ${type}. Make sure the URL is CORS-enabled.`);
    }
}

// Add new function to update virtual background
async function updateVirtualBackground() {
    if (!localVideoTrack || !isVirtualBackgroundEnabled) return;

    try {
        // Get the current processor
        // When Beauty + Virtual Background are both used, the VB processor may not be
        // the one referenced by `localVideoTrack.processor`, so prefer our shared reference.
        const processor = window.virtualBackgroundProcessor || localVideoTrack.processor;
        if (!processor) return;

        // Set options based on selected type
        const options = {
            type: virtualBgTypeSelect.value,
            fit: 'cover'
        };

        switch (virtualBgTypeSelect.value) {
            case 'color':
                options.color = virtualBgColorInput.value;
                break;
            case 'img':
                try {
                    options.source = await loadMediaWithCORS(virtualBgImgUrlInput.value, 'img');
                } catch (error) {
                    showPopup(error.message);
                    return;
                }
                break;
            case 'video':
                try {
                    options.source = await loadMediaWithCORS(virtualBgVideoUrlInput.value, 'video');
                } catch (error) {
                    showPopup(error.message);
                    return;
                }
                break;
            case 'blur':
                options.blurDegree = parseInt(virtualBgBlurSelect.value);
                break;
            case 'none':
                // No additional options needed
                break;
        }

        // Update the processor options
        processor.setOptions(options);
        showPopup("Virtual background updated");
    } catch (error) {
        console.error("Error updating virtual background:", error);
        showPopup("Failed to update virtual background");
    }
}

// Toggle virtual background
async function toggleVirtualBackground() {
    if (!localVideoTrack) {
        console.log("No local video track available");
        showPopup("No video track available");
        return;
    }

    try {
        if (!isVirtualBackgroundEnabled) {
            console.log("Enabling virtual background...");
            showPopup("Enabling virtual background...");
            
            // Create and register virtual background extension
            const vb = new VirtualBackgroundExtension();
            AgoraRTC.registerExtensions([vb]);
            
            // Create processor
            const processor = await vb.createProcessor();
            
            // Set up event handlers
            processor.eventBus.on("PERFORMANCE_WARNING", () => {
                console.warn("Performance warning!");
                showPopup("VirtualBackground performance warning!");
            });
            processor.eventBus.on("cost", (cost) => {
                console.warn(`cost of vb is ${cost}`);
                lastVirtualBgCost = cost;
            });
            processor.onoverload = async () => {
                console.log("overload!");
                showPopup("VirtualBackground overload!");
            };

            // Initialize processor
            try {
                await processor.init("not_needed");
            } catch (error) {
                console.error(error);
                showPopup("Failed to initialize virtual background");
                return;
            }

            // Set options based on selected type
            const options = {
                type: virtualBgTypeSelect.value,
                fit: 'cover'
            };

            switch (virtualBgTypeSelect.value) {
                case 'color':
                    options.color = virtualBgColorInput.value;
                    break;
                case 'img':
                    try {
                        options.source = await loadMediaWithCORS(virtualBgImgUrlInput.value, 'img');
                    } catch (error) {
                        showPopup(error.message);
                        return;
                    }
                    break;
                case 'video':
                    try {
                        options.source = await loadMediaWithCORS(virtualBgVideoUrlInput.value, 'video');
                    } catch (error) {
                        showPopup(error.message);
                        return;
                    }
                    break;
                case 'blur':
                    options.blurDegree = parseInt(virtualBgBlurSelect.value);
                    break;
                case 'none':
                    // No additional options needed
                    break;
            }

            processor.setOptions(options);
            // Enable once inside rebuildVideoPipeline (avoids double-enable flicker)

            // Store for the shared effect pipeline (beauty.js).
            window.virtualBackgroundProcessor = processor;

            isVirtualBackgroundEnabled = true;
            window.isVirtualBackgroundEnabled = true;
            virtualBgBtn.textContent = "Disable Virtual Background";

            // Let the pipeline helper wire processors (supports Beauty + VB together).
            if (window.rebuildVideoPipeline) {
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                await window.rebuildVideoPipeline();
            }

            showPopup("Virtual background enabled");
        } else {
            console.log("Disabling virtual background...");
            showPopup("Disabling virtual background...");

            // Prefer our shared reference (used by beauty.js pipeline).
            const processor = window.virtualBackgroundProcessor || localVideoTrack.processor;

            // Update state/UI before rebuilding pipeline.
            isVirtualBackgroundEnabled = false;
            window.isVirtualBackgroundEnabled = false;

            // VB cost events may stop arriving; force the chart to fall back to 0.
            lastVirtualBgCost = 0;
            virtualBgBtn.textContent = "Enable Virtual Background";

            // Clean up processors first to ensure a clean state.
            if (window.cleanupProcessors) {
                await window.cleanupProcessors();
            }

            // Disable + release the VB processor (cleanupProcessors disables/unpipes but doesn't release).
            if (processor) {
                await processor.disable();
                await processor.release();
                window.virtualBackgroundProcessor = null;
            }

            // Rebuild with remaining processors (e.g. Beauty-only chain).
            if (window.rebuildVideoPipeline) {
                await window.rebuildVideoPipeline();
            }

            showPopup("Virtual background disabled");
        }
    } catch (error) {
        console.error("Error toggling virtual background:", error);
        showPopup("Failed to toggle virtual background");
    }
}

function sanitizeDownloadName(name) {
    return String(name || 'audio_dump.pcm')
        .split(/[\\/]/)
        .pop()
        .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setAudioDumpStatus(state, label, message) {
    if (audioDumpStatus) {
        audioDumpStatus.dataset.state = state;
        audioDumpStatus.textContent = label;
    }
    if (audioDumpMessage) audioDumpMessage.textContent = message;
}

function updateAudioDumpProgress() {
    const fileCount = audioDumpState.files.length;
    const progress = Math.min(fileCount / AUDIO_DUMP_EXPECTED_FILES, 1) * 100;
    const totalSize = audioDumpState.files.reduce((sum, file) => sum + file.blob.size, 0);

    if (audioDumpProgress) audioDumpProgress.style.width = `${progress}%`;
    if (audioDumpProgressBar) audioDumpProgressBar.setAttribute('aria-valuenow', String(fileCount));
    if (audioDumpFileCount) {
        audioDumpFileCount.textContent = `${fileCount} of up to ${AUDIO_DUMP_EXPECTED_FILES} PCM files${totalSize ? `, ${formatBytes(totalSize)}` : ''}`;
    }
}

function updateAudioDumpControls() {
    if (!audioDumpBtn) return;

    audioDumpBtn.disabled = !isAinsEnabled
        || !localAudioTrack
        || audioDumpState.active
        || audioDumpState.finalizing;
    audioDumpBtn.textContent = audioDumpState.active
        ? `Collecting ${audioDumpState.files.length}/${AUDIO_DUMP_EXPECTED_FILES}`
        : audioDumpState.finalizing ? 'Creating ZIP...' : 'Dump Audio Data';

    if (
        !audioDumpState.active
        && !audioDumpState.finalizing
        && !audioDumpState.archiveBlob
        && audioDumpStatus?.dataset.state !== 'error'
    ) {
        setAudioDumpStatus(
            'idle',
            isAinsEnabled && localAudioTrack ? 'Ready' : 'Unavailable',
            !isAinsEnabled
                ? 'Enable AINS to collect diagnostic audio.'
                : !localAudioTrack
                    ? 'Join a channel to make a microphone available.'
                    : localAudioTrack.enabled
                        ? 'Captures the previous 30 seconds and the next 60 seconds.'
                        : 'Microphone capture starts locally without publishing to the channel.'
        );
    }

    const dumpLocksAudioState = audioDumpState.active || audioDumpState.finalizing;
    if (muteMicBtn) muteMicBtn.disabled = !localAudioTrack || dumpLocksAudioState;
    if (ainsBtn) ainsBtn.disabled = !localAudioTrack || dumpLocksAudioState;
}

async function restoreAudioDumpCapture() {
    const captureTrack = audioDumpState.captureTrack;
    audioDumpState.captureTrack = null;
    if (!captureTrack || captureTrack !== localAudioTrack) return;
    if (captureTrack.enabled && !isLocalAudioPublished) {
        await captureTrack.setEnabled(false);
    }
}

async function detachAinsProcessor() {
    const processor = ainsProcessor;
    if (!processor) return;

    let cleanupError;
    try {
        if (processor.enabled) await processor.disable();
    } catch (error) {
        cleanupError = error;
    }
    try {
        if (localAudioTrack) await localAudioTrack.unpipe();
    } catch (error) {
        cleanupError ||= error;
    }
    try {
        if (typeof processor.destroy === 'function') {
            await processor.destroy();
        } else if (typeof processor.release === 'function') {
            await processor.release();
        }
    } catch (error) {
        cleanupError ||= error;
    }

    if (ainsProcessor === processor) ainsProcessor = null;
    if (audioDumpState.active) await finalizeAudioDump();
    if (cleanupError) throw cleanupError;
}

function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function handleAudioDumpFile(blob, name) {
    if (!audioDumpState.active || !(blob instanceof Blob)) return;

    audioDumpState.files.push({
        blob,
        name: sanitizeDownloadName(name)
    });
    updateAudioDumpProgress();
    updateAudioDumpControls();
}

function buildAudioDumpManifest() {
    return {
        createdAt: new Date().toISOString(),
        dumpStartedAt: audioDumpState.startedAt?.toISOString(),
        channel: channelNameInput.value,
        uid: client?.uid ?? null,
        audioProfile: audioProfileSelect.value,
        microphone: micSelect.options[micSelect.selectedIndex]?.text || null,
        microphoneEnabled: Boolean(localAudioTrack?.enabled),
        microphoneMuted: localAudioTrack?.muted ?? null,
        microphoneEnabledAtDumpStart: audioDumpState.microphoneEnabledAtStart,
        microphonePublishedAtDumpStart: audioDumpState.microphonePublishedAtStart,
        microphoneCaptureStartedForDump: audioDumpState.captureStartedForDump,
        agoraRtcSdkVersion: AgoraRTC.VERSION || null,
        aiDenoiserVersion: AI_DENOISER_VERSION,
        aiDenoiserMode: ainsMode,
        page: `${window.location.origin}${window.location.pathname}`,
        userAgent: navigator.userAgent,
        crossOriginIsolated: window.crossOriginIsolated,
        files: audioDumpState.files.map(file => ({
            name: file.name,
            size: file.blob.size,
            type: file.blob.type || 'application/octet-stream'
        }))
    };
}

async function finalizeAudioDump() {
    if (!audioDumpState.active || audioDumpState.finalizing) return;

    audioDumpState.active = false;
    audioDumpState.finalizing = true;
    clearInterval(audioDumpState.statusTimer);
    audioDumpState.statusTimer = null;
    updateAudioDumpControls();

    try {
        await restoreAudioDumpCapture();
    } catch (error) {
        console.warn('Failed to restore microphone capture after AINS dump:', error);
    }

    if (!audioDumpState.files.length) {
        audioDumpState.finalizing = false;
        setAudioDumpStatus('error', 'No data', 'AINS returned no audio files. Keep the call running and try again.');
        updateAudioDumpControls();
        return;
    }

    if (typeof JSZip === 'undefined') {
        audioDumpState.finalizing = false;
        setAudioDumpStatus('error', 'ZIP unavailable', 'Could not load the ZIP library. Refresh the page and try again.');
        updateAudioDumpControls();
        return;
    }

    try {
        const zip = new JSZip();
        audioDumpState.files.forEach(file => zip.file(file.name, file.blob));
        zip.file('manifest.json', JSON.stringify(buildAudioDumpManifest(), null, 2));

        audioDumpState.archiveBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        const timestamp = audioDumpState.startedAt.toISOString().replace(/[:.]/g, '-');
        audioDumpState.archiveName = `ains-audio-dump-${timestamp}.zip`;
        audioDumpState.finalizing = false;

        downloadBlob(audioDumpState.archiveBlob, audioDumpState.archiveName);
        setAudioDumpStatus('ready', 'Downloaded', `${audioDumpState.files.length} PCM files packaged with diagnostic metadata.`);
        if (downloadAudioDumpBtn) downloadAudioDumpBtn.hidden = false;
        showPopup(`AINS audio dump ready: ${audioDumpState.archiveName}`);
    } catch (error) {
        console.error('Failed to create AINS audio dump ZIP:', error);
        audioDumpState.finalizing = false;
        setAudioDumpStatus('error', 'ZIP failed', `Could not create the archive: ${error.message}`);
    }

    updateAudioDumpControls();
}

async function startAudioDump() {
    if (!isAinsEnabled || !ainsProcessor || typeof ainsProcessor.dump !== 'function') {
        showPopup('Enable AINS before starting an audio dump');
        return;
    }
    if (!localAudioTrack) {
        showPopup('Join a channel before starting an audio dump');
        updateAudioDumpControls();
        return;
    }
    if (audioDumpState.active || audioDumpState.finalizing) return;

    audioDumpState.active = true;
    audioDumpState.files = [];
    audioDumpState.startedAt = new Date();
    audioDumpState.archiveBlob = null;
    audioDumpState.archiveName = null;
    audioDumpState.captureTrack = null;
    audioDumpState.captureStartedForDump = false;
    audioDumpState.microphoneEnabledAtStart = Boolean(localAudioTrack.enabled);
    audioDumpState.microphonePublishedAtStart = isLocalAudioPublished;
    if (downloadAudioDumpBtn) downloadAudioDumpBtn.hidden = true;
    updateAudioDumpProgress();
    setAudioDumpStatus('collecting', 'Collecting', 'Keep the call running for about 60 seconds.');
    updateAudioDumpControls();

    audioDumpState.statusTimer = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - audioDumpState.startedAt.getTime()) / 1000);
        if (audioDumpMessage) {
            audioDumpMessage.textContent = elapsedSeconds < 60
                ? `Collecting post-trigger audio: ${elapsedSeconds}s of about 60s.`
                : 'Finalizing the audio files...';
        }
    }, 1000);

    try {
        const processor = ainsProcessor;
        if (!localAudioTrack.enabled) {
            audioDumpState.captureTrack = localAudioTrack;
            audioDumpState.captureStartedForDump = true;
            await localAudioTrack.setEnabled(true);
            await new Promise(resolve => setTimeout(resolve, AUDIO_DUMP_CAPTURE_WARMUP_MS));
        }
        if (!isAinsEnabled || ainsProcessor !== processor) {
            throw new Error('AINS was disabled before audio collection started');
        }
        await processor.dump();
        showPopup('AINS audio dump started');
    } catch (error) {
        console.error('Failed to start AINS audio dump:', error);
        audioDumpState.active = false;
        clearInterval(audioDumpState.statusTimer);
        audioDumpState.statusTimer = null;
        try {
            await restoreAudioDumpCapture();
        } catch (restoreError) {
            console.warn('Failed to restore microphone capture after dump failure:', restoreError);
        }
        setAudioDumpStatus('error', 'Failed', error.message || 'Could not start the audio dump.');
        updateAudioDumpControls();
    }
}

function getAinsExtension() {
    if (ainsExtension) return ainsExtension;
    if (!window.AIDenoiser?.AIDenoiserExtension) {
        throw new Error('agora-extension-ai-denoiser failed to load');
    }

    const extension = new AIDenoiser.AIDenoiserExtension({
        assetsPath: AI_DENOISER_ASSETS_PATH
    });
    if (!extension.checkCompatibility()) {
        throw new Error('This browser does not support Agora AI Denoiser');
    }

    AgoraRTC.registerExtensions([extension]);
    ainsExtension = extension;
    console.info('[AINS] plugin registered', {
        version: AI_DENOISER_VERSION,
        assetsPath: AI_DENOISER_ASSETS_PATH,
        agoraRtcSdkVersion: AgoraRTC.VERSION || 'unknown'
    });
    return ainsExtension;
}

// Toggle AINS
async function toggleAins() {
    if (!localAudioTrack) {
        console.log("No local audio track available");
        showPopup("No audio track available");
        return;
    }

    try {
        if (!isAinsEnabled) {
            console.log("Enabling AINS...");
            showPopup("Enabling AINS...");
            
            // The extension is registered once and reused to create processors.
            const denoiser = getAinsExtension();

            // Create processor
            const processor = denoiser.createProcessor();
            ainsProcessor = processor;
            
            // Set up event handlers
            processor.on('dump', handleAudioDumpFile);
            processor.on('dumpend', () => {
                finalizeAudioDump();
            });
            processor.on('pipeerror', (error) => {
                console.error('AINS pipe error:', error);
                showPopup('AINS processor failed to load');
            });
            processor.on('overload', async (elapsedTimeInMs) => {
                const elapsedDetail = Number.isFinite(elapsedTimeInMs) ? ` after ${elapsedTimeInMs}ms` : '';
                console.warn(`[AINS] processor overload${elapsedDetail}`);
                try {
                    await processor.setMode('STATIONARY_NS');
                    ainsMode = 'STATIONARY_NS';
                    showPopup(`AINS overload${elapsedDetail}; switched to stationary noise suppression`);
                } catch (error) {
                    console.error('Failed to switch AINS mode after overload:', error);
                    showPopup('AINS overload; failed to switch noise suppression mode');
                }
            });

            // Pipe the processor
            await localAudioTrack.pipe(processor).pipe(localAudioTrack.processorDestination);
            
            // Enable and configure
            try {
                await processor.enable();
                await processor.setLevel("AGGRESSIVE");
                ainsMode = 'NSNG';
                isAinsEnabled = true;
                ainsBtn.textContent = "Disable AINS";
                updateAudioDumpControls();
                showPopup("AINS enabled successfully");
            } catch (error) {
                console.error("enable AIDenoiser failure");
                showPopup("Failed to enable AINS");
                try {
                    await detachAinsProcessor();
                } catch (cleanupError) {
                    console.error('Failed to clean up AINS processor:', cleanupError);
                }
            }
        } else {
            console.log("Disabling AINS...");
            showPopup("Disabling AINS...");
            await detachAinsProcessor();
            isAinsEnabled = false;
            ainsBtn.textContent = "Enable AINS";
            updateAudioDumpControls();
            showPopup("AINS disabled successfully");
        }
    } catch (error) {
        console.error("Error toggling AINS:", error);
        showPopup("Error toggling AINS");
    }
}

/* Update invite link
function updateInviteLink() {
    const channelName = channelNameInput.value;
    const inviteLink = `${window.location.origin}?channel=${channelName}`;
    document.getElementById('inviteLink').value = inviteLink;
}*/

// Copy invite link
function copyInviteLink() {
    const inviteLink = document.getElementById('inviteLink');
    inviteLink.select();
    document.execCommand('copy');
    alert('Invite link copied to clipboard!');
}

// Start stats monitoring
function startStatsMonitoring() {
    statsInterval = setInterval(async () => {
        try {
            const clientStats = await client.getRTCStats();
            const clientStats2 = await client2.getRTCStats();
            const localVideoStats = await client.getLocalVideoStats();
            
            // Get remote stats for the specific user
            let remoteVideoStats = {};
            const remoteUser = client2.remoteUsers.find(user => user.uid === client.uid);
            if (remoteUser) {
                remoteVideoStats = await client2.getRemoteVideoStats()[remoteUser.uid];
            }
            
            updateStats(clientStats, clientStats2, localVideoStats, remoteVideoStats);
        } catch (error) {
            console.error("Error getting stats:", error);
        }
    }, 1000);
}

// Stop stats monitoring
function stopStatsMonitoring() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
}

// Update stats display
function updateStats(clientStats, clientStats2, localVideoStats, remoteVideoStats) {
    const duration = Math.floor((Date.now() - startTime) / 1000);

    // Expose current outgoing send resolution so watermark auto-corners can follow profile changes.
    window.currentSendResolutionWidth = Number(localVideoStats?.sendResolutionWidth) || 0;
    window.currentSendResolutionHeight = Number(localVideoStats?.sendResolutionHeight) || 0;
    if (window.maybeRefreshWatermarkLayoutForResolutionChange) {
        Promise.resolve(window.maybeRefreshWatermarkLayoutForResolutionChange()).catch(() => {});
    }
    
    // Update overall stats
    document.getElementById('overallStats').innerHTML = [
        `Local UID: ${client.uid}`,
        `Host Count: ${clientStats.UserCount}`,
        `Duration: ${duration}s`,
        `RTT: ${clientStats.RTT}ms`,
        `Outgoing B/W: ${(Number(clientStats.OutgoingAvailableBandwidth) * 0.001).toFixed(4)} Mbps`,
        `Link Status: ${navigator.onLine ? "Online" : "Offline"}`
    ].map(stat => `<div class="stat-item">${stat}</div>`).join('');

    // Update local video stats
    document.getElementById('localVideoStats').innerHTML = [
        `Capture FPS: ${localVideoStats.captureFrameRate}`,
        `Send FPS: ${localVideoStats.sendFrameRate}`,
        `Video encode delay: ${Number(localVideoStats.encodeDelay).toFixed(2)}ms`,
        `Resolution: ${localVideoStats.sendResolutionWidth}x${localVideoStats.sendResolutionHeight}`,
        `Send bitrate: ${(Number(localVideoStats.sendBitrate) * 0.000001).toFixed(4)} Mbps`,
        `Send Jitter: ${Number(localVideoStats.sendJitterMs).toFixed(2)}ms`,
        `Send RTT: ${Number(localVideoStats.sendRttMs).toFixed(2)}ms`,
        `Packet Loss: ${Number(localVideoStats.currentPacketLossRate).toFixed(3)}%`,
        `Network Quality: ${clientNetQuality.uplink}`
    ].join('<br>');

    if (remoteVideoStats) {
        document.getElementById('remoteVideoStats').innerHTML = [
            `Receive FPS: ${remoteVideoStats.receiveFrameRate}`,
            `Decode FPS: ${remoteVideoStats.decodeFrameRate}`,
            `Render FPS: ${remoteVideoStats.renderFrameRate}`,
            `Resolution: ${remoteVideoStats.receiveResolutionWidth}x${remoteVideoStats.receiveResolutionHeight}`,
            `Receive bitrate: ${(Number(remoteVideoStats.receiveBitrate) * 0.000001).toFixed(4)} Mbps`,
            `Video receive delay: ${Number(remoteVideoStats.receiveDelay).toFixed(0)}ms`,
            `Packets lost: ${remoteVideoStats.receivePacketsLost}`,
            `E2E Delay: ${remoteVideoStats.end2EndDelay}ms`,
            `Transport Delay: ${remoteVideoStats.transportDelay}ms`,
            `Freeze Rate: ${Number(remoteVideoStats.freezeRate).toFixed(3)}%`,
            `Total freeze time: ${remoteVideoStats.totalFreezeTime}s`,
            `Network Quality: ${clientNetQuality2.downlink}`
        ].join('<br>');
    }

    // Update charts
    const time = (Date.now() - startTime) / 1000;
    
    // Cap FPS values at 60
    const localFPS = Math.min(localVideoStats.sendFrameRate, 60);
    const remoteFPS = remoteVideoStats ? Math.min(remoteVideoStats.receiveFrameRate, 60) : 0;
    
    networkData.addRow([
        time,
        Number(clientStats.SendBitrate) * 0.000001,
        Number(clientStats2.RecvBitrate) * 0.000001
    ]);

    fpsData.addRow([
        time,
        localFPS,
        remoteFPS
    ]);

    if (networkData.getNumberOfRows() > 60) {
        networkData.removeRow(0);
    }

    if (fpsData.getNumberOfRows() > 60) {
        fpsData.removeRow(0);
    }

    try {
        networkChart.draw(networkData, {
            ...chartOptions,
            title: 'Network Quality',
            vAxis: { title: 'Bitrate (Mbps)', minValue: 0, maxValue: 10 }
        });

        fpsChart.draw(fpsData, {
            ...chartOptions,
            title: 'Frame Rate',
            vAxis: { title: 'FPS', minValue: 0, maxValue: 60 }
        });
    } catch (error) {
        console.error("Error updating charts:", error);
    }

    // Update resolution chart with capped values
    resolutionData.addRow([
        time,
        Math.min(localVideoStats.sendResolutionWidth, 1920),
        Math.min(localVideoStats.sendResolutionHeight, 1080),
        remoteVideoStats ? Math.min(remoteVideoStats.receiveResolutionWidth, 1920) : 0,
        remoteVideoStats ? Math.min(remoteVideoStats.receiveResolutionHeight, 1080) : 0
    ]);

    if (resolutionData.getNumberOfRows() > 60) {
        resolutionData.removeRow(0);
    }

    try {
        resolutionChart.draw(resolutionData, {
            ...chartOptions,
            title: 'Resolution',
            vAxis: { title: 'Pixels', minValue: 0, maxValue: 1920 }
        });
    } catch (error) {
        console.error("Error updating resolution chart:", error);
    }

    // Update virtual background cost chart
    virtualBgCostData.addRow([time, isVirtualBackgroundEnabled ? lastVirtualBgCost : 0]);
    if (virtualBgCostData.getNumberOfRows() > 60) {
        virtualBgCostData.removeRow(0);
    }

    try {
        virtualBgCostChart.draw(virtualBgCostData, {
            ...chartOptions,
            title: 'Virtual Background Cost',
            vAxis: { title: 'Cost', minValue: 0 }
        });
    } catch (error) {
        console.error("Error updating virtual background cost chart:", error);
    }
}

// Add settings toggle functionality
function toggleSettings() {
    const controls = document.querySelector('.controls');
    controls.classList.toggle('hidden');
    settingsToggleBtn.textContent = controls.classList.contains('hidden') ? 'Show Settings' : 'Hide Settings';
}

// Initialize everything after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
        // Add GitHub link
        const githubLink = document.createElement('a');
        githubLink.href = 'https://github.com/frank005/catProxy';
        githubLink.className = 'github-link';
        githubLink.target = '_blank';
        githubLink.rel = 'noopener noreferrer';
        githubLink.innerHTML = `<svg viewBox="0 0 16 16" version="1.1" aria-hidden="true">
            <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
        </svg>`;
        document.body.appendChild(githubLink);
    
    // Set default cat background for video containers
    if (localVideo) localVideo.innerHTML = '<div class="no-video"></div>';
    if (remoteVideo) remoteVideo.innerHTML = '<div class="no-video"></div>';

    // Initialize Google Charts
    google.charts.load('current', {'packages':['corechart']});
    google.charts.setOnLoadCallback(initializeCharts);

    // Populate video profiles
    if (videoProfileSelect) {
        videoProfileSelect.innerHTML = videoProfiles.map(profile => 
            `<option value="${profile.value}" title="${profile.detail}" ${profile.value === "720p_3" ? "selected" : ""}>${profile.label}</option>`
        ).join('');
    }

    // Populate regions
    if (geoFenceSelect) {
        geoFenceSelect.innerHTML = regions.map(region => 
            `<option value="${region.value}">${region.label}</option>`
        ).join('');
    }

    // Populate proxy modes
    if (cloudProxySelect) {
        cloudProxySelect.innerHTML = proxyModes.map(mode => 
            `<option value="${mode.value}" title="${mode.detail}">${mode.label}</option>`
        ).join('');
    }

    // Populate audio profiles
    if (audioProfileSelect) {
        audioProfileSelect.innerHTML = audioProfiles.map(profile => 
            `<option value='${typeof profile.value === 'string' ? profile.value : JSON.stringify(profile.value)}' title="${profile.detail}" ${profile.value === "speech_standard" ? "selected" : ""}>${profile.label}</option>`
        ).join('');
    }

    // Get devices
    getDevices();

    // Add event listeners
    if (joinBtn) joinBtn.addEventListener('click', joinChannel);
    if (leaveBtn) leaveBtn.addEventListener('click', leaveChannel);
    if (muteMicBtn) muteMicBtn.addEventListener('click', toggleMicrophone);
    if (muteCameraBtn) muteCameraBtn.addEventListener('click', toggleCamera);
    if (dualStreamBtn) dualStreamBtn.addEventListener('click', toggleDualStream);
    if (switchStreamBtn) switchStreamBtn.addEventListener('click', switchStream);
    if (virtualBgBtn) virtualBgBtn.addEventListener('click', toggleVirtualBackground);
    if (ainsBtn) ainsBtn.addEventListener('click', toggleAins);
    if (audioDumpBtn) audioDumpBtn.addEventListener('click', startAudioDump);
    if (downloadAudioDumpBtn) {
        downloadAudioDumpBtn.addEventListener('click', () => {
            if (audioDumpState.archiveBlob && audioDumpState.archiveName) {
                downloadBlob(audioDumpState.archiveBlob, audioDumpState.archiveName);
            }
        });
    }
    if (watermarkBtn) {
        watermarkBtn.addEventListener('click', async () => {
            if (window.toggleWatermark) {
                await window.toggleWatermark();
            } else {
                showPopup('Watermark module not loaded');
            }
        });
    }
    if (cameraSelect) cameraSelect.addEventListener('change', switchCamera);

    // Set initial button states
    if (leaveBtn) {
        leaveBtn.disabled = true;
        leaveBtn.style.opacity = '0.5';
    }
    
    [muteMicBtn, muteCameraBtn, dualStreamBtn, switchStreamBtn, virtualBgBtn, ainsBtn, beautyBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = true;
        btn.style.opacity = '0.5';
    });
    updateAudioDumpControls();
    if (watermarkBtn) {
        watermarkBtn.disabled = false;
        watermarkBtn.style.opacity = '1';
    }

    // Handle window resize for charts
    window.addEventListener('resize', () => {
        if (networkChart && fpsChart) {
            networkChart.draw(networkData, {
                title: 'Network Quality',
                vAxis: { title: 'Bitrate (Mbps)' }
            });
            fpsChart.draw(fpsData, {
                title: 'Frame Rate',
                vAxis: { title: 'FPS' }
            });
        }
    });

    // Add settings toggle button
    settingsToggleBtn = document.createElement('button');
    settingsToggleBtn.className = 'settings-toggle';
    settingsToggleBtn.textContent = 'Hide Settings';
    settingsToggleBtn.addEventListener('click', toggleSettings);
    document.body.appendChild(settingsToggleBtn);

    // Add video profile change handler
    videoProfileSelect.addEventListener('change', async () => {
        if (!localVideoTrack) {
            showPopup("No video track available");
            return;
        }

        try {
            const selectedProfile = videoProfileSelect.value;
            await localVideoTrack.setEncoderConfiguration(selectedProfile);
            showPopup(`Video profile updated to ${selectedProfile}`);
        } catch (error) {
            console.error("Error updating video profile:", error);
            showPopup("Failed to update video profile");
        }
    });

    // Add event listeners for virtual background controls
    virtualBgTypeSelect.addEventListener('change', async () => {
        // Hide all groups first
        virtualBgColorGroup.style.display = 'none';
        virtualBgImgGroup.style.display = 'none';
        virtualBgVideoGroup.style.display = 'none';
        virtualBgBlurGroup.style.display = 'none';

        // Show relevant group based on selection
        switch (virtualBgTypeSelect.value) {
            case 'color':
                virtualBgColorGroup.style.display = 'flex';
                break;
            case 'img':
                virtualBgImgGroup.style.display = 'flex';
                break;
            case 'video':
                virtualBgVideoGroup.style.display = 'flex';
                break;
            case 'blur':
                virtualBgBlurGroup.style.display = 'flex';
                break;
        }

        // If virtual background is enabled, update it with new type
        if (isVirtualBackgroundEnabled) {
            await updateVirtualBackground();
        }
    });

    // Add event listeners for virtual background controls
    virtualBgColorInput.addEventListener('input', async (e) => {
        colorValueDisplay.textContent = e.target.value;
        if (isVirtualBackgroundEnabled) {
            await updateVirtualBackground();
        }
    });

    virtualBgImgUrlInput.addEventListener('input', async () => {
        if (isVirtualBackgroundEnabled) {
            await updateVirtualBackground();
        }
    });

    virtualBgVideoUrlInput.addEventListener('input', async () => {
        if (isVirtualBackgroundEnabled) {
            await updateVirtualBackground();
        }
    });

    virtualBgBlurSelect.addEventListener('input', async (e) => {
        const value = parseInt(e.target.value);
        const blurValue = document.getElementById('blurValue');
        blurValue.textContent = value === 1 ? 'Low' : value === 2 ? 'Medium' : 'High';
        if (isVirtualBackgroundEnabled) {
            await updateVirtualBackground();
        }
    });

    // Update logo click handler
    const logo = document.querySelector('.logo');
    logo.style.cursor = 'pointer';
    
    logo.addEventListener('click', () => {
        // Increment click count
        logoClickCount++;
        
        // Clear existing timeout
        if (logoClickTimeout) {
            clearTimeout(logoClickTimeout);
        }
        
        // Set new timeout to reset counter
        logoClickTimeout = setTimeout(() => {
            logoClickCount = 0;
        }, 3000);
        
        // Check if we've reached 3 clicks
        if (logoClickCount === 3) {
            // Show SVC popup
            svcPopup.classList.add('show');
            svcOverlay.classList.add('show');
            showPopup("🎮 You found the secret SVC controls!");
        }
    });

    // Add SVC popup event listeners
    svcSaveBtn.addEventListener('click', () => {
        saveSVCSettings();
        closeSVCPopup();
    });

    svcCancelBtn.addEventListener('click', closeSVCPopup);
    svcOverlay.addEventListener('click', closeSVCPopup);

    // Add enable SVC checkbox handler
    enableSVCCheckbox.addEventListener('change', (e) => {
        const svcControls = document.getElementById('svcControls');
        svcControls.style.display = e.target.checked ? 'block' : 'none';
        isSVCEnabled = e.target.checked;
        
        if (e.target.checked) {
            showPopup("🎮 SVC enabled! Make sure to save before joining the call.");
        } else {
            showPopup("SVC disabled");
        }
    });

    // Add event listeners for SVC sliders
    document.getElementById('spatialLayer').addEventListener('input', (e) => {
        document.getElementById('spatialValue').textContent = e.target.value;
    });

    document.getElementById('temporalLayer').addEventListener('input', (e) => {
        document.getElementById('temporalValue').textContent = e.target.value;
    });

    // Add event listener for apply button
    document.getElementById('applySVCBtn').addEventListener('click', updateSVCLayers);
});

// Add function to close SVC popup
function closeSVCPopup() {
    svcPopup.classList.remove('show');
    svcOverlay.classList.remove('show');
}

// Add function to save SVC settings
function saveSVCSettings() {
    isSVCEnabled = enableSVCCheckbox.checked;
    if (isSVCEnabled) {
        currentSpatialLayer = parseInt(document.getElementById('spatialLayer').value);
        currentTemporalLayer = parseInt(document.getElementById('temporalLayer').value);
        
        // Set SVC parameters immediately
        AgoraRTC.setParameter("SVC",["vp9"]);
        AgoraRTC.setParameter("ENABLE_AUT_CC",true);
        
        // Store settings for the current user
        if (client && client.uid) {
            layers[client.uid] = {
                spatialLayer: currentSpatialLayer,
                temporalLayer: currentTemporalLayer
            };
        }
        
        showPopup(`SVC settings saved! Spatial: ${currentSpatialLayer}, Temporal: ${currentTemporalLayer}`);
    } else {
        showPopup("SVC disabled");
    }
}

// Add function to update SVC layers
async function updateSVCLayers() {
    if (!client2 || !client2.remoteUsers.length || !isSVCEnabled) {
        showPopup("Cannot update SVC layers - no remote user or SVC not enabled");
        return;
    }

    const remoteUser = client2.remoteUsers.find(user => user.uid === client.uid);
    if (!remoteUser) {
        showPopup("Remote user not found");
        return;
    }

    try {
        const spatialLayer = parseInt(document.getElementById('spatialLayer').value);
        const temporalLayer = parseInt(document.getElementById('temporalLayer').value);

        // Update layers object
        layers[remoteUser.uid] = {
            spatialLayer: spatialLayer,
            temporalLayer: temporalLayer
        };

        // Apply the new layers
        await client2.pickSVCLayer(remoteUser.uid, {
            spatialLayer: spatialLayer,
            temporalLayer: temporalLayer
        });

        currentSpatialLayer = spatialLayer;
        currentTemporalLayer = temporalLayer;
        showPopup(`Updated SVC layers - Spatial: ${spatialLayer}, Temporal: ${temporalLayer}`);
    } catch (error) {
        console.error("Error updating SVC layers:", error);
        showPopup("Failed to update SVC layers");
    }
}

// Add toggle for SVC controls
function toggleSVCControls() {
    svcControls.style.display = svcControls.style.display === 'none' ? 'block' : 'none';
}
