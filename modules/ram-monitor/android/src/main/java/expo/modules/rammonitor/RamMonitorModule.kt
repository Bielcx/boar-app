package expo.modules.rammonitor

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Debug
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile

/**
 * Reports this process's real memory usage, unlike the JS heap size (which
 * only covers JS-allocated objects and misses the mmap'd model weights,
 * native inference buffers, etc). Two figures are exposed:
 *
 * - rssBytes: resident set size from /proc/self/status (VmRSS) — includes
 *   mmap'd pages actually resident in RAM right now, which is the figure
 *   that matters for auditing the 12GB RAM cap while a GGUF model is
 *   memory-mapped.
 * - totalPssBytes: proportional set size via ActivityManager, a slower but
 *   more "fair" accounting that avoids double-counting shared pages across
 *   processes; useful as a cross-check.
 */
class RamMonitorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RamMonitor")

    Function("getMemoryInfo") {
      val rss = readRssBytes()
      val pss = readTotalPssBytes()
      mapOf(
        "rssBytes" to rss,
        "totalPssBytes" to pss
      )
    }

    // Total physical RAM on this device, for the model catalog's
    // compatibility badges (comparing a candidate model's size against what
    // the device actually has, not just the bounty's 12GB ceiling).
    Function("getDeviceTotalRamBytes") {
      readDeviceTotalRamBytes()
    }

    // The hardware an evaluation ran on, for shared results (src/eval/shareResults.ts):
    // llama.cpp speed depends on the chipset, the cores' top frequencies and CPU
    // features such as i8mm and dotprod. The chipset name needs Android 12 (API 31).
    Function("getHardwareInfo") {
      mapOf(
        "socModel" to (if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL else ""),
        "socManufacturer" to (if (Build.VERSION.SDK_INT >= 31) Build.SOC_MANUFACTURER else ""),
        "hardware" to Build.HARDWARE,
        "apiLevel" to Build.VERSION.SDK_INT,
        "cpuFeatures" to readCpuFeatures(),
        "coreMaxFreqKHz" to readCoreMaxFreqs()
      )
    }

    // RAM the kernel can hand to a new allocation right now (free +
    // reclaimable cache, ~MemAvailable), for the pre-load fit check. More
    // honest than total - our RSS - a fixed guess for everyone else.
    Function("getAvailableRamBytes") {
      readAvailableRamBytes()
    }
  }

  private fun readCpuFeatures(): String {
    return try {
      File("/proc/cpuinfo").readLines().firstOrNull { it.startsWith("Features") }?.substringAfter(':')?.trim() ?: ""
    } catch (e: Exception) {
      ""
    }
  }

  /** Each core's highest frequency in kHz, in core order; 0 where the kernel doesn't say. */
  private fun readCoreMaxFreqs(): List<Int> {
    return (0 until Runtime.getRuntime().availableProcessors()).map { cpu ->
      try {
        File("/sys/devices/system/cpu/cpu$cpu/cpufreq/cpuinfo_max_freq").readText().trim().toInt()
      } catch (e: Exception) {
        0
      }
    }
  }

  private fun readAvailableRamBytes(): Long {
    return try {
      val context = appContext.reactContext ?: return 0L
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo()
      am.getMemoryInfo(info)
      info.availMem
    } catch (e: Exception) {
      0L
    }
  }

  private fun readDeviceTotalRamBytes(): Long {
    return try {
      val context = appContext.reactContext ?: return 0L
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo()
      am.getMemoryInfo(info)
      info.totalMem
    } catch (e: Exception) {
      0L
    }
  }

  private fun readRssBytes(): Long {
    return try {
      RandomAccessFile("/proc/self/status", "r").use { reader ->
        var line: String?
        while (reader.readLine().also { line = it } != null) {
          if (line!!.startsWith("VmRSS:")) {
            val kb = line!!.replace(Regex("[^0-9]"), "").toLongOrNull() ?: 0L
            return kb * 1024L
          }
        }
        0L
      }
    } catch (e: Exception) {
      0L
    }
  }

  private fun readTotalPssBytes(): Long {
    return try {
      val context = appContext.reactContext ?: return 0L
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val pid = android.os.Process.myPid()
      val infos: Array<Debug.MemoryInfo> = am.getProcessMemoryInfo(intArrayOf(pid))
      if (infos.isEmpty()) 0L else infos[0].totalPss.toLong() * 1024L
    } catch (e: Exception) {
      0L
    }
  }
}
