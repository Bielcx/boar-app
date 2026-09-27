package expo.modules.filehash

import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

private const val BUFFER_BYTES = 1 shl 20 // 1 MiB
private const val PROGRESS_EVERY_BYTES = 32L shl 20 // 32 MiB

/**
 * Streaming SHA-256 for model files that are far too large to read into JS
 * memory. AsyncFunctions run off the main thread, so hashing a multi-GB
 * GGUF doesn't block the UI; progress is reported as "onProgress" events
 * tagged with the caller's jobId.
 */
class FileHashModule : Module() {
  // jobIds the JS side asked to stop; checked between chunks.
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  override fun definition() = ModuleDefinition {
    Name("FileHash")

    Events("onProgress")

    // Size in bytes as a Long, or -1 if unknown. expo-file-system's legacy getInfoAsync measures a content:// URI
    // with InputStream.available(), an Int, so a picked file over 2 GB read as 0 bytes and the import refused it.
    AsyncFunction("size") { uri: String ->
      sizeOf(uri).toDouble()
    }

    Function("cancel") { jobId: String ->
      cancelled.add(jobId)
    }

    AsyncFunction("sha256") { uri: String, jobId: String ->
      try {
        val total = sizeOf(uri)
        openInput(uri).use { input ->
          hex(digestStream(input, null, jobId, total))
        }
      } finally {
        cancelled.remove(jobId)
      }
    }

    AsyncFunction("copyWithSha256") { srcUri: String, destUri: String, jobId: String ->
      val total = sizeOf(srcUri)
      val dest = fileOf(destUri)
      dest.parentFile?.mkdirs()
      var bytes = 0L
      try {
        val digest = openInput(srcUri).use { input ->
          FileOutputStream(dest).use { output ->
            digestStream(input, output, jobId, total) { bytes = it }
          }
        }
        mapOf("sha256" to hex(digest), "bytes" to bytes.toDouble())
      } catch (e: Throwable) {
        dest.delete()
        throw e
      } finally {
        cancelled.remove(jobId)
      }
    }
  }

  private fun digestStream(
    input: InputStream,
    output: FileOutputStream?,
    jobId: String,
    total: Long,
    onDone: ((Long) -> Unit)? = null
  ): ByteArray {
    val md = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_BYTES)
    var done = 0L
    var nextReport = PROGRESS_EVERY_BYTES
    while (true) {
      if (cancelled.contains(jobId)) throw CodedException("E_CANCELLED", "Cancelled", null)
      val n = input.read(buffer)
      if (n < 0) break
      md.update(buffer, 0, n)
      output?.write(buffer, 0, n)
      done += n
      if (done >= nextReport) {
        nextReport = done + PROGRESS_EVERY_BYTES
        sendEvent("onProgress", mapOf("jobId" to jobId, "bytesHashed" to done.toDouble(), "totalBytes" to total.toDouble()))
      }
    }
    output?.fd?.sync()
    sendEvent("onProgress", mapOf("jobId" to jobId, "bytesHashed" to done.toDouble(), "totalBytes" to total.toDouble()))
    onDone?.invoke(done)
    return md.digest()
  }

  private fun openInput(uri: String): InputStream {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      "content" -> appContext.reactContext?.contentResolver?.openInputStream(parsed)
        ?: throw CodedException("E_OPEN", "Cannot open $uri", null)
      else -> FileInputStream(fileOf(uri))
    }
  }

  private fun sizeOf(uri: String): Long {
    val parsed = Uri.parse(uri)
    if (parsed.scheme == "content") {
      val resolver = appContext.reactContext?.contentResolver ?: return -1L
      // The descriptor's length, or the provider's OpenableColumns.SIZE when it reports UNKNOWN_LENGTH (-1).
      val fromDescriptor = runCatching { resolver.openAssetFileDescriptor(parsed, "r")?.use { it.length } }.getOrNull() ?: -1L
      if (fromDescriptor >= 0) return fromDescriptor
      return runCatching {
        resolver.query(parsed, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
          if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L
        }
      }.getOrNull() ?: -1L
    }
    return fileOf(uri).length()
  }

  private fun fileOf(uri: String): File {
    val parsed = Uri.parse(uri)
    return File(if (parsed.scheme == "file") parsed.path!! else uri)
  }

  private fun hex(bytes: ByteArray): String =
    bytes.joinToString("") { "%02x".format(it) }
}
