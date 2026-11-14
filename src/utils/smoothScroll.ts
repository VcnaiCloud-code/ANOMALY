/**
 * ANOMALY SOUND - High-FPS Adaptive Smooth Scroll Engine
 *
 * - Mouse wheel: progressive acceleration & ease-out damping (frame-rate independent 60-144Hz).
 * - Trackpad / Magic Mouse: ultra-responsive low-latency smoothing preserving native gestures & momentum.
 * - Touchscreens: 100% native hardware-accelerated momentum (never hijacks touch events).
 * - Anchor / Section navigation: smooth cubic ease-in-out, immediately yielding to user input.
 * - Nested scroll containers, modals, pinch-zoom & prefers-reduced-motion: safely respected.
 * - Zero React re-renders and zero idle CPU usage (rAF stops automatically at rest).
 */

type AnimationMode = 'idle' | 'wheel' | 'anchor';

class SmoothScrollEngine {
  private currentY = 0;
  private targetY = 0;
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private mode: AnimationMode = 'idle';
  private activeLambda = 11;

  // Anchor ease-in-out state
  private anchorStartY = 0;
  private anchorEndY = 0;
  private anchorStartTime = 0;
  private anchorDuration = 650;

  // Input device classification state
  private lastWheelTime = 0;
  private lastAppliedY = 0;

  // Accessibility & lifecycle
  private reducedMotionQuery: MediaQueryList | null = null;
  private isReducedMotion = false;
  private initialized = false;

  public init(): () => void {
    if (typeof window === 'undefined' || this.initialized) {
      return () => {};
    }

    this.initialized = true;
    this.currentY = window.scrollY;
    this.targetY = window.scrollY;
    this.lastAppliedY = window.scrollY;

    if (window.matchMedia) {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.isReducedMotion = this.reducedMotionQuery.matches;
      this.reducedMotionQuery.addEventListener('change', this.handleReducedMotionChange);
    }

    // Must be non-passive ONLY when deciding to smooth discrete wheel events;
    // touchstart / touchmove are NEVER intercepted so mobile scroll stays 100% native.
    window.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('scroll', this.handleNativeScroll, { passive: true });
    window.addEventListener('touchstart', this.handleTouchOrKeyInterrupt, { passive: true });
    window.addEventListener('keydown', this.handleKeyDown, { passive: true });
    window.addEventListener('resize', this.handleResize, { passive: true });

    return () => this.destroy();
  }

  public destroy(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.stopRaf();

    if (this.reducedMotionQuery) {
      this.reducedMotionQuery.removeEventListener('change', this.handleReducedMotionChange);
    }
    window.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('scroll', this.handleNativeScroll);
    window.removeEventListener('touchstart', this.handleTouchOrKeyInterrupt);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);
  }

  public scrollTo(targetTop: number): void {
    const maxScroll = this.getMaxScroll();
    const clampedTarget = Math.max(0, Math.min(maxScroll, targetTop));

    if (this.isReducedMotion) {
      this.stopRaf();
      this.lastAppliedY = clampedTarget;
      window.scrollTo({ top: clampedTarget, behavior: 'auto' });
      this.currentY = clampedTarget;
      this.targetY = clampedTarget;
      return;
    }

    const startY = window.scrollY;
    const distance = Math.abs(clampedTarget - startY);
    if (distance < 2) {
      this.lastAppliedY = clampedTarget;
      window.scrollTo(window.scrollX, clampedTarget);
      this.currentY = clampedTarget;
      this.targetY = clampedTarget;
      return;
    }

    this.mode = 'anchor';
    this.anchorStartY = startY;
    this.anchorEndY = clampedTarget;
    this.targetY = clampedTarget;
    this.currentY = startY;
    this.lastAppliedY = startY;
    this.anchorStartTime = performance.now();
    // Responsive duration scaled subtly by scroll distance (480ms - 820ms)
    this.anchorDuration = Math.min(820, Math.max(480, 420 + distance * 0.18));

    this.startRaf();
  }

  private handleReducedMotionChange = (e: MediaQueryListEvent): void => {
    this.isReducedMotion = e.matches;
    if (this.isReducedMotion) {
      this.stopRaf();
    }
  };

  private getMaxScroll(): number {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  private isModalOrOverlayLocked(): boolean {
    const { classList } = document.body;
    return classList.contains('sheet-open') || classList.contains('modal-open');
  }

  private canTargetScrollInternally(target: EventTarget | null, deltaY: number): boolean {
    let el = target instanceof HTMLElement ? target : null;
    while (el && el !== document.body && el !== document.documentElement) {
      const tag = el.tagName;
      if (tag === 'INPUT' && (el as HTMLInputElement).type === 'range') {
        return true;
      }
      if (tag === 'SELECT') return true;

      if (el.hasAttribute('data-no-smooth-scroll')) {
        return true;
      }

      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        const scrollableHeight = el.scrollHeight - el.clientHeight;
        if (scrollableHeight > 1) {
          if (deltaY < 0 && el.scrollTop > 0) return true;
          if (deltaY > 0 && el.scrollTop < scrollableHeight - 1) return true;
          // If inside a modal/panel container even at its scroll boundary,
          // let the modal contain the scroll rather than scrolling the page underneath.
          if (
            style.position === 'fixed' ||
            el.closest('[role="dialog"]') ||
            el.closest('[aria-modal="true"]')
          ) {
            return true;
          }
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  private normalizeWheelDelta(e: WheelEvent): number {
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      // Line mode (Firefox/legacy wheel mice)
      dy *= 36;
    } else if (e.deltaMode === 2) {
      // Page mode
      dy *= window.innerHeight * 0.85;
    }
    return dy;
  }

  private handleWheel = (e: WheelEvent): void => {
    if (this.isReducedMotion) return;
    // Allow browser pinch-zoom & horizontal trackpad gestures natively
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaY) < 4) return;
    if (this.isModalOrOverlayLocked()) return;
    if (this.canTargetScrollInternally(e.target, e.deltaY)) return;

    const now = performance.now();
    const dtWheel = now - this.lastWheelTime;
    this.lastWheelTime = now;

    const dy = this.normalizeWheelDelta(e);
    if (Math.abs(dy) < 0.01) return;

    // Detect precision trackpad vs discrete notched mouse wheel:
    // Trackpads emit high-frequency (< 28ms) or small-delta (< 38px) pixel-mode events
    const isLikelyTrackpad = e.deltaMode === 0 && (dtWheel < 28 || Math.abs(dy) < 38);

    e.preventDefault();

    // Sync with actual scrollY if we were idle or switching from anchor/external scroll
    if (this.mode !== 'wheel') {
      this.currentY = window.scrollY;
      this.targetY = window.scrollY;
      this.lastAppliedY = window.scrollY;
    }

    this.mode = 'wheel';

    // Responsive damping constant (higher = faster response, zero sluggishness)
    // Mouse wheel: ~11.5 (silky glide with immediate start)
    // Trackpad: ~24 (instantaneous control, soft micro-polish)
    this.activeLambda = isLikelyTrackpad ? 24 : 11.5;

    const maxScroll = this.getMaxScroll();
    // Subtle step scaling for notched mouse wheels without sacrificing speed
    const stepMultiplier = isLikelyTrackpad ? 1.0 : 1.08;
    this.targetY = Math.max(0, Math.min(maxScroll, this.targetY + dy * stepMultiplier));

    this.startRaf();
  };

  private handleNativeScroll = (): void => {
    const actualY = window.scrollY;
    if (this.mode === 'idle') {
      this.currentY = actualY;
      this.targetY = actualY;
      this.lastAppliedY = actualY;
      return;
    }
    // If the user manually drags the scrollbar or an external jump happens, yield cleanly
    if (Math.abs(actualY - this.lastAppliedY) > 16) {
      this.stopRaf();
      this.currentY = actualY;
      this.targetY = actualY;
      this.lastAppliedY = actualY;
    }
  };

  private handleTouchOrKeyInterrupt = (): void => {
    if (this.mode !== 'idle') {
      this.stopRaf();
      this.currentY = window.scrollY;
      this.targetY = window.scrollY;
      this.lastAppliedY = window.scrollY;
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
    if (scrollKeys.includes(e.key) && this.mode !== 'idle') {
      this.stopRaf();
      this.currentY = window.scrollY;
      this.targetY = window.scrollY;
      this.lastAppliedY = window.scrollY;
    }
  };

  private handleResize = (): void => {
    const maxScroll = this.getMaxScroll();
    this.targetY = Math.min(this.targetY, maxScroll);
    this.currentY = Math.min(this.currentY, maxScroll);
    this.lastAppliedY = Math.min(this.lastAppliedY, maxScroll);
  };

  private startRaf(): void {
    if (this.rafId !== null) return;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopRaf(): void {
    this.mode = 'idle';
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (now: number): void => {
    // Clamp frame delta so tab-switching never causes jumps
    const rawDt = (now - this.lastFrameTime) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.lastFrameTime = now;

    if (this.mode === 'anchor') {
      const elapsed = now - this.anchorStartTime;
      const progress = Math.min(1, elapsed / this.anchorDuration);
      // Cubic ease-in-out curve
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const nextY = this.anchorStartY + (this.anchorEndY - this.anchorStartY) * eased;
      this.currentY = nextY;
      this.lastAppliedY = nextY;
      window.scrollTo(window.scrollX, nextY);

      if (progress >= 1) {
        this.lastAppliedY = this.anchorEndY;
        window.scrollTo(window.scrollX, this.anchorEndY);
        this.currentY = this.anchorEndY;
        this.targetY = this.anchorEndY;
        this.stopRaf();
        return;
      }

      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    if (this.mode === 'wheel') {
      const diff = this.targetY - this.currentY;
      if (Math.abs(diff) < 0.35) {
        this.currentY = this.targetY;
        this.lastAppliedY = this.targetY;
        window.scrollTo(window.scrollX, this.targetY);
        this.stopRaf();
        return;
      }

      // Frame-rate independent critically-damped exponential smoothing
      const factor = 1 - Math.exp(-this.activeLambda * dt);
      this.currentY += diff * factor;
      this.lastAppliedY = this.currentY;
      window.scrollTo(window.scrollX, this.currentY);

      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    this.stopRaf();
  };
}

export const smoothScrollEngine = new SmoothScrollEngine();
