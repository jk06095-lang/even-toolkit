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
 *
 * AUDIO FLOW (hardware):
 *   1. waitForEvenAppBridge() — SDK-managed, returns when bridge is truly ready
 *   2. createStartUpPageContainer() — MUST succeed before audioControl
 *   3. onEvenHubEvent() — register audio listener BEFORE opening mic
 *   4. audioControl(true) — opens G2 glasses mic, PCM pushed via onEvenHubEvent
 */

import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  RebuildPageContainer,
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
  private _audioOpen = false;

  get ready(): boolean { return this._ready; }
  get mode(): HUDMode { return this._mode; }
  get connected(): boolean { return this._connected; }

  /**
   * Initialize the bridge connection to G2 glasses.
   * Steps:
   * 1. Wait for bridge ready using the SDK's waitForEvenAppBridge() (CRITICAL)
   * 2. Call createStartUpPageContainer (REQUIRED before any rebuild or audioControl)
   * 3. Register onEvenHubEvent listener for audio data
   * 4. Mark as ready
   */
  async init(): Promise<boolean> {
    try {
      console.log('[HUD] Waiting for EvenAppBridge via SDK waitForEvenAppBridge()...');

      // Use the SDK's official waitForEvenAppBridge() with a timeout wrapper.
      // The SDK handles ready-state internally; our manual polling was unreliable
      // on actual hardware where the Flutter host injects the bridge asynchronously.
      this.bridge = await Promise.race([
        waitForEvenAppBridge(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bridge connection timeout (25s)')), 25000)
        ),
      ]);

      if (!this.bridge) throw new Error('Bridge object is null after wait');
      console.log('[HUD] Bridge instance acquired via SDK, creating startup page...');

      // CRITICAL: Must call createStartUpPageContainer first!
      // audioControl() WILL FAIL if this hasn't been called.
      // For Edition 202601, we ensure at least one container is defined.
      const startupResult = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [
            new TextContainerProperty({
              containerID: 1,
              containerName: 'main',
              xPosition: 0,
              yPosition: 0,
              width: W,
              height: H,
              borderWidth: 0,
              borderColor: 0,
              paddingLength: 4,
              content: '  ★ PROJECT ECHO\n  Initializing...',
              isEventCapture: 1,
            }),
          ],
          imageObject: [],
        }),
      );

      console.log('[HUD] Startup page created, result:', startupResult);

      // Register the event listener for audio data BEFORE calling audioControl.
      // The SDK's onEvenHubEvent delivers parsed events including audioEvent.
      // audioPcm is normalized to Uint8Array by the SDK, but we add safety checks.
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event: any) => {
        // Handle audio events
        const audioEvt = event?.audioEvent;
        if (audioEvt) {
          let audioPcm = audioEvt.audioPcm;
          if (audioPcm && audioPcm.length > 0) {
            // Ensure we have a proper Uint8Array.
            // On real hardware the SDK may deliver number[] depending on
            // the host serialization format (JSON number array vs base64).
            if (!(audioPcm instanceof Uint8Array)) {
              if (Array.isArray(audioPcm)) {
                audioPcm = new Uint8Array(audioPcm);
              } else if (audioPcm instanceof ArrayBuffer) {
                audioPcm = new Uint8Array(audioPcm);
              } else if (typeof audioPcm === 'string') {
                // base64 string — decode to Uint8Array
                try {
                  const binaryStr = atob(audioPcm);
                  const len = binaryStr.length;
                  audioPcm = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    audioPcm[i] = binaryStr.charCodeAt(i);
                  }
                } catch (e) {
                  console.warn('[HUD] Failed to decode base64 audio data:', e);
                  return;
                }
              }
            }

            this.audioPacketCount++;
            // Debug logging for first 10 packets to diagnose hardware issues
            if (this.audioPacketCount <= 10) {
              console.log(
                `[HUD] Audio packet #${this.audioPacketCount}: ${audioPcm.length} bytes, ` +
                `type: ${audioPcm.constructor.name}, first4: [${Array.from(audioPcm.slice(0, 4))}]`
              );
            }
            // Periodic stats
            if (this.audioPacketCount % 200 === 0) {
              console.log(`[HUD] Audio stats: ${this.audioPacketCount} packets received`);
            }

            for (const cb of this.audioListeners) {
              try {
                cb(audioPcm);
              } catch (e) {
                console.warn('[HUD] Audio listener error:', e);
              }
            }
          }
        }

        // Log system events that might affect audio (e.g., foreground/background)
        if (event?.sysEvent) {
          const sys = event.sysEvent;
          if (sys.eventType !== undefined && sys.eventType !== 8) {
            // Not IMU — log it for debugging
            console.log('[HUD] System event:', sys.eventType, sys.eventSource);
          }
        }
      });

      this._startupDone = true;
      this._ready = true;
      this._connected = true;

      // Small delay to let the glasses fully process createStartUpPageContainer
      await this.sleep(300);

      console.log('[HUD] ✓ Bridge fully initialized and ready for audio');
      return true;
    } catch (err) {
      console.warn('[HUD] Bridge initialization failed:', err);
      this._ready = false;
      this._connected = false;
      return false;
    }
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

  /**
   * Tell the glasses to start/stop sending microphone data.
   *
   * IMPORTANT on real hardware:
   * - createStartUpPageContainer MUST have been called first (the SDK docs state this)
   * - We retry up to 3 times with increasing delay if the first attempt fails
   * - A small delay after audioControl(true) is needed for the hardware to
   *   start streaming
   */
  async setAudioCapture(enabled: boolean): Promise<void> {
    if (!this.bridge || !this._ready || !this._startupDone) {
      console.warn(`[HUD] setAudioCapture(${enabled}) skipped — bridge not ready`);
      return;
    }

    console.log(`[HUD] Setting audio capture: ${enabled}`);

    if (enabled) {
      // Retry logic for opening mic — hardware may not be ready immediately
      const maxRetries = 3;
      let success = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await this.bridge.audioControl(true);
          console.log(`[HUD] audioControl(true) attempt ${attempt}/${maxRetries}, result:`, result);

          if (result) {
            success = true;
            this._audioOpen = true;
            this.audioPacketCount = 0;

            // Give hardware time to spin up the mic stream
            await this.sleep(500);
            console.log('[HUD] ✓ Mic opened — waiting for audio packets...');
            break;
          } else {
            console.warn(`[HUD] audioControl(true) returned falsy: ${result}, retrying...`);
          }
        } catch (err) {
          console.warn(`[HUD] audioControl(true) attempt ${attempt} error:`, err);
        }

        // Exponential backoff between retries
        if (attempt < maxRetries) {
          const delay = attempt * 1000;
          console.log(`[HUD] Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }

      if (!success) {
        console.error('[HUD] ✗ Failed to open mic after all retries');
      }
    } else {
      // Closing mic — single attempt is fine
      try {
        const result = await this.bridge.audioControl(false);
        console.log(`[HUD] audioControl(false) result:`, result);
        this._audioOpen = false;
      } catch (err) {
        console.warn('[HUD] audioControl(false) failed:', err);
      }
    }
  }

  /** Whether the G2 mic is currently open */
  get audioOpen(): boolean {
    return this._audioOpen;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  dispose(): void {
    // Close mic if open
    if (this._audioOpen && this.bridge) {
      this.bridge.audioControl(false).catch(() => {});
      this._audioOpen = false;
    }

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
