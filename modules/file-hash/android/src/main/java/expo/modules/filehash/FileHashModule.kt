package expo.modules.filehash

import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

private const val BUFFER_BYTES = 1 shl 20 // 1 MiB
private const val PROGRESS_EVERY_BYTES = 32L shl 20 // 32 MiB

/**
 * Streaming SHA-256 for model files that are far too large to read into JS
 * memory. AsyncFunctions run off the main thread, so hashing a multi-GB
 * GGUF doesn't block the UI; progress is reported as "onProgress" events
 * tagged with the caller's jobId.
 */
class FileHashModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FileHash")

    Events("onProgress")

    AsyncFunction("sha256") { uri: String, jobId: String ->
      val total = sizeOf(uri)
      openInput(uri).use { input ->
        hex(digestStream(input, null, jobId, total))
      }
    }

    AsyncFunction("copyWithSha256") { srcUri: String, destUri: String, jobId: String ->
      val total = sizeOf(srcUri)
      val dest = fileOf(destUri)
      dest.parentFile?.mkdirs()
      var bytes = 0L
      val digest = openInput(srcUri).use { input ->
        FileOutputStream(dest).use { output ->
          digestStream(input, output, jobId, total) { bytes = it }
        }
      }
      mapOf("sha256" to hex(digest), "bytes" to bytes.toDouble())
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
      return appContext.reactContext?.contentResolver
        ?.openAssetFileDescriptor(parsed, "r")
        ?.use { it.length }
        ?: -1L
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
