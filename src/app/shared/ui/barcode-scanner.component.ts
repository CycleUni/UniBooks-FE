import { AfterViewInit, Component, EventEmitter, OnDestroy, Output } from '@angular/core';
import type { Html5Qrcode } from 'html5-qrcode';

/**
 * Makes sure a BarcodeDetector that reads EAN-13 exists before html5-qrcode
 * looks for one. Android Chrome ships a native detector; iOS Safari has none,
 * so html5-qrcode fell back to its bundled ZXing-JS, which reads 1D barcodes
 * only when they fill the frame (iPhones had to nearly touch the book). The
 * polyfill runs ZXing-C++ as WebAssembly instead, served from our own origin
 * (see the zxing asset in angular.json) rather than its default CDN.
 */
export async function ensureEan13BarcodeDetector(): Promise<void> {
  const native = (globalThis as any).BarcodeDetector;
  if (native) {
    try {
      const formats: string[] = await native.getSupportedFormats();
      if (formats.includes('ean_13')) return;
    } catch {
      // Treat a detector that can't list its formats like a missing one.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path,
    },
  });
  (globalThis as any).BarcodeDetector = BarcodeDetector;
}

/**
 * Returns a filter that passes a decoded value only once it has been read
 * `reads` times in a row over at least `minSpanMs`. A misread can change two
 * digits so that the EAN-13 check digit still holds (seen on Android and iOS,
 * where it opened a different book); a misread holding steady across several
 * camera frames is far less likely than the true value doing so.
 *
 * The time span matters as much as the count: the scanner decodes ~10 times a
 * second, but in low light the camera delivers frames more slowly, so
 * back-to-back decodes can be the same frame read twice. Requiring two reads
 * alone let one bad frame confirm itself.
 */
export function createScanConfirmer(
  reads = 3,
  minSpanMs = 400,
  now: () => number = () => performance.now(),
): (decodedText: string) => boolean {
  let last = '';
  let count = 0;
  let firstSeenAt = 0;
  return (decodedText: string) => {
    const t = now();
    if (decodedText === last) {
      count++;
    } else {
      last = decodedText;
      count = 1;
      firstSeenAt = t;
    }
    return count >= reads && t - firstSeenAt >= minSpanMs;
  };
}

/**
 * Selects the most appropriate rear camera from available video devices only when
 * there is high confidence from device labels (e.g. avoiding explicitly labeled
 * ultra-wide or telephoto lenses on multi-lens iOS devices).
 *
 * If labels are generic, uninformative (e.g. Android "camera2 0"), or ambiguous,
 * returns null to let the browser choose naturally via { facingMode: "environment" }.
 */
export function selectBestRearCamera(devices: { id: string; label: string }[] | null | undefined): string | null {
  if (!devices || devices.length === 0) return null;

  // Filter out front-facing cameras
  const frontRegex = /front|user|前置|前相機|前鏡頭|facetime|selfie/i;
  const backDevices = devices.filter(d => !frontRegex.test(d.label || ''));
  if (backDevices.length <= 1) {
    // If only 0 or 1 back camera candidate, let browser handle facingMode natively
    return null;
  }

  // Avoid ultra-wide and telephoto lenses
  const ultraWideRegex = /ultra[\s-]?wide|0\.5x|超廣角/i;
  const telephotoRegex = /telephoto|望遠|長焦|[2-9]x/i;

  const hasSpecialtyLens = backDevices.some(d =>
    ultraWideRegex.test(d.label || '') || telephotoRegex.test(d.label || '')
  );

  // If none of the devices have explicit ultra-wide or telephoto labels,
  // we do not have high confidence in the label scheme — fall back to browser facingMode.
  if (!hasSpecialtyLens) {
    return null;
  }

  const normalBackCameras = backDevices.filter(d =>
    !ultraWideRegex.test(d.label || '') && !telephotoRegex.test(d.label || '')
  );

  if (normalBackCameras.length === 0) {
    return null;
  }

  // If there is one explicitly labeled as main / wide / back camera, prefer it
  const preferred = normalBackCameras.find(d =>
    /back camera|main|廣角|後置|後相機/i.test(d.label || '')
  );

  return preferred ? preferred.id : normalBackCameras[0].id;
}

let nextId = 0;

/**
 * The camera view that reads a book's barcode, shared by the sell form and the
 * search screen. It starts the rear camera when rendered and stops it when
 * removed, so a page shows it with `*ngIf` while scanning.
 *
 * It emits each code once it holds steady across frames (createScanConfirmer)
 * and leaves judging it to the page — isbnFromScan in core/isbn.ts — since
 * what an unusable code means differs by page. `failed` means the camera could
 * not be opened (permission denied, no camera); the page should close it.
 */
@Component({
  selector: 'ui-barcode-scanner',
  standalone: true,
  template: `<div class="reader" [id]="readerId"></div>`,
  styles: [`
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      aspect-ratio: 16 / 9;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--line);
    }
    .reader {
      width: 100%;
      height: 100%;
    }
  `]
})
export class UiBarcodeScanner implements AfterViewInit, OnDestroy {
  /** A code read steadily; not yet checked to be an ISBN. */
  @Output() decoded = new EventEmitter<string>();
  /** The camera could not be started. */
  @Output() failed = new EventEmitter<void>();

  readonly readerId = `barcode-reader-${nextId++}`;
  private scanner: Html5Qrcode | null = null;
  private destroyed = false;

  ngAfterViewInit() {
    this.start();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.stop();
  }

  private async start() {
    try {
      await ensureEan13BarcodeDetector();
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (this.destroyed) return;
      const scanner = new Html5Qrcode(this.readerId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.QR_CODE
        ],
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      });
      this.scanner = scanner;

      // Try camera enumeration to pick standard wide rear camera if high-confidence labels exist (e.g. multi-lens iOS)
      let selectedDeviceId: string | null = null;
      try {
        const devices = await Html5Qrcode.getCameras();
        selectedDeviceId = selectBestRearCamera(devices);
      } catch (e) {
        // Device enumeration can fail if permissions not yet granted or unsupported; fall back to facingMode
        console.warn('Camera enumeration fallback to facingMode', e);
      }

      const cameraIdOrConfig = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : { facingMode: 'environment' };

      const confirmed = createScanConfirmer();
      await scanner.start(
        cameraIdOrConfig,
        { fps: 10, qrbox: { width: 280, height: 120 } },
        (decodedText) => {
          if (confirmed(decodedText)) this.decoded.emit(decodedText);
        },
        () => {
          // Fires for every frame with no code in it; nothing to do.
        }
      );
      // Removed while the camera was still starting: ngOnDestroy found it not
      // yet running, so stop it now.
      if (this.destroyed) await this.stopScanner(scanner);
    } catch (err) {
      console.error('Scanner error', err);
      if (!this.destroyed) this.failed.emit();
    }
  }

  private stop() {
    if (this.scanner?.isScanning) this.stopScanner(this.scanner);
  }

  private async stopScanner(scanner: Html5Qrcode) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (err) {
      console.error('Error stopping scanner', err);
    }
  }
}
