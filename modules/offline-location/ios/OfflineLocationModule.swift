import CoreLocation
import ExpoModulesCore

/**
 * iOS side of modules/offline-location (JS contract in index.ts, Android side
 * in LocationManager). One-shot "when in use" position from CoreLocation.
 * GPS fixes work with no network (a cold fix is just slower without
 * assisted data). No CLGeocoder: reverse geocoding goes to Apple's servers,
 * so place names come from the offline pack instead.
 *
 * Precise location turned off by the user still counts as granted; the fix
 * then has a coarse accuracyM (kilometres), which is enough to pick a city.
 */
public class OfflineLocationModule: Module {
  private lazy var delegate = LocationDelegate()

  public func definition() -> ModuleDefinition {
    Name("OfflineLocation")

    AsyncFunction("getPermissionStatus") { () -> String in
      return Self.status(CLLocationManager().authorizationStatus)
    }.runOnQueue(.main)

    AsyncFunction("requestPermission") { (promise: Promise) in
      self.delegate.requestPermission { promise.resolve($0 == "granted" ? "granted" : "denied") }
    }.runOnQueue(.main)

    // Last fix CoreLocation already has, without turning on GPS; null if none
    // or permission is missing.
    AsyncFunction("getLastKnownPosition") { () -> [String: Any]? in
      return self.delegate.lastKnown()
    }.runOnQueue(.main)

    AsyncFunction("getCurrentPosition") { (opts: [String: Double]?, promise: Promise) in
      let timeoutMs = opts?["timeoutMs"] ?? 30_000
      let maxAgeMs = opts?["maxAgeMs"] ?? 0
      self.delegate.currentPosition(timeoutMs: timeoutMs, maxAgeMs: maxAgeMs, promise: promise)
    }.runOnQueue(.main)
  }

  static func status(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .authorizedWhenInUse, .authorizedAlways: return "granted"
    case .notDetermined: return "undetermined"
    default: return "denied"
    }
  }
}

/// All state lives on the main queue (CLLocationManager's delegate thread).
private final class LocationDelegate: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var permissionWaiters: [(String) -> Void] = []
  private var pending: [Promise] = []
  private var timeout: DispatchWorkItem?

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }

  func requestPermission(_ done: @escaping (String) -> Void) {
    guard manager.authorizationStatus == .notDetermined else {
      return done(OfflineLocationModule.status(manager.authorizationStatus))
    }
    permissionWaiters.append(done)
    manager.requestWhenInUseAuthorization()
  }

  func lastKnown() -> [String: Any]? {
    guard OfflineLocationModule.status(manager.authorizationStatus) == "granted",
          let last = manager.location else { return nil }
    return Self.payload(last, source: "cached")
  }

  func currentPosition(timeoutMs: Double, maxAgeMs: Double, promise: Promise) {
    guard OfflineLocationModule.status(manager.authorizationStatus) == "granted" else {
      return promise.reject("E_PERMISSION", "Location permission not granted")
    }
    guard CLLocationManager.locationServicesEnabled() else {
      return promise.reject("E_UNAVAILABLE", "Location services are off")
    }
    if maxAgeMs > 0, let last = manager.location, -last.timestamp.timeIntervalSinceNow * 1000 <= maxAgeMs {
      return promise.resolve(Self.payload(last, source: "cached"))
    }
    pending.append(promise)
    guard pending.count == 1 else { return } // a request is already in flight

    let work = DispatchWorkItem { [weak self] in
      self?.finish { $0.reject("E_TIMEOUT", "No location fix within \(Int(timeoutMs)) ms") }
    }
    timeout = work
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutMs / 1000, execute: work)
    manager.requestLocation()
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = OfflineLocationModule.status(manager.authorizationStatus)
    guard status != "undetermined" else { return }
    let waiters = permissionWaiters
    permissionWaiters.removeAll()
    waiters.forEach { $0(status) }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    finish { $0.resolve(Self.payload(location, source: "gps")) }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let code = (error as? CLError)?.code == .denied ? "E_PERMISSION" : "E_UNAVAILABLE"
    finish { $0.reject(code, error.localizedDescription) }
  }

  private func finish(_ settle: (Promise) -> Void) {
    timeout?.cancel()
    timeout = nil
    let promises = pending
    pending.removeAll()
    promises.forEach(settle)
  }

  private static func payload(_ location: CLLocation, source: String) -> [String: Any] {
    return [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracyM": location.horizontalAccuracy,
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
      "source": source,
    ]
  }
}
