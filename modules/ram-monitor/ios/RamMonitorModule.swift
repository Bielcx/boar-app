import ExpoModulesCore
import Darwin
import os

/**
 * iOS counterpart of RamMonitorModule.kt. Same JS contract, iOS-native
 * figures:
 *
 * - rssBytes: task_vm_info.resident_size, the pages of this process resident
 *   in RAM right now, including clean mmap'd pages of a loaded GGUF model.
 *   Same meaning as Android's VmRSS.
 * - totalPssBytes: task_vm_info.phys_footprint. iOS has no PSS; the physical
 *   footprint is the figure jetsam compares against the per-app memory limit,
 *   so it plays the same "fair accounting" cross-check role. Clean mmap'd
 *   file pages are not counted in it, which is why a model larger than the
 *   footprint limit can still be mapped.
 * - getAvailableRamBytes: os_proc_available_memory(), how much more this
 *   process may allocate before jetsam kills it. On iOS this, not device RAM
 *   minus RSS, is the real headroom.
 *
 * getMemoryInfo also logs all three figures (at most every 5s, as the UI
 * polls it) to stderr and os_log, subsystem team.sopa.aoair, category
 * memory, so a device smoke test can record memory without Instruments:
 * `xcrun devicectl device process launch --console ...` shows the lines.
 */
public class RamMonitorModule: Module {
  private static let log = OSLog(subsystem: "team.sopa.aoair", category: "memory")
  private var lastLog = Date.distantPast

  public func definition() -> ModuleDefinition {
    Name("RamMonitor")

    Function("getMemoryInfo") { () -> [String: Double] in
      let info = Self.taskVmInfo()
      self.logThrottled(info)
      return [
        "rssBytes": Double(info?.resident_size ?? 0),
        "totalPssBytes": Double(info?.phys_footprint ?? 0),
      ]
    }

    Function("getDeviceTotalRamBytes") { () -> Double in
      return Double(ProcessInfo.processInfo.physicalMemory)
    }

    Function("getAvailableRamBytes") { () -> Double in
      return Double(os_proc_available_memory())
    }
  }

  private func logThrottled(_ info: task_vm_info_data_t?) {
    let now = Date()
    guard now.timeIntervalSince(lastLog) >= 5 else { return }
    lastLog = now
    let mb = { (bytes: UInt64) in bytes / 1_048_576 }
    let line = "[BOAR mem] rss_mb=\(mb(info?.resident_size ?? 0)) footprint_mb=\(mb(info?.phys_footprint ?? 0)) available_mb=\(mb(UInt64(os_proc_available_memory())))"
    FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
    os_log("%{public}@", log: Self.log, type: .info, line)
  }

  private static func taskVmInfo() -> task_vm_info_data_t? {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    return result == KERN_SUCCESS ? info : nil
  }
}
