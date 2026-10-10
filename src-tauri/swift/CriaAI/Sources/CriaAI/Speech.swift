import Foundation
import AVFoundation
import Speech

/// Live dictation for Ramble: Apple's Speech framework, on-device where the
/// locale supports it.
///
/// Events go to Rust through one C callback as JSON strings:
///   {"kind":"interim","text":"..."}  phrase in progress
///   {"kind":"final","text":"..."}    phrase finished (after a pause)
///   {"kind":"end","error":"..."?}    session over; `error` only on failure
/// A "final" is cut by silence (`silence` seconds with no new words), then a
/// fresh recognition request takes over while the mic keeps running, so
/// phrases arrive as they are spoken rather than at the end.
public typealias CriaSpeechCallback = @convention(c) (UnsafePointer<CChar>?) -> Void

private final class Dictation {
    static let shared = Dictation()

    private let queue = DispatchQueue(label: "cria.speech")
    private let silence: TimeInterval = 1.4

    // `request` is read from the audio thread, so it has its own lock.
    // Everything else is touched only on `queue`.
    private let requestLock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    private var callback: CriaSpeechCallback?
    private var engine: AVAudioEngine?
    private var recogniser: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var timer: DispatchSourceTimer?
    private var wanted = false
    private var active = false
    private var lastText = ""
    private var failures = 0
    private var generation = 0

    func start(_ cb: CriaSpeechCallback) {
        queue.async {
            if self.active { return }
            self.active = true
            self.wanted = true
            self.callback = cb
            self.failures = 0
            self.generation += 1
            self.authorise { ok, error in
                self.queue.async {
                    guard self.wanted else { return }
                    if let error = error, !ok { self.finish(error: error); return }
                    self.begin()
                }
            }
        }
    }

    func stop() {
        queue.async {
            guard self.active, self.wanted else { return }
            self.wanted = false
            self.timer?.cancel()
            let gen = self.generation
            if let req = self.currentRequest() {
                // The pending result (or error) lands in `handle`, which finishes.
                req.endAudio()
                // Safety net: never leave the mic open if no result comes back.
                self.queue.asyncAfter(deadline: .now() + 3) {
                    if self.active && self.generation == gen { self.finish(error: nil) }
                }
            } else {
                self.finish(error: nil)
            }
        }
    }

    // MARK: permissions

    private func authorise(_ done: @escaping (Bool, String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { done(false, "speechDenied"); return }
            #if os(iOS)
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                done(granted, granted ? nil : "microphoneDenied")
            }
            #else
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                done(granted, granted ? nil : "microphoneDenied")
            }
            #endif
        }
    }

    // MARK: session

    private func begin() {
        let rec = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
        guard let rec = rec, rec.isAvailable else { finish(error: "recogniserUnavailable"); return }
        recogniser = rec
        do {
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            #endif
            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let self = self else { return }
                self.requestLock.lock()
                self.request?.append(buffer)
                self.requestLock.unlock()
            }
            engine.prepare()
            try engine.start()
            self.engine = engine
        } catch {
            finish(error: "audio: \(error.localizedDescription)")
            return
        }
        newRequest()
    }

    private func currentRequest() -> SFSpeechAudioBufferRecognitionRequest? {
        requestLock.lock()
        defer { requestLock.unlock() }
        return request
    }

    private func newRequest() {
        guard let rec = recogniser else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        requestLock.lock()
        request = req
        requestLock.unlock()
        lastText = ""
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            self?.queue.async { self?.handle(req, result, error) }
        }
    }

    private func handle(_ req: SFSpeechAudioBufferRecognitionRequest, _ result: SFSpeechRecognitionResult?, _ error: Error?) {
        // A superseded request's late callbacks must not touch the new one.
        guard active, req === currentRequest() else { return }
        if let result = result {
            let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                lastText = text
                failures = 0
            }
            if !result.isFinal {
                if !text.isEmpty {
                    emit(kind: "interim", text: text)
                    armTimer()
                }
                return
            }
        } else if error == nil {
            return
        }
        // Final result, or the task died: close this phrase.
        timer?.cancel()
        if !lastText.isEmpty { emit(kind: "final", text: lastText) }
        let hadText = !lastText.isEmpty
        lastText = ""
        emit(kind: "interim", text: "")
        if !wanted { finish(error: nil); return }
        if error != nil && !hadText {
            failures += 1
            if failures >= 3 { finish(error: "recognitionFailed"); return }
        }
        newRequest()
    }

    /// Cut the phrase once the speaker pauses: ending the audio makes the
    /// recogniser deliver its final result for what was said.
    private func armTimer() {
        timer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + silence)
        t.setEventHandler { [weak self] in self?.currentRequest()?.endAudio() }
        t.resume()
        timer = t
    }

    private func finish(error: String?) {
        guard active else { return }
        active = false
        wanted = false
        timer?.cancel()
        task?.cancel()
        task = nil
        requestLock.lock()
        request = nil
        requestLock.unlock()
        if let engine = engine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        engine = nil
        recogniser = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
        var payload: [String: String] = ["kind": "end"]
        if let error = error { payload["error"] = error }
        send(payload)
    }

    private func emit(kind: String, text: String) {
        send(["kind": kind, "text": text])
    }

    private func send(_ payload: [String: String]) {
        guard let cb = callback,
              let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        String(decoding: data, as: UTF8.self).withCString { cb($0) }
    }
}

@_cdecl("cria_speech_start")
public func criaSpeechStart(_ cb: CriaSpeechCallback) {
    Dictation.shared.start(cb)
}

@_cdecl("cria_speech_stop")
public func criaSpeechStop() {
    Dictation.shared.stop()
}
