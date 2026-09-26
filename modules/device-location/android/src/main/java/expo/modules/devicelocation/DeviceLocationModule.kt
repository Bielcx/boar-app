package expo.modules.devicelocation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Position from the phone's own GPS via the plain Android LocationManager.
 * Deliberately NOT Google's FusedLocationProviderClient (Play Services, absent
 * on GrapheneOS) and NOT NETWORK_PROVIDER (on most phones that's a Google or
 * OEM service that looks up Wi-Fi/cell positions online). Only GPS_PROVIDER
 * for fresh fixes, and the passive provider's last known fix as a fallback.
 * Foreground only; nothing is stored or sent.
 */
class DeviceLocationModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("DeviceLocation")

    AsyncFunction("getPermissionStatus") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("denied")
        return@AsyncFunction
      }
      if (hasFine(context) || hasCoarse(context)) {
        promise.resolve("granted")
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve("denied")
        return@AsyncFunction
      }
      permissions.getPermissions({ result ->
        val statuses = result.values.map { it.status }
        promise.resolve(
          if (statuses.any { it == PermissionsStatus.UNDETERMINED }) "undetermined" else "denied"
        )
      }, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve("denied")
        return@AsyncFunction
      }
      permissions.askForPermissions({ result ->
        val granted = result.values.any { it.status == PermissionsStatus.GRANTED }
        promise.resolve(if (granted) "granted" else "denied")
      }, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    AsyncFunction("getCurrentPosition") { timeoutMs: Double, maxAgeMs: Double, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_UNAVAILABLE", "No React context available", null)
        return@AsyncFunction
      }
      val fine = hasFine(context)
      if (!fine && !hasCoarse(context)) {
        promise.reject("E_PERMISSION", "Location permission not granted", null)
        return@AsyncFunction
      }
      val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      val cached = lastKnown(lm, fine)
      val now = System.currentTimeMillis()
      if (cached != null && now - cached.time <= maxAgeMs.toLong()) {
        promise.resolve(toMap(cached, "cached"))
        return@AsyncFunction
      }
      if (!fine || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
        if (cached != null) promise.resolve(toMap(cached, "cached"))
        else promise.reject("E_UNAVAILABLE", "GPS is off or only approximate location was allowed", null)
        return@AsyncFunction
      }
      freshGpsFix(lm, timeoutMs.toLong(), cached, promise)
    }
  }

  @Suppress("MissingPermission")
  private fun freshGpsFix(lm: LocationManager, timeoutMs: Long, cached: Location?, promise: Promise) {
    val settled = AtomicBoolean(false)
    val cancel = CancellationSignal()
    var listener: LocationListener? = null

    fun finish(location: Location?) {
      if (!settled.compareAndSet(false, true)) return
      listener?.let { lm.removeUpdates(it) }
      when {
        location != null -> promise.resolve(toMap(location, "gps"))
        cached != null -> promise.resolve(toMap(cached, "cached"))
        else -> promise.reject("E_TIMEOUT", "No GPS fix within ${timeoutMs}ms", null)
      }
    }

    mainHandler.post {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          lm.getCurrentLocation(LocationManager.GPS_PROVIDER, cancel, ContextCompat.getMainExecutor(appContext.reactContext!!)) {
            finish(it)
          }
        } else {
          val l = object : LocationListener {
            override fun onLocationChanged(location: Location) = finish(location)
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) = finish(null)
          }
          listener = l
          @Suppress("DEPRECATION")
          lm.requestSingleUpdate(LocationManager.GPS_PROVIDER, l, Looper.getMainLooper())
        }
      } catch (e: Exception) {
        finish(null)
        return@post
      }
      mainHandler.postDelayed({
        cancel.cancel()
        finish(null)
      }, timeoutMs)
    }
  }

  @Suppress("MissingPermission")
  private fun lastKnown(lm: LocationManager, fine: Boolean): Location? {
    val providers = if (fine) listOf(LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER)
      else listOf(LocationManager.PASSIVE_PROVIDER)
    return providers
      .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
      .maxByOrNull { it.time }
  }

  private fun hasFine(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun hasCoarse(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun toMap(l: Location, source: String) = mapOf(
    "latitude" to l.latitude,
    "longitude" to l.longitude,
    "accuracyM" to (if (l.hasAccuracy()) l.accuracy.toDouble() else -1.0),
    "timestamp" to l.time.toDouble(),
    "source" to source
  )
}
