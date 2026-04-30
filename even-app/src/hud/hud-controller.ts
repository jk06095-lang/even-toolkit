/**
 * HUD Controller — manages G2 glasses display output.
 *
 * G2 Display rules (from Display & UI System docs):
 * - Canvas: 576 x 288 pixels per eye
 * - Colors: 4-bit greyscale (16 levels of green)
 * - Text: left-aligned, top-aligned, no font control
 * - Max 8 non-image containers, exactly 1 must have isEventCapture: 1
 * - \n for line breaks, ~400-500 chars fill full screen
 * - Use textContainerUpgrade for flicker-free updates
 * - Supported UI chars: ━ ─ █▇▆▅▄▃▂▁ ▲△▶▷▼▽◀◁ ●○ ■□ ★☆ ╭╮╯╰ │
 *
 * CRITICAL: createStartUpPageContainer MUST be called before any
 * rebuildPageContainer calls. This is the SDK requirement.
 */

import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  DeviceConnectType,
} from '@evenrealities/even_hub_sdk';

// G2 display constants
const W = 576;
const H = 288;

export type HUDMode = 'off' | 'calibration' | 'combat' | 'ambient' | 'debrief';

export class HUDController {
  private bridge: EvenAppBridge | null = null;
  private _ready = false;
  private _mode: HUDMode = 'off';
  private _connected = false;
  private _startupDone = false;
  private audioListeners: Array<(pcm: Uint8Array) => void> = [];
  private unsubscribeEvents?: () => void;
  private audioPacketCount = 0;
  private lastVolumeBars = '';
  private statusListeners: Array<(status: any) => void> = [];

  get ready(): boolean { return this._ready; }
  get mode(): HUDMode { return this._mode; }
  get connected(): boolean { return this._connected; }

  /**
   * Initialize the bridge connection to G2 glasses.
   * Steps:
   * 1. Wait for bridge ready (with timeout)
   * 2. Call createStartUpPageContainer (REQUIRED before any rebuild)
   * 3. Mark as ready
   */
  async init(): Promise<boolean> {
    try {
      console.log('[HUD] Waiting for EvenAppBridge (Enhanced)...');
      
      const findBridge = (): any => (window as any).EvenAppBridge;

      // 1. Try to get bridge with a combination of events and polling
      this.bridge = await new Promise((resolve, reject) => {
        // Immediate check
        const b = findBridge();
        if (b) return resolve(b);

        // Event listener
        const onReady = () => {
          console.log('[HUD] EvenAppBridgeReady event fired');
          resolve(findBridge());
        };
        window.addEventListener('EvenAppBridgeReady', onReady, { once: true });

        // Polling as a last resort
        const interval = setInterval(() => {
          const b = findBridge();
          if (b) {
            clearInterval(interval);
            window.removeEventListener('EvenAppBridgeReady', onReady);
            resolve(b);
          }
        }, 500);

        // Timeout
        setTimeout(() => {
          clearInterval(interval);
          window.removeEventListener('EvenAppBridgeReady', onReady);
          reject(new Error('Bridge connection timeout (20s)'));
        }, 20000);
      });

      if (!this.bridge) throw new Error('Bridge object is null after wait');
      console.log('[HUD] Bridge instance acquired, syncing hardware info...');

      // 1.5. Wake up the hardware connection
      try {
        const info = await this.bridge.getDeviceInfo();
        console.log('[HUD] Initial Device Info:', info);
        if (info?.status) {
          this.handleDeviceStatus(info.status);
        }
      } catch (e) {
        console.warn('[HUD] getDeviceInfo failed during init (expected if not paired):', e);
      }

      // 2. Setup Listeners BEFORE createStartUpPageContainer
      
      // Device Status listener
      this.bridge.onDeviceStatusChanged((status) => {
        console.log('[HUD] Device Status Changed:', status.connectType, 'Wearing:', status.isWearing);
        this.handleDeviceStatus(status);
      });

      // Audio & Event listener
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event: any) => {
        // RAW LOGGING for debugging connection issues
        if (this.audioPacketCount < 3 || !event?.audioEvent) {
          console.log('[HUD] Incoming EvenHubEvent:', JSON.stringify(event).slice(0, 200));
        }

        const audioPcm = event?.audioEvent?.audioPcm;
        if (audioPcm && (audioPcm.length > 0 || Array.isArray(audioPcm))) {
          this.audioPacketCount++;
          // Convert to Uint8Array if it arrived as a regular Array (JSON fallback)
          const pcmData = audioPcm instanceof Uint8Array ? audioPcm : new Uint8Array(audioPcm);
          
          if (this.audioPacketCount <= 5) {
            console.log(`[HUD] Audio packet #${this.audioPacketCount}: ${pcmData.length} bytes`);
          }
          for (const cb of this.audioListeners) {
            cb(pcmData);
          }
        }
      });

      // 3. Create startup page
      // CRITICAL: Must call createStartUpPageContainer first!
      // Layout optimization: 2 containers (ID 1: Overlay, ID 2: Content) is more robust.
      console.log('[HUD] Creating startup page containers...');
      const startupResult = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 2,
          textObject: [
            new TextContainerProperty({
              containerID: 1,
              containerName: 'evt',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: H,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 0,
              content: ' ',
              isEventCapture: 1,
            }),
            new TextContainerProperty({
              containerID: 2,
              containerName: 'main',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: H,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 4,
              content: '  ★ PROJECT ECHO\n  Initializing...',
              isEventCapture: 0,
            }),
          ],
          imageObject: [],
        }),
      );

      console.log('[HUD] createStartUpPageContainer result:', startupResult);

      this._startupDone = true;
      this._ready = true;
      // We don't force _connected = true here; we wait for handleDeviceStatus
      return true;
    } catch (err) {
      console.warn('[HUD] Bridge initialization failed:', err);
      this._ready = false;
      this._connected = false;
      return false;
    }
  }

  private handleDeviceStatus(status: any): void {
    // Log the entire status object for field-name debugging
    console.log('[HUD] Full Device Status Object:', JSON.stringify(status));
    
    const isConnected = status.connectType === DeviceConnectType.Connected;
    if (isConnected !== this._connected) {
      console.log(`[HUD] Hardware Connection State: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
    }
    this._connected = isConnected;
    
    // Notify app-level listeners (for main.ts UI)
    for (const cb of this.statusListeners) {
      cb(status);
    }
  }

  /** Register listener for real-time device status changes */
  onStatusChanged(cb: (status: any) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== cb);
    };
  }

  // ── Phase 1: Calibration ──

  async showCalibration(step: string, detail: string): Promise<void> {
    this._mode = 'calibration';
    const lines = [
      '  ★ PROJECT ECHO',
      '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `  ${step}`,
      '',
      `  ${detail}`,
    ];
    await this.showText(lines.join('\n'));
  }

  // ── Phase 2: Combat ──
  //
  // Glasses display layout:
  // ┌──────────────────────────────────┐
  // │  ████████████░░░░  3s remaining  │  ← Header: silence gauge OR hint
  // │──────────────────────────────────│
  // │  "I think the best place is..."  │  ← Body: live transcript
  // └──────────────────────────────────┘
  //
  private _lastTranscript = '';
  private _combatInitialized = false;

  /**
   * Initialize the two-zone combat layout on glasses.
   * Must be called once before using quickUpdate-based methods.
   */
  async initCombatDisplay(): Promise<void> {
    this._mode = 'combat';
    this._combatInitialized = false;
    this._lastTranscript = '';
    await this.showTwoZone(
      '████████████████ Ready',
      'Speak now...',
    );
    this._combatInitialized = true;
  }

  async showListening(): Promise<void> {
    this._mode = 'combat';
    if (!this._combatInitialized) {
      await this.initCombatDisplay();
      return;
    }
    // Update header: full gauge
    await this.quickUpdate(2, 'hdr', '  ████████████████ Ready');
  }

  /**
   * Update the live transcript on the bottom zone of glasses.
   * Called frequently — uses quickUpdate for flicker-free display.
   */
  async showLiveTranscript(text: string): Promise<void> {
    if (!this._combatInitialized) return;
    if (text === this._lastTranscript) return; // Skip duplicate updates
    this._lastTranscript = text;
    // Truncate for glasses display width
    const displayText = text.length > 40 ? '...' + text.slice(-37) : text;
    await this.quickUpdate(3, 'body', `\n  "${displayText}"`);
  }

  /**
   * Show real-time volume visualization on glasses while user speaks.
   * Uses textContainerUpgrade for flicker-free updates.
   */
  async showSpeechActive(volume: number = 0): Promise<void> {
    this._mode = 'combat';
    const bars = this.volumeToBars(volume);
    // Only update if bars changed to avoid flooding
    if (bars === this.lastVolumeBars) return;
    this.lastVolumeBars = bars;
    // Update header with volume bars + "Speaking"
    if (this._combatInitialized) {
      await this.quickUpdate(2, 'hdr', `  ${bars} Speaking...`);
    }
  }

  /**
   * Show silence countdown gauge on glasses header.
   * Bottom zone keeps showing the last recognized transcript.
   */
  async showSilenceCountdown(secondsLeft: number, thresholdSeconds: number): Promise<void> {
    this._mode = 'combat';
    if (!this._combatInitialized) return;
    const pct = Math.max(0, secondsLeft / thresholdSeconds);
    const totalBlocks = 16;
    const filled = Math.round(pct * totalBlocks);
    const bar = '█'.repeat(filled) + '░'.repeat(totalBlocks - filled);
    // Only update header — body keeps the transcript
    await this.quickUpdate(2, 'hdr', `  ${bar} ${secondsLeft}s`);
  }

  async showSilenceWarning(seconds: number): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      await this.quickUpdate(2, 'hdr', `  ░░░░░░░░░░░░░░░░ ${seconds}s`);
    } else {
      await this.showTwoZone(`○ SILENCE: ${seconds}s`, '');
    }
  }

  /**
   * Show hint in the header zone (replaces the gauge).
   * Bottom zone keeps the last transcript.
   */
  async flashChunk(chunk: string): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      // Replace gauge with hint in the header
      await this.quickUpdate(2, 'hdr', `  ▶ ${chunk}`);
    } else {
      await this.showTwoZone(
        `▶ ${chunk}`,
        this._lastTranscript ? `"${this._lastTranscript.slice(0, 35)}"` : '',
      );
    }
  }

  async showSpeedUp(chunk: string): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      await this.quickUpdate(2, 'hdr', `  ▲ ${chunk}`);
    } else {
      await this.showTwoZone('▲ SPEED UP!', chunk);
    }
  }

  async showBlackout(): Promise<void> {
    this._mode = 'combat';
    await this.showText('');
    this._combatInitialized = false;
  }

  async showGoodJob(): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      await this.quickUpdate(2, 'hdr', '  ★ KEEP GOING!');
    } else {
      await this.showTwoZone('★ KEEP GOING!', '');
    }
  }

  /**
   * Convert a 0.0–1.0 volume level to visual bars for the glasses display.
   */
  private volumeToBars(volume: number): string {
    const levels = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const numBars = 8;
    let bars = '';
    for (let i = 0; i < numBars; i++) {
      const threshold = (i + 1) / numBars;
      if (volume >= threshold) {
        bars += levels[Math.min(levels.length - 1, Math.floor(volume * (levels.length - 1)))];
      } else if (volume >= threshold - 0.15) {
        bars += levels[Math.max(0, Math.floor(volume * (levels.length - 1)) - 2)];
      } else {
        bars += '▁';
      }
    }
    return bars;
  }

  // ── Phase 3: Debrief ──

  async showDebrief(status: string): Promise<void> {
    this._mode = 'debrief';
    const lines = [
      '  ★ DEBRIEF',
      '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `  ${status}`,
    ];
    await this.showText(lines.join('\n'));
  }

  // ── Phase 4: Ambient ──

  async showAmbientEcho(chunk: string): Promise<void> {
    this._mode = 'ambient';
    // Center the chunk vertically (approx 10 lines visible)
    const lines = [
      '', '', '', '',
      `      ${chunk}`,
      '', '', '',
    ];
    await this.showText(lines.join('\n'));
  }

  // ── Common ──

  async clearDisplay(): Promise<void> {
    await this.showText(' ');
    this._mode = 'off';
  }

  async showStatus(text: string): Promise<void> {
    await this.showText(`\n\n      ${text}`);
  }

  // ── Internal: SDK Display Commands ──

  /**
   * Full-screen single text container.
   * One event-capture overlay + one content container.
   */
  private async showText(content: string): Promise<void> {
    if (!this.bridge || !this._ready || !this._startupDone) return;
    try {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [
            new TextContainerProperty({
              containerID: 1,
              containerName: 'evt',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: H,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 0,
              content: ' ',
              isEventCapture: 1,
            }),
            new TextContainerProperty({
              containerID: 2,
              containerName: 'main',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: H,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 4,
              content,
              isEventCapture: 0,
            }),
          ],
          imageObject: [],
        }),
      );
    } catch (err) {
      console.warn('[HUD] rebuildPageContainer failed:', err);
    }
  }

  /**
   * Two-zone layout: header strip (top 56px) + body (rest).
   * Uses 3 containers: event-capture overlay + header + body.
   */
  private async showTwoZone(header: string, body: string): Promise<void> {
    if (!this.bridge || !this._ready || !this._startupDone) return;
    const headerH = 56;
    try {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 3,
          textObject: [
            // Event capture overlay (invisible, receives inputs)
            new TextContainerProperty({
              containerID: 1,
              containerName: 'evt',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: H,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 0,
              content: ' ',
              isEventCapture: 1,
            }),
            // Header strip
            new TextContainerProperty({
              containerID: 2,
              containerName: 'hdr',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: headerH,
              borderWidth: 0,
              borderColor: 5,
              borderRadius: 0,
              paddingLength: 4,
              content: `  ${header}`,
              isEventCapture: 0,
            }),
            // Body
            new TextContainerProperty({
              containerID: 3,
              containerName: 'body',
              xPosition: 0,
              yPosition: headerH,
              width: W,
              height: H - headerH,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 4,
              content: body ? `\n  ${body}` : '',
              isEventCapture: 0,
            }),
          ],
          imageObject: [],
        }),
      );
    } catch (err) {
      console.warn('[HUD] showTwoZone failed:', err);
    }
  }

  /**
   * In-place text update (flicker-free on hardware).
   */
  async quickUpdate(containerId: number, containerName: string, content: string): Promise<void> {
    if (!this.bridge || !this._ready) return;
    try {
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: containerId,
          containerName: containerName,
          contentOffset: 0,
          contentLength: 2000,
          content,
        }),
      );
    } catch { /* ignore */ }
  }

  // ── Audio Capture ──

  /** Register listener for raw PCM data from glasses */
  onAudioData(cb: (pcm: Uint8Array) => void): () => void {
    this.audioListeners.push(cb);
    return () => {
      this.audioListeners = this.audioListeners.filter((l) => l !== cb);
    };
  }

  /** Tell the glasses to start/stop sending microphone data */
  async setAudioCapture(enabled: boolean): Promise<void> {
    if (!this.bridge || !this._ready) {
      console.warn(`[HUD] setAudioCapture(${enabled}) skipped — bridge not ready`);
      return;
    }
    console.log(`[HUD] Setting audio capture: ${enabled}`);
    try {
      // Use the official SDK API directly
      const result = await this.bridge.audioControl(enabled);
      console.log(`[HUD] audioControl(${enabled}) result:`, result);
      if (!result) {
        console.warn('[HUD] audioControl returned false — mic may not be available');
      }
      if (enabled) {
        this.audioPacketCount = 0; // Reset packet counter
      }
    } catch (err) {
      console.warn('[HUD] audioControl failed:', err);
    }
  }

  dispose(): void {
    // Unsubscribe from events
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    // Try to shut down the page container gracefully
    if (this.bridge && this._ready) {
      this.bridge.shutDownPageContainer(0).catch(() => {});
    }
    this.bridge = null;
    this._ready = false;
    this._connected = false;
    this._startupDone = false;
  }
}
