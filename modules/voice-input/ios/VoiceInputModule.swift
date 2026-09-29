import AVFoundation
import ExpoModulesCore
import Speech

/**
 * iOS counterpart of VoiceInputModule.kt: speech-to-text with
 * SFSpeechRecognizer, forced on-device (requiresOnDeviceRecognition), so audio
 * never leaves the phone. isAvailable() is false when the current locale has
 * no on-device model (supportsOnDeviceRecognition), rather than silently
 * falling back to Apple's servers.
 *
 * Same events as Android. Android's recognizer ends a session on its own when
 * the user stops talking; SFSpeechRecognizer does not, so this module ends it
 * after SILENCE_SECONDS without a new partial result (or NO_SPEECH_SECONDS if
 * nothing was heard at all).
 */
public class VoiceInputModule: Module {
  private static let silenceSeconds: TimeInterval = 1.8
  private static let noSpeechSeconds: TimeInterval = 8

  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var silenceTimer: Timer?
  private var heardSpeech = false
  private var lastText = ""

  public func definition() -> ModuleDefinition {
    Name("VoiceInput")

    Events("onSpeechStart", "onSpeechEnd", "onPartialResults", "onResults", "onError")

    AsyncFunction("isAvailable") { () -> Bool in
      guard let recognizer = Self.makeRecognizer() else { return false }
      return recognizer.isAvailable && recognizer.supportsOnDeviceRecognition
    }

    AsyncFunction("startListening") { (promise: Promise) in
      Self.requestPermissions { granted in
        guard granted else {
          promise.reject("E_PERMISSION_DENIED", "Microphone or speech recognition permission denied")
          return
        }
        DispatchQueue.main.async {
          do {
            try self.beginListening()
            promise.resolve(nil)
          } catch {
            self.teardown()
            promise.reject("E_START_FAILED", error.localizedDescription)
          }
        }
      }
    }

    AsyncFunction("stopListening") { (promise: Promise) in
      DispatchQueue.main.async {
        self.finishAudio()
        promise.resolve(nil)
      }
    }

    OnDestroy {
      DispatchQueue.main.async { self.teardown() }
    }
  }

  // Device locale when it has an on-device model, else en-US.
  private static func makeRecognizer() -> SFSpeechRecognizer? {
    if let recognizer = SFSpeechRecognizer(), recognizer.supportsOnDeviceRecognition {
      return recognizer
    }
    return SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  }

  private static func requestPermissions(_ completion: @escaping (Bool) -> Void) {
    SFSpeechRecognizer.requestAuthorization { status in
      guard status == .authorized else { return completion(false) }
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        completion(granted)
      }
    }
  }

  private func beginListening() throws {
    teardown()
    guard let recognizer = Self.makeRecognizer(), recognizer.isAvailable else {
      throw VoiceInputError("Speech recognizer unavailable")
    }
    guard recognizer.supportsOnDeviceRecognition else {
      throw VoiceInputError("On-device speech recognition unavailable for this language")
    }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    self.request = request
    heardSpeech = false
    lastText = ""

    let input = audioEngine.inputNode
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
      request.append(buffer)
    }
    audioEngine.prepare()
    try audioEngine.start()

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      DispatchQueue.main.async { self?.handle(result: result, error: error) }
    }
    armSilenceTimer(Self.noSpeechSeconds)
  }

  private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
    guard task != nil else { return }
    if let result = result {
      let text = result.bestTranscription.formattedString
      if !heardSpeech && !text.isEmpty {
        heardSpeech = true
        sendEvent("onSpeechStart", [:])
      }
      lastText = text
      if result.isFinal {
        sendEvent("onSpeechEnd", [:])
        sendEvent("onResults", ["text": text])
        teardown()
        return
      }
      sendEvent("onPartialResults", ["text": text])
      armSilenceTimer(Self.silenceSeconds)
    } else if let error = error {
      // Stopping after speech can surface a cancellation error; the words
      // heard so far are still the answer.
      if heardSpeech && !lastText.isEmpty {
        sendEvent("onSpeechEnd", [:])
        sendEvent("onResults", ["text": lastText])
      } else {
        let nsError = error as NSError
        sendEvent("onError", ["code": String(nsError.code), "message": heardSpeech ? nsError.localizedDescription : "No speech input"])
      }
      teardown()
    }
  }

  private func armSilenceTimer(_ seconds: TimeInterval) {
    silenceTimer?.invalidate()
    silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      if self.heardSpeech {
        self.finishAudio()
      } else {
        self.sendEvent("onError", ["code": "no_speech", "message": "No speech input"])
        self.teardown()
      }
    }
  }

  // Ends the audio stream; the recognizer then delivers the final result.
  private func finishAudio() {
    silenceTimer?.invalidate()
    silenceTimer = nil
    if audioEngine.isRunning {
      audioEngine.stop()
      audioEngine.inputNode.removeTap(onBus: 0)
    }
    request?.endAudio()
  }

  private func teardown() {
    silenceTimer?.invalidate()
    silenceTimer = nil
    if audioEngine.isRunning {
      audioEngine.stop()
      audioEngine.inputNode.removeTap(onBus: 0)
    }
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

private struct VoiceInputError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}
