Pod::Spec.new do |s|
  s.name           = 'DeviceLocation'
  s.version        = '0.1.0'
  # Self-contained (no ../package.json): this ios/ dir can land before the
  # module's JS side, and pod install must not break in between.
  s.summary        = 'Offline device position via CoreLocation (no geocoding, no network).'
  s.license        = 'MIT'
  s.authors        = 'BOAR'
  s.homepage       = 'https://github.com/rferrari/boar-app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
