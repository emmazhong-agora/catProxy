# Cat Cloud Proxy

A modern web-based video conferencing application built with Agora RTC SDK, featuring cloud proxy capabilities, virtual backgrounds, and real-time performance monitoring.

## Features

- 🎥 High-quality video conferencing
- 🎤 Audio and video controls
- 🌐 Cloud proxy support (UDP/TCP)
- 🌍 Geo-fencing capabilities
- 🎨 Virtual background support
- 🎯 AI Noise Suppression (AINS)
- AINS audio dump collection for troubleshooting
- 📊 Real-time performance monitoring
- 📈 Network quality and FPS charts
- 🔄 Dual stream support
- 📱 Responsive design

## Prerequisites

- Modern web browser with WebRTC support
- Agora account and App ID
- Microphone and camera (optional)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/catProxy.git
cd catProxy
```

2. Open `index.html` in your web browser or serve it using a local web server.

## Configuration

1. Get your Agora App ID from the [Agora Console](https://console.agora.io/)
2. Enter your App ID in the application
3. (Optional) Enter a token if you have enabled token authentication
4. Enter a channel name to join
5. (Optional) Enter a user ID

## Usage

1. **Join a Channel**
   - Enter your App ID and channel name
   - Click "Join Channel"

2. **Device Selection**
   - Select your preferred microphone and camera
   - Choose video quality profile

3. **Cloud Proxy Settings**
   - Enable/disable cloud proxy
   - Select proxy mode (UDP/TCP)
   - Choose geo-fencing region

4. **Additional Features**
   - Toggle microphone/camera
   - Enable/disable virtual background
   - Toggle AI noise suppression
   - Collect an AINS audio dump
   - Enable/disable dual stream
   - Switch between streams

5. **Monitoring**
   - View real-time network quality
   - Monitor FPS and bitrate
   - Track connection statistics

## Collect an AINS audio dump

1. Join a channel and unmute the microphone.
2. Click **Enable AINS**.
3. Reproduce the audio problem. For the most useful dump, reproduce it before and after the next step.
4. Click **Dump Audio Data** and keep the call running for about 60 seconds.
5. The browser downloads one `ains-audio-dump-*.zip` archive when collection finishes.

The archive contains up to nine PCM files covering three AINS processing stages (`input`, `ns_out`, and `agc_out`) plus `manifest.json` with browser, SDK, channel, microphone, and audio-profile context. According to the [Agora AINS Web documentation](https://docs.agora.io/en/realtime-media/marketplace/build/add-audio-effects/ains/web#dump-audio-data), the dump includes up to 30 seconds before the button click and 60 seconds after it. Disabling AINS or leaving early ends the dump and can produce fewer files.

Share the complete ZIP when escalating an AINS issue. PCM files are raw audio and may contain customer conversations, so obtain consent and handle them as sensitive data.

## Deploy with GitHub Pages

This repository is a static site and does not require a build step. Its relative asset URLs also work when hosted below a repository path such as `/catProxy/`.

1. Push the files to the `main` branch of a GitHub repository.
2. Open **Settings > Pages** in that repository.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/(root)` folder, then save.
5. After GitHub finishes publishing, open `https://<username>.github.io/<repository>/`.

For this repository, pushing a new commit to `main` updates `https://frank005.github.io/catProxy/` because GitHub Pages is already enabled.

## Technical Details

### Video Profiles
- 360p (640x360)
- 480p (848x480)
- 720p (1280x720)
- 1080p (1920x1080)

### Supported Regions
- Global
- Africa
- Asia
- China
- Europe
- Hong Kong & Macau
- India
- Japan
- Korea
- North America
- Oceania
- South America
- United States

### Dependencies
- AgoraRTC SDK
- Google Charts
- Agora Virtual Background Extension
- Agora AI Denoiser Extension 2.0.2 (version-pinned CDN bundle and Wasm assets)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Agora.io](https://www.agora.io/) for providing the RTC SDK
- Google Charts for visualization capabilities 
