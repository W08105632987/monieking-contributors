import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera, RefreshCw, Zap, ZapOff, X, AlertCircle } from 'lucide-react'

interface CameraQrScannerProps {
  onScan: (qrText: string) => void
  onClose: () => void
}

// Crisp scanner confirmation beep synthesized via Web Audio API
function playScanBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime) // A5
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.08) // A6

    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + 0.12)

    if (navigator.vibrate) {
      navigator.vibrate([60, 40, 60])
    }
  } catch {
    // AudioContext blocked or not supported, ignore silently
  }
}

// Dynamically load html5-qrcode script if native BarcodeDetector is absent
function loadHtml5QrcodeScript(): Promise<any> {
  if ((window as any).Html5Qrcode) {
    return Promise.resolve((window as any).Html5Qrcode)
  }
  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById('html5-qrcode-cdn')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve((window as any).Html5Qrcode))
      existingScript.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.id = 'html5-qrcode-cdn'
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
    script.async = true
    script.onload = () => resolve((window as any).Html5Qrcode)
    script.onerror = () => reject(new Error('Failed to load QR scanner library'))
    document.body.appendChild(script)
  })
}

export function CameraQrScanner({ onScan, onClose }: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [isScanning, setIsScanning] = useState(true)

  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const html5ScannerRef = useRef<any | null>(null)
  const scannedRef = useRef(false)

  const handleDetected = useCallback((text: string) => {
    if (scannedRef.current) return
    scannedRef.current = true
    setIsScanning(false)
    playScanBeep()
    onScan(text)
  }, [onScan])

  const stopStream = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (html5ScannerRef.current) {
      try {
        html5ScannerRef.current.stop().catch(() => {})
      } catch {
        // ignore
      }
      html5ScannerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
      trackRef.current = null
    }
  }, [])

  useEffect(() => {
    scannedRef.current = false
    setErrorMessage(null)
    let isCancelled = false

    async function startScanner() {
      stopStream()

      // Check if native BarcodeDetector is available
      const hasBarcodeDetector = 'BarcodeDetector' in window

      if (hasBarcodeDetector) {
        try {
          const constraints: MediaStreamConstraints = {
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          }
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
          if (isCancelled) {
            stream.getTracks().forEach(t => t.stop())
            return
          }
          streamRef.current = stream
          const videoTrack = stream.getVideoTracks()[0]
          trackRef.current = videoTrack

          // Check torch capability
          try {
            const capabilities: any = videoTrack.getCapabilities?.() || {}
            setHasTorch(Boolean(capabilities.torch))
          } catch {
            setHasTorch(false)
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream
            await videoRef.current.play()
          }

          const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })

          const scanLoop = async () => {
            if (isCancelled || scannedRef.current || !videoRef.current) return
            if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
              try {
                const barcodes = await detector.detect(videoRef.current)
                if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                  handleDetected(barcodes[0].rawValue)
                  return
                }
              } catch {
                // Ignore detection errors during motion/focus
              }
            }
            animationFrameRef.current = requestAnimationFrame(scanLoop)
          }

          animationFrameRef.current = requestAnimationFrame(scanLoop)
        } catch (err: any) {
          if (isCancelled) return
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setErrorMessage('Camera access was denied. Please allow camera permissions in your browser.')
          } else {
            setErrorMessage('Could not open camera: ' + (err.message || 'Unknown error'))
          }
        }
      } else {
        // Fallback to Html5Qrcode library
        try {
          const Html5Qrcode = await loadHtml5QrcodeScript()
          if (isCancelled) return
          const scannerId = 'html5-qr-reader-container'
          const scanner = new Html5Qrcode(scannerId)
          html5ScannerRef.current = scanner

          await scanner.start(
            { facingMode: facingMode },
            {
              fps: 15,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0,
            },
            (decodedText: string) => {
              handleDetected(decodedText)
            },
            () => {
              // Frame decoding error, continue scanning
            }
          )
        } catch (err: any) {
          if (isCancelled) return
          setErrorMessage('Failed to initialize camera scanner: ' + (err.message || 'Camera not accessible'))
        }
      }
    }

    startScanner()

    return () => {
      isCancelled = true
      stopStream()
    }
  }, [facingMode, handleDetected, stopStream])

  // Toggle torch / flashlight
  const toggleTorch = async () => {
    if (!trackRef.current) return
    try {
      const nextTorch = !torchOn
      await (trackRef.current as any).applyConstraints({
        advanced: [{ torch: nextTorch }],
      })
      setTorchOn(nextTorch)
    } catch {
      // ignore
    }
  }

  // Toggle front/back camera
  const toggleFacingMode = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'))
  }

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-black aspect-[4/3] flex flex-col items-center justify-center border-2 border-green-500/50 shadow-inner">
      {/* Error state */}
      {errorMessage ? (
        <div className="p-4 text-center text-red-200 text-xs flex flex-col items-center gap-2">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="font-semibold">{errorMessage}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 px-3 py-1.5 rounded-full bg-white/20 text-white font-bold text-xs hover:bg-white/30"
          >
            Switch to Manual Input
          </button>
        </div>
      ) : (
        <>
          {/* Native Video Feed */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Fallback container for Html5Qrcode */}
          <div
            id="html5-qr-reader-container"
            className="absolute inset-0 w-full h-full overflow-hidden"
          />

          {/* Scanner Overlay UI */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-4 bg-gradient-to-b from-black/60 via-transparent to-black/70">
            {/* Top Bar Controls */}
            <div className="w-full flex items-center justify-between pointer-events-auto">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-green-950/80 text-green-300 border border-green-500/40 backdrop-blur-sm">
                <Camera className="w-3 h-3 text-green-400" /> Live Scanner
              </span>

              <div className="flex items-center gap-2">
                {hasTorch && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md text-amber-300 flex items-center justify-center border border-white/20 hover:bg-black/80"
                    title="Flashlight"
                  >
                    {torchOn ? <Zap className="w-4 h-4 fill-amber-300" /> : <ZapOff className="w-4 h-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center border border-white/20 hover:bg-black/80"
                  title="Switch Camera"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center border border-white/20 hover:bg-black/80"
                  title="Close Camera"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Target Reticle in Center */}
            <div className="relative w-48 h-48 sm:w-56 sm:h-56">
              {/* Corner Reticles */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-green-400 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-green-400 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-green-400 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-green-400 rounded-br-lg" />

              {/* Sweeping Laser Beam */}
              {isScanning && (
                <div className="absolute inset-x-2 h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent shadow-[0_0_12px_#22c55e] animate-bounce duration-1000 top-1/2 -translate-y-1/2" />
              )}
            </div>

            {/* Bottom Guidance */}
            <p className="text-white/90 text-[11px] font-semibold text-center bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm border border-white/10">
              Align Food Pass QR within the frame
            </p>
          </div>
        </>
      )}
    </div>
  )
}
