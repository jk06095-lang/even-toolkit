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

import { buildChatDisplay, type ChatLine } from '@toolkit/glasses/glass-chat-display';
import { renderTextPageLines } from '@toolkit/glasses/types';
import { renderTimerLines, renderTimerCompact } from '@toolkit/glasses/timer-display';

// G2 display constants
const W = 576;
const H = 288;

export type HUDMode = 'off' | 'standby' | 'calibration' | 'combat' | 'ambient' | 'debrief';

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

  // ── Standby Screen State ──
  private _batteryLevel: number | undefined = undefined;
  private _micReady = false;
  private _isStandby = false;
  private _isSessionActive = false;

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

    // Cache battery level from status
    if (status.batteryLevel !== undefined) {
      this._batteryLevel = status.batteryLevel;
    }
    
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
  
  private _lastTranscript = '';
  private _combatInitialized = false;
  private _chatLines: ChatLine[] = [];
  private _currentTopic = 'TRAINING';
  private _actionBarState = 'Ready';

  /**
   * Set the current topic for the combat header.
   */
  setCombatTopic(topic: string) {
    this._currentTopic = topic.toUpperCase();
  }

  private async updateCombatChat(): Promise<void> {
    if (!this._combatInitialized) return;
    const displayData = buildChatDisplay({
      title: this._currentTopic,
      actionBar: this._actionBarState,
      chatLines: this._chatLines,
      scrollOffset: 0,
      contentSlots: 7,
      maxChars: 44,
    });
    const content = renderTextPageLines(displayData.lines);
    // Container ID 2 is 'main' in showText() layout
    await this.quickUpdate(2, 'main', content);
  }

  async initCombatDisplay(): Promise<void> {
    this._mode = 'combat';
    this._combatInitialized = false;
    this._lastTranscript = '';
    this._chatLines = [{ type: 'system', text: 'System ready. Start speaking...' }];
    this._actionBarState = '████████████████';
    
    // Switch to single-text container layout for chat display
    await this.showText('Initializing chat...');
    this._combatInitialized = true;
    await this.updateCombatChat();
  }

  async showListening(): Promise<void> {
    this._mode = 'combat';
    if (!this._combatInitialized) {
      await this.initCombatDisplay();
      return;
    }
    this._actionBarState = renderTimerCompact({ running: true, remaining: 0, total: 0 }).replace('--', 'LISTENING');
    await this.updateCombatChat();
  }

  async showLiveTranscript(text: string): Promise<void> {
    if (!this._combatInitialized) return;
    if (text === this._lastTranscript) return;
    this._lastTranscript = text;

    // Update or add the transcript line
    const lastLine = this._chatLines[this._chatLines.length - 1];
    if (lastLine && lastLine.type === 'prompt') {
      lastLine.text = text;
    } else {
      this._chatLines.push({ type: 'prompt', text });
    }

    // Keep history brief
    if (this._chatLines.length > 20) this._chatLines.shift();
    
    await this.updateCombatChat();
  }

  async showSpeechActive(volume: number = 0): Promise<void> {
    this._mode = 'combat';
    const bars = this.volumeToBars(volume);
    if (bars === this.lastVolumeBars) return;
    this.lastVolumeBars = bars;
    
    if (this._combatInitialized) {
      this._actionBarState = `${bars} SPEAKING`;
      await this.updateCombatChat();
    }
  }

  async showSilenceCountdown(secondsLeft: number, thresholdSeconds: number): Promise<void> {
    this._mode = 'combat';
    if (!this._combatInitialized) return;
    
    // Generate precise unicode timer bar for the action bar
    const timerBar = renderTimerLines({ running: true, remaining: secondsLeft, total: thresholdSeconds }, 12)[1];
    this._actionBarState = `${timerBar} ${secondsLeft}s`;
    await this.updateCombatChat();
  }

  async showSilenceWarning(seconds: number): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      this._actionBarState = `! SILENCE: ${seconds}s`;
      await this.updateCombatChat();
    } else {
      await this.showText(`\n\n  ○ SILENCE: ${seconds}s`);
    }
  }

  async flashChunk(chunk: string): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      this._chatLines.push({ type: 'tool', text: `Hint: ${chunk}` });
      this._actionBarState = `▶ HINT DELIVERED`;
      await this.updateCombatChat();
    } else {
      await this.showText(`\n  ▶ ${chunk}`);
    }
  }

  async showSpeedUp(chunk: string): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      this._chatLines.push({ type: 'error', text: `SPEED UP! ${chunk}` });
      await this.updateCombatChat();
    } else {
      await this.showText(`\n  ▲ SPEED UP!\n  ${chunk}`);
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
      this._chatLines.push({ type: 'system', text: '★ PATTERN ACQUIRED' });
      this._actionBarState = `★ GREAT JOB`;
      await this.updateCombatChat();
      
      setTimeout(async () => {
        if (this._actionBarState === `★ GREAT JOB`) {
          this._actionBarState = 'LISTENING';
          await this.updateCombatChat();
        }
      }, 2000);
    } else {
      await this.showText('\n  ★ KEEP GOING!');
    }
  }

  async showPaused(): Promise<void> {
    this._mode = 'combat';
    if (this._combatInitialized) {
      this._actionBarState = '‖ PAUSED';
      await this.updateCombatChat();
    } else {
      await this.showText('\n  ‖ PAUSED');
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

  // ── Standby Screen ──

  /**
   * Render the standby/idle screen on G2 glasses.
   * Shows connection status, mic readiness, battery level, and app branding.
   * Single render — no periodic refresh loop.
   *
   * Layout (576×288 4-bit greyscale):
   * ┌──────────────────────────────────┐
   * │                                  │
   * │        ★ PROJECT ECHO            │
   * │        Ready to Go               │
   * │                                  │
   * │  ● Connected  ♪ Mic OK  █▇ 78%  │
   * └──────────────────────────────────┘
   */
  async showStandbyScreen(): Promise<void> {
    this._mode = 'standby';
    this._isStandby = true;

    // Build status indicators
    const connStr = this._connected ? '● Connected' : '○ Disconnected';
    const micStr = this._micReady ? '♪ Mic OK' : '♪ Mic --';
    const battStr = this._batteryLevel !== undefined
      ? `${this.batteryIcon(this._batteryLevel)} ${this._batteryLevel}%`
      : '';

    // Build the status line (compact, single row)
    const statusParts = [connStr, micStr];
    if (battStr) statusParts.push(battStr);
    const statusLine = statusParts.join('  ');

    // Current time (HH:MM)
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const lines = [
      '',
      '',
      '',
      '       ★ PROJECT ECHO',
      '       Ready to Go',
      '',
      `  ${statusLine}`,
      `  ${timeStr}`,
    ];

    await this.showText(lines.join('\n'));
    console.log('[HUD] Standby screen displayed');
  }

  /**
   * Enter standby mode — called when G2 is connected but no session is active.
   * Single render, no loop.
   */
  async enterStandby(): Promise<void> {
    if (this._isSessionActive) return; // Don't override active session
    if (!this._ready || !this._startupDone) return;
    await this.showStandbyScreen();
  }

  /**
   * Exit standby mode — called when a session starts.
   */
  exitStandby(): void {
    this._isStandby = false;
    this._isSessionActive = true;
  }

  /**
   * Mark session as ended — allows re-entering standby.
   */
  setSessionActive(active: boolean): void {
    this._isSessionActive = active;
  }

  /**
   * Set mic readiness flag (called when audio packets are received or mic is initialized).
   */
  setMicReady(ready: boolean): void {
    this._micReady = ready;
  }

  /**
   * Compact battery icon using G2-supported characters.
   * Returns a small 2-char gauge based on percentage.
   */
  private batteryIcon(pct: number): string {
    if (pct >= 80) return '█▇';
    if (pct >= 60) return '█▅';
    if (pct >= 40) return '▆▃';
    if (pct >= 20) return '▄▁';
    return '▂░';
  }

  // ── Common ──

  async clearDisplay(): Promise<void> {
    await this.showText(' ');
    this._mode = 'off';
    this._isStandby = false;
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
