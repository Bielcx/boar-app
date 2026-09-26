import ExpoModulesCore
import Foundation

/**
 * iOS counterpart of BundledAssetsModule.kt. Android bakes models into the
 * APK's assets/; on iOS the equivalent is a folder reference named after the
 * subdir (e.g. "models") in the app bundle's resources. No build plugin adds
 * that folder on iOS yet, so list() normally returns [] and the app falls back
 * to downloaded/imported models — same as an Android build without
 * withBundledModels.
 *
 * Also owns excludeFromBackup(): multi-GB model files must not go to iCloud
 * backup (Apple rejects apps that back up re-downloadable data, and the user's
 * iCloud quota would fill up).
 */
public class BundledAssetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BundledAssets")

    AsyncFunction("list") { (subdir: String) -> [String] in
      guard let dir = Bundle.main.resourceURL?.appendingPathComponent(subdir) else { return [] }
      return (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
    }

    // Copies <bundle>/<assetPath> to destAbsolutePath via a .part file, so an
    // interrupted copy never leaves a truncated model under the final name.
    AsyncFunction("copyToFile") { (assetPath: String, destAbsolutePath: String) -> Double in
      guard let source = Bundle.main.resourceURL?.appendingPathComponent(assetPath),
            FileManager.default.fileExists(atPath: source.path) else {
        throw Exception(name: "E_NO_ASSET", description: "BundledAssets: \(assetPath) not in app bundle")
      }
      let dest = Self.fileURL(destAbsolutePath)
      let tmp = dest.appendingPathExtension("part")
      let fm = FileManager.default
      try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? fm.removeItem(at: tmp)
      try fm.copyItem(at: source, to: tmp)
      try? fm.removeItem(at: dest)
      try fm.moveItem(at: tmp, to: dest)
      try Self.setExcludedFromBackup(dest)
      let size = try fm.attributesOfItem(atPath: dest.path)[.size] as? NSNumber
      return size?.doubleValue ?? 0
    }

    // Marks a file or directory as excluded from iCloud/iTunes backup.
    // Returns false if the path doesn't exist.
    AsyncFunction("excludeFromBackup") { (path: String) -> Bool in
      let url = Self.fileURL(path)
      guard FileManager.default.fileExists(atPath: url.path) else { return false }
      try Self.setExcludedFromBackup(url)
      return true
    }
  }

  // Accepts both "file:///..." URIs (expo-file-system) and plain paths.
  private static func fileURL(_ path: String) -> URL {
    if path.hasPrefix("file://"), let url = URL(string: path) { return url }
    return URL(fileURLWithPath: path)
  }

  private static func setExcludedFromBackup(_ url: URL) throws {
    var mutableUrl = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutableUrl.setResourceValues(values)
  }
}
