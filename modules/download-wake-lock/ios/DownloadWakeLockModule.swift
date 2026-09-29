import ExpoModulesCore
import UIKit

/**
 * iOS counterpart of DownloadWakeLockModule.kt. iOS has no CPU wake lock, so
 * "keep the download going" is two things here:
 *
 * - isIdleTimerDisabled: the screen does not auto-lock while a download runs,
 *   so the app stays in the foreground with the user watching progress.
 * - beginBackgroundTask: if the user leaves the app anyway, iOS grants a short
 *   grace period (typically ~30s) before suspending it.
 *
 * The transfer itself survives suspension because expo-file-system's
 * createDownloadResumable uses a background URLSession on iOS by default
 * (sessionType BACKGROUND); this module does not need to own the session.
 * Same contract as Android: not reference-counted, acquire while held is a
 * no-op, one release frees it.
 */
public class DownloadWakeLockModule: Module {
  private var held = false
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

  public func definition() -> ModuleDefinition {
    Name("DownloadWakeLock")

    Function("acquire") { () -> Bool in
      self.onMain { self.acquire() }
      return true
    }

    Function("release") {
      self.onMain { self.release() }
    }

    // JS reload or app teardown: nothing on the JS side will release it anymore.
    OnDestroy {
      self.onMain { self.release() }
    }
  }

  private func acquire() {
    guard !held else { return }
    held = true
    UIApplication.shared.isIdleTimerDisabled = true
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "BOAR:ModelDownload") { [weak self] in
      // Grace period over: iOS will suspend us. End the task so it doesn't
      // kill the app; the background URLSession keeps transferring.
      self?.endBackgroundTask()
    }
  }

  private func release() {
    guard held else { return }
    held = false
    UIApplication.shared.isIdleTimerDisabled = false
    endBackgroundTask()
  }

  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }
}
