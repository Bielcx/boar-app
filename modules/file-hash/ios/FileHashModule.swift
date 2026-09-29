import CryptoKit
import ExpoModulesCore
import Foundation

private let bufferBytes = 1 << 20 // 1 MiB
private let progressEveryBytes: Int64 = 32 << 20 // 32 MiB

/**
 * iOS counterpart of FileHashModule.kt: streaming SHA-256 (CryptoKit,
 * incremental) over FileHandle reads, so multi-GB GGUFs never enter JS memory.
 * Accepts file:// URIs and plain paths. URLs handed out by the document
 * picker without copying are security-scoped; access is opened around the read.
 *
 * cancel(jobId) makes that job reject with E_CANCELLED at its next chunk;
 * a cancelled copyWithSha256 deletes the partial destination.
 */
public class FileHashModule: Module {
  private let cancelLock = NSLock()
  private var cancelled = Set<String>()

  public func definition() -> ModuleDefinition {
    Name("FileHash")

    Events("onProgress")

    Function("cancel") { (jobId: String) in
      self.cancelLock.lock()
      self.cancelled.insert(jobId)
      self.cancelLock.unlock()
    }

    AsyncFunction("sha256") { (uri: String, jobId: String) -> String in
      let src = Self.fileURL(uri)
      return try Self.withScopedAccess(src) {
        let input = try FileHandle(forReadingFrom: src)
        defer { try? input.close() }
        let (digest, _) = try self.digest(input, output: nil, jobId: jobId, total: Self.size(of: src))
        return digest
      }
    }

    AsyncFunction("copyWithSha256") { (srcUri: String, destUri: String, jobId: String) -> [String: Any] in
      let src = Self.fileURL(srcUri)
      let dest = Self.fileURL(destUri)
      let fm = FileManager.default
      try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
      fm.createFile(atPath: dest.path, contents: nil)
      return try Self.withScopedAccess(src) {
        let input = try FileHandle(forReadingFrom: src)
        defer { try? input.close() }
        let output = try FileHandle(forWritingTo: dest)
        do {
          let (digest, bytes) = try self.digest(input, output: output, jobId: jobId, total: Self.size(of: src))
          try output.synchronize()
          try? output.close()
          return ["sha256": digest, "bytes": Double(bytes)]
        } catch let error as CancelledException {
          try? output.close()
          try? fm.removeItem(at: dest)
          throw error
        } catch {
          try? output.close()
          throw error
        }
      }
    }
  }

  private func digest(_ input: FileHandle, output: FileHandle?, jobId: String, total: Int64) throws -> (String, Int64) {
    defer { clearCancel(jobId) }
    var hasher = SHA256()
    var done: Int64 = 0
    var nextReport = progressEveryBytes
    while true {
      let chunk = try autoreleasepool { try input.read(upToCount: bufferBytes) }
      guard let data = chunk, !data.isEmpty else { break }
      if isCancelled(jobId) { throw CancelledException(jobId) }
      hasher.update(data: data)
      try output?.write(contentsOf: data)
      done += Int64(data.count)
      if done >= nextReport {
        nextReport = done + progressEveryBytes
        sendProgress(jobId, done, total)
      }
    }
    sendProgress(jobId, done, total)
    let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    return (hex, done)
  }

  private func isCancelled(_ jobId: String) -> Bool {
    cancelLock.lock()
    defer { cancelLock.unlock() }
    return cancelled.contains(jobId)
  }

  private func clearCancel(_ jobId: String) {
    cancelLock.lock()
    cancelled.remove(jobId)
    cancelLock.unlock()
  }

  private func sendProgress(_ jobId: String, _ done: Int64, _ total: Int64) {
    sendEvent("onProgress", ["jobId": jobId, "bytesHashed": Double(done), "totalBytes": Double(total)])
  }

  private static func fileURL(_ uri: String) -> URL {
    if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
    return URL(fileURLWithPath: uri)
  }

  private static func size(of url: URL) -> Int64 {
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber
    return size?.int64Value ?? -1
  }

  private static func withScopedAccess<T>(_ url: URL, _ body: () throws -> T) throws -> T {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return try body()
  }
}

private final class CancelledException: GenericException<String> {
  override var code: String { "E_CANCELLED" }
  override var reason: String { "File hash job \(param) was cancelled" }
}
