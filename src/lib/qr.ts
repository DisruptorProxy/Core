/**
 * QR scanning via the native BarcodeDetector, no library.
 *
 * The Chromium-based webview The Disruptor Proxy runs in ships BarcodeDetector, so a
 * dependency-free scan is possible where it is available and cleanly absent where
 * it is not. Capability is checked up front so the UI can hide the option rather
 * than offer a button that does nothing.
 */

interface BarcodeDetectorLike
{
    detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface BarcodeDetectorCtor
{
    new (options?: { formats: string[] }): BarcodeDetectorLike;
    getSupportedFormats?: () => Promise<string[]>;
}

const detectorCtor = (): BarcodeDetectorCtor | undefined =>
    (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

export const qrSupported = (): boolean =>
    detectorCtor() !== undefined && typeof navigator.mediaDevices?.getUserMedia === 'function';

export interface QrScan
{
    /** The live video element to place in the UI. */
    video: HTMLVideoElement;
    /** Resolves with the first decoded value, or rejects if stopped. */
    result: Promise<string>;
    /** Stops the camera and rejects the pending result. */
    stop: () => void;
}

/**
 * Starts a scan: opens the rear camera, decodes each frame, resolves on the first
 * QR found. The caller mounts `video`, awaits `result`, and must call `stop()` to
 * release the camera whether it resolves or the sheet closes.
 */
export const startQrScan = async (): Promise<QrScan> =>
{
    const Ctor = detectorCtor();

    if (Ctor === undefined)
    {
        throw new Error('QR scanning is not supported');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');

    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;

    await video.play();

    const detector = new Ctor({ formats: ['qr_code'] });

    let stopped = false;
    let rejectResult: (reason: Error) => void = () => undefined;

    const stop = (): void =>
    {
        if (stopped)
        {
            return;
        }

        stopped = true;
        stream.getTracks().forEach((track) => track.stop());
        rejectResult(new Error('Scan cancelled'));
    };

    const result = new Promise<string>((resolve, reject) =>
    {
        rejectResult = reject;

        const tick = async (): Promise<void> =>
        {
            if (stopped)
            {
                return;
            }

            try
            {
                const codes = await detector.detect(video);

                if (codes.length > 0 && codes[0].rawValue !== '')
                {
                    stopped = true;
                    stream.getTracks().forEach((track) => track.stop());
                    resolve(codes[0].rawValue);

                    return;
                }
            }
            catch
            {
                // A transient decode failure on one frame is normal; keep scanning.
            }

            requestAnimationFrame(() => void tick());
        };

        void tick();
    });

    return { video, result, stop };
};
