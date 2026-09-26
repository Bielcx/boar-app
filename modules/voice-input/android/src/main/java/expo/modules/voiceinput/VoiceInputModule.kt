package expo.modules.voiceinput

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Speech-to-text via Android's SpeechRecognizer, in one of two modes
 * (getRecognitionMode):
 *
 * - "on-device": Android 12+ createOnDeviceSpeechRecognizer. Audio is
 *   processed on the phone; this is the only mode BOAR uses by default.
 * - "system": the regular system recognition service with
 *   EXTRA_PREFER_OFFLINE, which is only a hint — Google's service (or an
 *   OEM's) may send audio to its servers. The JS side only allows it after
 *   the user explicitly accepts that (src/voice/voicePolicy.ts), and never
 *   in the offline build.
 *
 * Both depend on a system-provided recognition
 * service (Google's, or an OEM's) being installed — commonly true on stock
 * Android/most OEM builds, commonly FALSE on GrapheneOS or other
 * de-Googled builds with no such service. isAvailable() reflects this
 * honestly rather than pretending to work; the JS side (src/voice/VoiceInput.ts)
 * surfaces it as an "unavailable" state instead of a silent failure.
 *
 * A cross-device guarantee (e.g. a bundled whisper.cpp model) would need a
 * separate, much larger native binding — not attempted here; see
 * docs/MODELS.md for the honest scope note.
 */
class VoiceInputModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("VoiceInput")

    Events("onSpeechStart", "onSpeechEnd", "onPartialResults", "onResults", "onError")

    AsyncFunction("isAvailable") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      mainHandler.post {
        promise.resolve(SpeechRecognizer.isRecognitionAvailable(context))
      }
    }

    AsyncFunction("getRecognitionMode") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("unavailable")
        return@AsyncFunction
      }
      mainHandler.post {
        promise.resolve(
          when {
            onDeviceAvailable(context) -> "on-device"
            SpeechRecognizer.isRecognitionAvailable(context) -> "system"
            else -> "unavailable"
          }
        )
      }
    }

    AsyncFunction("startListening") { requireOnDevice: Boolean, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "No React context available", null)
        return@AsyncFunction
      }

      val hasPermission = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECORD_AUDIO
      ) == PackageManager.PERMISSION_GRANTED

      if (requireOnDevice && !onDeviceAvailable(context)) {
        promise.reject("E_ON_DEVICE_UNAVAILABLE", "On-device speech recognition is not available on this phone", null)
        return@AsyncFunction
      }

      if (hasPermission) {
        beginListening(context, requireOnDevice, promise)
        return@AsyncFunction
      }

      val permissions = appContext.permissions
      if (permissions == null) {
        promise.reject("E_NO_PERMISSIONS_MODULE", "Permissions module unavailable", null)
        return@AsyncFunction
      }
      permissions.askForPermissions({ result ->
        val granted = result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
        if (granted) {
          beginListening(context, requireOnDevice, promise)
        } else {
          promise.reject("E_PERMISSION_DENIED", "Microphone permission denied", null)
        }
      }, Manifest.permission.RECORD_AUDIO)
    }

    AsyncFunction("stopListening") { promise: Promise ->
      mainHandler.post {
        recognizer?.stopListening()
        promise.resolve(null)
      }
    }

    OnDestroy {
      mainHandler.post {
        recognizer?.destroy()
        recognizer = null
      }
    }
  }

  private fun onDeviceAvailable(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  private fun beginListening(context: Context, requireOnDevice: Boolean, promise: Promise) {
    mainHandler.post {
      try {
        recognizer?.destroy()
        val created = if (requireOnDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
          SpeechRecognizer.createSpeechRecognizer(context)
        }
        recognizer = created.apply {
          setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}

            override fun onBeginningOfSpeech() {
              sendEvent("onSpeechStart", mapOf<String, Any?>())
            }

            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
              sendEvent("onSpeechEnd", mapOf<String, Any?>())
            }

            override fun onError(error: Int) {
              sendEvent(
                "onError",
                mapOf("code" to error.toString(), "message" to errorMessage(error))
              )
            }

            override fun onResults(results: Bundle?) {
              val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: ""
              sendEvent("onResults", mapOf("text" to text))
            }

            override fun onPartialResults(partialResults: Bundle?) {
              val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: ""
              sendEvent("onPartialResults", mapOf("text" to text))
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
          })
        }

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }

        recognizer?.startListening(intent)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("E_START_FAILED", e.message ?: "Failed to start listening", e)
      }
    }
  }

  private fun errorMessage(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
    SpeechRecognizer.ERROR_CLIENT -> "Client side error"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
    SpeechRecognizer.ERROR_NETWORK -> "Network error"
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
    SpeechRecognizer.ERROR_NO_MATCH -> "No speech match"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
    SpeechRecognizer.ERROR_SERVER -> "Server error"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input"
    else -> "Unknown error ($error)"
  }
}
