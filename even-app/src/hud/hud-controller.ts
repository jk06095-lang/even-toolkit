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
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

import { buildScrollableList } from '@toolkit/glasses/glass-display-builders';
import { mapGlassEvent } from '@toolkit/glasses/action-map';

// G2 display constants
const W = 576;
const H = 288;

export type HUDMode = 'off' | 'standby' | 'calibration' | 'combat' | 'ambient' | 'debrief';
export type WearingState = 'wearing' | 'not-wearing' | 'unavailable';
export type HUDAction = 'resume' | 'end-practice' | 'exit-echo' | 'request-cue' | 'dismiss-cue';
export type CombatHUDState = 'READY' | 'LISTENING' | 'CUE' | 'ACK' | 'PAUSED';

export function parseWearingState(status: any): WearingState {
  const rawWearing =
    status?.isWearing ??
    status?.wearing ??
    status?.is_wearing ??
    status?.wearingStatus ??
    status?.wearState ??
    status?.isWear ??
    status?.wearStatus ??
    status?.wearingState ??
    status?.wear;

  if (rawWearing === undefined || rawWearing === null || rawWearing === '') {
    return 'unavailable';
  }

  const normalized = String(rawWearing).toLowerCase();
  return rawWearing === true ||
    rawWearing === 1 ||
    rawWearing === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'wearing'
    ? 'wearing'
    : 'not-wearing';
}

export class HUDController {
  private bridge: EvenAppBridge | null = null;
  private _ready = false;
  private _mode: HUDMode = 'off';
  private _connected = false;
  private _wearingState: WearingState = 'unavailable';
  private _startupDone = false;
  private audioListeners: Array<(pcm: Uint8Array) => void> = [];
  private unsubscribeEvents?: () => void;
  private audioPacketCount = 0;
  private statusListeners: Array<(status: any) => void> = [];
  private statusPollingTimer: any = null;

  // ── Standby Screen State ──
  private _batteryLevel: number | undefined = undefined;
  private _micReady = false;
  private _isStandby = false;
  private _isSessionActive = false;

  // ── HUD Interruption Menu State ──
  private _isInterruptMenuVisible = false;
  private _menuSelectedIndex = 0;
  private _onActionCallback?: (action: HUDAction) => void;

  get ready(): boolean { return this._ready; }
  get mode(): HUDMode { return this._mode; }
  get connected(): boolean { return this._connected; }
  get wearingState(): WearingState { return this._wearingState; }

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
        if (info) {
          // Support both nested 'status' object and flat SDK responses
          this.handleDeviceStatus(info.status || info);
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
        // 1. Handle Audio
        const audioPcm = event?.audioEvent?.audioPcm;
        if (audioPcm && (audioPcm.length > 0 || Array.isArray(audioPcm))) {
          this.audioPacketCount++;
          const pcmData = audioPcm instanceof Uint8Array ? audioPcm : new Uint8Array(audioPcm);
          for (const cb of this.audioListeners) cb(pcmData);
        }

        // 2. Handle Touch Gestures
        const action = mapGlassEvent(event);
        if (action) {
          this.handleHUDAction(action);
        }
      });

      // 2.5. Start Status Polling (Sync every 5 seconds)
      this.startStatusPolling();

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
    
    if (status.connectType !== undefined) {
      const isConnected = status.connectType === DeviceConnectType.Connected || status.connectType === 'connected';
      if (isConnected !== this._connected) {
        console.log(`[HUD] Hardware Connection State: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
      }
      this._connected = isConnected;
    }

    // Cache battery level
    if (status.batteryLevel !== undefined) {
      this._batteryLevel = status.batteryLevel;
    }

    this._wearingState = parseWearingState(status);
    console.log(`[HUD] Wear Status: ${this._wearingState}`);
    
    // Notify app-level listeners (for main.ts UI)
    for (const cb of this.statusListeners) {
      cb(status);
    }
  }

  private startStatusPolling() {
    if (this.statusPollingTimer) return;
    console.log('[HUD] Starting status polling loop (5s)');
    this.statusPollingTimer = setInterval(async () => {
      if (!this.bridge || !this._ready) return;
      try {
        const info = await this.bridge.getDeviceInfo();
        if (info) {
          this.handleDeviceStatus(info.status || info);
        }
      } catch (e) {
        // Silently fail polling
      }
    }, 5000);
  }

  private stopStatusPolling() {
    if (this.statusPollingTimer) {
      clearInterval(this.statusPollingTimer);
      this.statusPollingTimer = null;
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

  // ── Phase 2: Live Practice ──
  
  private _combatInitialized = false;
  private _combatHudState: CombatHUDState = 'READY';
  private _combatHudDetail = '';
  private _lastCombatFrame = '';
  private _ackTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Topic details stay on the phone UI. The G2 live HUD only renders
   * READY, LISTENING, CUE, or PAUSED.
   */
  setCombatTopic(_topic: string) {
    // Intentionally no-op for the simplified live HUD.
  }

  private async setCombatHudState(state: CombatHUDState, detail = ''): Promise<void> {
    if (state !== 'ACK') {
      this.clearAckTimeout();
    }
    this._mode = 'combat';
    this._combatInitialized = true;
    this._combatHudState = state;
    this._combatHudDetail = state === 'CUE' ? this.toGlanceableCue(detail) : '';
    await this.renderCombatHud();
  }

  private async renderCombatHud(): Promise<void> {
    if (!this._combatInitialized || this._isInterruptMenuVisible) return;

    const content = this.buildCombatHudFrame(this._combatHudState, this._combatHudDetail);
    if (content === this._lastCombatFrame) return;

    this._lastCombatFrame = content;
    await this.showText(content);
  }

  private async updateCombatChat(): Promise<void> {
    await this.renderCombatHud();
  }

  private clearAckTimeout(): void {
    if (this._ackTimeout) {
      clearTimeout(this._ackTimeout);
      this._ackTimeout = null;
    }
  }

  private buildCombatHudFrame(state: CombatHUDState, detail: string): string {
    if (state === 'ACK') {
      return [
        '',
        '',
        '       ACK',
        '',
        '       OK',
      ].join('\n');
    }

    if (state === 'CUE') {
      return [
        '',
        '',
        '       CUE',
        '',
        `  ${detail || 'Try again'}`,
      ].join('\n');
    }

    return [
      '',
      '',
      '',
      `       ${state}`,
      '',
    ].join('\n');
  }

  private toGlanceableCue(value: string): string {
    const compact = this.sanitizeTextForG2(value)
      .replace(/\s+/g, ' ')
      .trim();

    if (compact.length <= 50) return compact;

    const clipped = compact.slice(0, 47);
    const lastSpace = clipped.lastIndexOf(' ');
    return `${(lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
  }

  async initCombatDisplay(): Promise<void> {
    this._lastCombatFrame = '';
    await this.setCombatHudState('READY');
  }

  async showListening(): Promise<void> {
    await this.setCombatHudState('LISTENING');
  }

  async showLiveTranscript(_text: string): Promise<void> {
    // Transcript detail is intentionally phone-only during live conversation.
  }

  async showSpeechActive(_volume: number = 0): Promise<void> {
    await this.showListening();
  }

  async showSilenceCountdown(_secondsLeft: number, _thresholdSeconds: number): Promise<void> {
    await this.showListening();
  }

  async showSilenceWarning(_seconds: number): Promise<void> {
    await this.showListening();
  }

  async flashChunk(chunk: string): Promise<void> {
    await this.setCombatHudState('CUE', chunk);
  }

  async showGrammarFeedback(_correction: string): Promise<void> {
    // Grammar feedback stays on the phone UI and session export.
  }

  async showSpeedUp(chunk: string): Promise<void> {
    await this.setCombatHudState('CUE', chunk);
  }

  async showBlackout(): Promise<void> {
    await this.showListening();
  }

  async showGoodJob(): Promise<void> {
    this.clearAckTimeout();
    await this.setCombatHudState('ACK');
    this._ackTimeout = setTimeout(() => {
      this._ackTimeout = null;
      if (this._combatHudState === 'ACK' && !this._isInterruptMenuVisible) {
        void this.setCombatHudState('LISTENING');
      }
    }, 750);
  }

  async showPaused(): Promise<void> {
    await this.setCombatHudState('PAUSED');
  }
  // ── Phase 3: Review ──

  async showDebrief(_status: string): Promise<void> {
    await this.enterStandby();
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
    await this.showText(['', '', '', '       READY', ''].join('\n'));
    console.log('[HUD] Ready screen displayed');
  }
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
   * Helper to strip emojis and unsupported characters to prevent G2 rendering errors.
   */
  private sanitizeTextForG2(text: string): string {
    if (!text) return '';
    // 1. Specific replacements for common emojis/unsupported chars used in the app
    let cleaned = text
      .replace(/🎤/g, '●')
      .replace(/✓/g, '●')
      .replace(/👋/g, '')
      .replace(/☕/g, '')
      .replace(/🛒/g, '')
      .replace(/🏥/g, '')
      .replace(/📱/g, '')
      .replace(/🏋️/g, '')
      .replace(/🏨/g, '')
      .replace(/✈️/g, '')
      .replace(/🗺️/g, '')
      .replace(/🍽️/g, '')
      .replace(/🚶/g, '')
      .replace(/📊/g, '')
      .replace(/📧/g, '')
      .replace(/🤝/g, '')
      .replace(/🎉/g, '')
      .replace(/💬/g, '')
      .replace(/🎬/g, '')
      .replace(/📚/g, '')
      .replace(/✏️/g, '')
      .replace(/👥/g, '')
      .replace(/🎓/g, '');

    // 2. Generic regex for other common emojis ( Dingbats, Emoticons, Transport, etc. )
    const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}-\u{27B0}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu;
    cleaned = cleaned.replace(EMOJI_RE, '');

    // Allow list: space, basic printable ASCII, CJK, select G2 UI chars
    const ALLOWED_CHARS = /[\n\r\t\x20-\x7E\u00A0-\u00FF\u2010-\u2027\u2030-\u205E\u2190-\u21FF\u2500-\u25FF\u2605\u2606\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

    let finalCleaned = '';
    for (const char of cleaned) {
      if (ALLOWED_CHARS.test(char)) {
        finalCleaned += char;
      }
    }
    return finalCleaned;
  }

  /**
   * Full-screen single text container.
   * One event-capture overlay + one content container.
   */
  private async showText(content: string): Promise<void> {
    if (!this.bridge || !this._ready || !this._startupDone) return;
    const sanitized = this.sanitizeTextForG2(content);
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
              content: sanitized,
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
    const sanitizedHeader = this.sanitizeTextForG2(header);
    const sanitizedBody = this.sanitizeTextForG2(body);
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
              content: `  ${sanitizedHeader}`,
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
              content: sanitizedBody ? `\n  ${sanitizedBody}` : '',
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
    const sanitized = this.sanitizeTextForG2(content);
    try {
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: containerId,
          containerName: containerName,
          contentOffset: 0,
          contentLength: 2000,
          content: sanitized,
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

  // ── Interruption Menu Handling ──

  /** Register callback for HUD-triggered actions */
  onAction(cb: (action: HUDAction) => void) {
    this._onActionCallback = cb;
  }

  /** Mark if a session is currently active (enables/disables menu access) */
  setSessionActive(active: boolean) {
    this._isSessionActive = active;
    if (!active) {
      this._isInterruptMenuVisible = false;
    }
  }

  private handleHUDAction(action: any) {
    // Only allow menu if session is active OR if specifically handling GO_BACK to close menu
    if (!this._isSessionActive && !this._isInterruptMenuVisible) return;

    switch (action.type) {
      case 'REQUEST_CUE':
        if (this._isInterruptMenuVisible) {
          this.hideInterruptMenu();
        } else {
          this._onActionCallback?.('request-cue');
        }
        break;
      case 'GO_BACK':
        if (this._isInterruptMenuVisible) {
          this.hideInterruptMenu();
        } else {
          this.toggleInterruptMenu();
        }
        break;
      case 'HIGHLIGHT_MOVE':
        if (this._isInterruptMenuVisible) {
          const itemCount = 3;
          const delta = action.direction === 'down' ? 1 : -1;
          this._menuSelectedIndex = (this._menuSelectedIndex + delta + itemCount) % itemCount;
          this.updateInterruptMenu();
        } else {
          this._onActionCallback?.('dismiss-cue');
        }
        break;
      case 'SELECT_HIGHLIGHTED':
        if (this._isInterruptMenuVisible) {
          const actions: HUDAction[] = ['resume', 'end-practice', 'exit-echo'];
          const selectedAction = actions[this._menuSelectedIndex] ?? 'resume';
          this.hideInterruptMenu();
          this._onActionCallback?.(selectedAction);
        } else {
          this.showInterruptMenu();
        }
        break;
    }
  }

  private async toggleInterruptMenu() {
    if (this._isInterruptMenuVisible) {
      await this.hideInterruptMenu();
    } else {
      await this.showInterruptMenu();
    }
  }

  private async showInterruptMenu() {
    this._isInterruptMenuVisible = true;
    this._menuSelectedIndex = 0;
    await this.updateInterruptMenu();
  }

  private async hideInterruptMenu() {
    this._isInterruptMenuVisible = false;
    // Restore previous view
    if (this._mode === 'combat') {
      await this.updateCombatChat();
    } else {
      await this.enterStandby();
    }
  }

  private async updateInterruptMenu() {
    const title = 'ECHO PAUSED';
    const items = ['RESUME', 'END PRACTICE', 'EXIT ECHO'];
    
    const displayLines = buildScrollableList({
      items,
      highlightedIndex: this._menuSelectedIndex,
      maxVisible: 5,
      formatter: (item, idx) => {
        const prefix = idx === this._menuSelectedIndex ? '▶ ' : '  ';
        return `${prefix}${item}`;
      },
    });

    const content = [
      `  ★ ${title}`,
      '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      ...displayLines.map(l => l.text),
    ].join('\n');

    await this.quickUpdate(2, 'main', content);
  }

  async exitEcho(): Promise<void> {
    if (this.bridge && this._ready) {
      await this.setAudioCapture(false);
    }

    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.stopStatusPolling();

    if (this.bridge && this._ready) {
      await this.bridge.shutDownPageContainer(1).catch((err: unknown) => {
        console.warn('[HUD] shutDownPageContainer(1) failed:', err);
      });
    }

    this.bridge = null;
    this._ready = false;
    this._connected = false;
    this._startupDone = false;
    this.audioListeners = [];
    this.statusListeners = [];
  }

  dispose(): void {
    // Unsubscribe from events
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.stopStatusPolling();
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
